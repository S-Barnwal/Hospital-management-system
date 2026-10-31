import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { vitalFlags, hasAnyVital, bedChargeDates, depositBalance, cashSummary, denominationTotal, upiUri, UPI_ID_RE, followUpBucket } from '../../src/modules/clinical/phase2.logic.js';

describe('Vitals', () => {
  test('highlights out-of-range readings, ignores empty ones', () => {
    assert.deepEqual(vitalFlags({ pulseBpm: 132, spo2: 93, temperatureC: 37, bpSystolic: '', painScore: 8 }),
      { pulseBpm: 'critical_high', spo2: 'low', painScore: 'critical_high' });
    assert.deepEqual(vitalFlags({ spo2: 88, bloodSugarMgdl: 50 }), { spo2: 'critical_low', bloodSugarMgdl: 'critical_low' });
    assert.deepEqual(vitalFlags({}), {});
  });
  test('at least one reading is required', () => {
    assert.equal(hasAnyVital({ notes: 'x' }), false);
    assert.equal(hasAnyVital({ painScore: 0 }), true);
  });
});

describe('Daily bed charges', () => {
  test('one date per started day, in hospital time', () => {
    // 30 Oct 22:00 IST → 31 Oct 23:00 IST = 25 h → 2 days
    assert.deepEqual(bedChargeDates('2026-10-30T16:30:00Z', '2026-10-31T17:30:00Z', 'Asia/Kolkata'), ['2026-10-30', '2026-10-31']);
    assert.deepEqual(bedChargeDates('2026-10-30T16:30:00Z', '2026-10-30T18:00:00Z', 'Asia/Kolkata'), ['2026-10-30']);
    assert.equal(bedChargeDates('2026-12-30T00:00:00Z', '2027-01-03T00:00:00Z', 'UTC').at(-1), '2027-01-02');
  });
});

describe('Deposits & cash', () => {
  test('deposit balance', () => {
    assert.equal(depositBalance([{ Kind: 'deposit', Amount: 5000 }, { Kind: 'applied', Amount: 3200.5 }, { Kind: 'refund', Amount: '799.50' }]), '1000.00');
    assert.equal(depositBalance([]), '0.00');
  });
  test('expected cash = float + cash in − cash out; deposit-funded bill payments are not cash', () => {
    const s = cashSummary([
      { kind: 'payment', method: 'cash', amount: 500 }, { kind: 'deposit', method: 'cash', amount: 2000 },
      { kind: 'refund', method: 'cash', amount: 100 }, { kind: 'payment', method: 'upi', amount: 300 },
      { kind: 'payment', method: 'deposit', amount: 1500 }, { kind: 'applied', method: null, amount: 1500 },
    ], 1000);
    assert.equal(s.expectedCash, '3400.00');
    assert.equal(s.totals.upi.net, '300.00');
    assert.equal(s.totals.deposit.in, '1500.00');
    assert.equal(s.transactions, 5);
  });
  test('denominations', () => {
    assert.equal(denominationTotal({ 500: 4, 200: 1, 10: 3, 1: 2 }), '2232.00');
    assert.throws(() => denominationTotal({ 3: 1 }));
    assert.throws(() => denominationTotal({ 100: -1 }));
  });
});

describe('UPI & follow-ups', () => {
  test('UPI link', () => {
    assert.ok(UPI_ID_RE.test('cityhospital@okhdfcbank'));
    assert.ok(!UPI_ID_RE.test('not an id'));
    const u = upiUri({ upiId: 'cityhospital@okhdfcbank', payeeName: 'City Hospital', amount: 1250.5, note: 'INV2026-000012' });
    assert.equal(u, 'upi://pay?pa=cityhospital%40okhdfcbank&pn=City%20Hospital&am=1250.50&cu=INR&tn=INV2026-000012');
    assert.throws(() => upiUri({ upiId: 'bad', amount: 1 }));
  });
  test('follow-up buckets', () => {
    assert.equal(followUpBucket('2026-10-30', '2026-10-31'), 'overdue');
    assert.equal(followUpBucket('2026-10-31', '2026-10-31'), 'today');
    assert.equal(followUpBucket('2026-11-05', '2026-10-31'), 'upcoming');
  });
});
