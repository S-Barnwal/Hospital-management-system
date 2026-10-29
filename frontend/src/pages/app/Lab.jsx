import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { LuPlus, LuFlaskConical, LuArrowLeft, LuPrinter, LuBadgeCheck, LuPencil, LuSave, LuTrash2 } from 'react-icons/lu';
import { api, qs } from '../../lib/api.js';
import { useApi, useDebounced, useForm } from '../../lib/hooks.js';
import { useTenantAuth } from '../../context/AuthContext.jsx';
import { notify, withToast } from '../../lib/toast.js';
import { age, dateTime, fullName, money, titleCase } from '../../lib/format.js';
import { Alert, Badge, Button, Card, DataTable, EmptyState, Input, Modal, PageHeader, Pagination, Select, Skeleton, StatusBadge, Textarea, cx } from '../../components/ui.jsx';
import { PatientPicker, DoctorSelect } from '../../components/Pickers.jsx';

const STATUSES = ['ordered', 'sample_collected', 'completed', 'verified', 'cancelled'];
const FLAG_TONE = { normal: 'green', low: 'blue', high: 'red', abnormal: 'red' };

/** New lab order. Used from Lab and from an OPD consultation. */
export function LabOrderModal({ open, onClose, onSaved, preset }) {
  const { can, hasFeature } = useTenantAuth();
  const { data: tests } = useApi(() => api.get('/lab/tests'), []);
  const [patient, setPatient] = useState(preset?.patient ?? null);
  const [doctorId, setDoctorId] = useState(preset?.doctorId ? String(preset.doctorId) : '');
  const [selected, setSelected] = useState([]);
  const [priority, setPriority] = useState('routine');
  const [addToBill, setAddToBill] = useState(true);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const shown = (tests || []).filter((t) => !filter || `${t.name} ${t.code}`.toLowerCase().includes(filter.toLowerCase()));
  const total = (tests || []).filter((t) => selected.includes(t.id)).reduce((a, t) => a + Number(t.price), 0);
  const billable = hasFeature('billing') && can('billing.write');
  const save = async () => {
    setError(null);
    if (!patient) { setError('Choose a patient.'); return; }
    if (!selected.length) { setError('Select at least one test.'); return; }
    setBusy(true);
    try {
      const r = await api.post('/lab/orders', { patientId: patient.id, testIds: selected, priority, ...(doctorId ? { doctorId: Number(doctorId) } : {}),
        ...(preset?.consultationId ? { consultationId: preset.consultationId } : {}), addToBill: billable && addToBill });
      notify.success(`Lab order ${r.data.number} placed.`);
      onSaved(r.data);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="New lab order" size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Place order</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">{preset?.patient ? <p className="text-sm">Patient: <strong>{preset.patient.label}</strong></p> : <PatientPicker value={patient} onChange={setPatient} />}</div>
        <DoctorSelect label="Referring doctor (optional)" placeholder="—" value={doctorId} onChange={setDoctorId} />
        <Select label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)} options={[{ value: 'routine', label: 'Routine' }, { value: 'urgent', label: 'Urgent' }]} />
        <div className="sm:col-span-2">
          <Input label={`Tests (${selected.length} selected)`} placeholder="Filter tests…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="mt-2 grid max-h-60 gap-1 overflow-y-auto rounded-lg border border-line p-2 sm:grid-cols-2">
            {shown.map((t) => (
              <label key={t.id} className={cx('flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm', selected.includes(t.id) ? 'bg-forest-50' : 'hover:bg-ivory')}>
                <span className="flex items-center gap-2"><input type="checkbox" className="accent-forest-800" checked={selected.includes(t.id)}
                  onChange={() => setSelected((s) => (s.includes(t.id) ? s.filter((x) => x !== t.id) : [...s, t.id]))} />{t.name}</span>
                <span className="text-xs text-muted">{money(t.price)}</span>
              </label>
            ))}
            {tests && shown.length === 0 && <p className="p-2 text-sm text-muted">No tests. Add them in the Catalogue tab.</p>}
          </div>
        </div>
        {billable && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="accent-forest-800" checked={addToBill} onChange={(e) => setAddToBill(e.target.checked)} /> Add to patient’s bill ({money(total)})</label>}
        {error && <Alert tone="error" className="sm:col-span-2">{error}</Alert>}
      </div>
    </Modal>
  );
}

