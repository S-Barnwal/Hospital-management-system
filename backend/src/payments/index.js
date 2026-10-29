// Payment-provider abstraction. Add Stripe (or others) by implementing the same interface:
//   createOrder({ amountMinor, currency, receipt, notes }) → { orderId, checkout }
//   verifyCheckout({ orderId, paymentId, signature })     → boolean
//   parseWebhook(rawBody, headers)                         → normalised event | null
import { config } from '../config/env.js';
import { createRazorpayProvider } from './razorpay.provider.js';
import { createSandboxProvider } from './sandbox.provider.js';

const providers = new Map();

export function getProvider(name = config.payments.provider) {
  if (providers.has(name)) return providers.get(name);
  let p;
  if (name === 'razorpay') p = createRazorpayProvider(config.payments.razorpay);
  else if (name === 'sandbox') {
    if (config.isProd) throw new Error('Sandbox payments are disabled in production.');
    p = createSandboxProvider({ secret: config.payments.sandboxSecret });
  } else throw new Error(`Unknown payment provider: ${name}`);
  providers.set(name, p);
  return p;
}
