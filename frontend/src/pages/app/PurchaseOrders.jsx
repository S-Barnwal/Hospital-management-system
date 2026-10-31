// Pharmacy → Purchase orders: draft → place → receive goods (batch, expiry, sale price) → stock goes up.
import { useEffect, useState } from 'react';
import { LuPlus, LuTrash2, LuSend, LuPackageCheck, LuPrinter, LuBan, LuWand } from 'react-icons/lu';
import { api, qs } from '../../lib/api.js';
import { useApi, useDebounced } from '../../lib/hooks.js';
import { useTenantAuth } from '../../context/AuthContext.jsx';
import { notify, withToast } from '../../lib/toast.js';
import { date, money, titleCase } from '../../lib/format.js';
import Attachments from '../../components/Attachments.jsx';
import { Alert, Button, Card, DataTable, EmptyState, Input, Modal, Pagination, Select, Skeleton, StatusBadge, Textarea } from '../../components/ui.jsx';

const STATUSES = ['draft', 'ordered', 'partially_received', 'received', 'cancelled'];

/** Medicine search box used on the order form. */
function MedicineSearch({ onPick }) {
  const [q, setQ] = useState('');
  const search = useDebounced(q);
  const { data } = useApi(() => (search.length >= 2 ? api.get(`/pharmacy/medicines${qs({ q: search, pageSize: 8 })}`) : Promise.resolve({ data: [] })), [search]);
  return (
    <div className="relative">
      <Input label="Add medicine" placeholder="Search by name or scan barcode…" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      {data?.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-line bg-white shadow-lg">
          {data.map((m) => (
            <li key={m.id}><button type="button" className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-forest-50" onClick={() => { onPick(m); setQ(''); }}>
              <span>{m.name} {m.strength}</span><span className="text-xs text-muted">{m.stock} in stock</span></button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OrderForm({ po, onClose, onSaved }) {
  const { data: suppliers } = useApi(() => api.get('/pharmacy/suppliers'), []);
  const [supplierId, setSupplierId] = useState(po ? String(po.supplier.id) : '');
  const [expectedDate, setExpectedDate] = useState(po?.expectedDate ? String(po.expectedDate).slice(0, 10) : '');
  const [notes, setNotes] = useState(po?.notes || '');
  const [lines, setLines] = useState(po ? po.items.map((i) => ({ medicineId: i.medicineId, name: `${i.medicineName} ${i.strength || ''}`, quantity: String(i.quantity), unitCost: String(i.unitCost) })) : []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const total = lines.reduce((a, l) => a + Number(l.quantity || 0) * Number(l.unitCost || 0), 0);
  const add = (m, quantity = 1, cost = '') => setLines((ls) => (ls.some((l) => l.medicineId === m.medicineId) ? ls : [...ls, { medicineId: m.medicineId, name: m.name, quantity: String(quantity), unitCost: String(cost) }]));
  const suggest = async () => {
    try {
      const r = await api.get('/pharmacy/purchase-orders/suggestions');
      if (!r.data.length) { notify.info('Nothing is below its reorder level.'); return; }
      r.data.forEach((x) => add({ medicineId: x.medicineId, name: `${x.name} ${x.strength || ''}` }, x.suggestedQuantity, x.lastCost ?? ''));
    } catch (e) { notify.error(e.message); }
  };
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const body = { supplierId: Number(supplierId), expectedDate: expectedDate || null, notes: notes.trim() || null,
        items: lines.map((l) => ({ medicineId: l.medicineId, quantity: Number(l.quantity), unitCost: Number(l.unitCost || 0) })) };
      if (po) await api.put(`/pharmacy/purchase-orders/${po.id}`, body); else await api.post('/pharmacy/purchase-orders', body);
      notify.success(po ? 'Purchase order updated.' : 'Purchase order saved as draft.');
      onSaved();
    } catch (e) { setErr(e.details?.length ? `${e.message} ${e.details.map((d) => d.message).join(' · ')}` : e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} size="lg" title={po ? `Edit ${po.number}` : 'New purchase order'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!supplierId || !lines.length}>Save draft</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Supplier" required placeholder="Choose supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}
          options={(suppliers || []).filter((x) => x.isActive).map((x) => ({ value: String(x.id), label: x.name }))} hint={suppliers?.length === 0 ? 'Add suppliers in the Suppliers tab first.' : undefined} />
        <Input label="Expected delivery" type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
        <div className="sm:col-span-2 flex flex-wrap items-end gap-2">
          <div className="min-w-60 flex-1"><MedicineSearch onPick={(m) => add({ medicineId: m.id, name: `${m.name} ${m.strength || ''}` })} /></div>
          <Button variant="outline" onClick={suggest}><LuWand aria-hidden /> Add low-stock items</Button>
        </div>
        <div className="sm:col-span-2 overflow-x-auto">
          {lines.length === 0 ? <p className="text-sm text-muted">No medicines added.</p> : (
            <table className="table-base">
              <thead><tr><th>Medicine</th><th>Qty</th><th>Unit cost (₹)</th><th className="text-right">Amount</th><th /></tr></thead>
              <tbody className="divide-y divide-line">
                {lines.map((l, i) => (
                  <tr key={l.medicineId}>
                    <td className="font-medium">{l.name}</td>
                    <td><input className="input w-24" type="number" min="1" value={l.quantity} aria-label="Quantity" onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} /></td>
                    <td><input className="input w-28" type="number" min="0" step="0.01" value={l.unitCost} aria-label="Unit cost" onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unitCost: e.target.value } : x)))} /></td>
                    <td className="text-right">{money(Number(l.quantity || 0) * Number(l.unitCost || 0))}</td>
                    <td className="text-right"><Button size="sm" variant="ghost" aria-label="Remove" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><LuTrash2 aria-hidden /></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <Textarea label="Notes for the supplier" className="sm:col-span-2" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <p className="text-sm font-semibold sm:col-span-2">Order value: {money(total)}</p>
        {err && <Alert tone="error" className="sm:col-span-2">{err}</Alert>}
      </div>
    </Modal>
  );
}

function ReceiveForm({ po, onClose, onSaved }) {
  const open = po.items.filter((i) => Number(i.receivedQuantity) < Number(i.quantity));
  const [ref, setRef] = useState('');
  const [rows, setRows] = useState(open.map((i) => ({ itemId: i.id, name: `${i.medicineName} ${i.strength || ''}`, pending: i.quantity - i.receivedQuantity,
    quantity: String(i.quantity - i.receivedQuantity), batchNumber: '', expiryDate: '', salePrice: String(i.salePrice ?? '') })));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (i, k, v) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const save = async () => {
    const lines = rows.filter((r) => Number(r.quantity) > 0);
    if (lines.some((r) => !r.batchNumber.trim() || !r.expiryDate)) { setErr('Enter batch number and expiry date for every line you receive.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api.post(`/pharmacy/purchase-orders/${po.id}/receive`, { ...(ref.trim() ? { reference: ref.trim() } : {}),
        lines: lines.map((x) => ({ itemId: x.itemId, quantity: Number(x.quantity), batchNumber: x.batchNumber.trim(), expiryDate: x.expiryDate, salePrice: Number(x.salePrice || 0) })) });
      notify.success(r.data.status === 'received' ? 'All goods received. Stock updated.' : 'Goods received. Stock updated; the rest is still pending.');
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} size="lg" title={`Receive goods — ${po.number}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}><LuPackageCheck aria-hidden /> Add to stock</Button></>}>
      <Input label="Supplier invoice no. (optional)" value={ref} onChange={(e) => setRef(e.target.value)} className="mb-3 max-w-xs" />
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={r.itemId} className="grid grid-cols-2 gap-2 rounded-lg border border-line p-3 sm:grid-cols-5 sm:items-end">
            <p className="col-span-2 text-sm font-semibold sm:col-span-5">{r.name} <span className="font-normal text-muted">· {r.pending} pending</span></p>
            <Input label="Qty received" type="number" min="0" max={r.pending * 2} value={r.quantity} onChange={(e) => set(i, 'quantity', e.target.value)} />
            <Input label="Batch no." value={r.batchNumber} onChange={(e) => set(i, 'batchNumber', e.target.value)} />
            <Input label="Expiry" type="date" value={r.expiryDate} onChange={(e) => set(i, 'expiryDate', e.target.value)} />
            <Input label="Sale price (₹)" type="number" min="0" step="0.01" value={r.salePrice} onChange={(e) => set(i, 'salePrice', e.target.value)} />
          </div>
        ))}
      </div>
      {err && <Alert tone="error" className="mt-3">{err}</Alert>}
    </Modal>
  );
}

function OrderDetail({ id, onClose, onChanged }) {
  const { can } = useTenantAuth();
  const { data: po, loading, reload } = useApi(() => api.get(`/pharmacy/purchase-orders/${id}`), [id]);
  const [mode, setMode] = useState(null);
  const [reason, setReason] = useState('');
  const refresh = () => { reload(); onChanged(); };
  return (
    <Modal open onClose={onClose} size="lg" title={po ? `${po.number} · ${po.supplier.name}` : 'Purchase order'}
      footer={po && <div className="flex w-full flex-wrap justify-end gap-2 print:hidden">
        <Button variant="ghost" onClick={() => window.print()}><LuPrinter aria-hidden /> Print</Button>
        {can('pharmacy.write') && po.status === 'draft' && <Button variant="outline" onClick={() => setMode('edit')}>Edit</Button>}
        {can('pharmacy.write') && po.status === 'draft' && <Button onClick={async () => { if (await withToast(() => api.post(`/pharmacy/purchase-orders/${po.id}/place`), 'Order placed.')) refresh(); }}><LuSend aria-hidden /> Place order</Button>}
        {can('pharmacy.write') && ['ordered', 'partially_received'].includes(po.status) && <Button onClick={() => setMode('receive')}><LuPackageCheck aria-hidden /> Receive goods</Button>}
        {can('pharmacy.write') && ['draft', 'ordered'].includes(po.status) && <Button variant="ghost" onClick={() => setMode('cancel')}><LuBan aria-hidden /> Cancel</Button>}
      </div>}>
      {loading || !po ? <Skeleton className="h-40 w-full" /> : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3 text-sm"><StatusBadge status={po.status} />
            <span className="text-muted">Ordered {po.orderDate ? date(po.orderDate) : '—'} · expected {po.expectedDate ? date(po.expectedDate) : '—'}</span></div>
          {po.cancelReason && <Alert tone="error" className="mb-3">Cancelled: {po.cancelReason}</Alert>}
          <div className="overflow-x-auto"><table className="table-base">
            <thead><tr><th>Medicine</th><th className="text-right">Ordered</th><th className="text-right">Received</th><th className="text-right">Unit cost</th><th className="text-right">Amount</th></tr></thead>
            <tbody className="divide-y divide-line">
              {po.items.map((i) => <tr key={i.id}><td>{i.medicineName} {i.strength}</td><td className="text-right">{i.quantity}</td><td className="text-right">{i.receivedQuantity}</td>
                <td className="text-right">{money(i.unitCost)}</td><td className="text-right">{money(i.quantity * Number(i.unitCost))}</td></tr>)}
            </tbody>
          </table></div>
          <p className="mt-3 text-right font-semibold">Total {money(po.total)}</p>
          {po.notes && <p className="mt-2 text-sm text-muted">Notes: {po.notes}</p>}
          <div className="mt-4 border-t border-line pt-4 print:hidden">
            <Attachments entityType="purchase_order" entityId={po.id} canEdit={can('pharmacy.write')} title="Supplier invoices & files" compact category="invoice" />
          </div>
        </>
      )}
      {mode === 'edit' && <OrderForm po={po} onClose={() => setMode(null)} onSaved={() => { setMode(null); refresh(); }} />}
      {mode === 'receive' && <ReceiveForm po={po} onClose={() => setMode(null)} onSaved={() => { setMode(null); refresh(); }} />}
      {mode === 'cancel' && (
        <Modal open onClose={() => setMode(null)} size="sm" title="Cancel purchase order"
          footer={<><Button variant="ghost" onClick={() => setMode(null)}>Keep</Button><Button variant="danger" disabled={reason.trim().length < 3}
            onClick={async () => { if (await withToast(() => api.post(`/pharmacy/purchase-orders/${po.id}/cancel`, { reason: reason.trim() }), 'Order cancelled.')) { setMode(null); refresh(); } }}>Cancel order</Button></>}>
          <Textarea label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Modal>
      )}
    </Modal>
  );
}

export default function PurchaseOrders() {
  const { can } = useTenantAuth();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState(null);
  useEffect(() => setPage(1), [status]);
  const { data, meta, loading, error, reload } = useApi(() => api.get(`/pharmacy/purchase-orders${qs({ status, page })}`), [status, page]);
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
        <select className="input max-w-56" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option>{STATUSES.map((x) => <option key={x} value={x}>{titleCase(x)}</option>)}</select>
        {can('pharmacy.write') && <Button onClick={() => setCreating(true)}><LuPlus aria-hidden /> New purchase order</Button>}
      </div>
      <DataTable loading={loading} error={error} rows={data} onRowClick={(r) => setOpenId(r.id)} empty={<EmptyState title="No purchase orders">Create one, or use “Add low-stock items” to fill it automatically.</EmptyState>}
        columns={[
          { key: 'number', label: 'PO', render: (r) => <span className="font-mono text-xs font-semibold">{r.number}</span> },
          { key: 'supplierName', label: 'Supplier' },
          { key: 'orderDate', label: 'Ordered', render: (r) => (r.orderDate ? date(r.orderDate) : '—') },
          { key: 'expectedDate', label: 'Expected', render: (r) => (r.expectedDate ? date(r.expectedDate) : '—') },
          { key: 'lines', label: 'Items' },
          { key: 'total', label: 'Value', className: 'text-right', render: (r) => money(r.total) },
          { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
        ]} />
      <Pagination meta={meta} onPage={setPage} />
      {creating && <OrderForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload(); }} />}
      {openId && <OrderDetail id={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
    </Card>
  );
}
