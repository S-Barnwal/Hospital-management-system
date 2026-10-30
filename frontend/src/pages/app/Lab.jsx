import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { LuPlus, LuFlaskConical, LuArrowLeft, LuPrinter, LuBadgeCheck, LuSave, LuIndianRupee, LuTestTubes } from 'react-icons/lu';
import { api, qs } from '../../lib/api.js';
import { useApi, useDebounced } from '../../lib/hooks.js';
import { useTenantAuth } from '../../context/AuthContext.jsx';
import { notify } from '../../lib/toast.js';
import { age, dateTime, fullName, money, titleCase } from '../../lib/format.js';
import { Alert, Badge, Button, Card, DataTable, EmptyState, Input, Modal, PageHeader, Pagination, Select, Skeleton, StatusBadge, Textarea, cx } from '../../components/ui.jsx';
import { PatientPicker, DoctorSelect } from '../../components/Pickers.jsx';
import { PaymentModal } from './Billing.jsx';

export const LAB_STATUSES = ['ordered', 'sample_collected', 'completed', 'verified', 'cancelled'];
export const PAYMENT_STATUSES = ['unpaid', 'partial', 'paid', 'on_bill', 'unbilled', 'cancelled'];
const PAY_LABEL = { unpaid: 'Unpaid', partial: 'Partial', paid: 'Paid', on_bill: 'On patient bill', unbilled: 'Not billed', cancelled: 'Bill cancelled' };
export const PayBadge = ({ status }) => <StatusBadge status={status === 'on_bill' ? 'on_bill' : status} />;
const FLAG_TONE = { normal: 'green', low: 'blue', high: 'red', abnormal: 'red' };
const METHODS = ['cash', 'upi', 'card', 'bank', 'other'];
const toPaise = (v) => Math.round(Number(v || 0) * 100);

/** Referral (external) doctor dropdown. */
export function ReferralSelect({ value, onChange, label = 'Referred by (external doctor)' }) {
  const { data } = useApi(() => api.get('/lab/referrals'), []);
  return <Select label={label} placeholder="— Self / walk-in —" value={value ?? ''} onChange={(e) => onChange(e.target.value)}
    options={(data || []).map((r) => ({ value: String(r.id), label: `${r.name}${r.clinic ? ` · ${r.clinic}` : ''}` }))} />;
}

