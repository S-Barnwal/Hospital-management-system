// Phase 4 integration tests: token queue & TV screens, online booking, ABHA & patient photo, support tickets,
// sign-in history, hospital groups, coupons and free trials. Same rules as the other suites: a REAL SQL Server *test*
// database (or INTEGRATION_DB_OK), never production. Hospital B must get 404/400 for every one of A's records.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { config } from '../../src/config/env.js';
import { createApp } from '../../src/app.js';
import { db, withTransaction, closePool } from '../../src/db/pool.js';
import { migrate } from '../../src/db/migrate.js';
import { seedPermissions } from '../../src/db/seed.js';
import { provisionTenant } from '../../src/modules/tenants/provisioning.js';
import { hashPassword } from '../../src/utils/password.js';
import { assertSafeDatabase, retireTestHospitals } from './_safety.js';

const IS_TEST_DB = assertSafeDatabase(config);
const PASSWORD = 'IsolationTest123';
const suffix = randomUUID().slice(0, 6);
const A = { slug: `p4-a-${suffix}`, email: `p4-owner-a-${suffix}@test.local` };
const B = { slug: `p4-b-${suffix}`, email: `p4-owner-b-${suffix}@test.local` };
const TRIAL = { slug: `p4-trial-${suffix}`, email: `p4-trial-${suffix}@test.local` };
let server; let base;
const ids = {};
const restore = {};

