import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { quote, addInterval, toMinor, fromMinor } from '../../src/utils/pricing.js';
import { tzOffsetMinutes, localDayRangeUtc, localToUtc, localDateString } from '../../src/utils/time.js';
import { canTransition, overlaps, withinSchedule, freeSlots } from '../../src/modules/appointments/appointments.logic.js';
import { createRazorpayProvider } from '../../src/payments/razorpay.provider.js';
import { createSandboxProvider } from '../../src/payments/sandbox.provider.js';
import { parseConnectionString, loadConfig } from '../../src/config/env.js';
import { parseListQuery } from '../../src/utils/pagination.js';

describe('Pricing (integer paise, no floats)', () => {
  const plan = { MonthlyPrice: 2999, AnnualPrice: 29990, TaxRatePercent: 18, Currency: 'INR', IsContactSales: false };
  test('GST-exclusive quote', () => {
    assert.deepEqual(quote(plan, 'monthly'), { currency: 'INR', subtotal: '2999.00', tax: '539.82', total: '3538.82', totalMinor: 353882, taxRatePercent: 18 });
    assert.equal(quote(plan, 'annual').total, '35388.20');
  });
  test('contact-sales plans cannot be quoted', () => assert.throws(() => quote({ ...plan, IsContactSales: true }, 'monthly')));
  test('minor-unit conversions', () => {
    assert.equal(toMinor('999.5'), 99950);
    assert.equal(fromMinor(105), '1.05');
    assert.throws(() => toMinor('1.234'));
  });
  test('period end clamps at month end', () => {
    assert.equal(addInterval(new Date('2026-01-31T10:00:00Z'), 'monthly').toISOString(), '2026-02-28T10:00:00.000Z');
    assert.equal(addInterval(new Date('2028-02-29T00:00:00Z'), 'annual').toISOString(), '2029-02-28T00:00:00.000Z');
  });
});

describe('Timezones (UTC storage, hospital-local display)', () => {
  test('Asia/Kolkata offset and day range', () => {
    assert.equal(tzOffsetMinutes('Asia/Kolkata', new Date('2026-10-29T12:00:00Z')), 330);
    const { start, end } = localDayRangeUtc('Asia/Kolkata', '2026-10-29');
    assert.equal(start.toISOString(), '2026-10-28T18:30:00.000Z');
    assert.equal(end.toISOString(), '2026-10-29T18:30:00.000Z');
  });
  test('local wall-clock → UTC, including a DST zone', () => {
    assert.equal(localToUtc('Asia/Kolkata', '2026-10-30', '10:15').toISOString(), '2026-10-30T04:45:00.000Z');
    assert.equal(localToUtc('America/New_York', '2026-07-01', '09:00').toISOString(), '2026-07-01T13:00:00.000Z');
    assert.equal(localToUtc('America/New_York', '2026-12-01', '09:00').toISOString(), '2026-12-01T14:00:00.000Z');
  });
  test('local date string', () => assert.equal(localDateString('Asia/Kolkata', new Date('2026-10-29T20:00:00Z')), '2026-10-30'));
});

describe('Appointments rules', () => {
  test('status transitions', () => {
    assert.ok(canTransition('scheduled', 'checked_in'));
    assert.ok(canTransition('checked_in', 'completed'));
    assert.equal(canTransition('completed', 'cancelled'), false);
    assert.equal(canTransition('cancelled', 'scheduled'), false);
  });
  test('overlap is half-open (back-to-back slots are fine)', () => {
    assert.equal(overlaps(540, 555, 555, 570), false);
    assert.equal(overlaps(540, 560, 555, 570), true);
  });
  test('schedule window and free slots', () => {
    const blocks = [{ StartTime: '09:00', EndTime: '10:00', SlotMinutes: 15 }];
    assert.ok(withinSchedule(blocks, '09:45', 15));
    assert.equal(withinSchedule(blocks, '09:50', 15), false);
    assert.ok(withinSchedule([], '23:00', 15));
    assert.deepEqual(freeSlots(blocks, [{ start: 555, end: 570 }]), ['09:00', '09:30', '09:45']);
    assert.deepEqual(freeSlots(blocks, [], { nowMinutes: 560 }), ['09:30', '09:45']);
  });
});