function Catalogue() {
  const { can } = useTenantAuth();
  const { data, loading, error, reload } = useApi(() => api.get('/lab/tests?all=true'), []);
  const [editing, setEditing] = useState(null);
  const f = useForm({});
  useEffect(() => {
    if (editing) f.setValues(editing === 'new' ? { code: '', name: '', sampleType: 'Blood', unit: '', refLow: '', refHigh: '', refText: '', price: '0', isActive: true }
      : { ...Object.fromEntries(Object.entries(editing).map(([k, v]) => [k, v ?? ''])), isActive: editing.isActive });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  const save = f.submit(async (v) => {
    const body = { code: v.code, name: v.name, sampleType: v.sampleType || null, unit: v.unit || null, refLow: v.refLow, refHigh: v.refHigh, refText: v.refText || null, price: v.price, isActive: Boolean(v.isActive) };
    if (editing === 'new') await api.post('/lab/tests', body); else await api.put(`/lab/tests/${editing.id}`, body);
    notify.success('Test saved.');
    setEditing(null); reload();
  });
  return (
    <Card>
      {can('lab.configure') && <div className="flex justify-end border-b border-line p-4"><Button onClick={() => setEditing('new')}><LuPlus aria-hidden /> Add test</Button></div>}
      <DataTable loading={loading} error={error} rows={data} empty={<EmptyState icon={LuFlaskConical} title="No tests in catalogue" />}
        columns={[
          { key: 'code', label: 'Code', render: (t) => <span className="font-mono text-xs">{t.code}</span> },
          { key: 'name', label: 'Test', render: (t) => <span className="font-medium">{t.name}</span> },
          { key: 'sampleType', label: 'Sample' },
          { key: 'range', label: 'Reference range', render: (t) => (t.refLow != null || t.refHigh != null ? `${t.refLow ?? ''} – ${t.refHigh ?? ''} ${t.unit ?? ''}` : t.refText || '—') },
          { key: 'price', label: 'Price', render: (t) => money(t.price) },
          { key: 'isActive', label: 'Status', render: (t) => <Badge tone={t.isActive ? 'green' : 'gray'}>{t.isActive ? 'Active' : 'Inactive'}</Badge> },
          { key: 'act', label: <span className="sr-only">Actions</span>, className: 'text-right', render: (t) => can('lab.configure') && (
            <div className="flex justify-end gap-1">
              <Button size="sm" variant="ghost" onClick={() => setEditing(t)} aria-label="Edit"><LuPencil aria-hidden /></Button>
              <Button size="sm" variant="ghost" aria-label="Delete" onClick={async () => { if (window.confirm(`Delete test ${t.name}? Only possible if it was never ordered.`) && (await withToast(() => api.del(`/lab/tests/${t.id}`), 'Test deleted.'))) reload(); }}><LuTrash2 aria-hidden /></Button>
            </div>) },
        ]} />
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add test' : 'Edit test'}
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save} loading={f.submitting}>Save</Button></>}>
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-2" noValidate>
          <Input label="Code" required {...f.bind('code')} error={f.errors.code} />
          <Input label="Name" required {...f.bind('name')} error={f.errors.name} />
          <Input label="Sample type" {...f.bind('sampleType')} />
          <Input label="Unit" {...f.bind('unit')} />
          <Input label="Ref. low" type="number" step="any" {...f.bind('refLow')} />
          <Input label="Ref. high" type="number" step="any" {...f.bind('refHigh')} />
          <Input label="Reference text (non-numeric)" {...f.bind('refText')} className="sm:col-span-2" />
          <Input label="Price (₹)" type="number" min="0" step="0.01" {...f.bind('price')} error={f.errors.price} />
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" className="accent-forest-800" checked={Boolean(f.values.isActive)} onChange={(e) => f.setValues((s) => ({ ...s, isActive: e.target.checked }))} /> Active</label>
          {f.formError && <Alert tone="error" className="sm:col-span-2">{f.formError}</Alert>}
        </form>
      </Modal>
    </Card>
  );
}

