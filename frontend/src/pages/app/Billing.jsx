import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { LuPlus, LuReceipt, LuArrowLeft, LuPrinter, LuLock, LuTrash2, LuIndianRupee, LuUndo2, LuBan } from 'react-icons/lu';
import { api, qs } from '../../lib/api.js';
import { useApi, useDebounced, useForm } from '../../lib/hooks.js';
import { useTenantAuth } from '../../context/AuthContext.jsx';
import { notify } from '../../lib/toast.js';
import { date, dateTime, fullName, money, titleCase } from '../../lib/format.js';
import { Alert, Badge, Button, Card, DataTable, EmptyState, Input, Modal, PageHeader, Pagination, Select, Skeleton, StatusBadge, Textarea } from '../../components/ui.jsx';
import { PatientPicker } from '../../components/Pickers.jsx';

const ITEM_TYPES = ['consultation', 'lab', 'pharmacy', 'bed', 'procedure', 'other'];
const METHODS = ['cash', 'upi', 'card', 'bank', 'other'];

export default function Billing() {
  const { me, can } = useTenantAuth();
  const tz = me.tenant.timezone;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState({ status: '', unpaid: false, q: '' });
  const [page, setPage] = useState(1);
  const q = useDebounced(filters.q);
  useEffect(() => setPage(1), [filters.status, filters.unpaid, q]);
  const { data, meta, loading, error } = useApi(() => api.get(`/billing/bills${qs({ status: filters.status, unpaid: filters.unpaid || undefined, q, page })}`), [filters.status, filters.unpaid, q, page]);
  const [patient, setPatient] = useState(null);
  const [newErr, setNewErr] = useState(null);
  const create = async () => {
    setNewErr(null);
    if (!patient) { setNewErr('Choose a patient.'); return; }
    try { const r = await api.post('/billing/bills', { patientId: patient.id }); navigate(`/app/billing/${r.data.id}`); } catch (e) { setNewErr(e.message); }
  };
  return (
    <>
      <PageHeader title="Billing" subtitle="Bills, receipts, refunds and outstanding balances."
        actions={can('billing.write') && <Button onClick={() => { setPatient(null); setParams({ new: '1' }); }}><LuPlus aria-hidden /> New bill</Button>} />
      <Card>
        <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-4">
          <Select label="Status" placeholder="Any" value={filters.status} onChange={(e) => setFilters((s) => ({ ...s, status: e.target.value }))} options={['draft', 'finalized', 'cancelled'].map((s) => ({ value: s, label: titleCase(s) }))} />
          <Input label="Search" className="sm:col-span-2" placeholder="Bill no., patient name, number or phone" value={filters.q} onChange={(e) => setFilters((s) => ({ ...s, q: e.target.value }))} />
          <label className="flex items-end gap-2 pb-2.5 text-sm"><input type="checkbox" className="accent-forest-800" checked={filters.unpaid} onChange={(e) => setFilters((s) => ({ ...s, unpaid: e.target.checked }))} /> Unpaid only</label>
        </div>
        <DataTable loading={loading} error={error} rows={data} onRowClick={(b) => navigate(`/app/billing/${b.id}`)} empty={<EmptyState icon={LuReceipt} title="No bills" />}
          columns={[
            { key: 'billNumber', label: 'Bill', render: (b) => <span className="font-mono text-xs">{b.billNumber || `Draft #${b.id}`}</span> },
            { key: 'createdAt', label: 'Date', render: (b) => date(b.finalizedAt || b.createdAt, tz) },
            { key: 'patient', label: 'Patient', render: (b) => <div><p className="font-medium">{fullName(b.patientFirstName, b.patientLastName)}</p><p className="font-mono text-xs text-muted">{b.patientNumber}</p></div> },
            { key: 'total', label: 'Total', render: (b) => money(b.total) },
            { key: 'paid', label: 'Paid', render: (b) => money(b.paid) },
            { key: 'due', label: 'Balance', render: (b) => <span className={Number(b.total) - Number(b.paid) > 0 && b.status === 'finalized' ? 'font-semibold text-red-700' : ''}>{money(Number(b.total) - Number(b.paid))}</span> },
            { key: 'status', label: 'Status', render: (b) => <StatusBadge status={b.status === 'finalized' && Number(b.paid) >= Number(b.total) ? 'paid' : b.status} /> },
          ]} />
        <Pagination meta={meta} onPage={setPage} />
      </Card>
      <Modal open={params.get('new') === '1'} onClose={() => setParams({})} title="New bill"
        footer={<><Button variant="ghost" onClick={() => setParams({})}>Cancel</Button><Button onClick={create}>Open bill</Button></>}>
        <PatientPicker value={patient} onChange={setPatient} />
        <p className="mt-3 text-xs text-muted">If the patient already has a draft bill, it is reopened instead of creating a new one.</p>
        {newErr && <Alert tone="error" className="mt-3">{newErr}</Alert>}
      </Modal>
    </>
  );
}

