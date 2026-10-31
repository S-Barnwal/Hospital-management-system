// Laboratory, Phase 3: parameter editor for panel tests, home sample collection board, patient result trends.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LuPlus, LuTrash2, LuArrowUp, LuArrowDown, LuHouse, LuPhone, LuMapPin } from 'react-icons/lu';
import { api, qs } from '../../lib/api.js';
import { useApi } from '../../lib/hooks.js';
import { useTenantAuth } from '../../context/AuthContext.jsx';
import { notify, withToast } from '../../lib/toast.js';
import { dateTime, fullName, money } from '../../lib/format.js';
import { formatPhone } from '../../lib/contact.js';
import { Alert, Button, Card, EmptyState, Input, Modal, PageHeader, Skeleton, StatusBadge, Textarea, cx } from '../../components/ui.jsx';
import { StaffSelect } from '../../components/Pickers.jsx';
import { isOutOfRange } from '../../components/LabFlag.jsx';

const blankParam = { name: '', unit: '', refLow: '', refHigh: '', refText: '', inputType: 'numeric', options: '', decimals: '', isHeading: false, criticalLow: '', criticalHigh: '' };

/** Edit the parameters of a test (CBC → Hb, WBC …). An empty list makes it a single-result test again. */
export function ParametersModal({ test, onClose }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => {
    if (!test) return;
    setRows(null); setErr(null);
    api.get(`/lab/tests/${test.id}/parameters`).then((r) => setRows(r.data.map((p) => ({ ...p, unit: p.unit ?? '', refLow: p.refLow ?? '', refHigh: p.refHigh ?? '', refText: p.refText ?? '',
      inputType: p.inputType || 'numeric', options: (p.options || []).join(' | '), decimals: p.decimals ?? '', isHeading: Boolean(p.isHeading), criticalLow: p.criticalLow ?? '', criticalHigh: p.criticalHigh ?? '' }))))
      .catch((e) => setErr(e.message));
  }, [test]);
  if (!test) return null;
  const set = (i, k, v) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const move = (i, d) => setRows((rs) => { const c = [...rs]; const [x] = c.splice(i, 1); c.splice(i + d, 0, x); return c; });
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await api.put(`/lab/tests/${test.id}/parameters`, { parameters: rows.filter((r) => r.name.trim()).map((r) => ({
        ...(r.id ? { id: r.id } : {}), name: r.name.trim(), unit: r.unit.trim() || null, refLow: r.refLow === '' ? null : Number(r.refLow),
        refHigh: r.refHigh === '' ? null : Number(r.refHigh), refText: r.refText.trim() || null, isHeading: r.isHeading, inputType: r.inputType,
        options: r.inputType === 'option' ? r.options.split('|').map((x) => x.trim()).filter(Boolean) : [], decimals: r.decimals === '' ? null : Number(r.decimals),
        criticalLow: r.criticalLow === '' ? null : Number(r.criticalLow), criticalHigh: r.criticalHigh === '' ? null : Number(r.criticalHigh) })) });
      notify.success('Parameters saved. New orders of this test will use them.');
      onClose(true);
    } catch (e) { setErr(e.details?.[0] ? `${e.message} ${e.details[0].message}` : e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={() => onClose(false)} size="lg" title={`Parameters — ${test.name}`}
      footer={<><Button variant="ghost" onClick={() => onClose(false)}>Cancel</Button><Button onClick={save} loading={busy} disabled={!rows}>Save parameters</Button></>}>
      <p className="mb-3 text-sm text-muted">Give a test several parameters (for example a CBC: Haemoglobin, WBC, Platelets…). Each gets its own result, unit, normal range and flag.
        The range here is the default; add age / gender ranges with the “Ranges” button. Orders already placed keep the parameters they were ordered with.</p>
      {!rows ? <Skeleton className="h-32 w-full" /> : (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={r.id ?? `n${i}`} className="space-y-2 rounded-lg border border-line p-2">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-12 sm:items-end">
                <Input label={r.isHeading ? 'Heading' : 'Parameter'} className="col-span-2 sm:col-span-4" value={r.name} onChange={(e) => set(i, 'name', e.target.value)} />
                {r.isHeading ? <p className="col-span-2 self-center text-xs text-muted sm:col-span-8">Printed as a sub-heading (e.g. “Differential count”); takes no result.</p> : <>
                  <Input label="Unit" className="sm:col-span-2" value={r.unit} onChange={(e) => set(i, 'unit', e.target.value)} />
                  <Input label="Low" type="number" step="any" className="sm:col-span-2" value={r.refLow} onChange={(e) => set(i, 'refLow', e.target.value)} />
                  <Input label="High" type="number" step="any" className="sm:col-span-2" value={r.refHigh} onChange={(e) => set(i, 'refHigh', e.target.value)} />
                  <Input label="Reference text" className="col-span-2 sm:col-span-2" value={r.refText} onChange={(e) => set(i, 'refText', e.target.value)} placeholder="e.g. Negative" />
                </>}
              </div>
              <div className="flex flex-wrap items-end gap-2">
                {!r.isHeading && <>
                  <label className="w-36"><span className="label">Result type</span>
                    <select className="input" value={r.inputType} onChange={(e) => set(i, 'inputType', e.target.value)} aria-label={`Result type of ${r.name || 'parameter'}`}>
                      <option value="numeric">Number</option><option value="text">Free text</option><option value="option">Dropdown</option>
                    </select></label>
                  <Input label="Decimals" type="number" min="0" max="6" className="w-24" value={r.decimals} onChange={(e) => set(i, 'decimals', e.target.value)} />
                  {r.inputType === 'numeric' && <>
                    <Input label="Critical low" type="number" step="any" className="w-28" value={r.criticalLow} onChange={(e) => set(i, 'criticalLow', e.target.value)} />
                    <Input label="Critical high" type="number" step="any" className="w-28" value={r.criticalHigh} onChange={(e) => set(i, 'criticalHigh', e.target.value)} />
                  </>}
                  {r.inputType === 'option' && <Input label="Choices (separate with |)" className="min-w-48 flex-1" value={r.options} onChange={(e) => set(i, 'options', e.target.value)} placeholder="Positive | Negative" />}
                </>}
                <label className="mb-2 flex items-center gap-2 text-xs"><input type="checkbox" className="accent-forest-800" checked={r.isHeading} onChange={(e) => set(i, 'isHeading', e.target.checked)} /> Heading row</label>
                <div className="ml-auto flex gap-1">
                  <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><LuArrowUp aria-hidden /></Button>
                  <Button size="sm" variant="ghost" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><LuArrowDown aria-hidden /></Button>
                  <Button size="sm" variant="ghost" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label="Remove"><LuTrash2 aria-hidden /></Button>
                </div>
              </div>
            </div>
          ))}
          {rows.length === 0 && <p className="rounded-lg bg-ivory p-3 text-sm text-muted">No parameters — this test has a single result.</p>}
          <Button size="sm" variant="outline" onClick={() => setRows((rs) => [...rs, { ...blankParam }])}><LuPlus aria-hidden /> Add parameter</Button>
        </div>
      )}
      {err && <Alert tone="error" className="mt-3">{err}</Alert>}
    </Modal>
  );
}

