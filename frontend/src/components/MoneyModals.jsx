// Small money dialogs shared by Billing, Admissions and Deposits: take a deposit, refund it, use it on a bill,
// and create / send a UPI payment link for a bill.
import { useState } from 'react';
import { LuCopy, LuSend } from 'react-icons/lu';
import { api } from '../lib/api.js';
import { useApi } from '../lib/hooks.js';
import { notify } from '../lib/toast.js';
import { money, dateTime } from '../lib/format.js';
import { Alert, Button, Input, Modal, Select, Textarea } from './ui.jsx';
import { PatientPicker } from './Pickers.jsx';

export const METHODS = [{ value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'card', label: 'Card' }, { value: 'bank', label: 'Bank transfer' }, { value: 'other', label: 'Other' }];

/** Take an advance / deposit. `patient` = { id, label } to fix the patient, otherwise a picker is shown. */
export function DepositModal({ open, patient: fixed, admissionId, onClose, onDone }) {
  const [patient, setPatient] = useState(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const p = fixed || patient;
  const save = async () => {
    setErr(null); setBusy(true);
    try {
      const r = await api.post('/billing/deposits', { patientId: p.id, amount: Number(amount), method, ...(reference.trim() ? { reference: reference.trim() } : {}), ...(admissionId ? { admissionId } : {}) });
      notify.success(`Deposit received — receipt ${r.data.receiptNumber}. Balance ${money(r.data.balance)}.`);
      setAmount(''); setReference('');
      onDone?.(r.data);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Take advance / deposit" size="sm"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!p || !(Number(amount) > 0)}>Receive {Number(amount) > 0 ? money(amount) : ''}</Button></>}>
      <div className="space-y-3">
        {fixed ? <p className="text-sm">Patient: <strong>{fixed.label}</strong></p> : <PatientPicker value={patient} onChange={setPatient} />}
        <Input label="Amount (₹)" type="number" min="1" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Select label="Method" options={METHODS} value={method} onChange={(e) => setMethod(e.target.value)} />
        {method !== 'cash' && <Input label="Reference (UTR / card slip no.)" value={reference} onChange={(e) => setReference(e.target.value)} />}
        <p className="text-xs text-muted">The deposit is kept on the patient’s account and can be used on any of their bills, or refunded.</p>
        {err && <Alert tone="error">{err}</Alert>}
      </div>
    </Modal>
  );
}

export function DepositRefundModal({ open, patient, balance, onClose, onDone }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setErr(null); setBusy(true);
    try {
      const r = await api.post('/billing/deposits/refund', { patientId: patient.id, amount: Number(amount), method, reason: reason.trim() });
      notify.success(`Refunded — receipt ${r.data.receiptNumber}.`);
      onDone?.(r.data);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Refund deposit" size="sm"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" onClick={save} loading={busy} disabled={!(Number(amount) > 0) || reason.trim().length < 3}>Refund</Button></>}>
      <div className="space-y-3">
        <p className="text-sm">Available: <strong>{money(balance)}</strong></p>
        <Input label="Amount (₹)" type="number" min="1" step="0.01" max={balance} value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Select label="Paid back by" options={METHODS} value={method} onChange={(e) => setMethod(e.target.value)} />
        <Textarea label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Patient discharged, unused advance returned" />
        {err && <Alert tone="error">{err}</Alert>}
      </div>
    </Modal>
  );
}

/** Pay a finalised bill from the patient's deposit. */
export function UseDepositModal({ open, bill, balance, onClose, onDone }) {
  const due = Math.max(0, Number(bill.total) - Number(bill.paidAmount ?? bill.paid ?? 0));
  const max = Math.min(due, Number(balance));
  const [amount, setAmount] = useState(String(max.toFixed(2)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const save = async () => {
    setErr(null); setBusy(true);
    try {
      const r = await api.post('/billing/deposits/apply', { billId: bill.id, amount: Number(amount) });
      notify.success(`${money(r.data.amount)} paid from deposit — receipt ${r.data.receiptNumber}.`);
      onDone?.(r.data);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Pay from deposit" size="sm"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!(Number(amount) > 0) || Number(amount) > max + 0.001}>Use {money(amount || 0)}</Button></>}>
      <div className="space-y-3 text-sm">
        <p>Due on this bill: <strong>{money(due)}</strong> · Deposit available: <strong>{money(balance)}</strong></p>
        <Input label="Amount to use (₹)" type="number" min="0.01" step="0.01" max={max} value={amount} onChange={(e) => setAmount(e.target.value)} hint={`Up to ${money(max)}`} />
        {err && <Alert tone="error">{err}</Alert>}
      </div>
    </Modal>
  );
}

/** Create a UPI payment link for a bill, copy it or send it to the patient; shows earlier links. */
export function PaymentLinkModal({ open, bill, onClose }) {
  const { data: links, reload } = useApi(() => (open ? api.get(`/billing/bills/${bill.id}/payment-links`) : Promise.resolve({ data: [] })), [open, bill.id]);
  const [url, setUrl] = useState(null);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const create = async (channel) => {
    setErr(null); setBusy(channel);
    try {
      const r = await api.post(`/billing/bills/${bill.id}/payment-link`, { channel });
      setUrl(r.data.url);
      notify.success(channel === 'none' ? 'Payment link created.' : r.data.status === 'logged' ? 'Test mode: the message was logged, not delivered.' : `Payment link sent to ${r.data.sentTo}.`);
      reload();
    } catch (e) { setErr(e.message); } finally { setBusy(null); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(url); notify.success('Link copied.'); } catch { notify.error('Copy failed — select the link and copy it.'); } };
  return (
    <Modal open={open} onClose={onClose} title={`Payment link · ${bill.number || 'bill'}`}
      footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      <div className="space-y-4 text-sm">
        <p className="text-muted">The patient opens the link and pays the amount due with any UPI app, straight to your hospital’s UPI ID. When the money arrives, record it as a UPI payment with the UTR number.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" loading={busy === 'none'} onClick={() => create('none')}>Create link</Button>
          <Button variant="outline" loading={busy === 'whatsapp'} onClick={() => create('whatsapp')}><LuSend aria-hidden /> Send on WhatsApp</Button>
          <Button variant="outline" loading={busy === 'email'} onClick={() => create('email')}><LuSend aria-hidden /> Send by e-mail</Button>
        </div>
        {url && <div className="flex items-center gap-2 rounded-lg bg-forest-50 p-2"><input readOnly className="input min-w-0 flex-1 font-mono text-xs" value={url} onFocus={(e) => e.target.select()} aria-label="Payment link" /><Button size="sm" onClick={copy}><LuCopy aria-hidden /> Copy</Button></div>}
        {err && <Alert tone="error">{err}</Alert>}
        {links?.length > 0 && (
          <div>
            <p className="font-semibold">Earlier links</p>
            <ul className="mt-1 divide-y divide-line">
              {links.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-2 py-2 text-xs">
                  <span>{dateTime(l.createdAt)} · {l.channel || 'copied'} · opened {l.viewCount}× {l.revokedAt ? '· revoked' : new Date(l.expiresAt) < new Date() ? '· expired' : ''}</span>
                  {!l.revokedAt && new Date(l.expiresAt) > new Date() && <button type="button" className="font-semibold text-red-600" onClick={async () => { try { await api.post(`/billing/bills/${bill.id}/payment-links/${l.id}/revoke`); reload(); } catch (e) { notify.error(e.message); } }}>Revoke</button>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