function PaymentModal({ bill, kind, onClose, onDone }) {
  const max = kind === 'refund' ? Number(bill.paid) : Number(bill.balance);
  const f = useForm({ amount: max.toFixed(2), method: 'cash', reference: '', reason: '' });
  const save = f.submit(async (v) => {
    await api.post(`/billing/bills/${bill.id}/${kind === 'refund' ? 'refunds' : 'payments'}`, {
      amount: Number(v.amount), method: v.method, ...(v.reference ? { reference: v.reference } : {}), ...(v.reason ? { reason: v.reason } : {}),
    });
    onDone();
  });
  return (
    <Modal open onClose={onClose} title={kind === 'refund' ? 'Issue refund' : 'Record payment'} size="sm"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant={kind === 'refund' ? 'danger' : 'primary'} onClick={save} loading={f.submitting}>{kind === 'refund' ? 'Refund' : 'Record payment'}</Button></>}>
      <form onSubmit={save} className="space-y-3" noValidate>
        <Input label={`Amount (max ${money(max)})`} type="number" min="0.01" max={max} step="0.01" {...f.bind('amount')} error={f.errors.amount} />
        <Select label="Method" options={METHODS.map((m) => ({ value: m, label: m.toUpperCase() }))} {...f.bind('method')} />
        <Input label="Reference (UTR / card ref.)" {...f.bind('reference')} />
        {kind === 'refund' && <Textarea label="Reason" required {...f.bind('reason')} error={f.errors.reason} />}
        {f.formError && <Alert tone="error">{f.formError}</Alert>}
      </form>
    </Modal>
  );
}

