import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LuPlus, LuPill, LuPencil, LuTrash2, LuPackagePlus, LuMinus, LuTriangleAlert, LuTruck } from 'react-icons/lu';
import { api, qs } from '../../lib/api.js';
import { useApi, useDebounced, useForm } from '../../lib/hooks.js';
import { useTenantAuth } from '../../context/AuthContext.jsx';
import { notify, withToast } from '../../lib/toast.js';
import { dateTime, money, todayIn } from '../../lib/format.js';
import { Alert, Badge, Button, Card, DataTable, EmptyState, Input, Modal, PageHeader, Pagination, Select, Skeleton, cx } from '../../components/ui.jsx';
import { PatientPicker } from '../../components/Pickers.jsx';

/** Today's date in the hospital's timezone. */
const useToday = () => todayIn(useTenantAuth().me.tenant.timezone);

const FORMS = ['Tablet', 'Capsule', 'Syrup', 'Injection', 'Ointment', 'Drops', 'Sachet', 'Inhaler', 'Other'];
const blankMed = { name: '', genericName: '', form: 'Tablet', strength: '', unit: 'unit', hsnCode: '', taxRatePercent: '12', salePrice: '0', reorderLevel: '10', isActive: true };

function MedicineForm({ med, onClose, onSaved }) {
  const f = useForm(med ? { ...blankMed, ...Object.fromEntries(Object.entries(med).map(([k, v]) => [k, v ?? ''])), isActive: med.isActive } : blankMed);
  const save = f.submit(async (v) => {
    const body = { name: v.name, genericName: v.genericName || null, form: v.form || null, strength: v.strength || null, unit: v.unit || 'unit', hsnCode: v.hsnCode || null,
      taxRatePercent: Number(v.taxRatePercent), salePrice: Number(v.salePrice), reorderLevel: Number(v.reorderLevel), isActive: Boolean(v.isActive) };
    if (med) await api.put(`/pharmacy/medicines/${med.id}`, body); else await api.post('/pharmacy/medicines', body);
    notify.success(med ? 'Medicine updated.' : 'Medicine added.');
    onSaved();
  });
  return (
    <Modal open onClose={onClose} title={med ? `Edit ${med.name}` : 'Add medicine'} size="lg" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={f.submitting}>Save</Button></>}>
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-3" noValidate>
        <Input label="Brand / name" required className="sm:col-span-2" {...f.bind('name')} error={f.errors.name} />
        <Input label="Strength" placeholder="500 mg" {...f.bind('strength')} />
        <Input label="Generic name" className="sm:col-span-2" {...f.bind('genericName')} />
        <Select label="Form" options={FORMS.map((x) => ({ value: x, label: x }))} {...f.bind('form')} />
        <Input label="Unit" {...f.bind('unit')} hint="e.g. tablet, ml, unit" />
        <Input label="HSN code" {...f.bind('hsnCode')} />
        <Input label="GST %" type="number" min="0" max="100" step="0.01" {...f.bind('taxRatePercent')} />
        <Input label="Default sale price (₹)" type="number" min="0" step="0.01" {...f.bind('salePrice')} />
        <Input label="Reorder level" type="number" min="0" {...f.bind('reorderLevel')} />
        {med && <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" className="accent-forest-800" checked={Boolean(f.values.isActive)} onChange={(e) => f.setValues((s) => ({ ...s, isActive: e.target.checked }))} /> Active</label>}
        {f.formError && <Alert tone="error" className="sm:col-span-3">{f.formError}</Alert>}
      </form>
    </Modal>
  );
}

