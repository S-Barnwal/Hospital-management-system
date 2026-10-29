// Opens the provider's checkout and resolves with { orderId, paymentId, signature } for SERVER-SIDE verification.
// The browser never decides that a payment succeeded — the backend verifies the signature.
import { api } from './api.js';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the payment gateway. Check your connection.'));
    document.body.appendChild(s);
  });
}

export async function openRazorpay(payment, { name, description }) {
  await loadScript('https://checkout.razorpay.com/v1/checkout.js');
  return new Promise((resolve, reject) => {
    const rzp = new window.Razorpay({
      key: payment.keyId,
      order_id: payment.orderId,
      amount: payment.amountMinor,
      currency: payment.currency,
      name,
      description,
      prefill: payment.prefill,
      theme: { color: '#0B3B2E' },
      handler: (r) => resolve({ orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature }),
      modal: { ondismiss: () => reject(Object.assign(new Error('Payment was cancelled.'), { code: 'CANCELLED' })) },
    });
    rzp.on('payment.failed', (r) => reject(new Error(r?.error?.description || 'Payment failed.')));
    rzp.open();
  });
}

/** Sandbox gateway (development only): asks the backend to sign a simulated outcome. */
export async function sandboxPay(orderId, outcome) {
  const res = await api.post('/onboarding/sandbox/pay', { orderId, outcome });
  if (res.data.status !== 'authorised') throw new Error('Sandbox payment failed (simulated).');
  return { orderId: res.data.orderId, paymentId: res.data.paymentId, signature: res.data.signature };
}
