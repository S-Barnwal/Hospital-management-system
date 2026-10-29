// Razorpay adapter (India). Uses the REST API directly via fetch — no SDK required.
// Docs: Orders API, Standard Checkout signature verification, Webhooks (X-Razorpay-Signature).
import { hmacHex, safeEqual } from '../utils/crypto.js';

export function createRazorpayProvider({ keyId, keySecret, webhookSecret }, fetchImpl = globalThis.fetch) {
  const auth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;

  return {
    name: 'razorpay',
    isSandbox: keyId.startsWith('rzp_test_'),

    /** amountMinor is in paise. */
    async createOrder({ amountMinor, currency, receipt, notes }) {
      const res = await fetchImpl('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amountMinor, currency, receipt, notes }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.id) {
        const reason = body?.error?.description || `HTTP ${res.status}`;
        throw new Error(`Razorpay order creation failed: ${reason}`);
      }
      return {
        orderId: body.id,
        // Public values the browser needs to open Razorpay Checkout. key_secret is never sent.
        checkout: { provider: 'razorpay', keyId, orderId: body.id, amountMinor, currency },
      };
    },

    /** Verifies the signature returned by Checkout: HMAC_SHA256(order_id + "|" + payment_id, key_secret). */
    verifyCheckout({ orderId, paymentId, signature }) {
      if (!orderId || !paymentId || !signature) return false;
      return safeEqual(hmacHex(keySecret, `${orderId}|${paymentId}`), signature);
    },

    /** Verifies a webhook (raw body + X-Razorpay-Signature) and normalises it. Returns null if invalid. */
    parseWebhook(rawBody, headers) {
      if (!webhookSecret) return null;
      const sig = headers['x-razorpay-signature'];
      if (!sig || !safeEqual(hmacHex(webhookSecret, rawBody), sig)) return null;
      const evt = JSON.parse(rawBody.toString('utf8'));
      const payment = evt?.payload?.payment?.entity;
      const order = evt?.payload?.order?.entity;
      const eventId = headers['x-razorpay-event-id'] || `${evt.event}:${payment?.id || order?.id}:${evt.created_at}`;
      let status = null;
      if (evt.event === 'payment.captured' || evt.event === 'order.paid') status = 'paid';
      else if (evt.event === 'payment.failed') status = 'failed';
      return {
        eventId,
        type: evt.event,
        orderId: payment?.order_id || order?.id || null,
        paymentId: payment?.id || null,
        status,
        failureReason: payment?.error_description || null,
      };
    },
  };
}
