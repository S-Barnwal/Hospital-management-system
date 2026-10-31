// Lab upgrade chunk 2 integration tests: department master, test master fields, CSV import, result input types and
// report snapshots. Same rules as the other suites: a REAL SQL Server *test* database, never production.
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
import { provisionTenant } from '../../src/modules/tenants/provisioning.js';
import { hashPassword } from '../../src/utils/password.js';
import { assertSafeDatabase, retireTestHospitals } from './_safety.js';

const IS_TEST_DB = assertSafeDatabase(config);
const PASSWORD = 'IsolationTest123';
const suffix = randomUUID().slice(0, 6);
const A = { slug: `c2-a-${suffix}`, email: `c2-owner-a-${suffix}@test.local` };
const B = { slug: `c2-b-${suffix}`, email: `c2-owner-b-${suffix}@test.local` };
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
const ok = (r, code = 200) => { assert.equal(r.status, code, JSON.stringify(r.body)); return r.body.data; };

async function makeTenant(t) {
  const plan = await db.one(`SELECT PlanId FROM hms.Plans WHERE Code = 'professional'`);
  return withTransaction(async (tx) => provisionTenant(tx, {
    orgName: `Chunk2 ${t.slug}`, slug: t.slug, ownerName: 'Owner', ownerEmail: t.email, ownerPasswordHash: await hashPassword(PASSWORD),
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
  ids.patientA = ok(await a('POST', '/patients', { firstName: 'Panel', lastName: `A-${suffix}` }), 201).id;
});

after(async () => { server?.close(); await retireTestHospitals(db, [A.slug, B.slug], IS_TEST_DB).catch(() => {}); await closePool(); });

describe('Chunk 2: lab master data', () => {
  test('every new hospital gets its own default departments', async () => {
    const da = ok(await a('GET', '/lab/departments'));
    const db_ = ok(await b('GET', '/lab/departments'));
    assert.ok(da.some((d) => d.name === 'Haematology'));
    assert.ok(db_.some((d) => d.name === 'Haematology'));
    assert.equal(da.filter((d) => db_.some((x) => x.id === d.id)).length, 0, 'department ids are never shared between hospitals');
    ids.haemA = da.find((d) => d.name === 'Haematology').id;
    ids.bioA = da.find((d) => d.name === 'Biochemistry').id;
  });

  test('department CRUD: duplicate refused, rename keeps tests in step, delete only when unused, other hospital gets 404', async () => {
    const dep = ok(await a('POST', '/lab/departments', { name: `Molecular ${suffix}`, sortOrder: 80 }), 201);
    assert.equal((await a('POST', '/lab/departments', { name: `Molecular ${suffix}` })).status, 409);
    assert.equal((await a('POST', '/lab/departments', { name: 'X<script>' })).status, 400);
    assert.equal((await a('POST', '/lab/departments', { name: 'Fine', tenantId: ids.tenantB })).status, 400, 'strict body: no tenant id from the client');
    // Hospital B cannot see, edit or delete A's department, nor use it on a test.
    assert.equal((await b('PUT', `/lab/departments/${dep.id}`, { name: 'Hijack', sortOrder: 1 })).status, 404);
    assert.equal((await b('DELETE', `/lab/departments/${dep.id}`)).status, 404);
    assert.equal((await b('POST', '/lab/tests', { code: 'BX', name: 'B test', price: 1, departmentId: dep.id })).status, 400);

    const test = ok(await a('POST', '/lab/tests', { code: `PCR${suffix}`.slice(0, 20).toUpperCase(), name: 'PCR test', price: 1000, departmentId: dep.id, inputType: 'option', options: ['Detected', 'Not detected'] }), 201);
    ok(await a('PUT', `/lab/departments/${dep.id}`, { name: `Molecular Bio ${suffix}`, sortOrder: 80 }));
    const listed = ok(await a('GET', `/lab/tests?all=true&departmentId=${dep.id}`));
    assert.equal(listed.length, 1);
    assert.equal(listed[0].department, `Molecular Bio ${suffix}`);
    assert.deepEqual(listed[0].options, ['Detected', 'Not detected']);
    assert.equal((await a('DELETE', `/lab/departments/${dep.id}`)).status, 409, 'in use');
    ok(await a('DELETE', `/lab/tests/${test.id}`));
    ok(await a('DELETE', `/lab/departments/${dep.id}`));
  });

  test('test master: option tests need choices, decimals/TAT are bounded, unknown department text refused', async () => {
    assert.equal((await a('POST', '/lab/tests', { code: 'OPT1', name: 'Option test', price: 0, inputType: 'option' })).status, 400);
    assert.equal((await a('POST', '/lab/tests', { code: 'OPT2', name: 'Option test', price: 0, inputType: 'option', options: ['A|B'] })).status, 400);
    assert.equal((await a('POST', '/lab/tests', { code: 'DEC1', name: 'Decimals', price: 0, decimals: 9 })).status, 400);
    assert.equal((await a('POST', '/lab/tests', { code: 'TAT1', name: 'TAT', price: 0, tatHours: 0 })).status, 400);
    assert.equal((await a('POST', '/lab/tests', { code: 'DEP1', name: 'Dept text', price: 0, department: 'Nope dept' })).status, 400);
  });

  test('CSV import: dry run changes nothing, bad rows block the import, other hospital is untouched', async () => {
    const rows = [
      { code: `IMP1${suffix}`.toUpperCase(), name: 'Imported glucose', department: 'Biochemistry', unit: 'mg/dL', reflow: '70', refhigh: '100', price: '120', decimals: '0', method: 'GOD-POD' },
      { code: `IMP2${suffix}`.toUpperCase(), name: 'Imported HBsAg', department: `Imported Dept ${suffix}`, inputtype: 'option', options: 'Reactive|Non-reactive', price: '300' },
    ];
    const dry = ok(await a('POST', '/lab/tests/import', { rows, dryRun: true }));
    assert.equal(dry.create, 2);
    assert.deepEqual(dry.newDepartments, [`Imported Dept ${suffix}`]);
    assert.equal(ok(await a('GET', `/lab/tests?all=true&q=${encodeURIComponent('Imported')}`)).length, 0, 'dry run writes nothing');

    const bad = await a('POST', '/lab/tests/import', { rows: [...rows, { code: '', name: 'x' }] });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.details[0].path, 'line 4');
    assert.equal(ok(await a('GET', `/lab/tests?all=true&q=Imported`)).length, 0, 'nothing saved when any row is bad');

    const done = ok(await a('POST', '/lab/tests/import', { rows }), 201);
    assert.equal(done.create, 2);
    const imported = ok(await a('GET', '/lab/tests?all=true&q=Imported'));
    assert.equal(imported.length, 2);
    assert.equal(imported.find((t) => t.name === 'Imported glucose').department, 'Biochemistry');
    assert.equal(imported.find((t) => t.name === 'Imported glucose').method, 'GOD-POD');
    // Re-import: skip keeps, update overwrites (and logs the price change).
    assert.equal(ok(await a('POST', '/lab/tests/import', { rows }), 201).skip, 2);
    const upd = ok(await a('POST', '/lab/tests/import', { rows: [{ ...rows[0], price: '150' }], mode: 'update' }), 201);
    assert.equal(upd.update, 1);
    assert.equal(Number(ok(await a('GET', '/lab/tests?all=true&q=Imported glucose'))[0].price), 150);
    // Hospital B sees none of it, and its own import with the same codes creates B's own tests.
    assert.equal(ok(await b('GET', '/lab/tests?all=true&q=Imported')).length, 0);
    assert.ok(!ok(await b('GET', '/lab/departments?all=true')).some((d) => d.name === `Imported Dept ${suffix}`));
    assert.equal(ok(await b('POST', '/lab/tests/import', { rows }), 201).create, 2);
    assert.equal((await a('POST', '/lab/tests/import', { rows: Array.from({ length: 501 }, (_, i) => ({ code: `R${i}`, name: 'Row' })) })).status, 400, 'row limit');
    ids.glucoseA = imported.find((t) => t.name === 'Imported glucose').id;
    ids.hbsagA = imported.find((t) => t.name === 'Imported HBsAg').id;
  });

  test('order snapshots department/method/options; results are checked by input type; headings take no value', async () => {
    const panel = ok(await a('POST', '/lab/tests', { code: `CBC${suffix}`.slice(0, 20).toUpperCase(), name: 'Mini CBC', price: 200, departmentId: ids.haemA, method: 'Impedance' }), 201);
    ok(await a('PUT', `/lab/tests/${panel.id}/parameters`, { parameters: [
      { name: 'Haemoglobin', unit: 'g/dL', refLow: 13, refHigh: 17, decimals: 1 },
      { name: 'Differential count', isHeading: true, unit: 'ignored' },
      { name: 'Blood group', inputType: 'option', options: ['A', 'B', 'AB', 'O'] },
    ] }));
    assert.equal((await a('PUT', `/lab/tests/${panel.id}/parameters`, { parameters: [{ name: 'Bad', inputType: 'option' }] })).status, 400);
    const params = ok(await a('GET', `/lab/tests/${panel.id}/parameters`));
    assert.equal(params[1].isHeading, true);
    assert.equal(params[1].unit, null, 'heading rows keep no unit/range');

    const order = ok(await a('POST', '/lab/orders', { patientId: ids.patientA, testIds: [ids.hbsagA, panel.id, ids.glucoseA] }), 201);
    ok(await a('POST', `/lab/orders/${order.id}/status`, { status: 'sample_collected' }));
    let o = ok(await a('GET', `/lab/orders/${order.id}`));
    assert.deepEqual(o.items.map((i) => i.department), ['Haematology', 'Biochemistry', `Imported Dept ${suffix}`], 'report order follows department order');
    const hbsag = o.items.find((i) => i.testName === 'Imported HBsAg');
    const cbc = o.items.find((i) => i.testName === 'Mini CBC');
    assert.deepEqual(hbsag.options, ['Reactive', 'Non-reactive']);
    assert.equal(cbc.method, 'Impedance');
    const [hb, head, bg] = cbc.parameters;

    // Catalogue edits after ordering never change the order.
    ok(await a('PUT', `/lab/tests/${ids.hbsagA}`, { code: `IMP2${suffix}`.toUpperCase(), name: 'Imported HBsAg', price: 300, inputType: 'option', options: ['Pos', 'Neg'] }));

    assert.equal((await a('PUT', `/lab/orders/${order.id}/results`, { results: [{ itemId: hbsag.id, value: 'Pos' }] })).status, 400, 'not one of the snapshot choices');
    assert.equal((await a('PUT', `/lab/orders/${order.id}/results`, { parameters: [{ id: head.id, value: '5' }] })).status, 400, 'heading takes no value');
    assert.equal((await a('PUT', `/lab/orders/${order.id}/results`, { parameters: [{ id: bg.id, value: 'Z' }] })).status, 400);
    ok(await a('PUT', `/lab/orders/${order.id}/results`, {
      results: [{ itemId: hbsag.id, value: 'reactive' }, { itemId: o.items.find((i) => i.testName === 'Imported glucose').id, value: '140' }],
      parameters: [{ id: hb.id, value: '12' }, { id: bg.id, value: 'ab' }],
    }));
    o = ok(await a('GET', `/lab/orders/${order.id}`));
    assert.equal(o.status, 'completed', 'heading row does not keep the panel open');
    assert.equal(o.items.find((i) => i.testName === 'Imported HBsAg').resultValue, 'Reactive', 'stored with the configured spelling');
    assert.equal(o.items.find((i) => i.testName === 'Imported HBsAg').flag, null, 'option results are not range-flagged');
    const cbc2 = o.items.find((i) => i.testName === 'Mini CBC');
    assert.equal(cbc2.parameters.find((p) => p.name === 'Blood group').resultValue, 'AB');
    assert.equal(cbc2.parameters.find((p) => p.name === 'Haemoglobin').flag, 'low');
    assert.equal(cbc2.resultValue, '2 parameters');
    assert.equal(o.items.find((i) => i.testName === 'Imported glucose').flag, 'high');

    // Hospital B cannot read or write A's order.
    assert.equal((await b('GET', `/lab/orders/${order.id}`)).status, 404);
    assert.equal((await b('PUT', `/lab/orders/${order.id}/results`, { parameters: [{ id: hb.id, value: '1' }] })).status, 404);
  });
});
