import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { panelFlag, buildTrends, canMoveHome, poStatusFromLines, isValidEan, addFrequency, dueDatesUpTo, inclusiveDays, daysInMonth,
  computePayroll, sniffFileType, safeFileName } from '../../src/modules/clinical/phase3.logic.js';

describe('Lab panels & trends', () => {
  test('panel flag', () => {
    assert.equal(panelFlag(['normal', 'normal']), 'normal');
    assert.equal(panelFlag(['normal', 'high', null]), 'abnormal');
    assert.equal(panelFlag([null]), null);
  });
  test('trend series: numeric only, oldest first, grouped per test/parameter', () => {
    const s = buildTrends([
      { key: 'p:1', name: 'Hb', unit: 'g/dL', at: '2026-10-02', value: 11.2, flag: 'low' },
      { key: 'p:1', name: 'Hb', unit: 'g/dL', at: '2026-09-01', value: 10.1, flag: 'low' },
      { key: 't:5', name: 'Urine', at: '2026-09-01', value: null },
      { key: 't:6', name: 'TSH', at: '2026-09-01', value: 'abc' },
    ]);
    assert.equal(s.length, 1);
    assert.deepEqual(s[0].points.map((p) => p.value), [10.1, 11.2]);
  });
  test('home collection status flow', () => {
    assert.ok(canMoveHome('scheduled', 'assigned'));
    assert.ok(!canMoveHome('collected', 'cancelled'));
    assert.ok(!canMoveHome('scheduled', 'collected'));
  });
});

describe('Pharmacy', () => {
  test('purchase order status from received quantities', () => {
    assert.equal(poStatusFromLines([{ quantity: 10, receivedQuantity: 0 }], 'ordered'), 'ordered');
    assert.equal(poStatusFromLines([{ quantity: 10, receivedQuantity: 4 }], 'ordered'), 'partially_received');
    assert.equal(poStatusFromLines([{ quantity: 10, receivedQuantity: 10 }, { quantity: 5, receivedQuantity: 6 }], 'partially_received'), 'received');
    assert.equal(poStatusFromLines([{ quantity: 10, receivedQuantity: 10 }], 'cancelled'), 'cancelled');
  });
  test('EAN check digit', () => {
    assert.ok(isValidEan('4006381333931'));
    assert.ok(!isValidEan('4006381333932'));
    assert.ok(isValidEan('96385074'));
  });
});

describe('Dates & payroll', () => {
  test('monthly steps clamp to month end and keep the anchor day', () => {
    assert.equal(addFrequency('2026-01-31', 'monthly'), '2026-02-28');
    assert.equal(addFrequency('2026-02-28', 'monthly', 31), '2026-03-31');
    assert.equal(addFrequency('2026-11-30', 'quarterly'), '2027-02-28');
    assert.equal(addFrequency('2026-10-31', 'weekly'), '2026-11-07');
    assert.equal(addFrequency('2028-02-29', 'yearly'), '2029-02-28');
  });
  test('catch-up of missed recurring dates, capped and stopping at end date', () => {
    assert.deepEqual(dueDatesUpTo('2026-08-31', '2026-10-31', 'monthly'), { due: ['2026-08-31', '2026-09-30', '2026-10-31'], next: '2026-11-30' });
    assert.deepEqual(dueDatesUpTo('2026-11-01', '2026-10-31', 'monthly').due, []);
    assert.equal(dueDatesUpTo('2026-01-01', '2026-12-31', 'weekly', '2026-01-20').due.length, 3);
    assert.equal(dueDatesUpTo('2020-01-01', '2026-12-31', 'weekly').due.length, 24);
  });
  test('days', () => {
    assert.equal(inclusiveDays('2026-10-30', '2026-11-02'), 4);
    assert.equal(daysInMonth('2028-02'), 29);
  });
  test('payroll: absent and unpaid leave reduce pay; never negative', () => {
    const p = computePayroll({ monthlySalary: 30000, month: '2026-11', attendance: { absent: 2, half_day: 1 }, unpaidLeaveDays: 1, allowances: 500, deductions: 200 });
    assert.equal(p.daysInMonth, 30); assert.equal(p.paidDays, 26.5);
    assert.equal(p.gross, '26500.00'); assert.equal(p.net, '26800.00');
    assert.equal(computePayroll({ monthlySalary: 1000, month: '2026-11', deductions: 5000 }).net, '0.00');
  });
});

describe('Uploads', () => {
  test('file type comes from the bytes, not the name', () => {
    assert.equal(sniffFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), 'image/jpeg');
    assert.equal(sniffFileType(Buffer.from('%PDF-1.7 xxxxxxx')), 'application/pdf');
    assert.equal(sniffFileType(Buffer.from('<svg onload=alert(1)>')), null);
    assert.equal(sniffFileType(Buffer.from('MZ\x90\x00 exe file....')), null);
  });
  test('safe download names', () => {
    assert.equal(safeFileName('../../etc/passwd'), '.._.._etc_passwd');
    assert.equal(safeFileName('bill "1".jpg\r\nX-Evil: 1'), 'bill _1_.jpg_X-Evil_ 1');
    assert.equal(safeFileName(''), 'file');
  });
});
