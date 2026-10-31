// Phase 4 pure rules: token queue, ABHA, coupons + pricing, revenue, support status, online booking window.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseQueueKey, pickNext, canMoveToken, estimateWaitMinutes, normaliseAbhaNumber, formatAbhaNumber, ABHA_ADDRESS_RE,
  couponProblem, couponDiscountMinor, monthlyValueMinor, statusAfterReply, makeRefCode, bookingDateAllowed,
} from '../../src/modules/clinical/phase4.logic.js';
import { quote } from '../../src/utils/pricing.js';
import { describeAgent } from '../../src/utils/loginEvents.js';

describe('token queue', () => {
  test('queue keys: fixed counters and doctor queues only', () => {
    assert.deepEqual(parseQueueKey('lab'), { kind: 'lab', doctorId: null });
    assert.deepEqual(parseQueueKey('doctor:42'), { kind: 'doctor', doctorId: 42 });
    for (const bad of ['doctor:', 'doctor:abc', 'doctor:1;DROP', 'icu', '', null]) assert.equal(parseQueueKey(bad), null, String(bad));
  });
  test('priority tokens are called first, then the lowest number', () => {
    const w = [{ tokenNumber: 5, priority: false }, { tokenNumber: 9, priority: true }, { tokenNumber: 3, priority: false }];
    assert.equal(pickNext(w).tokenNumber, 9);
    assert.equal(pickNext(w.filter((x) => !x.priority)).tokenNumber, 3);
    assert.equal(pickNext([]), null);
  });
  test('token moves', () => {
    assert.ok(canMoveToken('waiting', 'called'));
    assert.ok(canMoveToken('called', 'called'), 'recall');
    assert.ok(canMoveToken('skipped', 'waiting'));
    assert.ok(!canMoveToken('done', 'waiting'));
    assert.ok(!canMoveToken('cancelled', 'called'));
  });
  test('waiting-time estimate from recent call gaps', () => {
    const t0 = Date.parse('2026-10-31T04:00:00Z');
    const calls = [0, 5, 10, 16].map((m) => new Date(t0 + m * 60000).toISOString());
    assert.equal(estimateWaitMinutes(calls, 3), 16);
    assert.equal(estimateWaitMinutes(calls.slice(0, 1), 3), null);
    assert.equal(estimateWaitMinutes(calls, 0), null);
  });
});

describe('ABHA', () => {
  test('number: 14 digits with or without dashes/spaces', () => {
    assert.equal(normaliseAbhaNumber('91-1234-5678-9012'), '91123456789012');
    assert.equal(normaliseAbhaNumber('91 1234 5678 9012'), '91123456789012');
    assert.equal(normaliseAbhaNumber(''), null);
    assert.throws(() => normaliseAbhaNumber('1234'));
    assert.throws(() => normaliseAbhaNumber('91-1234-5678-901X'));
    assert.equal(formatAbhaNumber('91123456789012'), '91-1234-5678-9012');
  });
  test('address: name@abdm (or @sbx sandbox)', () => {
    assert.ok(ABHA_ADDRESS_RE.test('ravi.kumar@abdm'));
    assert.ok(ABHA_ADDRESS_RE.test('ravi_92@sbx'));
    assert.ok(!ABHA_ADDRESS_RE.test('ravi@gmail.com'));
    assert.ok(!ABHA_ADDRESS_RE.test('@abdm'));
  });
});

