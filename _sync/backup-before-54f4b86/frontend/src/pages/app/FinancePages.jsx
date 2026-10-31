// Payments register and Expenses (with categories). All data is this hospital's only.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LuPlus, LuPencil, LuTrash2, LuWallet, LuReceipt, LuTags } from 'react-icons/lu';
import { api, qs } from '../../lib/api.js';
import { useApi, useDebounced, useForm } from '../../lib/hooks.js';
import { useTenantAuth } from '../../context/AuthContext.jsx';
import { notify, withToast } from '../../lib/toast.js';
import { date, dateTime, fullName, money, todayIn } from '../../lib/format.js';
import { Alert, Badge, Button, Card, DataTable, EmptyState, Input, Modal, PageHeader, Pagination, Select, StatCard, Textarea } from '../../components/ui.jsx';

const METHODS = ['cash', 'upi', 'card', 'bank', 'other'];
const methodOptions = METHODS.map((m) => ({ value: m, label: m.toUpperCase() }));
const monthStart = (tz) => `${todayIn(tz).slice(0, 8)}01`;

// ───────────────────────── Payments ─────────────────────────
export function Payments() {
  const { me } = useTenantAuth();
  const tz = me.tenant.timezone;
  const [filters, setFilters] = useState({ from: monthStart(tz), to: todayIn(tz), method: '', kind: '', q: '' });
  const [page, setPage] = useState(1);
  const q = useDebounced(filters.q);
  useEffect(() => setPage(1), [filters.from, filters.to, filters.method, filters.kind, q]);
  const { data, meta, loading, error } = useApi(() => api.get(`/billing/payments${qs({ ...filters, q, page })}`), [filters.from, filters.to, filters.method, filters.kind, q, page]);
  const set = (k) => (e) => setFilters((s) => ({ ...s, [k]: e.target.value }));
  return (
    <>
      <PageHeader title="Payments" subtitle="Every receipt and refund recorded against bills — lab, OPD, IPD and pharmacy." />
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard label="Received" icon={LuWallet} loading={loading && !meta} value={money(meta?.payments ?? 0)} />
        <StatCard label="Refunded" icon={LuReceipt} loading={loading && !meta} value={money(meta?.refunds ?? 0)} />
        <StatCard label="Net collection" icon={LuWallet} loading={loading && !meta} value={money(meta?.net ?? 0)} hint="For the selected filters" />
      </div>
      <Card>
        <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-5">
          <Input label="From" type="date" value={filters.from} onChange={set('from')} />
          <Input label="To" type="date" value={filters.to} onChange={set('to')} />
          <Select label="Method" placeholder="All methods" value={filters.method} onChange={set('method')} options={methodOptions} />
          <Select label="Type" placeholder="Payments & refunds" value={filters.kind} onChange={set('kind')} options={[{ value: 'payment', label: 'Payments' }, { value: 'refund', label: 'Refunds' }]} />
          <Input label="Search" placeholder="Receipt, bill, patient…" value={filters.q} onChange={set('q')} />
        </div>
        <DataTable loading={loading} error={error} rows={data} empty={<EmptyState icon={LuWallet} title="No payments in this period" />}
          columns={[
            { key: 'receiptNumber', label: 'Receipt', render: (r) => <span className="font-mono text-xs">{r.receiptNumber}</span> },
            { key: 'receivedAt', label: 'Date', render: (r) => <span className="whitespace-nowrap text-xs">{dateTime(r.receivedAt, tz)}</span> },
            { key: 'patient', label: 'Patient', render: (r) => <div><p className="font-medium">{fullName(r.patientFirstName, r.patientLastName)}</p><p className="text-xs text-muted">{r.patientNumber}</p></div> },
            { key: 'billNumber', label: 'Bill', render: (r) => <Link className="font-mono text-xs text-forest-700 underline" to={`/app/billing/${r.billId}`}>{r.billNumber || 'Bill'}</Link> },
            { key: 'method', label: 'Method', render: (r) => <span className="uppercase">{r.method}</span> },
            { key: 'kind', label: 'Type', render: (r) => <Badge tone={r.kind === 'refund' ? 'red' : 'green'}>{r.kind}</Badge> },
            { key: 'amount', label: 'Amount', className: 'text-right', render: (r) => <span className={r.kind === 'refund' ? 'text-red-700' : 'font-semibold'}>{r.kind === 'refund' ? '− ' : ''}{money(r.amount)}</span> },
            { key: 'receivedBy', label: 'By', render: (r) => <span className="text-xs">{r.receivedBy || '—'}{r.reference ? <span className="block text-muted">Ref: {r.reference}</span> : null}</span> },
          ]} />
        <Pagination meta={meta} onPage={setPage} />
      </Card>
    </>
  );
}

