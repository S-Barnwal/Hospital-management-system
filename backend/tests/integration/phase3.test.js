// Phase 3 integration tests (lab panels & home collection, purchase orders & barcodes, HR & payroll, recurring expenses,
// attachments). Same rules as the other suites: a REAL SQL Server *test* database, never production.
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
const A = { slug: `p3-a-${suffix}`, email: `p3-owner-a-${suffix}@test.local` };
const B = { slug: `p3-b-${suffix}`, email: `p3-owner-b-${suffix}@test.local` };
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
    orgName: `Phase3 ${t.slug}`, slug: t.slug, ownerName: 'Owner', ownerEmail: t.email, ownerPasswordHash: await hashPassword(PASSWORD),
  }, { planId: plan.PlanId, interval: 'monthly' }, null));
}
const ymd = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => ymd(new Date(Date.now() - n * 864e5));
// Smallest file the server accepts as a PNG (signature + padding); the server checks bytes, not names.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);

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
  ids.patientB = ok(await b('POST', '/patients', { firstName: 'Other', lastName: `B-${suffix}` }), 201).id;
});

after(async () => { server?.close(); await retireTestHospitals(db, [A.slug, B.slug], IS_TEST_DB).catch(() => {}); await closePool(); });

describe('Phase 3: laboratory panels and home collection', () => {
  test('panel parameters are per hospital, snapshotted on the order and flagged line by line', async () => {
    const [testA] = ok(await a('GET', '/lab/tests'));
    ok(await a('PUT', `/lab/tests/${testA.id}/parameters`, { parameters: [
      { name: 'Haemoglobin', unit: 'g/dL', refLow: 13, refHigh: 17 }, { name: 'WBC', unit: '/µL', refLow: 4000, refHigh: 11000 }] }));
    assert.equal(ok(await a('GET', `/lab/tests/${testA.id}/parameters`)).length, 2);
    assert.equal((await b('GET', `/lab/tests/${testA.id}/parameters`)).status, 404);
    assert.equal((await b('PUT', `/lab/tests/${testA.id}/parameters`, { parameters: [] })).status, 404);

    const scheduledAt = new Date(Date.now() + 3600e3).toISOString();
    const order = ok(await a('POST', '/lab/orders', { patientId: ids.patientA, testIds: [testA.id], addToBill: true,
      homeCollection: { address: '12 MG Road, Delhi 110001', scheduledAt, charge: 150 } }), 201);
    ids.orderA = order.id;
    let detail = ok(await a('GET', `/lab/orders/${order.id}`));
    assert.equal(detail.items[0].parameters.length, 2, 'parameters copied onto the order');
    assert.ok(detail.homeCollection?.id, 'home collection booked');
    assert.equal(Number(detail.amounts.gross), Number(detail.items[0].price) + 150, 'home-collection charge added to the order');

    // Changing the panel later does not change this order's snapshot.
    ok(await a('PUT', `/lab/tests/${testA.id}/parameters`, { parameters: [{ name: 'Haemoglobin', unit: 'g/dL', refLow: 12, refHigh: 16 }] }));
    detail = ok(await a('GET', `/lab/orders/${order.id}`));
    assert.equal(detail.items[0].parameters.length, 2);

    // Home collection list and status are per hospital; collecting moves the order on.
    const hcId = detail.homeCollection.id;
    assert.ok(ok(await a('GET', '/lab/home-collections?open=true')).some((h) => Number(h.id) === Number(hcId)));
    assert.ok(!ok(await b('GET', '/lab/home-collections?open=true')).some((h) => Number(h.id) === Number(hcId)));
    assert.equal((await b('POST', `/lab/home-collections/${hcId}/status`, { status: 'assigned' })).status, 404);
    assert.equal((await a('POST', `/lab/home-collections/${hcId}/status`, { status: 'collected' })).status, 409, 'cannot skip from scheduled to collected');
    const collector = ok(await a('POST', '/hr/staff', { staffType: 'lab_technician', fullName: `Collector ${suffix}` }), 201).id;
    const collectorB = ok(await b('POST', '/hr/staff', { staffType: 'lab_technician', fullName: `B tech ${suffix}` }), 201).id;
    assert.equal((await a('POST', `/lab/home-collections/${hcId}/status`, { status: 'assigned', collectorStaffId: collectorB })).status, 400, 'B\'s staff cannot collect A\'s sample');
    ok(await a('POST', `/lab/home-collections/${hcId}/status`, { status: 'assigned', collectorStaffId: collector }));
    ok(await a('POST', `/lab/home-collections/${hcId}/status`, { status: 'collected' }));
    detail = ok(await a('GET', `/lab/orders/${order.id}`));
    assert.equal(detail.status, 'sample_collected');

    // Results per parameter: Hb low, WBC normal → line flags; B cannot write them.
    const [hb, wbc] = detail.items[0].parameters;
    assert.equal((await b('PUT', `/lab/orders/${order.id}/results`, { parameters: [{ id: hb.id, value: '1' }] })).status, 404);
    ok(await a('PUT', `/lab/orders/${order.id}/results`, { parameters: [{ id: hb.id, value: '10.5' }, { id: wbc.id, value: '7000' }] }));
    detail = ok(await a('GET', `/lab/orders/${order.id}`));
    const flags = Object.fromEntries(detail.items[0].parameters.map((p) => [p.name, p.flag]));
    assert.equal(flags.Haemoglobin, 'low');
    assert.ok([null, 'normal'].includes(flags.WBC));

    assert.equal((await b('GET', `/lab/patients/${ids.patientA}/trends`)).status, 404);
    ok(await a('GET', `/lab/patients/${ids.patientA}/trends`));
  });
});