function client() {
  const jar = new Map();
  return async (method, p, body) => {
    const res = await fetch(`${base}${p}`, {
      method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/129.0 Safari/537.36', Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie()) { const [pair] = c.split(';'); const i = pair.indexOf('='); jar.set(pair.slice(0, i), pair.slice(i + 1)); }
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  };
}
const a = client();
const b = client();
const pub = client();
const ok = (r, code = 200) => { assert.equal(r.status, code, JSON.stringify(r.body)); return r.body.data; };

async function makeTenant(t) {
  const plan = await db.one(`SELECT PlanId FROM hms.Plans WHERE Code = 'professional'`);
  return withTransaction(async (tx) => provisionTenant(tx, {
    orgName: `Phase4 ${t.slug}`, slug: t.slug, ownerName: 'Owner', ownerEmail: t.email, ownerPasswordHash: await hashPassword(PASSWORD),
  }, { planId: plan.PlanId, interval: 'monthly' }, null));
}

before(async () => {
  await migrate({ log: () => {} });
  await seedPermissions();
  ids.tenantA = (await makeTenant(A)).tenantId;
  ids.tenantB = (await makeTenant(B)).tenantId;
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  ok(await a('POST', '/auth/login', { email: A.email, password: PASSWORD, workspace: A.slug }));
  ok(await b('POST', '/auth/login', { email: B.email, password: PASSWORD, workspace: B.slug }));
  ids.patientA = ok(await a('POST', '/patients', { firstName: 'Queue', lastName: `Patient-${suffix}` }), 201).id;
  ids.doctorA = ok(await a('POST', '/hr/staff', { staffType: 'doctor', fullName: `Dr Alpha ${suffix}`, room: '3' }), 201).id;
  ids.doctorB = ok(await b('POST', '/hr/staff', { staffType: 'doctor', fullName: `Dr Beta ${suffix}` }), 201).id;
});

after(async () => {
  server?.close();
  if (restore.trialDays !== undefined) await db.exec(`UPDATE hms.Plans SET TrialDays = @d WHERE Code = 'professional'`, { d: restore.trialDays }).catch(() => {});
  if (ids.couponId) await db.exec('UPDATE hms.Coupons SET IsActive = 0 WHERE CouponId = @c', { c: ids.couponId }).catch(() => {});
  if (ids.groupId) {
    await db.exec(`/* tenant-safe: test clean-up */ UPDATE hms.Tenants SET GroupId = NULL WHERE GroupId = @g`, { g: ids.groupId }).catch(() => {});
    await db.exec('DELETE FROM hms.TenantGroups WHERE GroupId = @g', { g: ids.groupId }).catch(() => {});
  }
  await retireTestHospitals(db, [A.slug, B.slug, TRIAL.slug], IS_TEST_DB).catch(() => {});
  await closePool();
});

describe('Phase 4: token queue and TV screens', () => {
  test('numbers per queue per day, priority first, other hospitals locked out, TV shows no patient data', async () => {
    const key = `doctor:${ids.doctorA}`;
    const t1 = ok(await a('POST', '/queue/tokens', { queueKey: key, patientId: ids.patientA }), 201);
    const t2 = ok(await a('POST', '/queue/tokens', { queueKey: key }), 201);
    const t3 = ok(await a('POST', '/queue/tokens', { queueKey: key, priority: true }), 201);
    assert.deepEqual([t1.number, t2.number, t3.number], [1, 2, 3]);
    assert.equal(ok(await a('POST', '/queue/tokens', { queueKey: 'lab' }), 201).number, 1, 'each queue has its own numbers');
    // B can neither issue into A's doctor queue, nor touch A's tokens, nor put A's patient on a token.
    assert.equal((await b('POST', '/queue/tokens', { queueKey: key })).status, 400);
    assert.equal((await b('POST', '/queue/tokens', { queueKey: 'lab', patientId: ids.patientA })).status, 400);
    assert.equal((await b('POST', `/queue/tokens/${t1.id}/status`, { status: 'cancelled' })).status, 404);
    assert.equal((await b('POST', '/queue/call-next', { queueKey: key })).status, 400);
    assert.equal((await a('POST', '/queue/tokens', { queueKey: 'doctor:abc' })).status, 400);

    const first = ok(await a('POST', '/queue/call-next', { queueKey: key }));
    assert.equal(first.number, 3, 'priority token first');
    assert.equal(first.counter, '3', 'doctor room used as counter');
    assert.equal(ok(await a('POST', '/queue/call-next', { queueKey: key })).number, 1);
    assert.equal((await a('POST', `/queue/tokens/${t3.id}/status`, { status: 'waiting' })).status, 409, 'done tokens are final');
    const boardB = ok(await b('GET', '/queue/board'));
    assert.ok(!boardB.queues.some((q) => q.key === key), 'B never sees A\'s queue');

    const screen = ok(await a('POST', '/queue/screens', { name: 'Hall', queueKeys: [key] }), 201);
    const token = screen.url.split('/tv/')[1];
    assert.equal((await b('POST', '/queue/screens', { name: 'Hall', queueKeys: [key] })).status, 400, 'B cannot show A\'s queue');
    const tv = ok(await pub('GET', `/public/display/${token}`));
    assert.equal(tv.queues[0].current.number, 1);
    const text = JSON.stringify(tv);
    assert.ok(!/Patient-|Queue|firstName|patientNumber|patientId/.test(text), 'no patient data on the TV feed');
    const screens = ok(await a('GET', '/queue/screens'));
    assert.equal((await b('DELETE', `/queue/screens/${screens[0].id}`)).status, 404);
    ok(await a('DELETE', `/queue/screens/${screens[0].id}`));
    assert.equal((await pub('GET', `/public/display/${token}`)).status, 404, 'revoked link stops working');
    assert.equal((await pub('GET', `/public/display/${'x'.repeat(43)}`)).status, 404);
  });

  test('checking an appointment in issues its doctor-queue token once', async () => {
    const today = (await a('GET', '/hr/attendance')).body.meta.today;
    const blocks = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startTime: '00:00', endTime: '23:59', slotMinutes: 15 }));
    ok(await a('PUT', `/hr/staff/${ids.doctorA}/schedule`, { blocks }));
    const av = ok(await a('GET', `/appointments/availability?doctorId=${ids.doctorA}&date=${today}`));
    if (!av.slots.length) return; // late night: no slot left today — covered by the booking test instead
    const appt = ok(await a('POST', '/appointments', { patientId: ids.patientA, doctorId: ids.doctorA, date: today, time: av.slots[0] }), 201);
    const r = ok(await a('POST', `/appointments/${appt.id}/status`, { status: 'checked_in' }));
    assert.ok(r.token?.number > 0);
    const again = await a('POST', '/queue/tokens', { appointmentId: appt.id });
    assert.equal(again.status, 200);
    assert.equal(again.body.data.number, r.token.number, 'same token returned');
    assert.equal((await b('POST', '/queue/tokens', { appointmentId: appt.id })).status, 404);
  });
});

