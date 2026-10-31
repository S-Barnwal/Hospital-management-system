// Super Admin → Invoices: register of every platform invoice (automatic for paid/free plans, plus manual ones),
// with view, PDF download (print), CSV export, create, edit, issue, void and delete-draft.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LuFileText, LuPlus, LuDownload, LuPrinter, LuArrowLeft, LuPencil, LuBan, LuSend, LuTrash2, LuRefreshCw } from 'react-icons/lu';
import { api, qs } from '../../lib/api.js';
import { useApi, useDebounced, useForm } from '../../lib/hooks.js';
import { useAdminAuth } from '../../context/AuthContext.jsx';
import { notify, withToast } from '../../lib/toast.js';
import { date, money, titleCase } from '../../lib/format.js';
import { Alert, Button, Card, DataTable, EmptyState, Input, Modal, PageHeader, Pagination, Select, Skeleton, StatCard, StatusBadge, Textarea, Badge } from '../../components/ui.jsx';
import Combobox from '../../components/Combobox.jsx';
import PhoneInput from '../../components/PhoneInput.jsx';
import EmailInput from '../../components/EmailInput.jsx';
import LocationFields from '../../components/LocationFields.jsx';
import InvoiceDocument, { INVOICE_PRINT_CSS } from '../../components/InvoiceDocument.jsx';

const API_BASE = `${import.meta.env?.VITE_API_BASE_URL || ''}/api/v1`;
const KINDS = [{ value: 'subscription', label: 'Plan purchase / renewal' }, { value: 'free', label: 'Free plan' }, { value: 'manual', label: 'Manual' }];