describe('Phase 3: pharmacy purchase orders and barcodes', () => {
  test('barcode is unique per hospital and invisible to others; PO receive adds stock; B cannot touch A\'s PO', async () => {
    const code = `4006381333931`;
    const medA = ok(await a('POST', '/pharmacy/medicines', { name: `Paracetamol ${suffix}`, strength: '500 mg', unit: 'tab', taxRatePercent: 12, salePrice: 2, reorderLevel: 100, barcode: code }), 201).id;
    assert.equal((await a('POST', '/pharmacy/medicines', { name: `Copy ${suffix}`, unit: 'tab', taxRatePercent: 12, salePrice: 2, reorderLevel: 0, barcode: code })).status, 409);
    // The same barcode is fine in another hospital (their own pack).
    ok(await b('POST', '/pharmacy/medicines', { name: `B med ${suffix}`, unit: 'tab', taxRatePercent: 12, salePrice: 2, reorderLevel: 0, barcode: code }), 201);
    assert.equal(Number(ok(await a('GET', `/pharmacy/medicines/by-barcode/${code}`)).id), medA);
    assert.notEqual(Number(ok(await b('GET', `/pharmacy/medicines/by-barcode/${code}`)).id), medA);

    const supA = ok(await a('POST', '/pharmacy/suppliers', { name: `Supplier ${suffix}` }), 201).id;
    const supB = ok(await b('POST', '/pharmacy/suppliers', { name: `B supplier ${suffix}` }), 201).id;
    assert.ok(ok(await a('GET', '/pharmacy/purchase-orders/suggestions')).some((s) => Number(s.medicineId ?? s.id) === medA), 'below reorder level → suggested');
    // B cannot order A's medicine, A cannot use B's supplier.
    assert.equal((await b('POST', '/pharmacy/purchase-orders', { supplierId: supB, items: [{ medicineId: medA, quantity: 10, unitCost: 1 }] })).status, 400);
    assert.equal((await a('POST', '/pharmacy/purchase-orders', { supplierId: supB, items: [{ medicineId: medA, quantity: 10, unitCost: 1 }] })).status, 400);

    const po = ok(await a('POST', '/pharmacy/purchase-orders', { supplierId: supA, items: [{ medicineId: medA, quantity: 200, unitCost: 1.25 }] }), 201);
    assert.equal((await b('GET', `/pharmacy/purchase-orders/${po.id}`)).status, 404);
    assert.equal((await a('POST', `/pharmacy/purchase-orders/${po.id}/receive`, { lines: [{ itemId: 1, quantity: 1, batchNumber: 'X', expiryDate: '2030-01-01', salePrice: 2 }] })).status, 409, 'draft cannot be received');
    ok(await a('POST', `/pharmacy/purchase-orders/${po.id}/place`));
    const detail = ok(await a('GET', `/pharmacy/purchase-orders/${po.id}`));
    assert.equal((await b('POST', `/pharmacy/purchase-orders/${po.id}/receive`, { lines: [{ itemId: detail.items[0].id, quantity: 50, batchNumber: 'B1', expiryDate: '2030-01-01', salePrice: 2 }] })).status, 404);
    ok(await a('POST', `/pharmacy/purchase-orders/${po.id}/receive`, { lines: [{ itemId: detail.items[0].id, quantity: 120, batchNumber: `B${suffix}`, expiryDate: '2030-01-01', salePrice: 2 }] }));
    assert.equal(ok(await a('GET', `/pharmacy/purchase-orders/${po.id}`)).status, 'partially_received');
    const stock = await db.one('SELECT SUM(QuantityOnHand) AS q FROM hms.StockBatches WHERE TenantId = @t AND MedicineId = @m', { t: ids.tenantA, m: medA });
    assert.equal(Number(stock.q), 120);
    ok(await a('POST', `/pharmacy/purchase-orders/${po.id}/receive`, { lines: [{ itemId: detail.items[0].id, quantity: 80, batchNumber: `C${suffix}`, expiryDate: '2030-06-01', salePrice: 2 }] }));
    assert.equal(ok(await a('GET', `/pharmacy/purchase-orders/${po.id}`)).status, 'received');
    assert.equal((await a('POST', `/pharmacy/purchase-orders/${po.id}/cancel`, { reason: 'Too late' })).status, 409, 'received order cannot be cancelled');
  });
});