export default function Lab() {
  const { me, can } = useTenantAuth();
  const tz = me.tenant.timezone;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'orders';
  const [filters, setFilters] = useState({ status: '', q: '' });
  const [page, setPage] = useState(1);
  const q = useDebounced(filters.q);
  useEffect(() => setPage(1), [filters.status, q]);
  const { data, meta, loading, error } = useApi(() => (tab === 'orders' ? api.get(`/lab/orders${qs({ status: filters.status, q, page })}`) : Promise.resolve({ data: [] })), [tab, filters.status, q, page]);
  return (
    <>
      <PageHeader title="Laboratory" subtitle="Orders, samples, results and verification."
        actions={can('lab.write') && tab === 'orders' && <Button onClick={() => setParams({ new: '1' })}><LuPlus aria-hidden /> New order</Button>} />
      <div className="mb-4 flex gap-1 rounded-lg border border-line bg-white p-1 sm:w-fit" role="tablist">
        {[['orders', 'Orders'], ['catalogue', 'Test catalogue']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setParams({ tab: k })} className={cx('flex-1 rounded-md px-4 py-1.5 text-sm font-semibold', tab === k ? 'bg-forest-900 text-white' : 'text-forest-800 hover:bg-forest-50')}>{l}</button>
        ))}
      </div>
      {tab === 'catalogue' ? <Catalogue /> : (
        <Card>
          <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-3">
            <Select label="Status" placeholder="Any status" value={filters.status} onChange={(e) => setFilters((s) => ({ ...s, status: e.target.value }))} options={STATUSES.map((s) => ({ value: s, label: titleCase(s) }))} />
            <Input label="Search" className="sm:col-span-2" placeholder="Order no., patient name or number" value={filters.q} onChange={(e) => setFilters((s) => ({ ...s, q: e.target.value }))} />
          </div>
          <DataTable loading={loading} error={error} rows={data} onRowClick={(o) => navigate(`/app/laboratory/${o.id}`)} empty={<EmptyState icon={LuFlaskConical} title="No lab orders" />}
            columns={[
              { key: 'number', label: 'Order', render: (o) => <div><p className="font-mono text-xs">{o.number}</p>{o.priority === 'urgent' && <Badge tone="red">Urgent</Badge>}</div> },
              { key: 'orderedAt', label: 'Ordered', render: (o) => dateTime(o.orderedAt, tz) },
              { key: 'patient', label: 'Patient', render: (o) => <div><p className="font-medium">{fullName(o.patientFirstName, o.patientLastName)}</p><p className="font-mono text-xs text-muted">{o.patientNumber}</p></div> },
              { key: 'tests', label: 'Tests', render: (o) => <span className="line-clamp-2 max-w-xs text-xs">{o.tests}</span> },
              { key: 'status', label: 'Status', render: (o) => <StatusBadge status={o.status} /> },
            ]} />
          <Pagination meta={meta} onPage={setPage} />
        </Card>
      )}
      {params.get('new') === '1' && <LabOrderModal open onClose={() => setParams({})} onSaved={(r) => navigate(`/app/laboratory/${r.id}`)} />}
    </>
  );
}