export function Invoices() {
  const navigate = useNavigate();
  const { admin } = useAdminAuth();
  const [filters, setFilters] = useState({ q: '', status: '', kind: '', sandbox: 'false', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const q = useDebounced(filters.q);
  const applied = { ...filters, q };
  const key = JSON.stringify(applied);
  useEffect(() => setPage(1), [key]);
  const { data, meta, loading, error, reload } = useApi(() => api.get(`/admin/invoices${qs({ ...applied, page })}`), [key, page]);
  const sum = meta?.summary;
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  return (
    <>
      <PageHeader title="Invoices" subtitle="Every invoice issued to hospitals — created automatically for paid and free plans, or raised manually."
        actions={<div className="flex flex-wrap gap-2">
          <Button variant="outline" href={`${API_BASE}/admin/invoices/export.csv${qs(applied)}`} download><LuDownload aria-hidden /> Export CSV</Button>
          {admin.role === 'super_admin' && <Button variant="outline" onClick={async () => {
            try { const r = await api.post('/admin/invoices/backfill'); notify.success(r.data.created ? `Created ${r.data.created} missing invoice(s).` : 'Every payment and free plan already has its invoice.'); reload(); } catch (e) { notify.error(e.message); }
          }}><LuRefreshCw aria-hidden /> Create missing invoices</Button>}
          {admin.role === 'super_admin' && <Button onClick={() => setCreating(true)}><LuPlus aria-hidden /> New invoice</Button>}
        </div>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Issued (in filter)" value={sum ? Number(sum.issuedCount || 0) : '—'} loading={loading && !sum} />
        <StatCard label="Invoiced value" value={sum ? money(sum.issuedTotal) : '—'} hint="Issued invoices only" loading={loading && !sum} />
        <StatCard label="GST on invoices" value={sum ? money(sum.taxTotal) : '—'} loading={loading && !sum} />
        <StatCard label="Drafts · Void" value={sum ? `${Number(sum.draftCount || 0)} · ${Number(sum.voidCount || 0)}` : '—'} loading={loading && !sum} />
      </div>
      <Card>
        <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 xl:grid-cols-4">
          <input className="input min-w-0 sm:col-span-2" placeholder="Search number, hospital, description" value={filters.q} onChange={set('q')} aria-label="Search invoices" />
          <select className="input min-w-0" value={filters.status} onChange={set('status')} aria-label="Status"><option value="">All statuses</option>{['issued', 'draft', 'void'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</select>
          <select className="input min-w-0" value={filters.kind} onChange={set('kind')} aria-label="Type"><option value="">All types</option>{KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select>
          <select className="input min-w-0" value={filters.sandbox} onChange={set('sandbox')} aria-label="Real or test"><option value="false">Real only</option><option value="true">Sandbox (test) only</option><option value="">Real + test</option></select>
          <label className="flex min-w-0 items-center gap-2 text-sm text-muted">From<input type="date" className="input min-w-0 flex-1" value={filters.from} onChange={set('from')} aria-label="From date" /></label>
          <label className="flex min-w-0 items-center gap-2 text-sm text-muted">To<input type="date" className="input min-w-0 flex-1" value={filters.to} onChange={set('to')} aria-label="To date" /></label>
          {(filters.q || filters.status || filters.kind || filters.from || filters.to || filters.sandbox !== 'false') && (
            <button type="button" className="text-left text-sm font-semibold text-forest-700 hover:underline" onClick={() => setFilters({ q: '', status: '', kind: '', sandbox: 'false', from: '', to: '' })}>Clear filters</button>
          )}
        </div>
        <DataTable loading={loading} error={error} rows={data} onRowClick={(r) => navigate(`/admin/invoices/${r.id}`)}
          empty={<EmptyState icon={LuFileText} title="No invoices match">Invoices appear here automatically when a hospital buys, renews or joins on a free plan.</EmptyState>}
          columns={[
            { key: 'number', label: 'Invoice', render: (r) => <span className="font-mono text-xs font-semibold">{r.number || 'Draft'} {r.isSandbox && <Badge tone="gold">Test</Badge>}</span> },
            { key: 'issuedAt', label: 'Date', render: (r) => date(r.issuedAt || r.createdAt) },
            { key: 'tenantName', label: 'Hospital', render: (r) => <div><p className="font-medium">{r.tenantName}</p><p className="text-xs text-muted">{r.billTo.gstin || r.tenantSlug}</p></div> },
            { key: 'description', label: 'Description', render: (r) => <span className="line-clamp-1 max-w-xs">{r.description}</span> },
            { key: 'kind', label: 'Type', render: (r) => KINDS.find((k) => k.value === r.kind)?.label },
            { key: 'total', label: 'Total', className: 'text-right', render: (r) => <span className="font-semibold">{money(r.total, r.currency)}</span> },
            { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          ]} />
        <Pagination meta={meta} onPage={setPage} />
      </Card>
      <InvoiceForm open={creating} onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); reload(); navigate(`/admin/invoices/${id}`); }} />
    </>
  );
}

export function InvoiceDetail() {
  const { id } = useParams();
  const { admin } = useAdminAuth();
  const { data: inv, loading, error, reload } = useApi(() => api.get(`/admin/invoices/${id}`), [id]);
  const [editing, setEditing] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const [resync, setResync] = useState(false);
  const isSuper = admin.role === 'super_admin';
  if (error) return <Alert tone="error">{error.status === 404 ? 'Invoice not found.' : error.message}</Alert>;
  if (loading || !inv) return <Skeleton className="h-96 w-full" />;
  const title = inv.number || 'Draft invoice';
  const print = () => { const old = document.title; document.title = `${inv.number || 'draft'}_${inv.tenantSlug}`.replace(/[^\w.-]+/g, '_'); window.print(); document.title = old; };

  return (
    <>
      <style>{INVOICE_PRINT_CSS}</style>
      <div className="print:hidden">
        <Link to="/admin/invoices" className="mb-4 flex items-center gap-1 text-sm font-medium text-forest-700"><LuArrowLeft aria-hidden /> All invoices</Link>
        <PageHeader eyebrow={`${titleCase(inv.kind)} · revision ${inv.revision}`} title={title}
          actions={<div className="flex flex-wrap gap-2">
            <Button onClick={print}><LuPrinter aria-hidden /> Download PDF / Print</Button>
            {isSuper && inv.status !== 'void' && <Button variant="outline" onClick={() => setEditing(true)}><LuPencil aria-hidden /> Edit</Button>}
            {isSuper && inv.status === 'draft' && <Button variant="gold" onClick={async () => { if (window.confirm('Issue this invoice? It gets the next invoice number and its amounts are locked.') && await withToast(() => api.post(`/admin/invoices/${id}/issue`), 'Invoice issued.')) reload(); }}><LuSend aria-hidden /> Issue</Button>}
            {isSuper && inv.status === 'issued' && <Button variant="outline" onClick={() => { setReason(''); setResync(true); }}><LuRefreshCw aria-hidden /> Update seller details</Button>}
            {isSuper && inv.status === 'issued' && <Button variant="danger" onClick={() => setVoiding(true)}><LuBan aria-hidden /> Void</Button>}
            {isSuper && inv.status === 'draft' && <Button variant="ghost" onClick={async () => { if (window.confirm('Delete this draft?') && await withToast(() => api.del(`/admin/invoices/${id}`), 'Draft deleted.')) window.history.back(); }}><LuTrash2 aria-hidden /> Delete draft</Button>}
          </div>} />
        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
          <StatusBadge status={inv.status} />
          <Link className="font-medium text-forest-800 hover:underline" to={`/admin/tenants/${inv.tenantId}`}>{inv.tenantName}</Link>
          {inv.paymentId && <span className="text-muted">Payment #{inv.paymentId}</span>}
          {inv.updatedAt && <span className="text-muted">Last changed {date(inv.updatedAt)} (see Audit logs for history)</span>}
        </div>
        {inv.status === 'issued' && <Alert tone="info" className="mb-4">Issued invoices keep their number and amounts. You can correct the buyer details, notes and payment reference; to change an amount, void this invoice and create a new one.</Alert>}
      </div>
      <InvoiceDocument inv={inv} />
      <InvoiceForm open={editing} invoice={inv} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />
      <Modal open={resync} onClose={() => setResync(false)} title="Update seller details on this invoice?" size="sm"
        footer={<><Button variant="ghost" onClick={() => setResync(false)}>Cancel</Button><Button disabled={reason.trim().length < 3}
          onClick={async () => { if (await withToast(() => api.put(`/admin/invoices/${id}`, { refreshSeller: true, reason: reason.trim() }), 'Seller details updated.')) { setResync(false); setReason(''); reload(); } }}>Update</Button></>}>
        <p className="mb-3 text-sm">Copies the <strong>current</strong> company name, address, e-mail, phone, GSTIN and state from <Link className="font-semibold underline" to="/admin/settings">Website settings</Link> onto this invoice. Number and amounts do not change; the old details are kept in the Audit log.</p>
        <Textarea label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Company address and GSTIN were added after this invoice was issued" />
      </Modal>
      <Modal open={voiding} onClose={() => setVoiding(false)} title={`Void ${inv.number}?`} size="sm"
        footer={<><Button variant="ghost" onClick={() => setVoiding(false)}>Cancel</Button><Button variant="danger" disabled={reason.trim().length < 5}
          onClick={async () => { if (await withToast(() => api.post(`/admin/invoices/${id}/void`, { reason: reason.trim() }), 'Invoice voided.')) { setVoiding(false); setReason(''); reload(); } }}>Void invoice</Button></>}>
        <p className="mb-3 text-sm">The invoice stays in the register marked <strong>VOID</strong> (its number is never reused). This cannot be undone.</p>
        <Textarea label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong GSTIN — replaced by a new invoice" />
      </Modal>
    </>
  );
}

/** Create a manual invoice, or edit one (drafts fully; issued ones only buyer details, notes and payment info). */
function InvoiceForm({ open, invoice, onClose, onSaved }) {
  const edit = Boolean(invoice);
  const locked = edit && invoice.status !== 'draft';
  const blank = { tenantId: '', description: '', sacCode: '', unitPrice: '', quantity: '1', discount: '0', taxRatePercent: '18', dueDate: '', paymentMethod: '', paymentRef: '', notes: '',
    customBuyer: false, name: '', email: '', phone: '', address: '', gstin: '', country: '', state: '', city: '', reason: '' };
  const f = useForm(blank);
  const [tq, setTq] = useState('');
  const tsearch = useDebounced(tq);
  const { data: tenants, loading: tLoading } = useApi(() => (open && !edit ? api.get(`/admin/tenants${qs({ q: tsearch, pageSize: 50 })}`) : Promise.resolve({ data: [] })), [open, edit, tsearch]);

  useEffect(() => {
    if (!open) return;
    if (!invoice) { f.setValues(blank); return; }
    const b = invoice.billTo;
    f.setValues({ ...blank, tenantId: String(invoice.tenantId), description: invoice.description, sacCode: invoice.sacCode || '', unitPrice: String(invoice.unitPrice),
      quantity: String(invoice.quantity), discount: String(invoice.discount), taxRatePercent: String(invoice.taxRatePercent), dueDate: invoice.dueDate ? String(invoice.dueDate).slice(0, 10) : '',
      paymentMethod: invoice.paymentMethod || '', paymentRef: invoice.paymentRef || '', notes: invoice.notes || '', customBuyer: true,
      name: b.name || '', email: b.email || '', phone: b.phone || '', address: b.address || '', gstin: b.gstin || '', country: b.country || '', state: b.state || '', city: b.city || '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoice]);

  const v = f.values;
  const gross = Number(v.unitPrice || 0) * Number(v.quantity || 1);
  const taxable = Math.max(0, gross - Number(v.discount || 0));
  const tax = Math.round(taxable * Number(v.taxRatePercent || 0)) / 100;

  const submitWith = (issueNow) => f.submit(async (vals) => {
    const billTo = vals.customBuyer ? { name: vals.name, email: vals.email, phone: vals.phone, address: vals.address, gstin: vals.gstin, country: vals.country, state: vals.state, city: vals.city } : undefined;
    const line = { description: vals.description, sacCode: vals.sacCode, unitPrice: Number(vals.unitPrice), quantity: Number(vals.quantity), discount: Number(vals.discount || 0), taxRatePercent: Number(vals.taxRatePercent) };
    const extra = { notes: vals.notes, dueDate: vals.dueDate, paymentMethod: vals.paymentMethod, paymentRef: vals.paymentRef, ...(billTo ? { billTo } : {}) };
    try {
      if (edit) {
        await api.put(`/admin/invoices/${invoice.id}`, { ...(locked ? {} : line), ...extra, reason: vals.reason });
        notify.success('Invoice updated.');
        onSaved(invoice.id);
      } else {
        const r = await api.post('/admin/invoices', { tenantId: Number(vals.tenantId), ...line, ...extra, issue: issueNow });
        notify.success(r.data.number ? `Invoice ${r.data.number} issued.` : 'Draft saved.');
        onSaved(r.data.id);
      }
    } catch (e) {
      // Map nested billTo.* errors onto the visible fields.
      if (e.details) e.details = e.details.map((d) => ({ ...d, path: d.path.replace(/^billTo\./, '') }));
      throw e;
    }
  });

  return (
    <Modal open={open} onClose={onClose} size="lg" title={edit ? `Edit ${invoice.number || 'draft'}` : 'New invoice'}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        {!edit && <Button variant="outline" loading={f.submitting} onClick={submitWith(false)}>Save as draft</Button>}
        <Button loading={f.submitting} onClick={submitWith(true)}>{edit ? 'Save changes' : 'Issue invoice'}</Button>
      </>}>
      <form onSubmit={submitWith(false)} className="grid gap-4 sm:grid-cols-2" noValidate>
        {!edit && (
          <Combobox label="Hospital" required className="sm:col-span-2" value={v.tenantId} loading={tLoading}
            options={(tenants || []).map((x) => ({ value: String(x.TenantId), label: x.Name, hint: x.Slug, keywords: `${x.Slug} ${x.Email || ''}` }))}
            onChange={(id) => { f.setValues((s) => ({ ...s, tenantId: id })); setTq(''); }} placeholder="Search hospital…" error={f.errors.tenantId} />
        )}
        {locked && <Alert tone="info" className="sm:col-span-2">Amounts are locked on an issued invoice. Only buyer details, payment information and notes can be corrected.</Alert>}
        <fieldset disabled={locked} className="contents">
          <Input label="Description" required className="sm:col-span-2" placeholder="e.g. Onboarding & data migration service" {...f.bind('description')} error={f.errors.description} />
          <Input label="SAC / HSN" placeholder="997331" inputMode="numeric" {...f.bind('sacCode')} error={f.errors.sacCode} hint="Leave empty for the default from settings." />
          <Input label="Quantity" type="number" min="1" {...f.bind('quantity')} error={f.errors.quantity} />
          <Input label="Rate (₹, before GST)" type="number" min="0" step="0.01" required {...f.bind('unitPrice')} error={f.errors.unitPrice} />
          <Input label="Discount (₹)" type="number" min="0" step="0.01" {...f.bind('discount')} error={f.errors.discount} />
          <Select label="GST rate" options={['0', '5', '12', '18', '28'].map((r) => ({ value: r, label: `${r}%` }))} {...f.bind('taxRatePercent')} error={f.errors.taxRatePercent} />
          <div className="rounded-lg bg-forest-50 p-3 text-sm">
            <p>Taxable {money(taxable)} + GST {money(tax)}</p>
            <p className="font-semibold">Total {money(taxable + tax)}</p>
          </div>
        </fieldset>
        <Input label="Due date" type="date" {...f.bind('dueDate')} error={f.errors.dueDate} />
        <Input label="Payment method" placeholder="Bank transfer / UPI / Cheque" {...f.bind('paymentMethod')} />
        <Input label="Payment reference" placeholder="UTR / transaction no." {...f.bind('paymentRef')} />
        <Textarea label="Notes (printed)" className="sm:col-span-2" {...f.bind('notes')} error={f.errors.notes} />

        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="accent-forest-800" checked={v.customBuyer} disabled={edit}
            onChange={(e) => f.setValues((s) => ({ ...s, customBuyer: e.target.checked }))} />
          {edit ? 'Buyer details on this invoice' : 'Use different buyer details (otherwise taken from the hospital’s profile)'}
        </label>
        {v.customBuyer && <>
          <Input label="Buyer name" required className="sm:col-span-2" {...f.bind('name')} error={f.errors.name} />
          <Input label="Address" className="sm:col-span-2" {...f.bind('address')} error={f.errors.address} />
          <LocationFields form={f} />
          <Input label="Buyer GSTIN" maxLength={15} placeholder="27ABCDE1234F1Z5" {...f.bind('gstin')} error={f.errors.gstin} />
          <EmailInput label="Buyer e-mail" {...f.bind('email')} error={f.errors.email} />
          <PhoneInput label="Buyer phone" {...f.bind('phone')} error={f.errors.phone} />
        </>}
        {edit && <Textarea label="Reason for the change" required className="sm:col-span-2" placeholder="e.g. Hospital asked to add its GSTIN" {...f.bind('reason')} error={f.errors.reason} />}
        {f.formError && <Alert tone="error" className="sm:col-span-2">{f.formError}</Alert>}
      </form>
    </Modal>
  );
}
