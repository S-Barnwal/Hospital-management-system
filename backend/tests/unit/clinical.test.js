import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeLine, computeBill, balanceDue, labFlag, canMoveLab, allocateFefo, bedDays, toCsv } from '../../src/modules/clinical/logic.js';
import { requireFeature } from '../../src/middleware/tenantAccess.js';

describe('Billing maths', () => {
  test('line subtotal and tax in paise', () => {
    assert.deepEqual(computeLine({ quantity: 3, unitPrice: '33.33', taxRatePercent: 12 }), { subMinor: 9999, taxMinor: 1200, lineSubtotal: '99.99', lineTax: '12.00' });
    assert.throws(() => computeLine({ quantity: 0, unitPrice: 10 }));
  });
  test('bill-level discount reduces taxable value proportionally', () => {
    const lines = [computeLine({ quantity: 1, unitPrice: 500 }), computeLine({ quantity: 2, unitPrice: 250, taxRatePercent: 18 })];
    const b = computeBill(lines, 100);
    assert.deepEqual([b.subtotal, b.discount, b.tax, b.total], ['1000.00', '100.00', '81.00', '981.00']);
    assert.throws(() => computeBill(lines, 2000), /exceed/);
    assert.equal(computeBill([], 0).total, '0.00');
  });
  test('balance due', () => assert.equal(balanceDue('981.00', '500.50'), '480.50'));
});

describe('Laboratory', () => {
  test('result flags', () => {
    assert.equal(labFlag('13.5', 12, 16), 'normal');
    assert.equal(labFlag('11.9', 12, 16), 'low');
    assert.equal(labFlag('200', null, 140), 'high');
    assert.equal(labFlag('Positive', 1, 2), null);
    assert.equal(labFlag('5', null, null), null);
  });
  test('order workflow', () => {
    assert.ok(canMoveLab('ordered', 'sample_collected'));
    assert.ok(canMoveLab('completed', 'verified'));
    assert.equal(canMoveLab('verified', 'completed'), false);
    assert.equal(canMoveLab('ordered', 'verified'), false);
  });
});

describe('Pharmacy FEFO', () => {
  const batches = [
    { BatchId: 1, ExpiryDate: '2026-12-31', QuantityOnHand: 5, SalePrice: 10 },
    { BatchId: 2, ExpiryDate: '2026-11-30', QuantityOnHand: 3, SalePrice: 11 },
    { BatchId: 3, ExpiryDate: '2026-01-01', QuantityOnHand: 50, SalePrice: 9 }, // expired
  ];
  test('takes earliest expiry first, skips expired', () => {
    assert.deepEqual(allocateFefo(batches, 6, '2026-10-29'), [{ batchId: 2, quantity: 3, unitPrice: 11 }, { batchId: 1, quantity: 3, unitPrice: 10 }]);
  });
  test('refuses to go negative', () => {
    assert.throws(() => allocateFefo(batches, 9, '2026-10-29'), (e) => e.code === 'INSUFFICIENT_STOCK');
    assert.throws(() => allocateFefo(batches, 1.5, '2026-10-29'));
  });
});

describe('IPD & reports', () => {
  test('bed days', () => {
    assert.equal(bedDays('2026-10-01T10:00:00Z', '2026-10-01T12:00:00Z'), 1);
    assert.equal(bedDays('2026-10-01T10:00:00Z', '2026-10-03T11:00:00Z'), 3);
  });
  test('CSV escapes quotes and blocks formula injection', () => {
    const csv = toCsv([{ a: 'x,"y"', b: '=HYPERLINK(1)' }], [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }]);
    assert.equal(csv, 'A,B\r\n"x,""y""",\'=HYPERLINK(1)');
  });
});

describe('Plan feature gate', () => {
  const run = (features) => new Promise((resolve) => requireFeature('billing')({ ctx: { features: new Set(features) } }, {}, resolve));
  test('blocks modules missing from the plan', async () => {
    assert.equal(await run(['billing']), undefined);
    assert.equal((await run(['patients'])).code, 'FEATURE_NOT_IN_PLAN');
  });
});

describe('Lab packages, payments and samples', async () => {
  const { allocatePackagePrice, labPaymentStatus, canMoveSample } = await import('../../src/modules/clinical/logic.js');
  test('package price is split proportionally and sums exactly', () => {
    const a = allocatePackagePrice(80000, [80000, 20000]);
    assert.deepEqual(a, [64000, 16000]);
    const b = allocatePackagePrice(10000, [3333, 3333, 3334]);
    assert.equal(b.reduce((x, y) => x + y, 0), 10000);
    assert.deepEqual(allocatePackagePrice(1000, [0, 0, 0]), [333, 333, 334]);
    assert.deepEqual(allocatePackagePrice(500, []), []);
  });
  test('payment status from bill', () => {
    assert.equal(labPaymentStatus(null), 'unbilled');
    assert.equal(labPaymentStatus({ billId: 1, status: 'draft', total: 10, paid: 0 }), 'on_bill');
    assert.equal(labPaymentStatus({ billId: 1, status: 'finalized', total: 10, paid: 0 }), 'unpaid');
    assert.equal(labPaymentStatus({ billId: 1, status: 'finalized', total: 10, paid: 4 }), 'partial');
    assert.equal(labPaymentStatus({ billId: 1, status: 'finalized', total: 10, paid: 10 }), 'paid');
    assert.equal(labPaymentStatus({ billId: 1, status: 'cancelled', total: 10, paid: 0 }), 'cancelled');
  });
  test('sample transitions', () => {
    assert.ok(canMoveSample('pending', 'collected'));
    assert.ok(canMoveSample('collected', 'received'));
    assert.ok(canMoveSample('rejected', 'collected'));
    assert.ok(!canMoveSample('pending', 'received'));
    assert.ok(!canMoveSample('received', 'collected'));
  });
});