const HOME_NEXT = {
  scheduled: [['assigned', 'Assign']], assigned: [['on_the_way', 'On the way'], ['collected', 'Mark collected']],
  on_the_way: [['collected', 'Mark collected']], collected: [], cancelled: [],
};

/** Day board of home sample collection visits. */
export function HomeCollections() {
  const { me, can } = useTenantAuth();
  const tz = me.tenant.timezone;
  const [date, setDate] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date()));
  const [openOnly, setOpenOnly] = useState(false);
  const { data, loading, error, reload } = useApi(() => api.get(`/lab/home-collections${qs({ date, open: openOnly ? 'true' : undefined })}`), [date, openOnly]);
  const [assign, setAssign] = useState(null);
  const [collector, setCollector] = useState('');
  const [cancel, setCancel] = useState(null);
  const [reason, setReason] = useState('');
  const move = async (v, status, extra = {}) => {
    if (await withToast(() => api.post(`/lab/home-collections/${v.id}/status`, { status, ...extra }), status === 'collected' ? 'Sample collected — the order moves to the lab.' : 'Visit updated.')) reload();
  };
  return (
    <>
      <PageHeader title="Home collections" subtitle="Sample pick-ups booked at the patient’s home. Assign a collector, track the visit and mark the sample collected." />
      <Card className="mb-4 flex flex-wrap items-end gap-3 p-4">
        <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <label className="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" className="accent-forest-800" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} /> Also show all open visits</label>
      </Card>
      {error && <Alert tone="error">{error.message}</Alert>}
      {loading && <Skeleton className="h-40 w-full" />}
      {!loading && data?.length === 0 && <Card><EmptyState icon={LuHouse} title="No home visits">Book one from <Link className="font-semibold underline" to="/app/laboratory?new=1">New lab order</Link> → “Collect the sample at the patient’s home”.</EmptyState></Card>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data?.map((v) => (
          <Card key={v.id} className={cx('flex flex-col p-4', v.priority === 'urgent' && 'ring-2 ring-red-200')}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gold-700">{dateTime(v.scheduledAt, tz)}</p>
                <Link to={`/app/laboratory/${v.orderId}`} className="font-semibold text-ink hover:underline">{fullName(v.patientFirstName, v.patientLastName)}</Link>
                <p className="text-xs text-muted">{v.patientNumber} · {v.orderNumber}{v.priority === 'urgent' ? ' · URGENT' : ''}</p>
              </div>
              <StatusBadge status={v.status} />
            </div>
            <p className="mt-3 flex gap-2 text-sm"><LuMapPin className="mt-0.5 shrink-0 text-forest-700" aria-hidden /><span>{v.address}{v.landmark ? <span className="text-muted"> · near {v.landmark}</span> : ''}</span></p>
            {(v.contactPhone || v.patientPhone) && <a className="mt-1 flex items-center gap-2 text-sm font-medium text-forest-700" href={`tel:${v.contactPhone || v.patientPhone}`}><LuPhone aria-hidden /> {formatPhone(v.contactPhone || v.patientPhone)}</a>}
            <p className="mt-2 text-xs text-muted">Tests: {v.tests}</p>
            <p className="mt-1 text-xs text-muted">Collector: {v.collectorName || 'not assigned'}{Number(v.charge) > 0 ? ` · visit charge ${money(v.charge)}` : ''}</p>
            {v.notes && <p className="mt-1 text-xs text-muted">Note: {v.notes}</p>}
            {can('lab.write') && (
              <div className="mt-auto flex flex-wrap gap-2 pt-3">
                {HOME_NEXT[v.status].map(([to, label]) => (to === 'assigned'
                  ? <Button key={to} size="sm" onClick={() => { setAssign(v); setCollector(v.collectorStaffId ? String(v.collectorStaffId) : ''); }}>{label}</Button>
                  : <Button key={to} size="sm" variant={to === 'collected' ? 'primary' : 'outline'} onClick={() => move(v, to)}>{label}</Button>))}
                {['assigned', 'on_the_way'].includes(v.status) && <Button size="sm" variant="ghost" onClick={() => { setAssign(v); setCollector(v.collectorStaffId ? String(v.collectorStaffId) : ''); }}>Change collector</Button>}
                {!['collected', 'cancelled'].includes(v.status) && <Button size="sm" variant="ghost" onClick={() => { setCancel(v); setReason(''); }}>Cancel visit</Button>}
              </div>
            )}
          </Card>
        ))}
      </div>
      <Modal open={Boolean(assign)} onClose={() => setAssign(null)} size="sm" title="Assign collector"
        footer={<><Button variant="ghost" onClick={() => setAssign(null)}>Cancel</Button><Button disabled={!collector} onClick={async () => { await move(assign, assign.status === 'scheduled' ? 'assigned' : assign.status, { collectorStaffId: Number(collector) }); setAssign(null); }}>Save</Button></>}>
        <StaffSelect label="Collector (staff member)" placeholder="Choose…" value={collector} onChange={setCollector} />
      </Modal>
      <Modal open={Boolean(cancel)} onClose={() => setCancel(null)} size="sm" title="Cancel home visit"
        footer={<><Button variant="ghost" onClick={() => setCancel(null)}>Keep</Button><Button variant="danger" disabled={reason.trim().length < 3} onClick={async () => { await move(cancel, 'cancelled', { reason: reason.trim() }); setCancel(null); }}>Cancel visit</Button></>}>
        <Textarea label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        <p className="mt-2 text-xs text-muted">The lab order stays open — the sample can still be collected at the lab.</p>
      </Modal>
    </>
  );
}