/** New lab order with tests and/or packages, discount and optional payment. Used from Lab and from an OPD consultation. */
export function LabOrderModal({ open, onClose, onSaved, preset }) {
  const { can, hasFeature } = useTenantAuth();
  const { data: tests } = useApi(() => api.get('/lab/tests'), []);
  const { data: packages } = useApi(() => api.get('/lab/packages'), []);
  const [patient, setPatient] = useState(preset?.patient ?? null);
  const [doctorId, setDoctorId] = useState(preset?.doctorId ? String(preset.doctorId) : '');
  const [referralId, setReferralId] = useState('');
  const [selected, setSelected] = useState([]);
  const [selectedPkgs, setSelectedPkgs] = useState([]);
  const [pkgTests, setPkgTests] = useState({}); // packageId -> testIds
  const [priority, setPriority] = useState('routine');
  const [discount, setDiscount] = useState('');
  const [addToBill, setAddToBill] = useState(true);
  const [payNow, setPayNow] = useState('');
  const [method, setMethod] = useState('cash');
  const [notes, setNotes] = useState('');
  const [filter, setFilter] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const fromConsultation = Boolean(preset?.consultationId);
  const billable = hasFeature('billing') && can('billing.write');

  // Load the test list of each selected package so we can block duplicates.
  useEffect(() => {
    selectedPkgs.filter((id) => !pkgTests[id]).forEach((id) => {
      api.get(`/lab/packages/${id}`).then((r) => setPkgTests((s) => ({ ...s, [id]: r.data.testIds }))).catch(() => {});
    });
  }, [selectedPkgs, pkgTests]);

  const inPackages = useMemo(() => new Set(selectedPkgs.flatMap((id) => pkgTests[id] || [])), [selectedPkgs, pkgTests]);
  const shown = (tests || []).filter((t) => !filter || `${t.name} ${t.code} ${t.department || ''}`.toLowerCase().includes(filter.toLowerCase()));
  const grossPaise = (tests || []).filter((t) => selected.includes(t.id)).reduce((a, t) => a + toPaise(t.price), 0)
    + (packages || []).filter((p) => selectedPkgs.includes(p.id)).reduce((a, p) => a + toPaise(p.price), 0);
  const discountPaise = Math.min(toPaise(discount), grossPaise);
  const net = (grossPaise - discountPaise) / 100;
  useEffect(() => { if (!fromConsultation) setPayNow(net.toFixed(2)); }, [net, fromConsultation]);

  const toggle = (list, setList, id) => setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const save = async () => {
    setError(null);
    if (!patient) { setError('Choose a patient.'); return; }
    if (!selected.length && !selectedPkgs.length) { setError('Select at least one test or package.'); return; }
    const dup = selected.find((id) => inPackages.has(id));
    if (dup) { setError(`“${tests.find((t) => t.id === dup)?.name}” is already in a selected package. Untick it.`); return; }
    if (toPaise(discount) > grossPaise) { setError('Discount cannot be more than the total.'); return; }
    setBusy(true);
    try {
      const billed = billable && addToBill;
      const pay = billed && !fromConsultation && Number(payNow) > 0 ? { payment: { amount: Number(payNow), method } } : {};
      const r = await api.post('/lab/orders', {
        patientId: patient.id, testIds: selected, packageIds: selectedPkgs, priority, discount: discountPaise / 100,
        ...(doctorId ? { doctorId: Number(doctorId) } : {}), ...(referralId ? { referralDoctorId: Number(referralId) } : {}),
        ...(preset?.consultationId ? { consultationId: preset.consultationId } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}),
        addToBill: billed, ...pay,
      });
      notify.success(`Lab order ${r.data.number} placed${r.data.receipt ? ` · receipt ${r.data.receipt}` : ''}.`);
      onSaved(r.data);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="New lab order" size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Place order · {money(net)}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">{preset?.patient ? <p className="text-sm">Patient: <strong>{preset.patient.label}</strong></p> : <PatientPicker value={patient} onChange={setPatient} />}</div>
        <DoctorSelect label="Hospital doctor (optional)" placeholder="—" value={doctorId} onChange={setDoctorId} />
        <ReferralSelect value={referralId} onChange={setReferralId} />
        <Select label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)} options={[{ value: 'routine', label: 'Routine' }, { value: 'urgent', label: 'Urgent' }]} />

        {packages?.length > 0 && (
          <div className="sm:col-span-2">
            <p className="label">Packages ({selectedPkgs.length} selected)</p>
            <div className="grid max-h-40 gap-1 overflow-y-auto rounded-lg border border-line p-2 sm:grid-cols-2">
              {packages.map((p) => (
                <label key={p.id} className={cx('flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm', selectedPkgs.includes(p.id) ? 'bg-gold-50' : 'hover:bg-ivory')}>
                  <span className="flex min-w-0 items-center gap-2"><input type="checkbox" className="accent-forest-800" checked={selectedPkgs.includes(p.id)} onChange={() => toggle(selectedPkgs, setSelectedPkgs, p.id)} />
                    <span className="truncate">{p.name} <span className="text-xs text-muted">({p.testCount} tests)</span></span></span>
                  <span className="shrink-0 text-xs font-semibold">{money(p.price)}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="sm:col-span-2">
          <Input label={`Individual tests (${selected.length} selected)`} placeholder="Filter tests…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="mt-2 grid max-h-56 gap-1 overflow-y-auto rounded-lg border border-line p-2 sm:grid-cols-2">
            {shown.map((t) => {
              const covered = inPackages.has(t.id);
              return (
                <label key={t.id} className={cx('flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm', covered ? 'cursor-not-allowed opacity-50' : 'cursor-pointer', selected.includes(t.id) ? 'bg-forest-50' : 'hover:bg-ivory')}>
                  <span className="flex min-w-0 items-center gap-2"><input type="checkbox" className="accent-forest-800" disabled={covered && !selected.includes(t.id)} checked={selected.includes(t.id)}
                    onChange={() => toggle(selected, setSelected, t.id)} /><span className="truncate">{t.name}</span>{covered && <span className="text-[10px] font-semibold uppercase text-gold-700">in package</span>}</span>
                  <span className="shrink-0 text-xs text-muted">{money(t.price)}</span>
                </label>
              );
            })}
            {tests && shown.length === 0 && <p className="p-2 text-sm text-muted">No tests. Add them under Laboratory → Tests.</p>}
          </div>
        </div>

        <Input label="Discount (₹)" type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} disabled={fromConsultation}
          hint={fromConsultation ? 'Give discounts on the patient’s bill' : undefined} />
        <div className="rounded-lg bg-ivory p-3 text-sm">
          <div className="flex justify-between"><span>Total</span><span>{money(grossPaise / 100)}</span></div>
          <div className="flex justify-between text-muted"><span>Discount</span><span>− {money(discountPaise / 100)}</span></div>
          <div className="mt-1 flex justify-between border-t border-line pt-1 font-semibold"><span>Net payable</span><span>{money(net)}</span></div>
        </div>

        {billable && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="accent-forest-800" checked={addToBill} onChange={(e) => setAddToBill(e.target.checked)} />
            {fromConsultation ? 'Add to the patient’s open bill' : 'Create invoice for this order'}</label>
        )}
        {billable && addToBill && !fromConsultation && (
          <>
            <Input label="Payment received now (₹)" type="number" min="0" step="0.01" value={payNow} onChange={(e) => setPayNow(e.target.value)} hint="Enter 0 to collect later" />
            <Select label="Payment method" value={method} onChange={(e) => setMethod(e.target.value)} options={METHODS.map((m) => ({ value: m, label: m.toUpperCase() }))} />
          </>
        )}
        <Textarea label="Notes (optional)" className="sm:col-span-2" value={notes} onChange={(e) => setNotes(e.target.value)} />
        {error && <Alert tone="error" className="sm:col-span-2">{error}</Alert>}
      </div>
    </Modal>
  );
}

/** Orders list (Laboratory → Orders). */
export default function Lab() {
  const { me, can } = useTenantAuth();
  const tz = me.tenant.timezone;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState({ status: '', paymentStatus: '', q: '' });
  const [page, setPage] = useState(1);
  const q = useDebounced(filters.q);
  useEffect(() => setPage(1), [filters.status, filters.paymentStatus, q]);
  const { data, meta, loading, error } = useApi(() => api.get(`/lab/orders${qs({ status: filters.status, paymentStatus: filters.paymentStatus, q, page })}`),
    [filters.status, filters.paymentStatus, q, page]);
  const set = (k) => (e) => setFilters((s) => ({ ...s, [k]: e.target.value }));
  return (
    <>
      <PageHeader title="Lab orders" subtitle="Every test order with its amount, payment and progress."
        actions={can('lab.write') && <Button onClick={() => setParams({ new: '1' })}><LuPlus aria-hidden /> New order</Button>} />
      <Card>
        <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-4">
          <Input label="Search" className="sm:col-span-2" placeholder="Order no., patient name, number or mobile" value={filters.q} onChange={set('q')} />
          <Select label="Payment" placeholder="All payment statuses" value={filters.paymentStatus} onChange={set('paymentStatus')} options={PAYMENT_STATUSES.map((s) => ({ value: s, label: PAY_LABEL[s] }))} />
          <Select label="Order status" placeholder="All statuses" value={filters.status} onChange={set('status')} options={LAB_STATUSES.map((s) => ({ value: s, label: titleCase(s) }))} />
        </div>
        <DataTable loading={loading} error={error} rows={data} onRowClick={(o) => navigate(`/app/laboratory/${o.id}`)} empty={<EmptyState icon={LuFlaskConical} title="No orders found" />}
          columns={[
            { key: 'number', label: 'Order #', render: (o) => <div><p className="whitespace-nowrap font-mono text-xs">{o.number}</p>{o.priority === 'urgent' && <Badge tone="red">Urgent</Badge>}</div> },
            { key: 'orderedAt', label: 'Date', render: (o) => <span className="whitespace-nowrap text-xs">{dateTime(o.orderedAt, tz)}</span> },
            { key: 'patient', label: 'Patient', render: (o) => <div><p className="font-medium">{fullName(o.patientFirstName, o.patientLastName)}</p><p className="text-xs text-muted">{o.patientNumber}{o.patientPhone ? ` · ${o.patientPhone}` : ''}</p></div> },
            { key: 'tests', label: 'Tests', render: (o) => <span className="line-clamp-2 max-w-[14rem] text-xs">{o.tests}</span> },
            { key: 'net', label: 'Net', className: 'text-right', render: (o) => money(o.net) },
            { key: 'paid', label: 'Paid', className: 'text-right', render: (o) => (o.paid == null ? '—' : money(o.paid)) },
            { key: 'balance', label: 'Balance', className: 'text-right', render: (o) => (o.balance == null ? '—' : <span className={Number(o.balance) > 0 ? 'font-semibold text-red-700' : ''}>{money(o.balance)}</span>) },
            { key: 'paymentStatus', label: 'Payment', render: (o) => <PayBadge status={o.paymentStatus} /> },
            { key: 'status', label: 'Order status', render: (o) => <StatusBadge status={o.status} /> },
          ]} />
        <Pagination meta={meta} onPage={setPage} />
      </Card>
      {params.get('new') === '1' && <LabOrderModal open onClose={() => setParams({})} onSaved={(r) => navigate(`/app/laboratory/${r.id}`)} />}
    </>
  );
}

export function LabOrderDetail() {
  const { id } = useParams();
  const { me, can, hasFeature } = useTenantAuth();
  const tz = me.tenant.timezone;
  const { data: o, loading, error, reload } = useApi(() => api.get(`/lab/orders/${id}`), [id]);
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [reason, setReason] = useState('');
  useEffect(() => { if (o) setValues(Object.fromEntries(o.items.map((i) => [i.id, i.resultValue ?? '']))); }, [o]);
  if (error) return <Alert tone="error">{error.status === 404 ? 'Lab order not found.' : error.message}</Alert>;
  if (loading && !o) return <Skeleton className="h-64 w-full" />;
  const run = async (key, fn, ok) => {
    setBusy(key);
    try { await fn(); notify.success(ok); await reload(); } catch (e) { notify.error(e.message); } finally { setBusy(null); }
  };
  const canEnter = can('lab.write') && ['sample_collected', 'completed'].includes(o.status);
  const p = o.patient;
  const a = o.amounts;
  const groups = o.items.reduce((acc, i) => { const k = i.packageName || i.department || 'Tests'; (acc[k] ||= []).push(i); return acc; }, {});
  const canPay = o.bill?.own && o.bill.status === 'finalized' && Number(a.balance) > 0 && can('billing.write') && hasFeature('billing');

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link to="/app/laboratory" className="flex items-center gap-1 text-sm font-medium text-forest-700"><LuArrowLeft aria-hidden /> Lab orders</Link>
        <div className="flex flex-wrap gap-2">
          {o.status === 'ordered' && can('lab.write') && <Button onClick={() => run('collect', () => api.post(`/lab/orders/${id}/status`, { status: 'sample_collected' }), 'All samples marked collected.')} loading={busy === 'collect'}><LuTestTubes aria-hidden /> Collect all samples</Button>}
          {canEnter && <Button variant="outline" loading={busy === 'save'} onClick={() => run('save', () => api.put(`/lab/orders/${id}/results`, { results: o.items.map((i) => ({ itemId: i.id, value: String(values[i.id] ?? '') })) }), 'Results saved.')}><LuSave aria-hidden /> Save results</Button>}
          {o.status === 'completed' && can('lab.verify') && <Button loading={busy === 'verify'} onClick={() => run('verify', () => api.post(`/lab/orders/${id}/verify`), 'Verified. Results are now locked.')}><LuBadgeCheck aria-hidden /> Verify</Button>}
          {canPay && <Button variant="outline" onClick={() => setPayOpen(true)}><LuIndianRupee aria-hidden /> Collect payment</Button>}
          {['ordered', 'sample_collected'].includes(o.status) && can('lab.write') && <Button variant="ghost" onClick={() => setCancelOpen(true)}>Cancel order</Button>}
          <Button variant="outline" onClick={() => window.print()}><LuPrinter aria-hidden /> Print report</Button>
        </div>
      </div>

      {/* Printed letterhead */}
      <div className="mb-4 hidden print:block">
        <p className="font-display text-2xl font-semibold">{o.hospital.name}</p>
        <p className="text-sm">{[o.hospital.address, o.hospital.phone].filter(Boolean).join(' · ')}</p>
        <p className="mt-3 text-center text-sm font-bold uppercase tracking-widest">Laboratory report</p>
        <table className="mt-3 w-full text-sm"><tbody>
          <tr><td className="py-0.5 pr-2 font-semibold">Patient</td><td>{fullName(p.firstName, p.lastName)} ({p.patientNumber})</td><td className="pr-2 font-semibold">Order</td><td>{o.number}</td></tr>
          <tr><td className="py-0.5 pr-2 font-semibold">Age / Sex</td><td>{[p.dateOfBirth && `${age(p.dateOfBirth)} yrs`, p.gender && titleCase(p.gender)].filter(Boolean).join(' / ') || '—'}</td><td className="pr-2 font-semibold">Ordered</td><td>{dateTime(o.orderedAt, tz)}</td></tr>
          <tr><td className="py-0.5 pr-2 font-semibold">Referred by</td><td>{o.referral?.name || o.doctorName || 'Self'}</td><td className="pr-2 font-semibold">Reported</td><td>{o.verifiedAt ? dateTime(o.verifiedAt, tz) : '—'}</td></tr>
        </tbody></table>
        <hr className="my-3" />
      </div>

      <div className="print:hidden">
        <PageHeader eyebrow={`${o.number} · ordered ${dateTime(o.orderedAt, tz)}`} title={fullName(p.firstName, p.lastName)}
          subtitle={`${p.patientNumber} · ${[p.gender && titleCase(p.gender), p.dateOfBirth && `${age(p.dateOfBirth)} yrs`, p.phone].filter(Boolean).join(' · ')}`} />
        <div className="mb-4 flex flex-wrap items-center gap-2"><StatusBadge status={o.status} />{o.priority === 'urgent' && <Badge tone="red">Urgent</Badge>}
          {o.verifiedAt && <span className="text-xs text-muted">Verified by {o.verifiedBy} · {dateTime(o.verifiedAt, tz)}</span>}</div>
        {o.status === 'ordered' && <Alert tone="info" className="mb-4">Collect the samples (below or under Samples) before entering results.</Alert>}
        {o.status === 'completed' && <Alert tone="warning" className="mb-4">Results entered — awaiting verification. Unverified results should not be released to the patient.</Alert>}
        {o.status === 'cancelled' && <Alert tone="error" className="mb-4">Cancelled: {o.cancelReason}{o.bill?.own && o.bill.status === 'finalized' ? ' — remember to refund/cancel its invoice under Billing.' : ''}</Alert>}

        <div className="mb-4 grid gap-4 lg:grid-cols-3">
          <Card className="p-4 text-sm">
            <p className="mb-2 font-semibold">Payment</p>
            <dl className="space-y-1">
              <div className="flex justify-between"><dt>Total</dt><dd>{money(a.gross)}</dd></div>
              <div className="flex justify-between text-muted"><dt>Discount</dt><dd>− {money(a.discount)}</dd></div>
              <div className="flex justify-between font-semibold"><dt>Net</dt><dd>{money(a.net)}</dd></div>
              {a.paid != null && <div className="flex justify-between"><dt>Paid</dt><dd>{money(a.paid)}</dd></div>}
              {a.balance != null && <div className="flex justify-between"><dt>Balance</dt><dd className={Number(a.balance) > 0 ? 'font-semibold text-red-700' : ''}>{money(a.balance)}</dd></div>}
            </dl>
            <div className="mt-2 flex items-center justify-between"><PayBadge status={a.paymentStatus} />
              {o.bill && can('billing.read') && <Link className="text-xs font-semibold text-forest-700 underline" to={`/app/billing/${o.bill.id}`}>{o.bill.number || 'Draft bill'}</Link>}</div>
          </Card>
          <Card className="p-4 text-sm">
            <p className="mb-2 font-semibold">Referral</p>
            <p>{o.referral ? <>{o.referral.name}{o.referral.clinic && <span className="text-muted"> · {o.referral.clinic}</span>}</> : 'Self / walk-in'}</p>
            {o.doctorName && <p className="mt-1 text-muted">Hospital doctor: {o.doctorName}</p>}
            {o.notes && <p className="mt-2 text-muted">Note: {o.notes}</p>}
          </Card>
          <Card className="p-4 text-sm">
            <p className="mb-2 font-semibold">Samples</p>
            <ul className="space-y-2">
              {o.samples.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span><span className="font-mono text-xs">{s.number}</span> · {s.sampleType}</span>
                  <span className="flex items-center gap-1"><StatusBadge status={s.status} />
                    {can('lab.write') && o.status !== 'cancelled' && ['pending', 'rejected'].includes(s.status) && <Button size="sm" variant="ghost" loading={busy === `s${s.id}`} onClick={() => run(`s${s.id}`, () => api.post(`/lab/samples/${s.id}/collect`), 'Sample collected.')}>Collect</Button>}
                    {can('lab.write') && o.status !== 'cancelled' && s.status === 'collected' && <Button size="sm" variant="ghost" loading={busy === `s${s.id}`} onClick={() => run(`s${s.id}`, () => api.post(`/lab/samples/${s.id}/receive`), 'Sample received in lab.')}>Receive</Button>}
                  </span>
                  {s.rejectReason && s.status === 'rejected' && <span className="w-full text-xs text-red-700">Rejected: {s.rejectReason}</span>}
                </li>
              ))}
              {o.samples.length === 0 && <li className="text-muted">No samples recorded.</li>}
            </ul>
          </Card>
        </div>
      </div>

      <Card>
        <div className="relative overflow-x-auto">
          <table className="table-base">
            <thead className="bg-forest-50/40"><tr><th>Test</th><th>Result</th><th>Unit</th><th>Reference range</th><th>Flag</th></tr></thead>
            {Object.entries(groups).map(([group, items]) => (
              <tbody key={group} className="divide-y divide-line">
                <tr><td colSpan={5} className="bg-ivory text-xs font-bold uppercase tracking-wider text-forest-800">{group}</td></tr>
                {items.map((i) => (
                  <tr key={i.id}>
                    <td className="font-medium">{i.testName}</td>
                    <td className="min-w-36">{canEnter
                      ? <input className="input print:hidden" value={values[i.id] ?? ''} onChange={(e) => setValues((s) => ({ ...s, [i.id]: e.target.value }))} aria-label={`Result for ${i.testName}`} />
                      : <span className={cx('font-semibold', ['high', 'low', 'abnormal'].includes(i.flag) && 'text-red-700')}>{i.resultValue ?? '—'}</span>}</td>
                    <td>{i.unit ?? ''}</td>
                    <td className="text-xs">{i.refLow != null || i.refHigh != null ? `${i.refLow ?? ''} – ${i.refHigh ?? ''}` : i.refText ?? '—'}</td>
                    <td>{i.flag ? <Badge tone={FLAG_TONE[i.flag]}>{i.flag}</Badge> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </Card>
      {o.status === 'verified'
        ? <div className="mt-10 hidden justify-end text-sm print:flex"><div className="text-center"><p className="font-semibold">{o.verifiedBy}</p><p className="border-t border-ink pt-1">Verified by (Pathologist)</p></div></div>
        : <p className="mt-6 hidden text-sm font-semibold print:block">PROVISIONAL — NOT VERIFIED</p>}
      <p className="mt-6 hidden text-center text-xs print:block">— End of report —</p>

      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel lab order" size="sm"
        footer={<><Button variant="ghost" onClick={() => setCancelOpen(false)}>Keep</Button><Button variant="danger" disabled={!reason.trim()} onClick={() => { setCancelOpen(false); run('cancel', () => api.post(`/lab/orders/${id}/status`, { status: 'cancelled', reason: reason.trim() }), 'Order cancelled.'); }}>Cancel order</Button></>}>
        <Textarea label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
      {payOpen && <PaymentModal bill={{ id: o.bill.id, paid: a.paid, balance: a.balance }} kind="payment" onClose={() => setPayOpen(false)}
        onDone={() => { setPayOpen(false); notify.success('Payment recorded.'); reload(); }} />}
    </>
  );
}