describe('Phase 4: online booking', () => {
  test('public page only when switched on; request → confirm creates patient + appointment; B is locked out', async () => {
    assert.equal((await pub('GET', `/public/booking/${A.slug}`)).status, 404, 'off by default');
    const s = ok(await a('GET', '/settings'));
    ok(await a('PUT', '/settings', { name: s.Name, timezone: s.Timezone, settings: { 'booking.enabled': 'on', 'booking.notice': 'Bring old reports' } }));
    const page = ok(await pub('GET', `/public/booking/${A.slug}`));
    assert.ok(page.doctors.some((d) => d.id === ids.doctorA), 'scheduled doctor listed');
    assert.ok(!page.doctors.some((d) => d.id === ids.doctorB));
    assert.equal(page.notice, 'Bring old reports');
    assert.ok(!JSON.stringify(page).includes('Patient-'), 'no patient data on the public page');
    const date = new Date(Date.parse(`${page.today}T00:00:00Z`) + 86400000).toISOString().slice(0, 10); // tomorrow: whole day free
    const { slots } = ok(await pub('GET', `/public/booking/${A.slug}/slots?doctorId=${ids.doctorA}&date=${date}`));
    assert.ok(slots.length > 10);
    assert.equal((await pub('GET', `/public/booking/${A.slug}/slots?doctorId=${ids.doctorB}&date=${date}`)).status, 404, 'other hospital\'s doctor');
    const body = { doctorId: ids.doctorA, date, time: slots[2], name: `Online Person ${suffix}`, phone: '+919812345678', consent: true };
    assert.equal((await pub('POST', `/public/booking/${A.slug}`, { ...body, consent: false })).status, 400);
    assert.equal((await pub('POST', `/public/booking/${A.slug}`, { ...body, website: 'spam' })).status, 400, 'honeypot');
    const req1 = ok(await pub('POST', `/public/booking/${A.slug}`, body), 201);
    assert.match(req1.ref, /^[A-Z2-9]{8}$/);
    assert.equal((await pub('POST', `/public/booking/${A.slug}`, body)).status, 409, 'same slot cannot be requested twice');
    const after = ok(await pub('GET', `/public/booking/${A.slug}/slots?doctorId=${ids.doctorA}&date=${date}`)).slots;
    assert.ok(!after.includes(slots[2]), 'requested slot is held');

    const list = ok(await a('GET', '/booking/requests?status=pending'));
    const r = list.find((x) => x.ref === req1.ref);
    assert.ok(r);
    assert.ok(!ok(await b('GET', '/booking/requests')).some((x) => x.ref === req1.ref));
    assert.equal((await b('POST', `/booking/requests/${r.id}/confirm`, {})).status, 404);
    assert.equal((await b('POST', `/booking/requests/${r.id}/reject`, { note: 'nope' })).status, 404);
    assert.equal((await a('POST', `/booking/requests/${r.id}/confirm`, { patientId: 999999999 })).status, 400);
    const conf = ok(await a('POST', `/booking/requests/${r.id}/confirm`, {}));
    assert.match(conf.appointmentNumber, /^APT-/);
    const patient = ok(await a('GET', `/patients/${conf.patientId}`));
    assert.equal(patient.phone, '+919812345678');
    assert.equal((await a('POST', `/booking/requests/${r.id}/confirm`, {})).status, 409, 'confirmed once');
  });
});

