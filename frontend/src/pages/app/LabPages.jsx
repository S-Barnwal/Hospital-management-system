// Laboratory master data and work queues: Tests, Packages (+ price history), Samples, Results, Referral doctors.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LuPlus, LuFlaskConical, LuPencil, LuTrash2, LuSearch, LuIndianRupee, LuArrowLeft, LuPackage, LuTestTubes, LuClipboardCheck, LuUserRound } from 'react-icons/lu';
import { api, qs } from '../../lib/api.js';
import { useApi, useDebounced, useForm } from '../../lib/hooks.js';
import { useTenantAuth } from '../../context/AuthContext.jsx';
import { notify, withToast } from '../../lib/toast.js';
import { dateTime, fullName, money, titleCase } from '../../lib/format.js';
import { Alert, Badge, Button, Card, DataTable, EmptyState, Input, Modal, PageHeader, Pagination, Select, Skeleton, StatusBadge, Textarea, cx } from '../../components/ui.jsx';

const ActiveBadge = ({ on }) => <Badge tone={on ? 'green' : 'gray'}>{on ? 'Active' : 'Inactive'}</Badge>;
const confirmDelete = (msg) => window.confirm(msg);

function SearchBar({ value, onChange, placeholder, children }) {
  return (
    <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-end">
      <div className="relative flex-1">
        <Input label="Search" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
        <LuSearch className="pointer-events-none absolute right-3 top-[38px] text-muted" aria-hidden />
      </div>
      {children}
    </div>
  );
}

function DepartmentInput({ f, name = 'department' }) {
  const { data } = useApi(() => api.get('/lab/departments'), []);
  return (
    <>
      <Input label="Department" list="lab-departments" placeholder="e.g. Biochemistry" {...f.bind(name)} error={f.errors[name]} />
      <datalist id="lab-departments">{(data || []).map((d) => <option key={d} value={d} />)}</datalist>
    </>
  );
}