/** Tiny line chart with the normal band shaded. */
function TrendChart({ s }) {
  const w = 260; const h = 70; const pad = 6;
  const vals = s.points.map((p) => p.value);
  const lo = Math.min(...vals, s.refLow ?? Infinity); const hi = Math.max(...vals, s.refHigh ?? -Infinity);
  const span = hi - lo || 1;
  const x = (i) => pad + (s.points.length === 1 ? (w - 2 * pad) / 2 : (i * (w - 2 * pad)) / (s.points.length - 1));
  const y = (v) => h - pad - ((v - lo) / span) * (h - 2 * pad);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-20 w-full" role="img" aria-label={`${s.name} trend`}>
      {s.refLow != null && s.refHigh != null && <rect x={0} width={w} y={y(Number(s.refHigh))} height={Math.max(1, y(Number(s.refLow)) - y(Number(s.refHigh)))} className="fill-forest-50" />}
      <polyline fill="none" strokeWidth="2" className="stroke-forest-700" points={s.points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')} />
      {s.points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.value)} r="3" className={isOutOfRange(p.flag) ? 'fill-red-600' : 'fill-forest-700'} />)}
    </svg>
  );
}

/** Patient → Lab trends: every numeric verified result over time. */
export function LabTrends({ patientId }) {
  const { me } = useTenantAuth();
  const { data, loading, error } = useApi(() => api.get(`/lab/patients/${patientId}/trends`), [patientId]);
  if (error) return error.status === 403 ? null : <Alert tone="error">{error.message}</Alert>;
  if (loading) return <Skeleton className="h-32 w-full" />;
  if (!data?.length) return <p className="text-sm text-muted">No verified numeric lab results yet.</p>;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {data.slice(0, 12).map((s) => {
        const last = s.points[s.points.length - 1];
        return (
          <div key={s.key} className="rounded-lg border border-line p-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className="truncate text-sm font-semibold" title={s.name}>{s.name}</p>
              <p className={cx('shrink-0 text-sm font-bold', isOutOfRange(last.flag) ? 'text-red-700' : 'text-forest-800')}>{last.value}{s.unit ? ` ${s.unit}` : ''}</p>
            </div>
            <TrendChart s={s} />
            <p className="text-[11px] text-muted">{s.points.length} result(s) · last {new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: me.tenant.timezone }).format(new Date(last.at))}
              {s.refLow != null || s.refHigh != null ? ` · normal ${s.refLow ?? ''}–${s.refHigh ?? ''}` : ''}</p>
          </div>
        );
      })}
    </div>
  );
}

