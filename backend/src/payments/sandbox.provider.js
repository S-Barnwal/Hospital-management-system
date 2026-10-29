// LOCAL DEVELOPMENT ONLY. Simulates a payment gateway so the purchase → provisioning flow can be
// exercised without real credentials. Payments are flagged IsSandbox = 1 and invoices say "SANDBOX".
// config/env.js refuses to start in production with this provider.
import { randomUUID } from 'node:crypto';
import { hmacHex, safeEqual } from '../utils/crypto.js';

export function createSandboxProvider({ secret }) {
  return {
    name: 'sandbox',
    isSandbox: true,

    async createOrder({ amountMinor, currency }) {
      const orderId = `sandbox_order_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
      return { orderId, checkout: { provider: 'sandbox', orderId, amountMinor, currency } };
    },

    /**
     * The sandbox "gateway" (POST /api/v1/onboarding/sandbox/pay) signs the outcome with a server secret,
     * and verification goes through exactly the same code path as Razorpay.
     */
    sign(orderId, paymentId) {
      return hmacHex(secret, `${orderId}|${paymentId}`);
    },

    verifyCheckout({ orderId, paymentId, signature }) {
      if (!orderId || !paymentId || !signature) return false;
      return safeEqual(hmacHex(secret, `${orderId}|${paymentId}`), signature);
    },

    parseWebhook() {
      return null; // no webhooks in sandbox
    },
  };
}