describe('coupons and pricing', () => {
  const plan = { Code: 'professional', MonthlyPrice: 2999, AnnualPrice: 29990, TaxRatePercent: 18, Currency: 'INR' };
  const c = { IsActive: true, PercentOff: 20, AmountOff: null, AppliesTo: 'both', Intervals: null, PlanCodes: null, MaxRedemptions: 10, Redeemed: 0 };
  test('validity rules', () => {
    const now = new Date('2026-10-31T00:00:00Z');
    assert.equal(couponProblem(c, { planCode: 'professional', interval: 'monthly', kind: 'signup', now }), null);
    assert.match(couponProblem({ ...c, IsActive: false }, { planCode: 'x', interval: 'monthly', kind: 'signup', now }), /not valid/);
    assert.match(couponProblem(null, { planCode: 'x', interval: 'monthly', kind: 'signup', now }), /not valid/);
    assert.match(couponProblem({ ...c, ValidUntil: '2026-10-01T00:00:00Z' }, { planCode: 'professional', interval: 'monthly', kind: 'signup', now }), /expired/);
    assert.match(couponProblem({ ...c, ValidFrom: '2026-12-01T00:00:00Z' }, { planCode: 'professional', interval: 'monthly', kind: 'signup', now }), /not active yet/);
    assert.match(couponProblem({ ...c, Redeemed: 10 }, { planCode: 'professional', interval: 'monthly', kind: 'signup', now }), /fully used/);
    assert.match(couponProblem({ ...c, AppliesTo: 'renewal' }, { planCode: 'professional', interval: 'monthly', kind: 'signup', now }), /only for renewals/);
    assert.match(couponProblem({ ...c, Intervals: 'annual' }, { planCode: 'professional', interval: 'monthly', kind: 'signup', now }), /annual/);
    assert.match(couponProblem({ ...c, PlanCodes: 'starter,enterprise' }, { planCode: 'professional', interval: 'monthly', kind: 'signup', now }), /selected plan/);
    assert.equal(couponProblem({ ...c, PlanCodes: 'starter, Professional' }, { planCode: 'professional', interval: 'monthly', kind: 'signup', now }), null);
  });
  test('discount is on the subtotal, GST on the rest; total never below ₹1', () => {
    const q = quote(plan, 'monthly', (sub) => couponDiscountMinor(c, sub));
    assert.deepEqual([q.subtotal, q.discount, q.tax, q.total], ['2999.00', '599.80', '431.86', '2831.06']);
    const flat = quote(plan, 'monthly', (sub) => couponDiscountMinor({ ...c, PercentOff: null, AmountOff: 500 }, sub));
    assert.deepEqual([flat.discount, flat.tax, flat.total], ['500.00', '449.82', '2948.82']);
    const huge = quote(plan, 'monthly', (sub) => couponDiscountMinor({ ...c, PercentOff: null, AmountOff: 999999 }, sub));
    assert.equal(huge.discount, '2998.00');
    assert.ok(huge.totalMinor >= 100);
    assert.equal(quote(plan, 'monthly').discount, '0.00');
  });
});

describe('revenue, support, booking', () => {
  test('MRR: annual ÷ 12, free and trial count 0', () => {
    assert.equal(monthlyValueMinor({ interval: 'monthly', monthlyPrice: 2999, annualPrice: 29990 }), 299900);
    assert.equal(monthlyValueMinor({ interval: 'annual', monthlyPrice: 2999, annualPrice: 29990 }), 249917);
    assert.equal(monthlyValueMinor({ interval: 'monthly', monthlyPrice: 2999, isFree: true }), 0);
    assert.equal(monthlyValueMinor({ interval: 'monthly', monthlyPrice: 2999, isTrial: true }), 0);
  });
  test('ticket status after a reply', () => {
    assert.equal(statusAfterReply('support'), 'awaiting_hospital');
    assert.equal(statusAfterReply('hospital'), 'awaiting_support');
  });
  test('booking reference codes are unambiguous', () => {
    for (let i = 0; i < 50; i += 1) assert.match(makeRefCode(), /^[A-HJ-NP-Z2-9]{8}$/);
  });
  test('booking window: today … 30 days ahead', () => {
    assert.ok(bookingDateAllowed('2026-10-31', '2026-10-31'));
    assert.ok(bookingDateAllowed('2026-11-30', '2026-10-31'));
    assert.ok(!bookingDateAllowed('2026-12-01', '2026-10-31'));
    assert.ok(!bookingDateAllowed('2026-10-30', '2026-10-31'));
    assert.ok(!bookingDateAllowed('31-10-2026', '2026-10-31'));
  });
  test('device names for sign-in history', () => {
    assert.equal(describeAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'), 'Chrome on Windows');
    assert.equal(describeAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'), 'Safari on iOS');
    assert.equal(describeAgent(''), 'Unknown device');
  });
});