export function LabOrderDetail() {
  const { id } = useParams();
  const { me, can } = useTenantAuth();
  const tz = me.tenant.timezone;
  const { data: o, loading, error, reload } = useApi(() => api.get(`/lab/orders/${id}`), [id]);
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(null);
  const [cancelOpen, setCancelOpen] = useState(false);
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
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link to="/app/laboratory" className="flex items-center gap-1 text-sm font-medium text-forest-700"><LuArrowLeft aria-hidden /> Laboratory</Link>
        <div className="flex flex-wrap gap-2">
          {o.status === 'ordered' && can('lab.write') && <Button onClick={() => run('collect', () => api.post(`/lab/orders/${id}/status`, { status: 'sample_collected' }), 'Sample marked collected.')} loading={busy === 'collect'}>Mark sample collected</Button>}
          {canEnter && <Button variant="outline" loading={busy === 'save'} onClick={() => run('save', () => api.put(`/lab/orders/${id}/results`, { results: o.items.map((i) => ({ itemId: i.id, value: String(values[i.id] ?? '') })) }), 'Results saved.')}><LuSave aria-hidden /> Save results</Button>}
          {o.status === 'completed' && can('lab.verify') && <Button loading={busy === 'verify'} onClick={() => run('verify', () => api.post(`/lab/orders/${id}/verify`), 'Verified. Results are now locked.')}><LuBadgeCheck aria-hidden /> Verify</Button>}
          {['ordered', 'sample_collected'].includes(o.status) && can('lab.write') && <Button variant="ghost" onClick={() => setCancelOpen(true)}>Cancel order</Button>}
          <Button variant="outline" onClick={() => window.print()}><LuPrinter aria-hidden /> Print report</Button>
        </div>
      </div>
      <div className="mb-4 hidden print:block"><p className="font-display text-2xl font-semibold">{o.hospital.name}</p><p className="text-sm">{o.hospital.address}</p><p className="mt-2 font-semibold">Laboratory report</p><hr className="my-3" /></div>
      <PageHeader eyebrow={`${o.number} · ordered ${dateTime(o.orderedAt, tz)}`} title={fullName(p.firstName, p.lastName)}
        subtitle={`${p.patientNumber} · ${[p.gender && titleCase(p.gender), p.dateOfBirth && `${age(p.dateOfBirth)} yrs`].filter(Boolean).join(' · ')}${o.doctorName ? ` · Ref. ${o.doctorName}` : ''}`} />
      <div className="mb-4 flex flex-wrap items-center gap-2"><StatusBadge status={o.status} />{o.priority === 'urgent' && <Badge tone="red">Urgent</Badge>}
        {o.verifiedAt && <span className="text-xs text-muted">Verified by {o.verifiedBy} · {dateTime(o.verifiedAt, tz)}</span>}</div>
      {o.status === 'ordered' && <Alert tone="info" className="mb-4 print:hidden">Collect the sample before entering results.</Alert>}
      {o.status === 'completed' && <Alert tone="warning" className="mb-4 print:hidden">Results entered — awaiting verification. Unverified results should not be released to the patient.</Alert>}
      {o.status === 'cancelled' && <Alert tone="error" className="mb-4">Cancelled: {o.cancelReason}</Alert>}
      <Card>
        <div className="relative overflow-x-auto">
          <table className="table-base">
            <thead className="bg-forest-50/40"><tr><th>Test</th><th>Result</th><th>Unit</th><th>Reference</th><th>Flag</th></tr></thead>
            <tbody className="divide-y divide-line">
              {o.items.map((i) => (
                <tr key={i.id}>
                  <td className="font-medium">{i.testName}</td>
                  <td className="min-w-36">{canEnter
                    ? <input className="input" value={values[i.id] ?? ''} onChange={(e) => setValues((s) => ({ ...s, [i.id]: e.target.value }))} aria-label={`Result for ${i.testName}`} />
                    : <span className={cx('font-semibold', ['high', 'low', 'abnormal'].includes(i.flag) && 'text-red-700')}>{i.resultValue ?? '—'}</span>}</td>
                  <td>{i.unit ?? ''}</td>
                  <td className="text-xs">{i.refLow != null || i.refHigh != null ? `${i.refLow ?? ''} – ${i.refHigh ?? ''}` : i.refText ?? '—'}</td>
                  <td>{i.flag ? <Badge tone={FLAG_TONE[i.flag]}>{i.flag}</Badge> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {o.status !== 'verified' && <p className="mt-6 hidden text-sm font-semibold print:block">PROVISIONAL — NOT VERIFIED</p>}
      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel lab order" size="sm"
        footer={<><Button variant="ghost" onClick={() => setCancelOpen(false)}>Keep</Button><Button variant="danger" disabled={!reason.trim()} onClick={() => { setCancelOpen(false); run('cancel', () => api.post(`/lab/orders/${id}/status`, { status: 'cancelled', reason: reason.trim() }), 'Order cancelled.'); }}>Cancel order</Button></>}>
        <Textarea label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </>
  );
}
