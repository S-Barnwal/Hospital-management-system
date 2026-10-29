import { useState } from 'react';
import { LuFlaskConical } from 'react-icons/lu';
import { Alert, Button, Modal } from './ui.jsx';
import { money } from '../lib/format.js';
import { sandboxPay } from '../lib/payments.js';

/** Development-only stand-in for the payment gateway. Clearly labelled; no real money moves. */
export default function SandboxGateway({ payment, onAuthorised, onFailed, onClose }) {
  const [busy, setBusy] = useState(null);
  const run = async (outcome) => {
    setBusy(outcome);
    try {
      if (outcome === 'success') onAuthorised(await sandboxPay(payment.orderId, 'success'));
      else { await sandboxPay(payment.orderId, 'failure').catch(() => {}); onFailed(new Error('Payment failed (simulated in sandbox).')); }
    } catch (e) {
      onFailed(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Modal open title="Sandbox payment" onClose={onClose} size="sm">
      <div className="space-y-4 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-gold-50 text-gold-700"><LuFlaskConical className="h-6 w-6" aria-hidden /></span>
        <Alert tone="warning" title="Test mode — no real payment">This simulates the gateway for local development. Configure Razorpay keys to accept real payments.</Alert>
        <p className="text-sm text-muted">Order <code className="rounded bg-forest-50 px-1">{payment.orderId}</code></p>
        <p className="font-display text-3xl font-semibold text-forest-950">{money(payment.amountMinor / 100, payment.currency)}</p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" loading={busy === 'failure'} onClick={() => run('failure')}>Simulate failure</Button>
          <Button loading={busy === 'success'} onClick={() => run('success')}>Simulate success</Button>
        </div>
      </div>
    </Modal>
  );
}