describe('Payment providers', () => {
  test('Razorpay checkout signature verification', () => {
    const rp = createRazorpayProvider({ keyId: 'rzp_test_abc', keySecret: 'sec', webhookSecret: 'wh' });
    const sig = createHmac('sha256', 'sec').update('order_1|pay_1').digest('hex');
    assert.equal(rp.verifyCheckout({ orderId: 'order_1', paymentId: 'pay_1', signature: sig }), true);
    assert.equal(rp.verifyCheckout({ orderId: 'order_2', paymentId: 'pay_1', signature: sig }), false);
    assert.equal(rp.verifyCheckout({ orderId: 'order_1', paymentId: 'pay_1', signature: 'nope' }), false);
    assert.equal(rp.isSandbox, true);
  });
  test('Razorpay webhook signature + normalisation', () => {
    const rp = createRazorpayProvider({ keyId: 'rzp_live_x', keySecret: 'sec', webhookSecret: 'wh' });
    const body = Buffer.from(JSON.stringify({ event: 'payment.captured', created_at: 1, payload: { payment: { entity: { id: 'pay_9', order_id: 'order_9' } } } }));
    const sig = createHmac('sha256', 'wh').update(body).digest('hex');
    const evt = rp.parseWebhook(body, { 'x-razorpay-signature': sig, 'x-razorpay-event-id': 'evt_1' });
    assert.deepEqual(evt, { eventId: 'evt_1', type: 'payment.captured', orderId: 'order_9', paymentId: 'pay_9', status: 'paid', failureReason: null });
    assert.equal(rp.parseWebhook(body, { 'x-razorpay-signature': 'bad' }), null);
    assert.equal(rp.isSandbox, false);
  });
  test('Razorpay order creation uses Basic auth and never exposes the secret', async () => {
    let seen;
    const fakeFetch = async (url, init) => { seen = { url, init }; return { ok: true, status: 200, json: async () => ({ id: 'order_X' }) }; };
    const rp = createRazorpayProvider({ keyId: 'rzp_test_k', keySecret: 'topsecret', webhookSecret: '' }, fakeFetch);
    const out = await rp.createOrder({ amountMinor: 100, currency: 'INR', receipt: 'r', notes: {} });
    assert.equal(seen.url, 'https://api.razorpay.com/v1/orders');
    assert.equal(seen.init.headers.Authorization, `Basic ${Buffer.from('rzp_test_k:topsecret').toString('base64')}`);
    assert.equal(out.orderId, 'order_X');
    assert.equal(JSON.stringify(out.checkout).includes('topsecret'), false);
  });
  test('Sandbox signs and verifies through the same interface', async () => {
    const sb = createSandboxProvider({ secret: 's3' });
    const { orderId } = await sb.createOrder({ amountMinor: 1, currency: 'INR' });
    assert.ok(orderId.startsWith('sandbox_order_'));
    assert.ok(sb.verifyCheckout({ orderId, paymentId: 'p1', signature: sb.sign(orderId, 'p1') }));
    assert.equal(sb.verifyCheckout({ orderId, paymentId: 'p2', signature: sb.sign(orderId, 'p1') }), false);
  });
});

describe('Configuration', () => {
  test('parses ADO.NET connection strings', () => {
    const c = parseConnectionString('Data Source=SQL1.example.net,1444;Initial Catalog=db1;User Id=u1;Password=p=w;Encrypt=True;TrustServerCertificate=True;');
    assert.equal(c.server, 'SQL1.example.net');
    assert.equal(c.port, 1444);
    assert.equal(c.database, 'db1');
    assert.equal(c.user, 'u1');
    assert.equal(c.password, 'p=w');
    assert.equal(c.options.trustServerCertificate, true);
  });
  test('refuses sandbox payments and weak secrets in production', () => {
    const cfg = loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'short', PAYMENT_PROVIDER: 'sandbox' });
    assert.equal(cfg.problems.length, 2);
  });
});

describe('List queries', () => {
  test('sort allowlist blocks SQL injection via ?sort=', () => {
    assert.throws(() => parseListQuery({ sort: 'Name; DROP TABLE Patients' }, { name: 'FirstName' }, 'name'), /Invalid sort/);
    const lq = parseListQuery({ page: '3', pageSize: '500', order: 'asc' }, { name: 'FirstName' }, 'name');
    assert.deepEqual([lq.offset, lq.pageSize, lq.orderBy], [200, 100, 'FirstName ASC']);
  });
});
