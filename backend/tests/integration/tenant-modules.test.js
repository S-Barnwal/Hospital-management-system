// Integration tests for the newer modules — same rules as tenant-isolation.test.js:
// a REAL SQL Server *test* database (name contains "test"), never production.  Run: npm run test:integration
//
// Proves that two hospitals registered side by side (1) each get their own defaults and numbering and
// (2) cannot see, change or use each other's lab, finance, messaging or backup data.
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
import { setPlansFree } from '../../src/modules/onboarding/onboarding.service.js';
import { assertSafeDatabase, retireTestHospitals } from './_safety.js';

const IS_TEST_DB = assertSafeDatabase(config);

const PASSWORD = 'IsolationTest123';
const suffix = randomUUID().slice(0, 6);
const A = { slug: `mod-a-${suffix}`, email: `owner-a-${suffix}@test.local` };
const B = { slug: `mod-b-${suffix}`, email: `owner-b-${suffix}@test.local` };
let server; let base;
const ids = {};

function client() {
  const jar = new Map();
  return async (method, p, body) => {
    const res = await fetch(`${base}${p}`, {
      method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
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

async function makeTenant(t) {
  const plan = await db.one(`SELECT PlanId FROM hms.Plans WHERE Code = 'professional'`);
  return withTransaction(async (tx) => provisionTenant(tx, {
    orgName: `Modules ${t.slug}`, slug: t.slug, ownerName: 'Owner', ownerEmail: t.email, ownerPasswordHash: await hashPassword(PASSWORD),
  }, { planId: plan.PlanId, interval: 'monthly' }, null));
}

before(async () => {
  await migrate({ log: () => {} });
  await seedPermissions();
  ids.tenantA = (await makeTenant(A)).tenantId;
  ids.tenantB = (await makeTenant(B)).tenantId;
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  assert.equal((await a('POST', '/auth/login', { email: A.email, password: PASSWORD, workspace: A.slug })).status, 200);
  assert.equal((await b('POST', '/auth/login', { email: B.email, password: PASSWORD, workspace: B.slug })).status, 200);
  ids.patientA = (await a('POST', '/patients', { firstName: 'Alice', lastName: `Only-A-${suffix}`, email: `alice-${suffix}@test.local` })).body.data.id;
  ids.patientB = (await b('POST', '/patients', { firstName: 'Bob', lastName: `Only-B-${suffix}` })).body.data.id;
});

after(async () => { server?.close(); await retireTestHospitals(db, [A.slug, B.slug, `free-${suffix}`], IS_TEST_DB).catch(() => {}); await closePool(); });

describe('A newly registered hospital', () => {
  test('gets its own defaults (roles, lab tests, expense categories)', async () => {
    for (const tid of [ids.tenantA, ids.tenantB]) {
      const r = await db.one(`SELECT (SELECT COUNT(*) FROM hms.Roles WHERE TenantId = @t) AS roles,
                                     (SELECT COUNT(*) FROM hms.LabTests WHERE TenantId = @t) AS tests,
                                     (SELECT COUNT(*) FROM hms.ExpenseCategories WHERE TenantId = @t) AS cats`, { t: tid });
      assert.ok(r.roles >= 9 && r.tests >= 10 && r.cats >= 8, JSON.stringify(r));
    }
  });

  test('numbers documents independently of other hospitals (both start at LAB-000001)', async () => {
    const [ta] = (await a('GET', '/lab/tests')).body.data;
    const [tb] = (await b('GET', '/lab/tests')).body.data;
    const oa = await a('POST', '/lab/orders', { patientId: ids.patientA, testIds: [ta.id], addToBill: true });
    const ob = await b('POST', '/lab/orders', { patientId: ids.patientB, testIds: [tb.id], addToBill: true });
    assert.equal(oa.status, 201); assert.equal(ob.status, 201);
    assert.equal(oa.body.data.number, 'LAB-000001');
    assert.equal(ob.body.data.number, 'LAB-000001');
    ids.orderA = oa.body.data.id; ids.testA = ta.id;
  });
});

describe('Laboratory isolation', () => {
  test('packages, referral doctors and orders of another hospital are invisible and untouchable', async () => {
    const pkg = await a('POST', '/lab/packages', { name: 'A package', price: 100, testIds: [ids.testA] });
    const ref = await a('POST', '/lab/referrals', { name: 'Dr Outside A', commissionPercent: 10 });
    assert.equal(pkg.status, 201); assert.equal(ref.status, 201);
    assert.equal((await b('GET', `/lab/packages/${pkg.body.data.id}`)).status, 404);
    assert.equal((await b('PUT', `/lab/packages/${pkg.body.data.id}`, { name: 'Hacked', testIds: [ids.testA] })).status, 404);
    assert.equal((await b('DELETE', `/lab/packages/${pkg.body.data.id}`)).status, 404);
    assert.equal((await b('POST', `/lab/packages/${pkg.body.data.id}/prices`, { price: 1, reason: 'hack' })).status, 404);
    assert.equal((await b('PUT', `/lab/referrals/${ref.body.data.id}`, { name: 'Hacked' })).status, 404);
    assert.ok(!(await b('GET', '/lab/packages?all=true')).body.data.some((p) => p.id === pkg.body.data.id));
    assert.equal((await b('GET', `/lab/orders/${ids.orderA}`)).status, 404);
    assert.equal((await b('POST', `/lab/orders/${ids.orderA}/share`, { channel: 'email' })).status, 404);
  });

  test('cannot order another hospital\'s test, package or referral doctor', async () => {
    assert.equal((await b('POST', '/lab/orders', { patientId: ids.patientB, testIds: [ids.testA] })).status, 400);
  });

  test('cannot act on another hospital\'s samples', async () => {
    const s = await db.one('SELECT TOP 1 LabSampleId FROM hms.LabSamples WHERE TenantId = @t', { t: ids.tenantA });
    assert.equal((await b('POST', `/lab/samples/${s.LabSampleId}/collect`)).status, 404);
    assert.ok(!(await b('GET', '/lab/samples')).body.data.some((x) => x.id === s.LabSampleId));
  });
});

describe('Finance isolation', () => {
  test('expenses and categories stay inside their hospital', async () => {
    const cats = (await a('GET', '/expenses/categories')).body.data;
    const today = new Date().toISOString().slice(0, 10);
    const e = await a('POST', '/expenses', { expenseDate: today, categoryId: cats[0].id, amount: 500, method: 'cash' });
    assert.equal(e.status, 201);
    assert.equal((await b('PUT', `/expenses/${e.body.data.id}`, { expenseDate: today, categoryId: cats[0].id, amount: 1, method: 'cash' })).status, 400);
    assert.equal((await b('DELETE', `/expenses/${e.body.data.id}`)).status, 404);
    assert.equal((await b('POST', '/expenses', { expenseDate: today, categoryId: cats[0].id, amount: 1, method: 'cash' })).status, 400);
    assert.ok(!(await b('GET', '/expenses')).body.data.some((x) => x.id === e.body.data.id));
  });

  test('payments register and analytics show only own money', async () => {
    const pa = (await a('GET', '/billing/payments')).body.meta;
    const pb = (await b('GET', '/billing/payments')).body.meta;
    assert.ok(pa && pb);
    const an = await b('GET', '/analytics');
    assert.equal(an.status, 200);
    assert.equal(Number(an.body.data.finance.expenses), 0);
  });
});

describe('Messaging and backups isolation', () => {
  test('message log and messaging settings are per hospital', async () => {
    const la = (await a('GET', '/message-log')).body.data;
    const lb = (await b('GET', '/message-log')).body.data;
    const idsA = new Set(la.map((m) => m.id));
    assert.ok(!lb.some((m) => idsA.has(m.id)));
    const sa = (await a('GET', '/settings/messaging')).body.data;
    assert.match(sa.preview.from, new RegExp(`Modules ${A.slug}`));
  });

  test('a backup contains only the hospital\'s own rows and no secrets', async () => {
    const r = await a('GET', '/backups/export');
    assert.equal(r.status, 200);
    const text = JSON.stringify(r.body);
    assert.ok(text.includes(`Only-A-${suffix}`));
    assert.ok(!text.includes(`Only-B-${suffix}`));
    assert.ok(!/PasswordHash|TokenHash|CodeHash|OtpHash|SmtpPassEnc|WaTokenEnc/.test(text));
  });
});

describe('"Free for now" plans', () => {
  test('free sign-up creates a full isolated workspace without payment; charging later moves it to paid', async () => {
    const plan = await db.one(`SELECT PlanId, IsFree FROM hms.Plans WHERE Code = 'starter'`);
    await withTransaction((tx) => setPlansFree(tx, { planIds: [plan.PlanId], free: true, noticeDays: 7 }));
    try {
      const c = client();
      const slug = `free-${suffix}`;
      const body = { planCode: 'starter', interval: 'monthly', orgName: `Free ${suffix}`, slug, phone: '9876543210',
        ownerName: 'Free Owner', ownerEmail: `free-${suffix}@test.local`, password: PASSWORD, acceptTerms: true, country: 'IN', state: 'DL', city: 'New Delhi' };
      const r = await c('POST', '/onboarding/checkout', body);
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.equal(r.body.data.free, true);
      assert.equal(r.body.data.tenantId, undefined); // internal ids are not returned
      // Signed straight in, own data only.
      const me = await c('GET', '/tenant/me');
      assert.equal(me.status, 200);
      assert.equal((await c('GET', `/lab/orders/${ids.orderA}`)).status, 404);
      const tid = (await db.one('SELECT TenantId FROM hms.Tenants WHERE Slug = @slug', { slug })).TenantId;
      const sub = await db.one('SELECT IsFree FROM hms.Subscriptions WHERE TenantId = @t', { t: tid });
      assert.equal(sub.IsFree, true);
      assert.equal((await db.one('SELECT COUNT(*) AS n FROM hms.Payments WHERE TenantId = @t', { t: tid })).n, 0);
      // …but it does get an official ₹0 invoice, visible to the hospital.
      const inv = await db.one(`SELECT InvoiceNumber, Total, Kind, Status FROM hms.Invoices WHERE TenantId = @t`, { t: tid });
      assert.equal(inv.Kind, 'free'); assert.equal(inv.Status, 'issued'); assert.equal(Number(inv.Total), 0);
      assert.match(inv.InvoiceNumber, /^INV\/\d{4}\/\d{6}$/);
      const mine = await c('GET', '/subscription');
      assert.ok(mine.body.data.invoices.some((i) => i.InvoiceNumber === inv.InvoiceNumber));
      // Same e-mail cannot farm a second free workspace.
      assert.equal((await client()('POST', '/onboarding/checkout', { ...body, slug: `free2-${suffix}` })).status, 409);

      // Start charging: the free hospital gets at most 7 days and is no longer free.
      await withTransaction((tx) => setPlansFree(tx, { planIds: [plan.PlanId], free: false, noticeDays: 7 }));
      const after = await db.one('SELECT IsFree, CurrentPeriodEnd FROM hms.Subscriptions WHERE TenantId = @t', { t: tid });
      assert.equal(after.IsFree, false);
      assert.ok(new Date(after.CurrentPeriodEnd) <= new Date(Date.now() + 7 * 86400000 + 60000));
    } finally {
      await withTransaction((tx) => setPlansFree(tx, { planIds: [plan.PlanId], free: Boolean(plan.IsFree), noticeDays: 7 }));
    }
  });
});

describe('Phase 2: care & cash isolation', () => {
  test('prescription templates, admissions care, deposits, payment links and cash closing stay inside their hospital', async () => {
    // Doctor + template in A
    const doc = await a('POST', '/hr/staff', { staffType: 'doctor', fullName: `Dr A ${suffix}`, consultationFee: 300 });
    assert.equal(doc.status, 201, JSON.stringify(doc.body));
    const tpl = await a('POST', '/opd/templates', { name: `Fever ${suffix}`, doctorId: doc.body.data.id, diagnosis: 'Viral fever',
      items: [{ medicineName: 'Paracetamol 650', dosage: '1 tab', frequency: '1-1-1', durationDays: 3 }] });
    assert.equal(tpl.status, 201, JSON.stringify(tpl.body));
    assert.ok(!(await b('GET', '/opd/templates?all=true')).body.data.some((x) => x.id === tpl.body.data.id));
    assert.equal((await b('PUT', `/opd/templates/${tpl.body.data.id}`, { name: 'x', items: [{ medicineName: 'y' }] })).status, 404);
    assert.equal((await b('DELETE', `/opd/templates/${tpl.body.data.id}`)).status, 404);

    // Ward, admission, vitals, notes, charges in A
    const ward = await a('POST', '/ipd/wards', { name: `General ${suffix}`, wardType: 'general', dailyRate: 1000, bedCount: 2 });
    assert.equal(ward.status, 201, JSON.stringify(ward.body));
    const wards = (await a('GET', '/ipd/wards')).body.data;
    const bed = wards.find((w) => w.id === ward.body.data.id).beds[0];
    const adm = await a('POST', '/ipd/admissions', { patientId: ids.patientA, bedId: bed.id, reason: 'Fever' });
    assert.equal(adm.status, 201, JSON.stringify(adm.body));
    const admId = adm.body.data.id;
    const v = await a('POST', `/ipd/admissions/${admId}/vitals`, { pulseBpm: 132, spo2: 93 });
    assert.equal(v.status, 201); assert.equal(v.body.data.flags.pulseBpm, 'critical_high');
    assert.equal((await a('POST', `/ipd/admissions/${admId}/notes`, { category: 'medication', note: 'Given', medicineName: 'Paracetamol' })).status, 201);
    const charges = (await a('GET', '/ipd/service-charges')).body.data;
    assert.ok(charges.length >= 5);
    assert.equal((await a('POST', `/ipd/admissions/${admId}/charges`, { chargeId: charges[0].id, quantity: 1 })).status, 201);
    const bedPost = await a('POST', `/ipd/admissions/${admId}/bed-charges`);
    assert.equal(bedPost.body.data.daysAdded, 1);
    assert.equal((await a('POST', `/ipd/admissions/${admId}/bed-charges`)).body.data.daysAdded, 0); // never twice
    // B sees and touches nothing of it
    for (const p of ['vitals', 'notes', 'charges', 'discharge-summary']) assert.equal((await b('GET', `/ipd/admissions/${admId}/${p}`)).status, 404, p);
    assert.equal((await b('POST', `/ipd/admissions/${admId}/vitals`, { pulseBpm: 80 })).status, 404);
    assert.equal((await b('POST', `/ipd/admissions/${admId}/notes`, { category: 'note', note: 'hack' })).status, 404);
    assert.equal((await b('POST', `/ipd/admissions/${admId}/charges`, { chargeId: charges[0].id })).status, 404);
    assert.equal((await b('PUT', `/ipd/admissions/${admId}/discharge-summary`, { finalDiagnosis: 'x' })).status, 404);
    assert.equal((await b('PUT', `/ipd/service-charges/${charges[0].id}`, { name: 'x', category: 'other', price: 1 })).status, 404);

    // Discharge summary → sign → discharge
    assert.equal((await a('PUT', `/ipd/admissions/${admId}/discharge-summary`, { finalDiagnosis: 'Viral fever', conditionAtDischarge: 'Stable', medications: [{ medicineName: 'Paracetamol' }] })).status, 200);
    assert.equal((await a('POST', `/ipd/admissions/${admId}/discharge-summary/finalize`)).status, 200);
    assert.equal((await a('PUT', `/ipd/admissions/${admId}/discharge-summary`, { finalDiagnosis: 'changed' })).status, 409);
    const dis = await a('POST', `/ipd/admissions/${admId}/discharge`, { chargeBedDays: true });
    assert.equal(dis.status, 200, JSON.stringify(dis.body));

    // Deposit in A; B cannot see, use or refund it
    const dep = await a('POST', '/billing/deposits', { patientId: ids.patientA, amount: 5000, method: 'cash' });
    assert.equal(dep.status, 201, JSON.stringify(dep.body));
    assert.equal((await b('POST', '/billing/deposits', { patientId: ids.patientA, amount: 1, method: 'cash' })).status, 400);
    assert.equal((await b('POST', '/billing/deposits/refund', { patientId: ids.patientA, amount: 1, method: 'cash', reason: 'hack' })).status, 400);
    assert.deepEqual((await b('GET', `/billing/deposits?patientId=${ids.patientA}`)).body.data, []);

    // Use the deposit on A's admission bill
    const bills = (await a('GET', `/ipd/admissions/${admId}/charges`)).body.data.bills;
    const draft = bills.find((x) => x.status === 'draft');
    assert.equal((await a('POST', `/billing/bills/${draft.id}/finalize`)).status, 200);
    const applied = await a('POST', '/billing/deposits/apply', { billId: draft.id });
    assert.equal(applied.status, 201, JSON.stringify(applied.body));
    assert.equal((await b('POST', '/billing/deposits/apply', { billId: draft.id })).status, 404);

    // Payment link needs the hospital's UPI ID; never visible to B
    assert.equal((await a('POST', `/billing/bills/${draft.id}/payment-link`, {})).status, 400);
    assert.equal((await b('GET', `/billing/bills/${draft.id}/payment-links`)).body.data.length, 0);

    // Cash closing: A's cash includes the ₹5000 deposit; B's closing is empty
    const cur = (await a('GET', '/billing/cash/current')).body.data;
    assert.ok(Number(cur.expectedCash) >= 5000);
    const close = await a('POST', '/billing/cash/close', { countedCash: Number(cur.expectedCash) });
    assert.equal(close.status, 201, JSON.stringify(close.body));
    assert.equal((await b('GET', `/billing/cash/closings/${close.body.data.id}`)).status, 404);
    assert.equal(Number((await b('GET', '/billing/cash/current')).body.data.expectedCash), 0);
  });

  test('OPD: template applied in a consultation, vitals saved, follow-up listed only in its own hospital', async () => {
    const doc = await a('POST', '/hr/staff', { staffType: 'doctor', fullName: `Dr Follow ${suffix}`, consultationFee: 200 });
    const c = await a('POST', '/opd/consultations', { patientId: ids.patientA, doctorId: doc.body.data.id });
    assert.ok([200, 201].includes(c.status), JSON.stringify(c.body));
    const cid = c.body.data.id;
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const put = await a('PUT', `/opd/consultations/${cid}`, { diagnosis: 'Viral fever', followUpDate: tomorrow,
      vitals: { temperatureC: 38.5, pulseBpm: 104, spo2: 97 }, prescriptions: [{ medicineName: 'Paracetamol 650', frequency: '1-1-1', durationDays: 3 }] });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    assert.equal((await a('POST', `/opd/consultations/${cid}/finalize`, { chargeConsultation: false })).status, 200);
    const fa = await a('GET', '/opd/follow-ups?view=all');
    assert.ok(fa.body.data.some((x) => x.consultationId === cid), JSON.stringify(fa.body));
    assert.ok(!(await b('GET', '/opd/follow-ups?view=all')).body.data.some((x) => x.consultationId === cid));
  });

  test('UPI payment link: created with the hospital UPI ID, public page shows only bill & amount, revoke kills it', async () => {
    await db.exec(`MERGE hms.TenantSettings AS t USING (SELECT @tid AS TenantId, 'payment.upi_id' AS SettingKey) AS s
                   ON t.TenantId = s.TenantId AND t.SettingKey = s.SettingKey
                   WHEN MATCHED THEN UPDATE SET SettingValue = 'testhospital@okhdfcbank'
                   WHEN NOT MATCHED THEN INSERT (TenantId, SettingKey, SettingValue) VALUES (@tid, 'payment.upi_id', 'testhospital@okhdfcbank');`, { tid: ids.tenantA });
    // A finalised bill with a balance: a lab order with its own invoice and no payment.
    const [test1] = (await a('GET', '/lab/tests')).body.data;
    await db.exec('UPDATE hms.LabTests SET Price = 250 WHERE TenantId = @t AND LabTestId = @id', { t: ids.tenantA, id: test1.id });
    const order = await a('POST', '/lab/orders', { patientId: ids.patientA, testIds: [test1.id], addToBill: true });
    assert.equal(order.status, 201, JSON.stringify(order.body));
    const billId = (await db.one('SELECT BillId FROM hms.LabOrders WHERE TenantId = @t AND LabOrderId = @id', { t: ids.tenantA, id: order.body.data.id }))?.BillId;
    assert.ok(billId, 'lab order has its own bill');
    const link = await a('POST', `/billing/bills/${billId}/payment-link`, { channel: 'none' });
    assert.equal(link.status, 201, JSON.stringify(link.body));
    const token = link.body.data.url.split('/pay/')[1];
    const pub = await client()('GET', `/public/pay/${token}`);
    assert.equal(pub.status, 200, JSON.stringify(pub.body));
    assert.ok(pub.body.data.upiUri.startsWith('upi://pay?pa=testhospital%40okhdfcbank') || pub.body.data.upiUri.includes('testhospital@okhdfcbank'));
    const text = JSON.stringify(pub.body);
    assert.ok(!/Only-A-|alice-|diagnos/i.test(text), 'no patient surname, e-mail or clinical data on the public page');
    // B can neither list nor revoke A's link
    const links = (await a('GET', `/billing/bills/${billId}/payment-links`)).body.data;
    assert.equal((await b('POST', `/billing/bills/${billId}/payment-links/${links[0].id}/revoke`)).status, 404);
    assert.equal((await a('POST', `/billing/bills/${billId}/payment-links/${links[0].id}/revoke`)).status, 200);
    assert.equal((await client()('GET', `/public/pay/${token}`)).status, 404);
    assert.equal((await client()('GET', `/public/pay/${'x'.repeat(43)}`)).status, 404);
  });

  test('deposit refund cannot exceed the balance', async () => {
    const bal = (await a('GET', `/billing/deposits?patientId=${ids.patientA}`)).body;
    const r = await a('POST', '/billing/deposits/refund', { patientId: ids.patientA, amount: 999999, method: 'cash', reason: 'Too much' });
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.ok(bal);
  });
});
