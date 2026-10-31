// Expenses → Recurring: rent, internet, AMC… posted automatically on the due date (or with "Post due now").
import { useState } from 'react';
import { LuPlus, LuPencil, LuTrash2, LuPlay } from 'react-icons/lu';
import { api } from '../../lib/api.js';
import { useApi, useForm } from '../../lib/hooks.js';
import { useTenantAuth } from '../../context/AuthContext.jsx';
import { notify, withToast } from '../../lib/toast.js';
import { money, titleCase, todayIn } from '../../lib/format.js';
import { Alert, Badge, Button, DataTable, EmptyState, Input, Modal, Select } from '../../components/ui.jsx';

const FREQ = ['weekly', 'monthly', 'quarterly', 'yearly'].map((f) => ({ value: f, label: titleCase(f) }));
const METHODS = ['cash', 'card', 'upi', 'bank', 'other'].map((m) => ({ value: m, label: m.toUpperCase() }));

export default function RecurringExpenses({ categories, onClose }) {
  const { me, can } = useTenantAuth();
  const tz = me.tenant.timezone;
  const { data, loading, error, reload } = useApi(() => api.get('/expenses/recurring'), []);
  const [editing, setEditing] = useState(null);
  const blank = { title: '', categoryId: '', amount: '', method: 'bank', paidTo: '', frequency: 'monthly', nextDueDate: todayIn(tz), endDate: '', isActive: true };
  const f = useForm(blank);
  const open = (r) => { setEditing(r); f.setErrors({}); f.setFormError(null); f.setValues(r === 'new' ? blank : { ...blank, ...r, categoryId: String(r.categoryId), amount: String(r.amount), paidTo: r.paidTo || '', endDate: r.endDate || '' }); };
  const save = f.submit(async (v) => {
    const body = { title: v.title, categoryId: Number(v.categoryId), amount: Number(v.amount), method: v.method, paidTo: v.paidTo || null, frequency: v.frequency,
      nextDueDate: v.nextDueDate, endDate: v.endDate || null, isActive: Boolean(v.isActive) };
    if (editing === 'new') await api.post('/expenses/recurring', body); else await api.put(`/expenses/recurring/${editing.id}`, body);
    notify.success('Recurring expense saved.');
    setEditing(null); reload();
  });
  return (
    <Modal open onClose={onClose} size="lg" title="Recurring expenses"
      footer={<div className="flex w-full flex-wrap justify-between gap-2">
        {can('expenses.write') ? <Button variant="outline" onClick={async () => { const r = await withToast(() => api.post('/expenses/recurring/post-due'), null); if (r) { notify.success(r.data.posted ? `${r.data.posted} expense(s) posted.` : 'Nothing is due today.'); reload(); } }}><LuPlay aria-hidden /> Post due now</Button> : <span />}
        <div className="flex gap-2"><Button variant="ghost" onClick={onClose}>Close</Button>{can('expenses.write') && <Button onClick={() => open('new')}><LuPlus aria-hidden /> Add</Button>}</div>
      </div>}>
      <p className="mb-3 text-sm text-muted">Fixed costs are added to Expenses automatically every morning on their due date. Missed dates are caught up (never twice).</p>
      {error && <Alert tone="error">{error.message}</Alert>}
      <DataTable loading={loading} rows={data} empty={<EmptyState title="No recurring expenses">For example: Rent ₹40,000 every month on the 5th.</EmptyState>}
        columns={[
          { key: 'title', label: 'Expense', render: (r) => <div><p className="font-medium">{r.title} {!r.isActive && <Badge tone="gray">Stopped</Badge>}</p><p className="text-xs text-muted">{r.category}{r.paidTo ? ` · ${r.paidTo}` : ''}</p></div> },
          { key: 'amount', label: 'Amount', render: (r) => money(r.amount) },
          { key: 'frequency', label: 'Every', render: (r) => titleCase(r.frequency) },
          { key: 'nextDueDate', label: 'Next due', render: (r) => (r.isActive ? r.nextDueDate : '—') },
          { key: 'postedCount', label: 'Posted' },
          { key: 'act', label: <span className="sr-only">Actions</span>, className: 'text-right', render: (r) => can('expenses.write') && (
            <div className="flex justify-end gap-1">
              <Button size="sm" variant="ghost" aria-label="Edit" onClick={() => open(r)}><LuPencil aria-hidden /></Button>
              <Button size="sm" variant="ghost" aria-label="Stop / delete" onClick={async () => { if (window.confirm(`Stop “${r.title}”? Expenses already posted are kept.`) && await withToast(() => api.del(`/expenses/recurring/${r.id}`), 'Stopped.')) reload(); }}><LuTrash2 aria-hidden /></Button>
            </div>) },
        ]} />
      {editing && (
        <Modal open onClose={() => setEditing(null)} title={editing === 'new' ? 'New recurring expense' : `Edit ${editing.title}`}
          footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save} loading={f.submitting}>Save</Button></>}>
          <form onSubmit={save} className="grid gap-3 sm:grid-cols-2" noValidate>
            <Input label="Title" required className="sm:col-span-2" placeholder="Building rent" {...f.bind('title')} error={f.errors.title} />
            <Select label="Category" required placeholder="Choose…" options={categories} {...f.bind('categoryId')} error={f.errors.categoryId} />
            <Input label="Amount (₹)" type="number" min="1" step="0.01" required {...f.bind('amount')} error={f.errors.amount} />
            <Select label="Every" options={FREQ} {...f.bind('frequency')} />
            <Select label="Paid by" options={METHODS} {...f.bind('method')} />
            <Input label="Next due date" type="date" required {...f.bind('nextDueDate')} error={f.errors.nextDueDate} />
            <Input label="End date (optional)" type="date" {...f.bind('endDate')} error={f.errors.endDate} />
            <Input label="Paid to" className="sm:col-span-2" {...f.bind('paidTo')} />
            {editing !== 'new' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-forest-800" checked={Boolean(f.values.isActive)} onChange={(e) => f.setValues((s) => ({ ...s, isActive: e.target.checked }))} /> Active</label>}
            {f.formError && <Alert tone="error" className="sm:col-span-2">{f.formError}</Alert>}
          </form>
        </Modal>
      )}
    </Modal>
  );
}