describe('Phase 4: ABHA, patient photo, support, sign-in history', () => {
  test('ABHA is validated and unique per hospital; photo must be the patient\'s own image', async () => {
    assert.equal((await a('PATCH', `/patients/${ids.patientA}`, { abhaNumber: '1234' })).status, 400);
    ok(await a('PATCH', `/patients/${ids.patientA}`, { abhaNumber: '91-1234-5678-9012', abhaAddress: `queue.${suffix}@abdm` }));
    const p = ok(await a('GET', `/patients/${ids.patientA}`));
    assert.equal(p.abhaNumber, '91123456789012');
    assert.equal(p.abhaNumberFormatted, '91-1234-5678-9012');
    assert.equal((await a('POST', '/patients', { firstName: 'Dup', abhaNumber: '91123456789012' })).status, 409);
    ok(await b('POST', '/patients', { firstName: 'Other hospital', abhaNumber: '91123456789012' }), 201); // a different hospital may hold the same ABHA
    assert.equal((await b('PUT', `/patients/${ids.patientA}/photo`, { attachmentId: null })).status, 404);
    assert.equal((await a('PUT', `/patients/${ids.patientA}/photo`, { attachmentId: 999999999 })).status, 400);
  });

  test('support tickets stay with their hospital; internal notes are never shown to it', async () => {
    const t = ok(await a('POST', '/support/tickets', { subject: 'Printer question', category: 'technical', message: 'How do I print a token slip?' }), 201);
    assert.match(t.number, /^TKT-\d{6}$/);
    assert.equal((await b('GET', `/support/tickets/${t.id}`)).status, 404);
    assert.equal((await b('POST', `/support/tickets/${t.id}/messages`, { body: 'hijack' })).status, 404);
    assert.equal((await b('POST', `/support/tickets/${t.id}/close`)).status, 404);
    assert.ok(!ok(await b('GET', '/support/tickets')).some((x) => x.id === t.id));
    await db.exec(`INSERT INTO hms.SupportTicketMessages (TenantId, TicketId, AuthorType, AuthorName, Body, IsInternal) VALUES (@tid, @id, 'support', 'Agent', 'internal: check logs', 1)`,
      { tid: ids.tenantA, id: t.id });
    const thread = ok(await a('GET', `/support/tickets/${t.id}`));
    assert.ok(!thread.messages.some((m) => m.body.includes('internal')), 'internal note hidden');
    ok(await a('POST', `/support/tickets/${t.id}/messages`, { body: 'Any update?' }), 201);
    assert.equal(ok(await a('GET', `/support/tickets/${t.id}`)).status, 'awaiting_support');
    ok(await a('POST', `/support/tickets/${t.id}/close`));
    assert.equal((await a('POST', `/support/tickets/${t.id}/messages`, { body: 'again' })).status, 409);
  });

  test('sign-in history lists only this hospital\'s sign-ins, including failures', async () => {
    await client()('POST', '/auth/login', { email: A.email, password: 'wrong-password-1', workspace: A.slug });
    const rows = ok(await a('GET', '/users/login-history'));
    assert.ok(rows.some((r) => r.success && r.email === A.email));
    assert.ok(rows.some((r) => !r.success && r.reason === 'bad_password'));
    assert.ok(!rows.some((r) => r.email === B.email), 'no other hospital');
    assert.equal(rows[0].device.includes('Windows') || rows[0].device.length > 0, true);
    assert.ok(!('userAgent' in rows[0]), 'raw user-agent not returned');
  });
});