// ───────────────────────── Tests ─────────────────────────
export function LabTests() {
  const { can } = useTenantAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const search = useDebounced(q);
  const { data: depts } = useApi(() => api.get('/lab/departments'), []);
  const { data, loading, error, reload } = useApi(() => api.get(`/lab/tests${qs({ all: 'true', q: search, department: dept })}`), [search, dept]);
  const [editing, setEditing] = useState(null);
  const f = useForm({});
  useEffect(() => {
    if (editing) f.setValues(editing === 'new' ? { code: '', name: '', department: '', description: '', sampleType: 'Blood', unit: '', refLow: '', refHigh: '', refText: '', price: '0', isActive: true }
      : { ...Object.fromEntries(Object.entries(editing).map(([k, v]) => [k, v ?? ''])), isActive: editing.isActive, priceReason: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  const priceChanged = editing && editing !== 'new' && Number(f.values.price) !== Number(editing.price);
  const save = f.submit(async (v) => {
    const body = { code: v.code, name: v.name, department: v.department || null, description: v.description || null, sampleType: v.sampleType || null, unit: v.unit || null,
      refLow: v.refLow, refHigh: v.refHigh, refText: v.refText || null, price: v.price, isActive: Boolean(v.isActive), ...(priceChanged && v.priceReason ? { priceReason: v.priceReason } : {}) };
    if (editing === 'new') await api.post('/lab/tests', body); else await api.put(`/lab/tests/${editing.id}`, body);
    notify.success(editing === 'new' ? 'Test added.' : 'Test updated.');
    setEditing(null); reload();
  });
  return (
    <>
      <PageHeader title="Tests" subtitle="Your lab’s test menu with reference ranges and prices."
        actions={can('lab.configure') && <Button onClick={() => setEditing('new')}><LuPlus aria-hidden /> New test</Button>} />
      <Card>
        <SearchBar value={q} onChange={setQ} placeholder="Search name, code…">
          <Select label="Department" placeholder="All departments" className="sm:w-56" value={dept} onChange={(e) => setDept(e.target.value)} options={(depts || []).map((d) => ({ value: d, label: d }))} />
        </SearchBar>
        <DataTable loading={loading} error={error} rows={data} empty={<EmptyState icon={LuFlaskConical} title="No tests found" />}
          columns={[
            { key: 'code', label: 'Code', render: (t) => <span className="font-mono text-xs">{t.code}</span> },
            { key: 'name', label: 'Test name', render: (t) => <span className="font-medium">{t.name}</span> },
            { key: 'department', label: 'Department', render: (t) => t.department || '—' },
            { key: 'sampleType', label: 'Sample', render: (t) => t.sampleType || '—' },
            { key: 'range', label: 'Reference range', render: (t) => (t.refLow != null || t.refHigh != null ? `${t.refLow ?? ''} – ${t.refHigh ?? ''} ${t.unit ?? ''}` : t.refText || '—') },
            { key: 'price', label: 'Price', className: 'text-right', render: (t) => money(t.price) },
            { key: 'isActive', label: 'Status', render: (t) => <ActiveBadge on={t.isActive} /> },
            { key: 'act', label: 'Actions', className: 'text-right', render: (t) => (
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" onClick={() => navigate(`/app/lab-prices/test/${t.id}`)} aria-label="Price history" title="Price history"><LuIndianRupee aria-hidden /></Button>
                {can('lab.configure') && <Button size="sm" variant="ghost" onClick={() => setEditing(t)} aria-label="Edit" title="Edit"><LuPencil aria-hidden /></Button>}
                {can('lab.configure') && <Button size="sm" variant="ghost" aria-label="Delete" title="Delete" onClick={async () => { if (confirmDelete(`Delete test “${t.name}”? Only possible if it was never ordered and is in no package.`) && (await withToast(() => api.del(`/lab/tests/${t.id}`), 'Test deleted.'))) reload(); }}><LuTrash2 aria-hidden /></Button>}
              </div>) },
          ]} />
      </Card>
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing === 'new' ? 'New test' : `Edit test — ${editing?.code ?? ''}`} size="lg"
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save} loading={f.submitting}>Save</Button></>}>
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-2" noValidate>
          <Input label="Code" required {...f.bind('code')} error={f.errors.code} hint="Short unique code, e.g. CBC" />
          <Input label="Test name" required {...f.bind('name')} error={f.errors.name} />
          <DepartmentInput f={f} />
          <Input label="Sample type" list="sample-types" {...f.bind('sampleType')} hint="Tests with the same sample type share one sample" />
          <datalist id="sample-types">{['Blood', 'Serum', 'Plasma', 'Urine', 'Stool', 'Swab', 'Sputum', 'CSF'].map((s) => <option key={s} value={s} />)}</datalist>
          <Input label="Unit" {...f.bind('unit')} />
          <Input label="Price (₹)" type="number" min="0" step="0.01" required {...f.bind('price')} error={f.errors.price} />
          <Input label="Ref. low" type="number" step="any" {...f.bind('refLow')} error={f.errors.refLow} />
          <Input label="Ref. high" type="number" step="any" {...f.bind('refHigh')} error={f.errors.refHigh} />
          <Input label="Reference text (non-numeric results)" {...f.bind('refText')} className="sm:col-span-2" />
          <Textarea label="Description" {...f.bind('description')} className="sm:col-span-2" />
          {priceChanged && <Input label="Reason for price change" {...f.bind('priceReason')} className="sm:col-span-2" hint="Saved in the price history" />}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-forest-800" checked={Boolean(f.values.isActive)} onChange={(e) => f.setValues((s) => ({ ...s, isActive: e.target.checked }))} /> Active (available for new orders)</label>
          {f.formError && <Alert tone="error" className="sm:col-span-2">{f.formError}</Alert>}
        </form>
      </Modal>
    </>
  );
}

// ───────────────────────── Packages ─────────────────────────
export function LabPackages() {
  const { can } = useTenantAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const search = useDebounced(q);
  const { data, loading, error, reload } = useApi(() => api.get(`/lab/packages${qs({ all: 'true', q: search })}`), [search]);
  return (
    <>
      <PageHeader title="Packages" subtitle="Bundles of tests sold together at a package price."
        actions={can('lab.configure') && <Button to="/app/lab-packages/new"><LuPlus aria-hidden /> New package</Button>} />
      <Card>
        <SearchBar value={q} onChange={setQ} placeholder="Search name, code…" />
        <DataTable loading={loading} error={error} rows={data} empty={<EmptyState icon={LuPackage} title="No packages yet">Create a package such as “Full body check-up”.</EmptyState>}
          columns={[
            { key: 'code', label: 'Code', render: (p) => <span className="whitespace-nowrap font-mono text-xs">{p.code}</span> },
            { key: 'name', label: 'Package name', render: (p) => <span className="font-medium">{p.name}</span> },
            { key: 'department', label: 'Department', render: (p) => p.department || '—' },
            { key: 'testCount', label: '# Tests', className: 'text-right' },
            { key: 'individualTotal', label: 'Individual total', className: 'text-right', render: (p) => money(p.individualTotal) },
            { key: 'price', label: 'Package price', className: 'text-right', render: (p) => <span className="font-semibold">{money(p.price)}</span> },
            { key: 'savings', label: 'Savings', className: 'text-right', render: (p) => <span className={Number(p.savings) >= 0 ? 'text-forest-700' : 'text-red-700'}>{money(p.savings)}</span> },
            { key: 'isActive', label: 'Status', render: (p) => <ActiveBadge on={p.isActive} /> },
            { key: 'act', label: 'Actions', className: 'text-right', render: (p) => (
              <div className="flex justify-end gap-1">
                {can('lab.configure') && <Button size="sm" variant="ghost" onClick={() => navigate(`/app/lab-packages/${p.id}/edit`)} aria-label="Edit" title="Edit"><LuPencil aria-hidden /></Button>}
                <Button size="sm" variant="ghost" onClick={() => navigate(`/app/lab-prices/package/${p.id}`)} aria-label="Price history" title="Price history"><LuIndianRupee aria-hidden /></Button>
                {can('lab.configure') && <Button size="sm" variant="ghost" aria-label="Delete" title="Delete" onClick={async () => { if (confirmDelete(`Delete package “${p.name}”? Only possible if it was never ordered.`) && (await withToast(() => api.del(`/lab/packages/${p.id}`), 'Package deleted.'))) reload(); }}><LuTrash2 aria-hidden /></Button>}
              </div>) },
          ]} />
      </Card>
    </>
  );
}

export function PackageForm() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const { data: tests } = useApi(() => api.get('/lab/tests?all=true'), []);
  const { data: pkg, loading, error } = useApi(() => (isNew ? Promise.resolve({ data: null }) : api.get(`/lab/packages/${id}`)), [id]);
  const f = useForm({ name: '', department: '', description: '', price: '', isActive: 'true' });
  const [selected, setSelected] = useState([]);
  const [filter, setFilter] = useState('');
  useEffect(() => {
    if (pkg) {
      f.setValues({ name: pkg.name, department: pkg.department ?? '', description: pkg.description ?? '', isActive: pkg.isActive ? 'true' : 'false' });
      setSelected(pkg.testIds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pkg]);
  const chosen = (tests || []).filter((t) => selected.includes(t.id));
  const individual = chosen.reduce((a, t) => a + Number(t.price), 0);
  const save = f.submit(async (v) => {
    if (!selected.length) { const e = new Error('Select at least one test.'); throw e; }
    const body = { name: v.name, department: v.department || null, description: v.description || null, isActive: v.isActive === 'true', testIds: selected };
    if (isNew) { const r = await api.post('/lab/packages', { ...body, price: v.price }); notify.success(`Package ${r.data.code} created.`); }
    else { await api.put(`/lab/packages/${id}`, body); notify.success('Package updated.'); }
    navigate('/app/lab-packages');
  });
  if (error) return <Alert tone="error">{error.status === 404 ? 'Package not found.' : error.message}</Alert>;
  if (!isNew && loading) return <Skeleton className="h-64 w-full" />;
  const shown = (tests || []).filter((t) => !filter || `${t.name} ${t.code}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <>
      <Link to="/app/lab-packages" className="mb-4 flex items-center gap-1 text-sm font-medium text-forest-700"><LuArrowLeft aria-hidden /> Packages</Link>
      <PageHeader title={isNew ? 'New package' : `Edit package — ${pkg?.code}`} />
      <Card className="p-5">
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-6" noValidate>
          <Input label="Package name" required className="sm:col-span-3" {...f.bind('name')} error={f.errors.name} />
          <div className="sm:col-span-2"><DepartmentInput f={f} /></div>
          <Select label="Status" className="sm:col-span-1" options={[{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }]} {...f.bind('isActive')} />
          <Textarea label="Description" className="sm:col-span-6" {...f.bind('description')} />
          <div className="sm:col-span-6">
            <p className="label">Included tests <span className="text-gold-700">*</span> <span className="font-normal text-muted">({selected.length} selected · individual total {money(individual)})</span></p>
            <Input placeholder="Filter tests…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <div className="mt-2 max-h-80 overflow-y-auto rounded-lg border border-line">
              <table className="table-base">
                <thead className="bg-forest-50/40"><tr><th className="w-10"><span className="sr-only">Select</span></th><th>Test</th><th className="text-right">Price</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {shown.map((t) => (
                    <tr key={t.id} className={cx('cursor-pointer', selected.includes(t.id) && 'bg-forest-50/60')} onClick={() => setSelected((s) => (s.includes(t.id) ? s.filter((x) => x !== t.id) : [...s, t.id]))}>
                      <td><input type="checkbox" className="accent-forest-800" checked={selected.includes(t.id)} readOnly aria-label={`Include ${t.name}`} /></td>
                      <td>{t.name} <span className="text-xs text-muted">({t.code})</span>{!t.isActive && <Badge tone="gray" className="ml-2">Inactive</Badge>}</td>
                      <td className="text-right">{money(t.price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {isNew ? (
            <div className="sm:col-span-2">
              <Input label="Package price (₹)" required type="number" min="0" step="0.01" {...f.bind('price')} error={f.errors.price}
                hint={f.values.price !== '' ? `Patient saves ${money(individual - Number(f.values.price || 0))}` : 'Usually less than the individual total'} />
            </div>
          ) : (
            <p className="text-sm text-muted sm:col-span-6">Current price: <strong className="text-ink">{money(pkg.price)}</strong>. To change it, use <Link className="font-semibold text-forest-700 underline" to={`/app/lab-prices/package/${id}`}>Price history</Link> so every change keeps a reason.</p>
          )}
          {f.formError && <Alert tone="error" className="sm:col-span-6">{f.formError}</Alert>}
          <div className="flex flex-wrap gap-2 sm:col-span-6">
            <Button type="submit" loading={f.submitting}>{isNew ? 'Create package' : 'Save changes'}</Button>
            <Button variant="outline" to="/app/lab-packages">Cancel</Button>
            {!isNew && <Button variant="outline" to={`/app/lab-prices/package/${id}`}>Price history</Button>}
          </div>
        </form>
      </Card>
    </>
  );
}

// ───────────────────────── Price history (test or package) ─────────────────────────
export function PriceHistory() {
  const { type, id } = useParams();
  const { me, can } = useTenantAuth();
  const tz = me.tenant.timezone;
  const base = type === 'package' ? 'packages' : 'tests';
  const { data, loading, error, reload } = useApi(() => api.get(`/lab/${base}/${id}/prices`), [type, id]);
  const f = useForm({ price: '', reason: '' });
  const save = f.submit(async (v) => {
    await api.post(`/lab/${base}/${id}/prices`, { price: v.price, reason: v.reason });
    notify.success('New price saved.');
    f.setValues({ price: '', reason: '' });
    reload();
  });
  if (error) return <Alert tone="error">{error.status === 404 ? 'Not found.' : error.message}</Alert>;
  if (loading && !data) return <Skeleton className="h-64 w-full" />;
  const { item, history } = data;
  const back = type === 'package' ? '/app/lab-packages' : '/app/lab-tests';
  return (
    <>
      <PageHeader title={`Price history — ${item.name} (${item.code})`} />
      {type === 'package' && <Alert tone="info" className="mb-4">Current individual test total ({item.testCount} tests): <strong>{money(item.individualTotal)}</strong></Alert>}
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <p className="border-b border-line px-5 py-3 font-semibold">Timeline (newest first)</p>
          <ul className="divide-y divide-line">
            {history.map((h, i) => (
              <li key={h.id} className="px-5 py-3">
                <p className="flex items-center gap-2 text-lg font-semibold">{money(h.price)} {i === 0 && <Badge tone="green">Current</Badge>}</p>
                <p className="text-sm text-muted">Effective: {dateTime(h.effectiveAt, tz)}</p>
                <p className="text-sm text-muted">Reason: {h.reason}{h.changedBy ? ` · By: ${h.changedBy}` : ''}</p>
              </li>
            ))}
            {history.length === 0 && <li className="px-5 py-3 text-sm"><p className="font-semibold">{money(item.price)} <Badge tone="green">Current</Badge></p><p className="text-muted">No changes recorded yet.</p></li>}
          </ul>
        </Card>
        {can('lab.configure') && (
          <Card className="h-fit lg:col-span-2">
            <p className="border-b border-line px-5 py-3 font-semibold">Add new price</p>
            <form onSubmit={save} className="space-y-3 p-5" noValidate>
              <Input label="New price (₹)" required type="number" min="0" step="0.01" {...f.bind('price')} error={f.errors.price} />
              <Input label="Reason" required placeholder="Added test, promotional pricing…" {...f.bind('reason')} error={f.errors.reason} />
              {f.formError && <Alert tone="error">{f.formError}</Alert>}
              <Button type="submit" className="w-full" loading={f.submitting}>Save new price</Button>
            </form>
          </Card>
        )}
      </div>
      <Button variant="outline" className="mt-6" to={back}><LuArrowLeft aria-hidden /> Back to {type === 'package' ? 'packages' : 'tests'}</Button>
    </>
  );
}

// ───────────────────────── Samples ─────────────────────────
const SAMPLE_STATUSES = ['pending', 'collected', 'received', 'rejected'];
export function LabSamples() {
  const { me, can } = useTenantAuth();
  const tz = me.tenant.timezone;
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const search = useDebounced(q);
  useEffect(() => setPage(1), [search, status]);
  const { data, meta, loading, error, reload } = useApi(() => api.get(`/lab/samples${qs({ q: search, status, page })}`), [search, status, page]);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');
  const act = async (s, action, msg, body = {}) => { if (await withToast(() => api.post(`/lab/samples/${s.id}/${action}`, body), msg)) reload(); };
  return (
    <>
      <PageHeader title="Samples" subtitle="Collect, receive or reject samples. Orders move forward automatically when all their samples are collected." />
      <Card>
        <SearchBar value={q} onChange={setQ} placeholder="Sample #, order #, patient…">
          <Select label="Status" placeholder="All statuses" className="sm:w-48" value={status} onChange={(e) => setStatus(e.target.value)} options={SAMPLE_STATUSES.map((s) => ({ value: s, label: titleCase(s) }))} />
        </SearchBar>
        <DataTable loading={loading} error={error} rows={data} empty={<EmptyState icon={LuTestTubes} title="No samples found" />}
          columns={[
            { key: 'number', label: 'Sample #', render: (s) => <span className="whitespace-nowrap font-mono text-xs">{s.number}</span> },
            { key: 'orderNumber', label: 'Order #', render: (s) => <Link className="font-mono text-xs text-forest-700 underline" to={`/app/laboratory/${s.orderId}`}>{s.orderNumber}</Link> },
            { key: 'patient', label: 'Patient', render: (s) => <div><p className="font-medium">{fullName(s.patientFirstName, s.patientLastName)}</p><p className="text-xs text-muted">{s.patientNumber}</p></div> },
            { key: 'sampleType', label: 'Type', render: (s) => <div><p>{s.sampleType}</p><p className="line-clamp-1 max-w-[12rem] text-xs text-muted">{s.tests}</p></div> },
            { key: 'status', label: 'Status', render: (s) => <div><StatusBadge status={s.status} />{s.priority === 'urgent' && <Badge tone="red" className="ml-1">Urgent</Badge>}{s.status === 'rejected' && <p className="text-xs text-red-700">{s.rejectReason}</p>}</div> },
            { key: 'collectedAt', label: 'Collected', render: (s) => <span className="text-xs">{s.collectedAt ? dateTime(s.collectedAt, tz) : '—'}</span> },
            { key: 'receivedAt', label: 'Received', render: (s) => <span className="text-xs">{s.receivedAt ? dateTime(s.receivedAt, tz) : '—'}</span> },
            { key: 'act', label: 'Actions', className: 'text-right', render: (s) => can('lab.write') && (
              <div className="flex justify-end gap-1">
                {['pending', 'rejected'].includes(s.status) && <Button size="sm" onClick={() => act(s, 'collect', 'Sample collected.')}>{s.status === 'rejected' ? 'Recollect' : 'Collect'}</Button>}
                {s.status === 'collected' && <Button size="sm" variant="outline" onClick={() => act(s, 'receive', 'Sample received in lab.')}>Receive</Button>}
                {['collected', 'received'].includes(s.status) && ['ordered', 'sample_collected'].includes(s.orderStatus) && <Button size="sm" variant="ghost" onClick={() => { setRejecting(s); setReason(''); }}>Reject</Button>}
              </div>) },
          ]} />
        <Pagination meta={meta} onPage={setPage} />
      </Card>
      <Modal open={Boolean(rejecting)} onClose={() => setRejecting(null)} title={`Reject sample ${rejecting?.number ?? ''}`} size="sm"
        footer={<><Button variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button><Button variant="danger" disabled={reason.trim().length < 3} onClick={() => { const s = rejecting; setRejecting(null); act(s, 'reject', 'Sample rejected — recollect it.', { reason: reason.trim() }); }}>Reject</Button></>}>
        <Textarea label="Reason" placeholder="Haemolysed, insufficient quantity, wrong container…" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </>
  );
}

// ───────────────────────── Results & reports ─────────────────────────
const RESULT_TABS = [
  ['pending', 'Awaiting results', 'sample_collected'],
  ['review', 'Awaiting verification', 'completed'],
  ['reports', 'Verified reports', 'verified'],
];
export function LabResults() {
  const { me } = useTenantAuth();
  const tz = me.tenant.timezone;
  const navigate = useNavigate();
  const [tab, setTab] = useState('pending');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const search = useDebounced(q);
  useEffect(() => setPage(1), [tab, search]);
  const status = RESULT_TABS.find((x) => x[0] === tab)[2];
  const { data, meta, loading, error } = useApi(() => api.get(`/lab/orders${qs({ status, q: search, page })}`), [status, search, page]);
  return (
    <>
      <PageHeader title="Results & reports" subtitle="Enter results, verify them, and print verified reports." />
      <div className="mb-4 flex flex-wrap gap-1 rounded-lg border border-line bg-white p-1 sm:w-fit" role="tablist">
        {RESULT_TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx('flex-1 rounded-md px-4 py-1.5 text-sm font-semibold', tab === k ? 'bg-forest-900 text-white' : 'text-forest-800 hover:bg-forest-50')}>{l}</button>
        ))}
      </div>
      <Card>
        <SearchBar value={q} onChange={setQ} placeholder="Order #, patient name or number…" />
        <DataTable loading={loading} error={error} rows={data} onRowClick={(o) => navigate(`/app/laboratory/${o.id}`)}
          empty={<EmptyState icon={LuClipboardCheck} title={tab === 'reports' ? 'No verified reports' : 'Nothing waiting here'} />}
          columns={[
            { key: 'number', label: 'Order #', render: (o) => <div><p className="whitespace-nowrap font-mono text-xs">{o.number}</p>{o.priority === 'urgent' && <Badge tone="red">Urgent</Badge>}</div> },
            { key: 'patient', label: 'Patient', render: (o) => <div><p className="font-medium">{fullName(o.patientFirstName, o.patientLastName)}</p><p className="text-xs text-muted">{o.patientNumber}</p></div> },
            { key: 'tests', label: 'Tests', render: (o) => <span className="line-clamp-2 max-w-xs text-xs">{o.tests}</span> },
            { key: 'referralName', label: 'Referred by', render: (o) => o.referralName || o.doctorName || 'Self' },
            { key: 'when', label: tab === 'reports' ? 'Verified' : 'Ordered', render: (o) => <span className="text-xs">{dateTime(tab === 'reports' ? o.verifiedAt : o.orderedAt, tz)}</span> },
            { key: 'go', label: <span className="sr-only">Open</span>, className: 'text-right', render: () => <span className="text-sm font-semibold text-forest-700">{tab === 'pending' ? 'Enter results →' : tab === 'review' ? 'Review →' : 'View / print →'}</span> },
          ]} />
        <Pagination meta={meta} onPage={setPage} />
      </Card>
    </>
  );
}

// ───────────────────────── Referral doctors ─────────────────────────
export function ReferralDoctors() {
  const { can, hasFeature } = useTenantAuth();
  const [q, setQ] = useState('');
  const search = useDebounced(q);
  const { data, loading, error, reload } = useApi(() => api.get(`/lab/referrals${qs({ all: 'true', q: search })}`), [search]);
  const [editing, setEditing] = useState(null);
  const f = useForm({});
  useEffect(() => {
    if (editing) f.setValues(editing === 'new' ? { name: '', qualification: '', clinic: '', phone: '', email: '', commissionPercent: '0', isActive: true }
      : { ...Object.fromEntries(Object.entries(editing).map(([k, v]) => [k, v ?? ''])), isActive: editing.isActive });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  const save = f.submit(async (v) => {
    const body = { name: v.name, qualification: v.qualification || null, clinic: v.clinic || null, phone: v.phone || null, email: v.email || null,
      commissionPercent: v.commissionPercent || 0, isActive: Boolean(v.isActive) };
    if (editing === 'new') await api.post('/lab/referrals', body); else await api.put(`/lab/referrals/${editing.id}`, body);
    notify.success('Referral doctor saved.');
    setEditing(null); reload();
  });
  return (
    <>
      <PageHeader title="Referral doctors" subtitle="Outside doctors who send patients for tests — track their business and commission."
        actions={can('lab.configure') && <Button onClick={() => setEditing('new')}><LuPlus aria-hidden /> Add doctor</Button>} />
      <Card>
        <SearchBar value={q} onChange={setQ} placeholder="Name, clinic or phone…" />
        <DataTable loading={loading} error={error} rows={data} empty={<EmptyState icon={LuUserRound} title="No referral doctors" />}
          columns={[
            { key: 'name', label: 'Doctor', render: (r) => <div><p className="font-medium">{r.name}</p><p className="text-xs text-muted">{r.qualification}</p></div> },
            { key: 'clinic', label: 'Clinic', render: (r) => r.clinic || '—' },
            { key: 'phone', label: 'Contact', render: (r) => <div className="text-xs"><p>{r.phone || '—'}</p><p className="text-muted">{r.email}</p></div> },
            { key: 'commissionPercent', label: 'Commission', className: 'text-right', render: (r) => `${Number(r.commissionPercent)}%` },
            { key: 'orders', label: 'Orders', className: 'text-right' },
            { key: 'business', label: 'Business', className: 'text-right', render: (r) => money(r.business) },
            { key: 'isActive', label: 'Status', render: (r) => <ActiveBadge on={r.isActive} /> },
            { key: 'act', label: 'Actions', className: 'text-right', render: (r) => can('lab.configure') && (
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEditing(r)} aria-label="Edit"><LuPencil aria-hidden /></Button>
                <Button size="sm" variant="ghost" aria-label="Delete" onClick={async () => { if (confirmDelete(`Delete ${r.name}? Only possible if they have no orders.`) && (await withToast(() => api.del(`/lab/referrals/${r.id}`), 'Deleted.'))) reload(); }}><LuTrash2 aria-hidden /></Button>
              </div>) },
          ]} />
      </Card>
      {hasFeature('reports') && <p className="mt-3 text-xs text-muted">Commission payable for any period is shown under Analytics.</p>}
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add referral doctor' : 'Edit referral doctor'}
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save} loading={f.submitting}>Save</Button></>}>
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-2" noValidate>
          <Input label="Name" required {...f.bind('name')} error={f.errors.name} className="sm:col-span-2" />
          <Input label="Qualification" placeholder="MBBS, MD" {...f.bind('qualification')} />
          <Input label="Clinic / hospital" {...f.bind('clinic')} />
          <Input label="Phone" {...f.bind('phone')} error={f.errors.phone} />
          <Input label="Email" type="email" {...f.bind('email')} error={f.errors.email} />
          <Input label="Commission (%)" type="number" min="0" max="100" step="0.01" {...f.bind('commissionPercent')} error={f.errors.commissionPercent} />
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" className="accent-forest-800" checked={Boolean(f.values.isActive)} onChange={(e) => f.setValues((s) => ({ ...s, isActive: e.target.checked }))} /> Active</label>
          {f.formError && <Alert tone="error" className="sm:col-span-2">{f.formError}</Alert>}
        </form>
      </Modal>
    </>
  );
}
