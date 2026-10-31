// Lab upgrade chunk 3 integration tests: reference ranges by age & gender, critical values (alert, acknowledgement,
// verification block), ranges CSV import — and that all of it stays inside each hospital. The numbers are made-up
// test data, not clinical guidance. Same rules as the other suites: a REAL SQL Server *test* database, never production.
// Run: npm run test:integration  (or npm run test:e2e against the dev DB — test hospitals are retired afterwards)
//
// Every flow is walked end to end in hospital A, and hospital B is shown to get 404 / 400 for each of A's records.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { config } from '../../src/config/env.js';
import { createApp } from '../../src/app.js';
import { db, withTransaction, closePool } from '../../src/db/pool.js';
import { migrate } from '../../src/db/migrate.js';
import { seedPermissions } from '../../src/db/seed.js';
import { loadVerifiedReport } from '../../src/modules/lab/report.service.js';
import { provisionTenant } from '../../src/modules/tenants/provisioning.js';
import { hashPassword } from '../../src/utils/password.js';
import { assertSafeDatabase, retireTestHospitals } from './_safety.js';

const IS_TEST_DB = assertSafeDatabase(config);
const PASSWORD = 'IsolationTest123';
const suffix = randomUUID().slice(0, 6);
const A = { slug: `c3-a-${suffix}`, email: `c3-owner-a-${suffix}@test.local` };
const B = { slug: `c3-b-${suffix}`, email: `c3-owner-b-${suffix}@test.local` };
let server; let base;
const ids = {};

