// Integration tests — require a REAL SQL Server test database (never production).
//   1. Create an empty database, e.g. medicore_hms_test
//   2. Put its settings in backend/.env.test (see .env.example) with NODE_ENV=test
//   3. npm run test:integration   (runs migrations + seed automatically)
//
// Proves Hospital A cannot read or modify Hospital B's records through the HTTP API.
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
import { finalizePaidOrder } from '../../src/modules/onboarding/onboarding.service.js';
import { assertSafeDatabase, retireTestHospitals } from './_safety.js';

const IS_TEST_DB = assertSafeDatabase(config);

let server;
let base;
const PASSWORD = 'IsolationTest123';
const suffix = randomUUID().slice(0, 6);
const A = { slug: `iso-a-${suffix}`, email: `owner-a-${suffix}@test.local` };
const B = { slug: `iso-b-${suffix}`, email: `owner-b-${suffix}@test.local` };

/** Tiny cookie-keeping HTTP client. */
function client() {
  const jar = new Map();
  return async (method, path, body, headers = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json', 'X-Requested-With': 'fetch',
        Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json };
  };
}

async function makeTenant(t) {
  const plan = await db.one(`SELECT PlanId FROM hms.Plans WHERE Code = 'professional'`);
  const hash = await hashPassword(PASSWORD);
  return withTransaction((tx) => provisionTenant(tx, {
    orgName: `Isolation ${t.slug}`, slug: t.slug, ownerName: 'Owner', ownerEmail: t.email, ownerPasswordHash: hash,
  }, { planId: plan.PlanId, interval: 'monthly' }, null));
}

const a = client();
const b = client();
const ids = {};