describe('Phase 3: HR, payroll and salary expenses', () => {
  test('attendance, leave and payroll stay inside the hospital; paying creates one locked salary expense', async () => {
    const staffA = ok(await a('POST', '/hr/staff', { staffType: 'nurse', fullName: `Nurse ${suffix}` }), 201).id;
    // B cannot mark, request leave or set salary for A's staff.
    const { today } = (await a('GET', '/hr/attendance')).body.meta;
    assert.equal((await b('PUT', '/hr/attendance', { date: today, entries: [{ staffId: staffA, status: 'absent' }] })).status, 400);
    assert.equal((await b('POST', '/hr/leaves', { staffId: staffA, leaveType: 'casual', fromDate: today, toDate: today })).status, 400);
    assert.equal((await b('PUT', `/hr/staff/${staffA}/salary`, { monthlySalary: 1 })).status, 404);
    assert.equal((await a('PUT', '/hr/attendance', { date: '2999-01-01', entries: [{ staffId: staffA, status: 'present' }] })).status, 400, 'no future dates');

    const month = today.slice(0, 7);
    const first = `${month}-01`;
    ok(await a('PUT', '/hr/attendance', { date: first, entries: [{ staffId: staffA, status: 'absent' }] }));
    ok(await a('PUT', `/hr/staff/${staffA}/salary`, { monthlySalary: 31000 }));
    assert.ok(!ok(await b('GET', `/hr/payroll?month=${month}`)).some((r) => Number(r.staffId) === staffA));

    // Leave: overlap refused; approval is per hospital.
    const leave = ok(await a('POST', '/hr/leaves', { staffId: staffA, leaveType: 'unpaid', fromDate: today, toDate: today, halfDay: true }), 201);
    assert.equal((await a('POST', '/hr/leaves', { staffId: staffA, leaveType: 'casual', fromDate: today, toDate: today })).status, 409);
    assert.equal((await b('POST', `/hr/leaves/${leave.id}/decide`, { status: 'approved' })).status, 404);
    ok(await a('POST', `/hr/leaves/${leave.id}/decide`, { status: 'approved' }));

    ok(await a('POST', '/hr/payroll/generate', { month }));
    const row = ok(await a('GET', `/hr/payroll?month=${month}`)).find((r) => Number(r.staffId) === staffA);
    assert.ok(row?.run, 'payslip prepared');
    // Paid days = days in month − 1 absent day − ½ day unpaid leave. (On the 1st the approved leave cannot overwrite the
    // day already marked absent, but the unpaid half day still counts from the leave request.)
    const dim = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
    assert.equal(Number(row.run.paidDays), dim - 1.5);
    assert.equal(Number(row.run.gross), Math.round((31000 * (dim - 1.5) / dim) * 100) / 100);

    assert.equal((await b('GET', `/hr/payroll/${row.run.id}`)).status, 404);
    assert.equal((await b('POST', `/hr/payroll/${row.run.id}/pay`, { method: 'bank' })).status, 404);
    ok(await a('PUT', `/hr/payroll/${row.run.id}`, { allowances: 500, deductions: 200 }));
    const paid = ok(await a('POST', `/hr/payroll/${row.run.id}/pay`, { method: 'bank' }));
    assert.match(paid.expenseNumber, /^EXP-/);
    assert.equal((await a('POST', `/hr/payroll/${row.run.id}/pay`, { method: 'bank' })).status, 409, 'paid once only');
    const exp = await db.one('SELECT ExpenseId, Amount FROM hms.Expenses WHERE TenantId = @t AND PayrollId = @p', { t: ids.tenantA, p: row.run.id });
    assert.ok(exp, 'salary expense recorded');
    assert.equal((await a('DELETE', `/expenses/${exp.ExpenseId}`)).status, 409, 'salary expense is locked');
    const slip = ok(await a('GET', `/hr/payroll/${row.run.id}`));
    assert.equal(slip.status, 'paid');
    assert.equal(Number(slip.net), Number(exp.Amount));
  });
});