export function BillDetail() {
  const { id } = useParams();
  const { me, can } = useTenantAuth();
  const tz = me.tenant.timezone;
  const { data: b, loading, error, reload } = useApi(() => api.get(`/billing/bills/${id}`), [id]);
  const item = useForm({ itemType: 'procedure', description: '', quantity: '1', unitPrice: '', taxRatePercent: '0' });
  const [discount, setDiscount] = useState('');
  const [busy, setBusy] = useState(null);
  const [payKind, setPayKind] = useState(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  useEffect(() => { if (b) setDiscount(String(Number(b.discount))); }, [b]);
  if (error) return <Alert tone="error">{error.status === 404 ? 'Bill not found.' : error.message}</Alert>;
  if (loading && !b) return <Skeleton className="h-64 w-full" />;
  const run = async (key, fn, ok) => {
    setBusy(key);
    try { await fn(); if (ok) notify.success(ok); await reload(); } catch (e) { notify.error(e.message); } finally { setBusy(null); }
  };
  const draft = b.status === 'draft';
  const editable = draft && can('billing.write');
  const addItem = item.submit(async (v) => {
    await api.post(`/billing/bills/${id}/items`, { ...v, quantity: Number(v.quantity), unitPrice: Number(v.unitPrice), taxRatePercent: Number(v.taxRatePercent) });
    item.setValues({ itemType: v.itemType, description: '', quantity: '1', unitPrice: '', taxRatePercent: v.taxRatePercent });
    reload();
  });
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link to="/app/billing" className="flex items-center gap-1 text-sm font-medium text-forest-700"><LuArrowLeft aria-hidden /> Billing</Link>
        <div className="flex flex-wrap gap-2">
          {editable && <Button loading={busy === 'final'} onClick={() => run('final', () => api.post(`/billing/bills/${id}/finalize`), 'Bill finalised. It can no longer be edited.')}><LuLock aria-hidden /> Finalise bill</Button>}
          {b.status === 'finalized' && Number(b.balance) > 0 && can('billing.write') && <Button onClick={() => setPayKind('payment')}><LuIndianRupee aria-hidden /> Record payment</Button>}
          {b.status === 'finalized' && Number(b.paid) > 0 && can('billing.refund') && <Button variant="outline" onClick={() => setPayKind('refund')}><LuUndo2 aria-hidden /> Refund</Button>}
          {b.status !== 'cancelled' && Number(b.paid) === 0 && can('billing.write') && (draft || can('billing.refund')) && <Button variant="ghost" onClick={() => setCancelOpen(true)}><LuBan aria-hidden /> Cancel</Button>}
          {b.status !== 'draft' && <Button variant="outline" onClick={() => window.print()}><LuPrinter aria-hidden /> Print</Button>}
        </div>
      </div>

      <div className="mb-6 hidden print:block">
        <p className="font-display text-2xl font-semibold">{b.hospital.name}</p>
        <p className="text-sm">{[b.hospital.address, b.hospital.phone].filter(Boolean).join(' · ')}</p>
        <p className="mt-3 text-lg font-semibold">{b.status === 'cancelled' ? 'CANCELLED INVOICE' : 'INVOICE'}</p><hr className="my-2" />
      </div>

      <PageHeader eyebrow={b.billNumber ? `${b.billNumber} · ${date(b.finalizedAt, tz)}` : `Draft bill #${b.id}`}
        title={fullName(b.patient.firstName, b.patient.lastName)} subtitle={`${b.patient.patientNumber}${b.patient.phone ? ` · ${b.patient.phone}` : ''}`} />
      <div className="mb-4 flex items-center gap-2 print:hidden"><StatusBadge status={b.status === 'finalized' && Number(b.balance) <= 0 ? 'paid' : b.status} />
        {draft && <span className="text-xs text-muted">Draft — add items, then finalise to issue a numbered invoice.</span>}</div>
      {b.status === 'cancelled' && <Alert tone="error" className="mb-4">Cancelled: {b.cancelReason}</Alert>}

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2 print:col-span-3">
          <div className="relative overflow-x-auto">
            <table className="table-base">
              <thead className="bg-forest-50/40"><tr><th>Item</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">Tax %</th><th className="text-right">Amount</th>{editable && <th />}</tr></thead>
              <tbody className="divide-y divide-line">
                {b.items.length === 0 && <tr><td colSpan={6}><EmptyState icon={LuReceipt} title="No items yet" /></td></tr>}
                {b.items.map((i) => (
                  <tr key={i.id}>
                    <td><p className="font-medium">{i.description}</p><p className="text-xs text-muted">{titleCase(i.itemType)}</p></td>
                    <td className="text-right">{Number(i.quantity)}</td>
                    <td className="text-right">{money(i.unitPrice)}</td>
                    <td className="text-right">{Number(i.taxRatePercent)}</td>
                    <td className="text-right font-medium">{money(Number(i.lineSubtotal) + Number(i.lineTax))}</td>
                    {editable && <td className="text-right"><Button size="sm" variant="ghost" aria-label="Remove item" onClick={() => run('rm', () => api.del(`/billing/bills/${id}/items/${i.id}`), 'Item removed.')}><LuTrash2 aria-hidden /></Button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {editable && (
            <form onSubmit={addItem} className="grid grid-cols-2 gap-2 border-t border-line p-4 sm:grid-cols-12 print:hidden" noValidate>
              <Select label="Type" className="sm:col-span-2" options={ITEM_TYPES.map((t) => ({ value: t, label: titleCase(t) }))} {...item.bind('itemType')} />
              <Input label="Description" className="col-span-2 sm:col-span-4" required {...item.bind('description')} error={item.errors.description} />
              <Input label="Qty" type="number" min="0.01" step="0.01" className="sm:col-span-1" {...item.bind('quantity')} error={item.errors.quantity} />
              <Input label="Rate (₹)" type="number" min="0" step="0.01" className="sm:col-span-2" {...item.bind('unitPrice')} error={item.errors.unitPrice} />
              <Input label="Tax %" type="number" min="0" max="100" step="0.01" className="sm:col-span-1" {...item.bind('taxRatePercent')} />
              <div className="flex items-end sm:col-span-2"><Button type="submit" className="w-full" loading={item.submitting}><LuPlus aria-hidden /> Add</Button></div>
              {item.formError && <Alert tone="error" className="col-span-2 sm:col-span-12">{item.formError}</Alert>}
            </form>
          )}
        </Card>

        <div className="space-y-6">
          <Card className="space-y-2 p-5 text-sm">
            <div className="flex justify-between"><span className="text-muted">Subtotal</span><span>{money(b.subtotal)}</span></div>
            <div className="flex items-center justify-between gap-2"><span className="text-muted">Discount</span>
              {editable ? (
                <span className="flex items-center gap-1 print:hidden">
                  <input className="input w-28 py-1 text-right" type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} aria-label="Discount" />
                  <Button size="sm" variant="outline" onClick={() => run('disc', () => api.patch(`/billing/bills/${id}`, { discountAmount: Number(discount || 0) }), 'Discount applied.')}>Apply</Button>
                </span>
              ) : <span>− {money(b.discount)}</span>}
            </div>
            <div className="flex justify-between"><span className="text-muted">Tax</span><span>{money(b.tax)}</span></div>
            <div className="flex justify-between border-t border-line pt-2 text-base font-semibold"><span>Total</span><span>{money(b.total)}</span></div>
            <div className="flex justify-between"><span className="text-muted">Paid</span><span>{money(b.paid)}</span></div>
            <div className="flex justify-between font-semibold text-red-700"><span>Balance due</span><span>{money(b.balance)}</span></div>
          </Card>
          <Card className="p-5">
            <h2 className="mb-2 font-display text-lg font-semibold">Receipts</h2>
            {b.payments.length === 0 ? <p className="text-sm text-muted">No payments yet.</p> : (
              <ul className="space-y-2 text-sm">
                {b.payments.map((p) => (
                  <li key={p.id} className="flex items-start justify-between gap-2 rounded-lg border border-line p-2">
                    <div><p className="font-mono text-xs">{p.receiptNumber}</p><p className="text-xs text-muted">{dateTime(p.receivedAt, tz)} · {p.method.toUpperCase()}{p.receivedBy ? ` · ${p.receivedBy}` : ''}</p>{p.reason && <p className="text-xs text-muted">{p.reason}</p>}</div>
                    <Badge tone={p.kind === 'refund' ? 'red' : 'green'}>{p.kind === 'refund' ? '−' : '+'}{money(p.amount)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      {payKind && <PaymentModal bill={b} kind={payKind} onClose={() => setPayKind(null)} onDone={() => { setPayKind(null); notify.success(payKind === 'refund' ? 'Refund recorded.' : 'Payment recorded.'); reload(); }} />}
      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel bill" size="sm"
        footer={<><Button variant="ghost" onClick={() => setCancelOpen(false)}>Keep</Button><Button variant="danger" disabled={reason.trim().length < 3} onClick={() => { setCancelOpen(false); run('cancel', () => api.post(`/billing/bills/${id}/cancel`, { reason: reason.trim() }), 'Bill cancelled.'); }}>Cancel bill</Button></>}>
        <Textarea label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </>
  );
}