before(async () => {
  await migrate({ log: () => {} });
  await seedPermissions();
  ids.tenantA = (await makeTenant(A)).tenantId;
  ids.tenantB = (await makeTenant(B)).tenantId;
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}/api/v1`;

  assert.equal((await a('POST', '/auth/login', { email: A.email, password: PASSWORD, workspace: A.slug })).status, 200);
  assert.equal((await b('POST', '/auth/login', { email: B.email, password: PASSWORD, workspace: B.slug })).status, 200);

  ids.patientA = (await a('POST', '/patients', { firstName: 'Alice', lastName: 'A' })).body.data.id;
  ids.patientB = (await b('POST', '/patients', { firstName: 'Bob', lastName: 'B' })).body.data.id;
  ids.doctorA = (await a('POST', '/hr/staff', { staffType: 'doctor', fullName: 'Dr A' })).body.data.id;
  ids.doctorB = (await b('POST', '/hr/staff', { staffType: 'doctor', fullName: 'Dr B' })).body.data.id;
});

after(async () => {
  server?.close();
  await retireTestHospitals(db, [A.slug, B.slug], IS_TEST_DB).catch(() => {});
  await closePool();
});

describe('Tenant isolation over HTTP', () => {
  test('lists only show own records', async () => {
    const list = await a('GET', '/patients?pageSize=100');
    assert.equal(list.status, 200);
    assert.ok(list.body.data.some((p) => p.id === ids.patientA));
    assert.ok(!list.body.data.some((p) => p.id === ids.patientB));
  });

  test('cannot read another hospital\'s patient by id (IDOR) — 404, not 403', async () => {
    assert.equal((await a('GET', `/patients/${ids.patientB}`)).status, 404);
  });

  test('cannot modify or archive another hospital\'s patient', async () => {
    assert.equal((await a('PATCH', `/patients/${ids.patientB}`, { firstName: 'Hacked' })).status, 404);
    assert.equal((await a('POST', `/patients/${ids.patientB}/archive`, { archived: true })).status, 404);
    const still = await b('GET', `/patients/${ids.patientB}`);
    assert.equal(still.body.data.firstName, 'Bob');
    assert.equal(still.body.data.isArchived, false);
  });

  test('cannot book an appointment with another hospital\'s patient or doctor', async () => {
    const date = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    assert.equal((await a('POST', '/appointments', { patientId: ids.patientB, doctorId: ids.doctorA, date, time: '10:00' })).status, 400);
    assert.equal((await a('POST', '/appointments', { patientId: ids.patientA, doctorId: ids.doctorB, date, time: '10:00' })).status, 400);
    assert.equal((await a('POST', '/appointments', { patientId: ids.patientA, doctorId: ids.doctorA, date, time: '10:00' })).status, 201);
  });

  test('client-supplied TenantId is rejected', async () => {
    const r = await a('POST', '/patients', { firstName: 'X', tenantId: ids.tenantB });
    assert.equal(r.status, 400);
  });

  test('subdomain of another hospital is refused', async () => {
    const r = await a('GET', '/patients', null, { Host: `${B.slug}.${config.appBaseDomain}` });
    assert.equal(r.status, 403);
  });

  test('database refuses cross-tenant foreign keys even if app code were wrong', async () => {
    await assert.rejects(db.exec(
      `INSERT INTO hms.Appointments (TenantId, AppointmentNumber, PatientId, DoctorId, StartAt, EndAt)
       VALUES (@ta, 'X-1', @pb, @da, SYSUTCDATETIME(), DATEADD(MINUTE, 15, SYSUTCDATETIME()))`,
      { ta: ids.tenantA, pb: ids.patientB, da: ids.doctorA }), (e) => e.number === 547);
  });

  test('double-booking the same doctor slot is refused', async () => {
    const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const p2 = (await a('POST', '/patients', { firstName: 'Second' })).body.data.id;
    const results = await Promise.all([
      a('POST', '/appointments', { patientId: ids.patientA, doctorId: ids.doctorA, date, time: '11:00' }),
      a('POST', '/appointments', { patientId: p2, doctorId: ids.doctorA, date, time: '11:05' }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  });

  test('admin API rejects hospital sessions', async () => {
    assert.equal((await a('GET', '/admin/tenants')).status, 401);
  });
});

describe('Payment finalisation idempotency', () => {
  test('processing the same paid order twice provisions once', async () => {
    const plan = await db.one(`SELECT PlanId FROM hms.Plans WHERE Code = 'starter'`);
    const onboardingId = randomUUID();
    const orderId = `sandbox_order_idem_${suffix}`;
    await db.exec(`INSERT INTO hms.OnboardingRequests (OnboardingId, PlanId, BillingInterval, OrgName, Slug, OwnerName, OwnerEmail, OwnerPasswordHash,
                     Subtotal, TaxAmount, TotalAmount, Currency, ExpiresAt)
                   VALUES (@id, @pid, 'monthly', 'Idem Hospital', @slug, 'Owner', @email, @hash, 999, 179.82, 1178.82, 'INR', DATEADD(HOUR, 1, SYSUTCDATETIME()))`,
    { id: onboardingId, pid: plan.PlanId, slug: `idem-${suffix}`, email: `idem-${suffix}@test.local`, hash: await hashPassword(PASSWORD) });
    await db.exec(`INSERT INTO hms.Payments (OnboardingId, Purpose, PlanId, BillingInterval, Provider, IsSandbox, ProviderOrderId, Subtotal, TaxAmount, Amount, Currency)
                   VALUES (@id, 'onboarding', @pid, 'monthly', 'sandbox', 1, @order, 999, 179.82, 1178.82, 'INR')`,
    { id: onboardingId, pid: plan.PlanId, order: orderId });

    const [r1, r2] = await Promise.all([
      finalizePaidOrder({ providerName: 'sandbox', orderId, paymentId: 'sandbox_pay_1', source: 'checkout' }),
      finalizePaidOrder({ providerName: 'sandbox', orderId, paymentId: 'sandbox_pay_1', source: 'webhook' }),
    ]);
    assert.equal([r1, r2].filter((r) => r.alreadyProcessed).length, 1);
    const count = await db.one('SELECT COUNT(*) AS n FROM hms.Tenants WHERE Slug = @s', { s: `idem-${suffix}` });
    assert.equal(count.n, 1);
    const inv = await db.one(`SELECT COUNT(*) AS n FROM hms.Invoices i JOIN hms.Payments p ON p.PaymentId = i.PaymentId WHERE p.ProviderOrderId = @o`, { o: orderId });
    assert.equal(inv.n, 1);
  });
});