function client() {
  const jar = new Map();
  const send = async (method, p, body, raw) => {
    const headers = { 'X-Requested-With': 'fetch', Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') };
    if (raw) headers['Content-Type'] = raw; else if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${base}${p}`, { method, headers, body: raw ? body : body ? JSON.stringify(body) : undefined });
    for (const c of res.headers.getSetCookie()) { const [pair] = c.split(';'); const i = pair.indexOf('='); jar.set(pair.slice(0, i), pair.slice(i + 1)); }
    const buf = Buffer.from(await res.arrayBuffer());
    let json = null; try { json = JSON.parse(buf.toString('utf8')); } catch { json = buf; }
    return { status: res.status, body: json, headers: res.headers };
  };
  const fn = (method, p, body) => send(method, p, body);
  fn.upload = (p, buf, type = 'application/octet-stream') => send('POST', p, buf, type);
  return fn;
}
const a = client();
const b = client();
const yearsAgo = (n) => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - n); d.setUTCDate(d.getUTCDate() - 10); return d.toISOString().slice(0, 10); };
const ok = (r, code = 200) => { assert.equal(r.status, code, JSON.stringify(r.body)); return r.body.data; };

async function makeTenant(t) {
  const plan = await db.one(`SELECT PlanId FROM hms.Plans WHERE Code = 'professional'`);
  return withTransaction(async (tx) => provisionTenant(tx, {
    orgName: `Chunk3 ${t.slug}`, slug: t.slug, ownerName: 'Owner', ownerEmail: t.email, ownerPasswordHash: await hashPassword(PASSWORD),
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
  const pat = async (c, firstName, gender, dateOfBirth) => ok(await c('POST', '/patients', { firstName, lastName: `C3-${suffix}`, gender, ...(dateOfBirth ? { dateOfBirth } : {}) }), 201).id;
  ids.woman = await pat(a, 'Woman', 'female', '1990-05-01');
  ids.man = await pat(a, 'Man', 'male', '1985-03-10');
  ids.child = await pat(a, 'Child', 'female', yearsAgo(6));
  ids.noDob = await pat(a, 'NoDob', 'male', null);
  ids.patientB = await pat(b, 'Other', 'female', '1990-05-01');
});

after(async () => { server?.close(); await retireTestHospitals(db, [A.slug, B.slug], IS_TEST_DB).catch(() => {}); await closePool(); });

const CODE = (p) => `${p}${suffix}`.toUpperCase().slice(0, 20);

describe('Chunk 3: reference ranges and critical values', () => {
  test('ranges are per test and per hospital; overlaps and foreign parameters are refused', async () => {
    const t1 = ok(await a('POST', '/lab/tests', { code: CODE('K'), name: 'Potassium (test data)', unit: 'mmol/L', refLow: 3.5, refHigh: 5.1, criticalLow: 2.5, criticalHigh: 6.5, price: 100 }), 201);
    const panel = ok(await a('POST', '/lab/tests', { code: CODE('HBP'), name: 'Hb panel (test data)', price: 100 }), 201);
    ok(await a('PUT', `/lab/tests/${panel.id}/parameters`, { parameters: [{ name: 'Haemoglobin', unit: 'g/dL', refLow: 11, refHigh: 18, criticalLow: 5 }, { name: 'Note', isHeading: true }] }));
    const hb = ok(await a('GET', `/lab/tests/${panel.id}/parameters`)).find((p) => p.name === 'Haemoglobin');
    ids.k = t1.id; ids.panel = panel.id; ids.hb = hb.id;

    ok(await a('PUT', `/lab/tests/${panel.id}/ranges`, { ranges: [
      { parameterId: hb.id, gender: 'male', ageFrom: 18, ageFromUnit: 'y', refLow: 13, refHigh: 17, criticalLow: 7 },
      { parameterId: hb.id, gender: 'female', ageFrom: 18, ageFromUnit: 'y', refLow: 12, refHigh: 15, criticalLow: 7 },
      { parameterId: hb.id, gender: 'any', ageFrom: 1, ageFromUnit: 'y', ageTo: 18, ageToUnit: 'y', refLow: 11, refHigh: 14 },
    ] }));
    const got = ok(await a('GET', `/lab/tests/${panel.id}/ranges`));
    assert.equal(got.ranges.length, 3);
    assert.equal(got.parameters.length, 1, 'heading rows take no ranges');
    assert.equal(ok(await a('GET', `/lab/tests?all=true&q=${encodeURIComponent('Hb panel')}`))[0].rangeCount, 3);

    const overlap = await a('PUT', `/lab/tests/${panel.id}/ranges`, { ranges: [
      { parameterId: hb.id, gender: 'female', ageFrom: 18, refLow: 12, refHigh: 15 }, { parameterId: hb.id, gender: 'female', ageFrom: 40, refLow: 1, refHigh: 2 }] });
    assert.equal(overlap.status, 400);
    assert.match(overlap.body.error.details[0].message, /overlaps/);
    assert.equal((await a('PUT', `/lab/tests/${panel.id}/ranges`, { ranges: [{ refLow: 5, refHigh: 1 }] })).status, 400);
    assert.equal((await a('PUT', `/lab/tests/${panel.id}/ranges`, { ranges: [{ refLow: 1, tenantId: ids.tenantB }] })).status, 400, 'strict body');

    // Hospital B: cannot read or replace A's ranges, nor attach A's parameter to its own test.
    assert.equal((await b('GET', `/lab/tests/${panel.id}/ranges`)).status, 404);
    assert.equal((await b('PUT', `/lab/tests/${panel.id}/ranges`, { ranges: [] })).status, 404);
    const bTest = ok(await b('POST', '/lab/tests', { code: CODE('BT'), name: 'B test', price: 1 }), 201);
    assert.equal((await b('PUT', `/lab/tests/${bTest.id}/ranges`, { ranges: [{ parameterId: hb.id, refLow: 1, refHigh: 2 }] })).status, 400);
    assert.equal(ok(await a('GET', `/lab/tests/${panel.id}/ranges`)).ranges.length, 3, 'A unchanged');
  });

  test('the order takes the range for the patient’s age and gender (default when nothing matches)', async () => {
    const hbRange = async (patientId) => {
      const order = ok(await a('POST', '/lab/orders', { patientId, testIds: [ids.panel] }), 201);
      const o = ok(await a('GET', `/lab/orders/${order.id}`));
      const p = o.items[0].parameters.find((x) => x.name === 'Haemoglobin');
      return { orderId: order.id, low: Number(p.refLow), high: Number(p.refHigh), label: p.rangeLabel, crit: p.criticalLow == null ? null : Number(p.criticalLow), id: p.id };
    };
    const w = await hbRange(ids.woman);
    assert.deepEqual([w.low, w.high, w.label, w.crit], [12, 15, 'Female · 18 y +', 7]);
    const m = await hbRange(ids.man);
    assert.deepEqual([m.low, m.high, m.label], [13, 17, 'Male · 18 y +']);
    const c = await hbRange(ids.child);
    assert.deepEqual([c.low, c.high, c.label, c.crit], [11, 14, 'All · 1 y – 18 y', null]);
    const n = await hbRange(ids.noDob);
    assert.deepEqual([n.low, n.high, n.label, n.crit], [11, 18, null, 5], 'no date of birth → default range and default critical limit');
    ids.manOrder = m.orderId; ids.manHb = m.id;

    // Editing ranges later never changes an order already placed.
    ok(await a('PUT', `/lab/tests/${ids.panel}/ranges`, { ranges: [] }));
    const again = ok(await a('GET', `/lab/orders/${m.orderId}`)).items[0].parameters.find((x) => x.name === 'Haemoglobin');
    assert.equal(Number(again.refLow), 13);
  });

  test('critical result: flagged, alerted, listed for this hospital only, verification blocked until acknowledged', async () => {
    const order = ok(await a('POST', '/lab/orders', { patientId: ids.woman, testIds: [ids.k] }), 201);
    ok(await a('POST', `/lab/orders/${order.id}/status`, { status: 'sample_collected' }));
    let o = ok(await a('GET', `/lab/orders/${order.id}`));
    const item = o.items[0];
    ok(await a('PUT', `/lab/orders/${order.id}/results`, { results: [{ itemId: item.id, value: '2.1' }] }));
    o = ok(await a('GET', `/lab/orders/${order.id}`));
    assert.equal(o.items[0].flag, 'crit_low');
    assert.equal(o.critical.open, 1);
    assert.ok(ok(await a('GET', '/lab/critical')).some((x) => Number(x.orderId) === order.id));
    assert.ok(!ok(await b('GET', '/lab/critical')).some((x) => Number(x.orderId) === order.id), 'B never sees A’s critical results');
    const notes = ok(await a('GET', '/notifications'));
    assert.ok(notes.some((x) => /Critical lab result/.test(x.Title ?? x.title)), 'staff alerted');
    assert.ok(!JSON.stringify(notes).includes('Woman'), 'no patient name in the alert');
    assert.ok(!ok(await b('GET', '/notifications')).some((x) => (x.Title ?? x.title ?? '').includes(o.number)));

    const blocked = await a('POST', `/lab/orders/${order.id}/verify`);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error.code, 'CRITICAL_UNACKNOWLEDGED');
    assert.equal((await b('POST', `/lab/orders/${order.id}/critical-ack`, { note: 'B hijack' })).status, 404);
    assert.equal((await a('POST', `/lab/orders/${order.id}/critical-ack`, { note: '' })).status, 400, 'note required');
    assert.equal(ok(await a('POST', `/lab/orders/${order.id}/critical-ack`, { note: 'Dr X informed by phone' })).acknowledged, 1);
    assert.equal((await a('POST', `/lab/orders/${order.id}/critical-ack`, { note: 'again' })).status, 409);
    o = ok(await a('GET', `/lab/orders/${order.id}`));
    assert.equal(o.critical.open, 0);
    assert.equal(o.critical.acknowledgedNote, 'Dr X informed by phone');
    assert.ok(o.items[0].criticalAckBy, 'who acknowledged is recorded');

    // A changed value that is still critical needs a new acknowledgement; a normal value clears it.
    ok(await a('PUT', `/lab/orders/${order.id}/results`, { results: [{ itemId: item.id, value: '2.0' }] }));
    assert.equal(ok(await a('GET', `/lab/orders/${order.id}`)).critical.open, 1);
    ok(await a('PUT', `/lab/orders/${order.id}/results`, { results: [{ itemId: item.id, value: '4.2' }] }));
    o = ok(await a('GET', `/lab/orders/${order.id}`));
    assert.equal(o.items[0].flag, 'normal');
    assert.equal(o.critical.open, 0);
    ok(await a('POST', `/lab/orders/${order.id}/verify`));

    // Patient-facing report: no staff alert bookkeeping.
    const rep = await loadVerifiedReport(ids.tenantA, order.id);
    assert.ok(rep && !('criticalAckBy' in rep.items[0]) && !('criticalAt' in rep.items[0]));
  });

  test('panel parameter critical: panel line flagged critical; acknowledgement covers parameters', async () => {
    ok(await a('POST', `/lab/orders/${ids.manOrder}/status`, { status: 'sample_collected' }));
    ok(await a('PUT', `/lab/orders/${ids.manOrder}/results`, { parameters: [{ id: ids.manHb, value: '6.1' }] }));
    let o = ok(await a('GET', `/lab/orders/${ids.manOrder}`));
    assert.equal(o.items[0].flag, 'crit_low');
    assert.equal(o.items[0].parameters.find((x) => x.name === 'Haemoglobin').flag, 'crit_low');
    assert.equal((await a('POST', `/lab/orders/${ids.manOrder}/verify`)).status, 409);
    ok(await a('POST', `/lab/orders/${ids.manOrder}/critical-ack`, { note: 'Ward nurse informed' }));
    ok(await a('POST', `/lab/orders/${ids.manOrder}/verify`));
    o = ok(await a('GET', `/lab/orders/${ids.manOrder}`));
    assert.equal(o.status, 'verified');
  });

  test('ranges CSV import: dry run, all-or-nothing, only this hospital’s tests', async () => {
    const rows = [
      { testCode: CODE('HBP'), parameter: 'Haemoglobin', gender: 'female', ageFrom: '18', ageFromUnit: 'y', low: '12', high: '15', criticalLow: '7' },
      { testCode: CODE('HBP'), parameter: 'Haemoglobin', gender: 'male', ageFrom: '18', ageFromUnit: 'y', low: '13', high: '17' },
      { testCode: CODE('K'), gender: 'any', ageTo: '30', ageToUnit: 'd', low: '3.7', high: '5.9' },
    ];
    const dry = ok(await a('POST', '/lab/ranges/import', { rows, dryRun: true }));
    assert.deepEqual([dry.tests, dry.ranges, dry.errors.length], [2, 3, 0]);
    assert.equal(ok(await a('GET', `/lab/tests/${ids.panel}/ranges`)).ranges.length, 0, 'dry run writes nothing');

    const bad = await a('POST', '/lab/ranges/import', { rows: [...rows, { testCode: 'NOPE-X', low: '1' }, { testCode: CODE('HBP'), parameter: 'Unknown', low: '1' }] });
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.body.error.details.map((d) => d.path), ['line 5', 'line 6']);
    assert.equal(ok(await a('GET', `/lab/tests/${ids.panel}/ranges`)).ranges.length, 0, 'nothing saved');

    assert.equal(ok(await a('POST', '/lab/ranges/import', { rows }), 201).ranges, 3);
    assert.equal(ok(await a('GET', `/lab/tests/${ids.panel}/ranges`)).ranges.length, 2);
    assert.equal(ok(await a('GET', `/lab/tests/${ids.k}/ranges`)).ranges.length, 1);
    // B importing A's test codes: those codes are not in B's catalogue.
    const fromB = await b('POST', '/lab/ranges/import', { rows, dryRun: true });
    assert.equal(ok(fromB).errors.length, 3);
    assert.equal(ok(await a('GET', `/lab/tests/${ids.panel}/ranges`)).ranges.length, 2, 'A unchanged');
  });
});