// ───────────────────────── Expenses ─────────────────────────
function CategoriesModal({ onClose, onChanged }) {
  const { data, loading, reload } = useApi(() => api.get('/expenses/categories?all=true'), []);
  const [name, setName] = useState('');
  const add = async (e) => {
    e.preventDefault();
    if (name.trim().length < 2) return;
    if (await withToast(() => api.post('/expenses/categories', { name: name.trim() }), 'Category added.')) { setName(''); reload(); onChanged(); }
  };
  return (
    <Modal open onClose={onClose} title="Expense categories" footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      <form onSubmit={add} className="mb-4 flex items-end gap-2">
        <Input label="New category" className="flex-1" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit"><LuPlus aria-hidden /> Add</Button>
      </form>
      {loading ? <p className="text-sm text-muted">Loading…</p> : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {(data || []).map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className={c.isActive ? '' : 'text-muted line-through'}>{c.name} <span className="text-xs text-muted">({c.expenseCount})</span></span>
              <span className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={async () => { if (await withToast(() => api.put(`/expenses/categories/${c.id}`, { name: c.name, isActive: !c.isActive }), c.isActive ? 'Deactivated.' : 'Activated.')) { reload(); onChanged(); } }}>{c.isActive ? 'Deactivate' : 'Activate'}</Button>
                {c.expenseCount === 0 && <Button size="sm" variant="ghost" aria-label={`Delete ${c.name}`} onClick={async () => { if (window.confirm(`Delete category “${c.name}”?`) && (await withToast(() => api.del(`/expenses/categories/${c.id}`), 'Category deleted.'))) { reload(); onChanged(); } }}><LuTrash2 aria-hidden /></Button>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

export function Expenses() {
  const { me, can } = useTenantAuth();
  const tz = me.tenant.timezone;
  const [filters, setFilters] = useState({ from: monthStart(tz), to: todayIn(tz), categoryId: '', method: '', q: '' });
  const [page, setPage] = useState(1);
  const q = useDebounced(filters.q);
  useEffect(() => setPage(1), [filters.from, filters.to, filters.categoryId, filters.method, q]);
  const { data: cats, reload: reloadCats } = useApi(() => api.get('/expenses/categories'), []);
  const { data, meta, loading, error, reload } = useApi(() => api.get(`/expenses${qs({ ...filters, q, page })}`), [filters.from, filters.to, filters.categoryId, filters.method, q, page]);
  const [editing, setEditing] = useState(null);
  const [catsOpen, setCatsOpen] = useState(false);
  const f = useForm({});
  useEffect(() => {
    if (editing) f.setValues(editing === 'new' ? { expenseDate: todayIn(tz), categoryId: '', amount: '', method: 'cash', paidTo: '', reference: '', notes: '' }
      : { ...Object.fromEntries(Object.entries(editing).map(([k, v]) => [k, v ?? ''])), categoryId: String(editing.categoryId) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  const save = f.submit(async (v) => {
    const body = { expenseDate: v.expenseDate, categoryId: Number(v.categoryId) || 0, amount: v.amount, method: v.method, paidTo: v.paidTo || null, reference: v.reference || null, notes: v.notes || null };
    if (editing === 'new') { const r = await api.post('/expenses', body); notify.success(`Expense ${r.data.number} recorded.`); }
    else { await api.put(`/expenses/${editing.id}`, body); notify.success('Expense updated.'); }
    setEditing(null); reload();
  });
  const set = (k) => (e) => setFilters((s) => ({ ...s, [k]: e.target.value }));
  const catOptions = (cats || []).map((c) => ({ value: String(c.id), label: c.name }));
  return (
    <>
      <PageHeader title="Expenses" subtitle="Record the hospital’s running costs. Analytics uses these to show profit."
        actions={can('expenses.write') && <div className="flex gap-2"><Button variant="outline" onClick={() => setCatsOpen(true)}><LuTags aria-hidden /> Categories</Button><Button onClick={() => setEditing('new')}><LuPlus aria-hidden /> New expense</Button></div>} />
      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <StatCard label="Total for selected filters" icon={LuReceipt} loading={loading && !meta} value={money(meta?.totalAmount ?? 0)} hint={`${meta?.total ?? 0} expense(s)`} />
      </div>
      <Card>
        <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-5">
          <Input label="From" type="date" value={filters.from} onChange={set('from')} />
          <Input label="To" type="date" value={filters.to} onChange={set('to')} />
          <Select label="Category" placeholder="All categories" value={filters.categoryId} onChange={set('categoryId')} options={catOptions} />
          <Select label="Method" placeholder="All methods" value={filters.method} onChange={set('method')} options={methodOptions} />
          <Input label="Search" placeholder="Number, paid to, notes…" value={filters.q} onChange={set('q')} />
        </div>
        <DataTable loading={loading} error={error} rows={data} empty={<EmptyState icon={LuReceipt} title="No expenses in this period" />}
          columns={[
            { key: 'number', label: 'Expense #', render: (e) => <span className="font-mono text-xs">{e.number}</span> },
            { key: 'expenseDate', label: 'Date', render: (e) => date(`${e.expenseDate}T12:00:00Z`, tz) },
            { key: 'category', label: 'Category' },
            { key: 'paidTo', label: 'Paid to', render: (e) => <div><p>{e.paidTo || '—'}</p>{e.notes && <p className="line-clamp-1 max-w-[14rem] text-xs text-muted">{e.notes}</p>}</div> },
            { key: 'method', label: 'Method', render: (e) => <span className="uppercase">{e.method}</span> },
            { key: 'amount', label: 'Amount', className: 'text-right', render: (e) => <span className="font-semibold">{money(e.amount)}</span> },
            { key: 'act', label: 'Actions', className: 'text-right', render: (e) => can('expenses.write') && (
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEditing(e)} aria-label="Edit"><LuPencil aria-hidden /></Button>
                <Button size="sm" variant="ghost" aria-label="Delete" onClick={async () => { if (window.confirm(`Delete expense ${e.number} (${money(e.amount)})?`) && (await withToast(() => api.del(`/expenses/${e.id}`), 'Expense deleted.'))) reload(); }}><LuTrash2 aria-hidden /></Button>
              </div>) },
          ]} />
        <Pagination meta={meta} onPage={setPage} />
      </Card>
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing === 'new' ? 'New expense' : `Edit expense ${editing?.number ?? ''}`}
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save} loading={f.submitting}>Save</Button></>}>
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-2" noValidate>
          <Input label="Date" type="date" required max={todayIn(tz)} {...f.bind('expenseDate')} error={f.errors.expenseDate} />
          <Select label="Category" required placeholder="Choose…" options={catOptions} {...f.bind('categoryId')} error={f.errors.categoryId} />
          <Input label="Amount (₹)" type="number" min="0.01" step="0.01" required {...f.bind('amount')} error={f.errors.amount} />
          <Select label="Paid by" options={methodOptions} {...f.bind('method')} />
          <Input label="Paid to" placeholder="Vendor / person" {...f.bind('paidTo')} />
          <Input label="Reference / bill no." {...f.bind('reference')} />
          <Textarea label="Notes" className="sm:col-span-2" {...f.bind('notes')} />
          {f.formError && <Alert tone="error" className="sm:col-span-2">{f.formError}</Alert>}
        </form>
      </Modal>
      {catsOpen && <CategoriesModal onClose={() => setCatsOpen(false)} onChanged={reloadCats} />}
    </>
  );
}