describe('Phase 4: groups, coupons and trials', () => {
  test('branches: figures only for branches where the same e-mail has an account', async () => {
    ids.groupId = (await db.one(`INSERT INTO hms.TenantGroups (Name) OUTPUT INSERTED.GroupId VALUES (@n)`, { n: `Group ${suffix}` })).GroupId;
    await db.exec(`/* tenant-safe: test setup */ UPDATE hms.Tenants SET GroupId = @g WHERE TenantId IN (@a, @b)`, { g: ids.groupId, a: ids.tenantA, b: ids.tenantB });
    const r = ok(await a('GET', '/branches'));
    assert.equal(r.branches.length, 2);
    const other = r.branches.find((x) => x.tenantId === ids.tenantB);
    assert.equal(other.accessible, false);
    assert.equal(other.figures, null, 'no figures for a branch the user cannot sign in to');
    assert.ok(r.branches.find((x) => x.tenantId === ids.tenantA).figures);
  });

  test('coupon preview prices before GST; bad codes are refused', async () => {
    ids.couponId = (await db.one(`INSERT INTO hms.Coupons (Code, Description, PercentOff, AppliesTo, MaxRedemptions) OUTPUT INSERTED.CouponId
                                  VALUES (@c, N'Test 20%', 20, 'both', 5)`, { c: `T${suffix.toUpperCase()}` })).CouponId;
    const plan = await db.one(`SELECT IsFree FROM hms.Plans WHERE Code = 'professional'`);
    if (plan.IsFree) return; // free-for-now mode: nothing to discount
    const r = ok(await pub('POST', '/onboarding/coupon-preview', { planCode: 'professional', interval: 'monthly', couponCode: `t${suffix}` }));
    assert.ok(Number(r.amount.discount) > 0);
    assert.equal((Number(r.amount.subtotal) - Number(r.amount.discount) + Number(r.amount.tax)).toFixed(2), r.amount.total);
    assert.equal((await pub('POST', '/onboarding/coupon-preview', { planCode: 'professional', interval: 'monthly', couponCode: 'NOPE-XYZ' })).status, 400);
    ok(await a('POST', '/subscription/coupon-preview', { planCode: 'professional', interval: 'monthly', couponCode: `T${suffix.toUpperCase()}` }));
  });

  test('free trial: workspace without payment, trial flag, one trial per e-mail', async () => {
    const plan = await db.one(`SELECT TrialDays, IsFree FROM hms.Plans WHERE Code = 'professional'`);
    if (plan.IsFree) return;
    restore.trialDays = plan.TrialDays;
    await db.exec(`UPDATE hms.Plans SET TrialDays = 14 WHERE Code = 'professional'`);
    const body = { planCode: 'professional', interval: 'monthly', orgName: `Trial ${suffix}`, slug: TRIAL.slug, facilityType: 'clinic', phone: '+919876500000',
      ownerName: 'Trial Owner', ownerEmail: TRIAL.email, password: 'TrialPass12345', acceptTerms: true, country: 'IN', state: 'DL', city: 'New Delhi', trial: true };
    const r = ok(await client()('POST', '/onboarding/checkout', body), 201);
    assert.equal(r.trial, true);
    const sub = await db.one(`/* tenant-safe: test check */ SELECT s.IsTrial, DATEDIFF(DAY, s.CurrentPeriodStart, s.CurrentPeriodEnd) AS days FROM hms.Subscriptions s
                              JOIN hms.Tenants t ON t.TenantId = s.TenantId WHERE t.Slug = @slug`, { slug: TRIAL.slug });
    assert.equal(sub.IsTrial, true);
    assert.equal(sub.days, 14);
    const again = await client()('POST', '/onboarding/checkout', { ...body, slug: `${TRIAL.slug}-2` });
    assert.equal(again.status, 409, 'one trial per e-mail');
  });
});

describe('Phase 4: Super Admin endpoints', () => {
  test('reject hospital sessions and anonymous callers', async () => {
    for (const p of ['/admin/coupons', '/admin/revenue', '/admin/monitoring', '/admin/login-history', '/admin/support/tickets', '/admin/groups', '/admin/team']) {
      assert.equal((await a('GET', p)).status, 401, p);
      assert.equal((await pub('GET', p)).status, 401, p);
    }
    assert.equal((await a('POST', '/admin/coupons', { code: 'HACK50', percentOff: 50 })).status, 401);
    assert.equal((await a('PUT', `/admin/tenants/${ids.tenantB}/group`, { groupId: null })).status, 401);
  });
});