describe('Phase 3: recurring expenses and attachments', () => {
  test('recurring expenses post each due date once and only for their own hospital', async () => {
    const cats = ok(await a('GET', '/expenses/categories'));
    const catB = ok(await b('GET', '/expenses/categories'))[0];
    assert.equal((await a('POST', '/expenses/recurring', { title: 'Rent', categoryId: catB.id, amount: 1000, method: 'bank', frequency: 'weekly', nextDueDate: daysAgo(14) })).status, 400, 'other hospital\'s category');
    const rec = ok(await a('POST', '/expenses/recurring', { title: `Rent ${suffix}`, categoryId: cats[0].id, amount: 1000, method: 'bank', frequency: 'weekly', nextDueDate: daysAgo(14) }), 201);
    assert.equal((await b('PUT', `/expenses/recurring/${rec.id}`, { title: 'Hijack attempt', categoryId: catB.id, amount: 1, method: 'cash', frequency: 'weekly', nextDueDate: daysAgo(1) })).status, 404);
    assert.equal((await b('DELETE', `/expenses/recurring/${rec.id}`)).status, 404);
    ok(await b('POST', '/expenses/recurring/post-due'));
    const countFor = async () => (await db.one('SELECT COUNT(*) AS n FROM hms.Expenses WHERE TenantId = @t AND RecurringExpenseId = @r', { t: ids.tenantA, r: rec.id })).n;
    assert.equal(await countFor(), 0, 'B posting does not post A\'s');
    ok(await a('POST', '/expenses/recurring/post-due'));
    assert.equal(await countFor(), 3, '14, 7 and 0 days ago');
    ok(await a('POST', '/expenses/recurring/post-due'));
    assert.equal(await countFor(), 3, 'idempotent');
  });

  test('attachments: real type checked by bytes, files invisible to other hospitals', async () => {
    const cats = ok(await a('GET', '/expenses/categories'));
    const expA = ok(await a('POST', '/expenses', { expenseDate: daysAgo(1), categoryId: cats[0].id, amount: 99, method: 'cash' }), 201).id;
    const q = (type, id, name = 'receipt.png') => `/attachments?entityType=${type}&entityId=${id}&fileName=${encodeURIComponent(name)}`;
    assert.equal((await a.upload(q('expense', expA, 'evil.png'), Buffer.from('<script>alert(1)</script> not an image'))).status, 400);
    assert.equal((await b.upload(q('expense', expA), PNG)).status, 404, 'B cannot attach to A\'s expense');
    assert.equal((await b.upload(q('patient', ids.patientA), PNG)).status, 404, 'B cannot attach to A\'s patient');
    const file = ok(await a.upload(q('patient', ids.patientA, 'id card.png'), PNG), 201);
    assert.equal(file.contentType, 'image/png');
    assert.equal((await b('GET', q('patient', ids.patientA).split('&fileName')[0])).status, 404);
    assert.equal((await b('GET', `/attachments/${file.id}/file`)).status, 404);
    assert.equal((await b('DELETE', `/attachments/${file.id}`)).status, 404);
    const got = await a('GET', `/attachments/${file.id}/file`);
    assert.equal(got.status, 200);
    assert.equal(got.headers.get('x-content-type-options'), 'nosniff');
    assert.match(got.headers.get('content-security-policy') || '', /sandbox/);
    assert.ok(Buffer.compare(got.body, PNG) === 0);
    ok(await a('DELETE', `/attachments/${file.id}`));
    assert.equal((await a('GET', `/attachments/${file.id}/file`)).status, 404);
  });
});