function ReceiveStock({ medicine, suppliers, onClose, onSaved }) {
  const today = useToday();
  const f = useForm({ batchNumber: '', expiryDate: '', quantity: '', purchasePrice: '', salePrice: String(medicine.salePrice ?? ''), supplierId: '', reference: '' });
  const save = f.submit(async (v) => {
    await api.post('/pharmacy/stock/receive', { medicineId: medicine.id, batchNumber: v.batchNumber, expiryDate: v.expiryDate, quantity: Number(v.quantity),
      purchasePrice: Number(v.purchasePrice), salePrice: Number(v.salePrice), ...(v.supplierId ? { supplierId: Number(v.supplierId) } : {}), ...(v.reference ? { reference: v.reference } : {}) });
    notify.success(`${v.quantity} unit(s) received.`);
    onSaved();
  });
  return (
    <Modal open onClose={onClose} title={`Receive stock — ${medicine.name}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={f.submitting}>Receive</Button></>}>
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-2" noValidate>
        <Input label="Batch number" required {...f.bind('batchNumber')} error={f.errors.batchNumber} />
        <Input label="Expiry date" type="date" required min={today} {...f.bind('expiryDate')} error={f.errors.expiryDate} />
        <Input label="Quantity" type="number" min="1" required {...f.bind('quantity')} error={f.errors.quantity} />
        <Select label="Supplier" placeholder="—" options={(suppliers || []).map((s) => ({ value: String(s.id), label: s.name }))} {...f.bind('supplierId')} />
        <Input label="Purchase price / unit (₹)" type="number" min="0" step="0.01" required {...f.bind('purchasePrice')} error={f.errors.purchasePrice} />
        <Input label="Sale price / unit (₹)" type="number" min="0" step="0.01" required {...f.bind('salePrice')} error={f.errors.salePrice} />
        <Input label="Invoice / reference" className="sm:col-span-2" {...f.bind('reference')} />
        {f.formError && <Alert tone="error" className="sm:col-span-2">{f.formError}</Alert>}
      </form>
    </Modal>
  );
}

function MedicineDetail({ id, onClose, onChanged }) {
  const { can } = useTenantAuth();
  const { data: m, loading, reload } = useApi(() => api.get(`/pharmacy/medicines/${id}`), [id]);
  const { data: suppliers } = useApi(() => api.get('/pharmacy/suppliers'), []);
  const [receive, setReceive] = useState(false);
  const [adjust, setAdjust] = useState(null);
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const today = useToday();
  return (
    <Modal open onClose={onClose} title={m ? `${m.name}${m.strength ? ` ${m.strength}` : ''}` : 'Medicine'} size="lg">
      {loading || !m ? <Skeleton className="h-40 w-full" /> : (
        <div className="space-y-5 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted">{[m.genericName, m.form, `GST ${Number(m.taxRatePercent)}%`, `reorder at ${m.reorderLevel}`].filter(Boolean).join(' · ')}</p>
            {can('pharmacy.write') && <Button size="sm" onClick={() => setReceive(true)}><LuPackagePlus aria-hidden /> Receive stock</Button>}
          </div>
          <div className="relative overflow-x-auto rounded-lg border border-line">
            <table className="table-base">
              <thead className="bg-forest-50/40"><tr><th>Batch</th><th>Expiry</th><th className="text-right">Qty</th><th className="text-right">Cost</th><th className="text-right">MRP</th><th>Supplier</th>{can('pharmacy.configure') && <th />}</tr></thead>
              <tbody className="divide-y divide-line">
                {m.batches.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-muted">No stock received yet.</td></tr>}
                {m.batches.map((b) => (
                  <tr key={b.id} className={b.expiryDate < today ? 'bg-red-50/50' : ''}>
                    <td className="font-mono text-xs">{b.batchNumber}</td>
                    <td>{b.expiryDate} {b.expiryDate < today && <Badge tone="red">Expired</Badge>}</td>
                    <td className="text-right font-semibold">{b.quantity}</td>
                    <td className="text-right">{money(b.purchasePrice)}</td>
                    <td className="text-right">{money(b.salePrice)}</td>
                    <td>{b.supplierName || '—'}</td>
                    {can('pharmacy.configure') && <td className="text-right"><Button size="sm" variant="ghost" onClick={() => { setAdjust(b); setQty(''); setReason(''); }}>Adjust</Button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <p className="mb-2 font-semibold">Recent stock movements</p>
            <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
              {m.movements.length === 0 && <li className="text-muted">None.</li>}
              {m.movements.map((mv, i) => (
                <li key={i} className="flex justify-between gap-2 border-b border-line py-1">
                  <span>{dateTime(mv.at)} · <strong className="capitalize">{mv.kind}</strong> · {mv.batchNumber}{mv.reference ? ` · ${mv.reference}` : ''}{mv.byName ? ` · ${mv.byName}` : ''}</span>
                  <span className={mv.quantity < 0 ? 'text-red-700' : 'text-forest-700'}>{mv.quantity > 0 ? '+' : ''}{mv.quantity}</span>
                </li>
              ))}
            </ul>
          </div>
          {receive && <ReceiveStock medicine={m} suppliers={suppliers} onClose={() => setReceive(false)} onSaved={() => { setReceive(false); reload(); onChanged(); }} />}
          {adjust && (
            <div className="space-y-3 rounded-lg border border-line p-3">
              <p className="font-semibold">Adjust batch {adjust.batchNumber} (on hand {adjust.quantity})</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Input label="Change (+/−)" type="number" value={qty} onChange={(e) => setQty(e.target.value)} hint="e.g. −2 for breakage" />
                <Input label="Reason" className="sm:col-span-2" value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
              <div className="flex gap-2"><Button variant="ghost" onClick={() => setAdjust(null)}>Cancel</Button>
                <Button disabled={!Number(qty) || reason.trim().length < 3} onClick={async () => { if (await withToast(() => api.post('/pharmacy/stock/adjust', { batchId: adjust.id, quantity: Number(qty), reason: reason.trim() }), 'Stock adjusted.')) { setAdjust(null); reload(); onChanged(); } }}>Save adjustment</Button></div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Medicines() {
  const { can } = useTenantAuth();
  const [q, setQ] = useState('');
  const [low, setLow] = useState(false);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  const [detail, setDetail] = useState(null);
  const search = useDebounced(q);
  useEffect(() => setPage(1), [search, low]);
  const { data, meta, loading, error, reload } = useApi(() => api.get(`/pharmacy/medicines${qs({ q: search, lowStock: low || undefined, page })}`), [search, low, page]);
  const today = useToday();
  const remove = async (m) => {
    if (!window.confirm(`Delete ${m.name}? Only possible if it has never been stocked. Otherwise mark it inactive.`)) return;
    if (await withToast(() => api.del(`/pharmacy/medicines/${m.id}`), 'Medicine deleted.')) reload();
  };
  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-end">
        <Input label="Search" className="flex-1" placeholder="Brand or generic name" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex items-center gap-2 pb-2.5 text-sm"><input type="checkbox" className="accent-forest-800" checked={low} onChange={(e) => setLow(e.target.checked)} /> Low stock only</label>
        {can('pharmacy.configure') && <Button onClick={() => setEditing('new')}><LuPlus aria-hidden /> Add medicine</Button>}
      </div>
      <DataTable loading={loading} error={error} rows={data} onRowClick={(m) => setDetail(m.id)} empty={<EmptyState icon={LuPill} title="No medicines" />}
        columns={[
          { key: 'name', label: 'Medicine', render: (m) => <div><p className="font-medium">{m.name} {m.strength}</p><p className="text-xs text-muted">{[m.genericName, m.form].filter(Boolean).join(' · ')}</p></div> },
          { key: 'stock', label: 'Stock', render: (m) => <span className={cx('font-semibold', m.stock <= m.reorderLevel && 'text-red-700')}>{m.stock} {m.stock <= m.reorderLevel && <Badge tone="red">Low</Badge>}</span> },
          { key: 'nextExpiry', label: 'Next expiry', render: (m) => (m.nextExpiry ? <span className={m.nextExpiry < today ? 'text-red-700' : ''}>{m.nextExpiry}</span> : '—') },
          { key: 'salePrice', label: 'Price', render: (m) => money(m.salePrice) },
          { key: 'isActive', label: 'Status', render: (m) => <Badge tone={m.isActive ? 'green' : 'gray'}>{m.isActive ? 'Active' : 'Inactive'}</Badge> },
          { key: 'act', label: <span className="sr-only">Actions</span>, className: 'text-right', render: (m) => can('pharmacy.configure') && (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" variant="ghost" onClick={() => setEditing(m)} aria-label="Edit"><LuPencil aria-hidden /></Button>
              <Button size="sm" variant="ghost" onClick={() => remove(m)} aria-label="Delete"><LuTrash2 aria-hidden /></Button>
            </div>) },
        ]} />
      <Pagination meta={meta} onPage={setPage} />
      {editing && <MedicineForm med={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {detail && <MedicineDetail id={detail} onClose={() => setDetail(null)} onChanged={reload} />}
    </Card>
  );
}

function Dispense() {
  const { can, hasFeature } = useTenantAuth();
  const [patient, setPatient] = useState(null);
  const [lines, setLines] = useState([]);
  const [q, setQ] = useState('');
  const [addToBill, setAddToBill] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const search = useDebounced(q);
  const { data: found } = useApi(() => (search.length >= 2 ? api.get(`/pharmacy/medicines${qs({ q: search, pageSize: 8 })}`) : Promise.resolve({ data: [] })), [search]);
  const billable = hasFeature('billing') && can('billing.write');
  const total = lines.reduce((a, l) => a + Number(l.salePrice) * Number(l.quantity || 0), 0);
  const submit = async () => {
    if (!lines.length) { notify.error('Add at least one medicine.'); return; }
    setBusy(true);
    const r = await withToast(() => api.post('/pharmacy/dispense', { ...(patient ? { patientId: patient.id } : {}), items: lines.map((l) => ({ medicineId: l.id, quantity: Number(l.quantity) })), addToBill: Boolean(patient) && billable && addToBill }), 'Medicines dispensed.');
    setBusy(false);
    if (r) { setResult(r.data); setLines([]); }
  };
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="space-y-4 p-5 lg:col-span-2">
        <PatientPicker value={patient} onChange={setPatient} label="Patient (optional for walk-in)" required={false} />
        <div className="relative">
          <Input label="Add medicine" placeholder="Search medicine…" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
          {found?.length > 0 && (
            <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-line bg-white shadow-[var(--shadow-lift)]">
              {found.map((m) => (
                <li key={m.id}><button type="button" disabled={m.stock <= 0} className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-forest-50 disabled:opacity-50"
                  onClick={() => { setLines((ls) => (ls.some((l) => l.id === m.id) ? ls : [...ls, { ...m, quantity: '1' }])); setQ(''); }}>
                  <span>{m.name} {m.strength}</span><span className="text-xs text-muted">{m.stock} in stock · {money(m.salePrice)}</span></button></li>
              ))}
            </ul>
          )}
        </div>
        {lines.length === 0 ? <p className="text-sm text-muted">No medicines added.</p> : (
          <div className="relative overflow-x-auto"><table className="table-base">
            <thead><tr><th>Medicine</th><th>Available</th><th>Qty</th><th /></tr></thead>
            <tbody className="divide-y divide-line">
              {lines.map((l) => (
                <tr key={l.id}><td className="font-medium">{l.name} {l.strength}</td><td>{l.stock}</td>
                  <td><input className="input w-24" type="number" min="1" max={l.stock} value={l.quantity} onChange={(e) => setLines((ls) => ls.map((x) => (x.id === l.id ? { ...x, quantity: e.target.value } : x)))} aria-label="Quantity" /></td>
                  <td className="text-right"><Button size="sm" variant="ghost" onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))} aria-label="Remove"><LuMinus aria-hidden /></Button></td></tr>
              ))}
            </tbody>
          </table></div>
        )}
        {billable && patient && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-forest-800" checked={addToBill} onChange={(e) => setAddToBill(e.target.checked)} /> Add to patient’s bill (GST applied per medicine)</label>}
        <div className="flex items-center justify-between border-t border-line pt-4"><p className="text-sm text-muted">Estimated (before tax): <strong className="text-ink">{money(total)}</strong></p>
          <Button onClick={submit} loading={busy} disabled={!lines.length}>Dispense</Button></div>
        <p className="text-xs text-muted">Stock is taken from the batch that expires first. Expired batches are never dispensed.</p>
      </Card>
      <Card className="p-5">
        <h2 className="mb-2 font-display text-lg font-semibold">Last dispense</h2>
        {!result ? <p className="text-sm text-muted">Nothing yet.</p> : (
          <ul className="space-y-1 text-sm">
            {result.lines.map((l, i) => <li key={i} className="flex justify-between"><span>{l.medicine}</span><span>{l.quantity} × {money(l.unitPrice)}</span></li>)}
            {result.billId && <li className="pt-2"><a className="font-semibold text-forest-700 underline" href={`/app/billing/${result.billId}`}>Open bill</a></li>}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Alerts() {
  const { data, loading } = useApi(() => api.get('/pharmacy/alerts'), []);
  if (loading) return <Skeleton className="h-40 w-full" />;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card><h2 className="border-b border-line px-5 py-4 font-display text-lg font-semibold">Low stock</h2>
        <DataTable rowKey="id" rows={data?.lowStock} empty={<EmptyState icon={LuPill} title="All medicines above reorder level" />}
          columns={[{ key: 'name', label: 'Medicine', render: (m) => `${m.name} ${m.strength ?? ''}` }, { key: 'stock', label: 'Stock' }, { key: 'reorderLevel', label: 'Reorder at' }]} /></Card>
      <Card><h2 className="border-b border-line px-5 py-4 font-display text-lg font-semibold">Expiring within 60 days / expired</h2>
        <DataTable rowKey="key" rows={data?.expiring?.map((e, i) => ({ ...e, key: i }))} empty={<EmptyState icon={LuTriangleAlert} title="Nothing expiring soon" />}
          columns={[{ key: 'name', label: 'Medicine', render: (m) => `${m.name} ${m.strength ?? ''}` }, { key: 'batchNumber', label: 'Batch' }, { key: 'expiryDate', label: 'Expiry' }, { key: 'quantity', label: 'Qty' }]} /></Card>
    </div>
  );
}

function Suppliers() {
  const { can } = useTenantAuth();
  const { data, loading, error, reload } = useApi(() => api.get('/pharmacy/suppliers'), []);
  const [editing, setEditing] = useState(null);
  const f = useForm({ name: '', phone: '', gstin: '' });
  useEffect(() => { if (editing) f.setValues(editing === 'new' ? { name: '', phone: '', gstin: '' } : { name: editing.name, phone: editing.phone || '', gstin: editing.gstin || '' }); /* eslint-disable-next-line */ }, [editing]);
  const save = f.submit(async (v) => {
    const body = { name: v.name, ...(v.phone ? { phone: v.phone } : {}), ...(v.gstin ? { gstin: v.gstin } : {}) };
    if (editing === 'new') await api.post('/pharmacy/suppliers', body); else await api.put(`/pharmacy/suppliers/${editing.id}`, body);
    notify.success('Supplier saved.'); setEditing(null); reload();
  });
  return (
    <Card>
      {can('pharmacy.configure') && <div className="flex justify-end border-b border-line p-4"><Button onClick={() => setEditing('new')}><LuPlus aria-hidden /> Add supplier</Button></div>}
      <DataTable loading={loading} error={error} rows={data} empty={<EmptyState icon={LuTruck} title="No suppliers" />}
        columns={[
          { key: 'name', label: 'Supplier', render: (s) => <span className="font-medium">{s.name}</span> }, { key: 'phone', label: 'Phone' }, { key: 'gstin', label: 'GSTIN' },
          { key: 'act', label: <span className="sr-only">Actions</span>, className: 'text-right', render: (s) => can('pharmacy.configure') && (
            <div className="flex justify-end gap-1">
              <Button size="sm" variant="ghost" onClick={() => setEditing(s)} aria-label="Edit"><LuPencil aria-hidden /></Button>
              <Button size="sm" variant="ghost" aria-label="Delete" onClick={async () => { if (window.confirm(`Delete supplier ${s.name}?`) && (await withToast(() => api.del(`/pharmacy/suppliers/${s.id}`), 'Supplier deleted.'))) reload(); }}><LuTrash2 aria-hidden /></Button>
            </div>) },
        ]} />
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add supplier' : 'Edit supplier'} size="sm" footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save} loading={f.submitting}>Save</Button></>}>
        <form onSubmit={save} className="space-y-3" noValidate>
          <Input label="Name" required {...f.bind('name')} error={f.errors.name} />
          <Input label="Phone" {...f.bind('phone')} />
          <Input label="GSTIN" {...f.bind('gstin')} />
          {f.formError && <Alert tone="error">{f.formError}</Alert>}
        </form>
      </Modal>
    </Card>
  );
}

export default function Pharmacy() {
  const { can } = useTenantAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'medicines';
  const tabs = [['medicines', 'Medicines & stock'], ...(can('pharmacy.write') ? [['dispense', 'Dispense']] : []), ['alerts', 'Alerts'], ['suppliers', 'Suppliers']];
  return (
    <>
      <PageHeader title="Pharmacy & inventory" subtitle="Batch-wise stock with expiry tracking and a full movement ledger." />
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg border border-line bg-white p-1 sm:w-fit" role="tablist">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setParams({ tab: k })} className={cx('flex-1 whitespace-nowrap rounded-md px-4 py-1.5 text-sm font-semibold', tab === k ? 'bg-forest-900 text-white' : 'text-forest-800 hover:bg-forest-50')}>{l}</button>)}
      </div>
      {tab === 'medicines' && <Medicines />}
      {tab === 'dispense' && <Dispense />}
      {tab === 'alerts' && <Alerts />}
      {tab === 'suppliers' && <Suppliers />}
    </>
  );
}

