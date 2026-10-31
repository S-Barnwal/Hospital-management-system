// One admission, start to finish: overview & transfer, vitals chart, nursing notes, charges & deposits,
// structured discharge summary, discharge.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { LuArrowLeft, LuArrowRightLeft, LuLogOut, LuPlus, LuPrinter, LuSave, LuLock, LuTrash2, LuBedDouble, LuWallet, LuRefreshCw } from 'react-icons/lu';
import { api } from '../../lib/api.js';
import { useApi } from '../../lib/hooks.js';
import { useTenantAuth } from '../../context/AuthContext.jsx';
import { notify, withToast } from '../../lib/toast.js';
import { date, dateTime, fullName, money, relative, titleCase } from '../../lib/format.js';
import { Alert, Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Skeleton, Textarea, cx } from '../../components/ui.jsx';
import { DepositModal } from '../../components/MoneyModals.jsx';

const TABS = [['overview', 'Overview'], ['vitals', 'Vitals'], ['notes', 'Nursing notes'], ['charges', 'Charges & deposit'], ['summary', 'Discharge summary']];
const FLAG_STYLE = { low: 'bg-gold-100 text-gold-700', high: 'bg-gold-100 text-gold-700', critical_low: 'bg-red-100 text-red-700 font-bold', critical_high: 'bg-red-100 text-red-700 font-bold' };
const VITAL_FIELDS = [
  ['temperatureC', 'Temp °C', '0.1'], ['pulseBpm', 'Pulse /min', '1'], ['bpSystolic', 'BP sys', '1'], ['bpDiastolic', 'BP dia', '1'],
  ['respiratoryRate', 'Resp /min', '1'], ['spo2', 'SpO₂ %', '1'], ['bloodSugarMgdl', 'Sugar mg/dL', '1'], ['painScore', 'Pain 0–10', '1'], ['weightKg', 'Weight kg', '0.1'],
];

export default function AdmissionDetail() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'overview';
  const { data: a, loading, error, reload } = useApi(() => api.get(`/ipd/admissions/${id}`), [id]);
  if (error) return <Alert tone="error">{error.status === 404 ? 'Admission not found.' : error.message}</Alert>;
  if (loading && !a) return <Skeleton className="h-64 w-full" />;
  const open = a.status === 'admitted';
  return (
    <>
      <Link to="/app/admissions?tab=admissions" className="mb-4 flex items-center gap-1 text-sm font-medium text-forest-700"><LuArrowLeft aria-hidden /> Admissions</Link>
      <PageHeader eyebrow={`${a.number} · ${a.wardName} · bed ${a.bedNumber}`} title={fullName(a.patientFirstName, a.patientLastName)}
        subtitle={`${a.patientNumber} · admitted ${dateTime(a.admittedAt)} (${relative(a.admittedAt)})${a.doctorName ? ` · ${a.doctorName}` : ''}`}
        actions={<HeaderActions a={a} reload={reload} />} />
      <div className="mb-4 flex items-center gap-2">
        <Badge tone={open ? 'green' : 'gray'}>{open ? 'Admitted' : `Discharged ${dateTime(a.dischargedAt)}`}</Badge>
      </div>
      <div className="mb-5 flex gap-1 overflow-x-auto rounded-lg border border-line bg-white p-1 sm:w-fit" role="tablist">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setParams({ tab: k })} className={cx('whitespace-nowrap rounded-md px-4 py-1.5 text-sm font-semibold', tab === k ? 'bg-forest-900 text-white' : 'text-forest-800 hover:bg-forest-50')}>{l}</button>)}
      </div>
      {tab === 'overview' && <Overview a={a} />}
      {tab === 'vitals' && <Vitals a={a} />}
      {tab === 'notes' && <Notes a={a} />}
      {tab === 'charges' && <Charges a={a} />}
      {tab === 'summary' && <Summary a={a} reload={reload} />}
    </>
  );
}

function HeaderActions({ a, reload }) {
  const { can, hasFeature } = useTenantAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState(null);
  const [toBed, setToBed] = useState('');
  const [text, setText] = useState('');
  const [charge, setCharge] = useState(true);
  const [busy, setBusy] = useState(false);
  const { data: wards } = useApi(() => (mode === 'transfer' ? api.get('/ipd/wards') : Promise.resolve({ data: [] })), [mode]);
  const { data: ds } = useApi(() => (mode === 'discharge' ? api.get(`/ipd/admissions/${a.id}/discharge-summary`) : Promise.resolve({ data: null })), [mode]);
  const free = (wards || []).flatMap((w) => w.beds.filter((b) => b.status === 'available').map((b) => ({ value: String(b.id), label: `${w.name} · ${b.bedNumber}` })));
  const signed = ds?.status === 'final';
  if (a.status !== 'admitted' || !can('ipd.write')) {
    return <Button variant="outline" to={`/app/admissions/${a.id}/discharge-summary`}><LuPrinter aria-hidden /> Discharge summary</Button>;
  }
  const run = async (fn, msg) => { setBusy(true); const ok = await withToast(fn, msg); setBusy(false); if (ok) { setMode(null); reload(); } return ok; };
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setMode('transfer')}><LuArrowRightLeft aria-hidden /> Transfer bed</Button>
        <Button onClick={() => setMode('discharge')}><LuLogOut aria-hidden /> Discharge</Button>
      </div>
      <Modal open={mode === 'transfer'} onClose={() => setMode(null)} title="Transfer to another bed" size="sm"
        footer={<><Button variant="ghost" onClick={() => setMode(null)}>Cancel</Button><Button disabled={!toBed} loading={busy} onClick={() => run(() => api.post(`/ipd/admissions/${a.id}/transfer`, { toBedId: Number(toBed) }), 'Patient transferred.')}>Transfer</Button></>}>
        <Select label="Move to bed" placeholder={free.length ? 'Select a free bed' : 'No free beds'} options={free} value={toBed} onChange={(e) => setToBed(e.target.value)} />
      </Modal>
      <Modal open={mode === 'discharge'} onClose={() => setMode(null)} title="Discharge patient"
        footer={<><Button variant="ghost" onClick={() => setMode(null)}>Cancel</Button>
          <Button loading={busy} disabled={!signed && text.trim().length < 3}
            onClick={async () => { if (await run(() => api.post(`/ipd/admissions/${a.id}/discharge`, { ...(text.trim() ? { dischargeSummary: text.trim() } : {}), chargeBedDays: charge }), 'Patient discharged.')) navigate(`/app/admissions/${a.id}?tab=charges`); }}>Confirm discharge</Button></>}>
        <div className="space-y-3 text-sm">
          {signed ? <Alert tone="success">The discharge summary is signed and will be attached to this discharge.</Alert>
            : <Alert tone="warning">The discharge summary is not signed yet. Sign it in the <strong>Discharge summary</strong> tab (recommended), or type a short summary below.</Alert>}
          {!signed && <Textarea label="Short discharge summary" value={text} onChange={(e) => setText(e.target.value)} />}
          {hasFeature('billing') && can('billing.write') && Number(a.dailyRate) > 0 && (
            <label className="flex items-center gap-2"><input type="checkbox" className="accent-forest-800" checked={charge} onChange={(e) => setCharge(e.target.checked)} /> Add any bed days not yet charged ({money(a.dailyRate)}/day)</label>
          )}
          <p className="text-xs text-muted">The bed becomes free immediately. Bills stay open for payment.</p>
        </div>
      </Modal>
    </>
  );
}

function Overview({ a }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="p-5">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {[['Patient no.', a.patientNumber], ['Bed', `${a.wardName} · ${a.bedNumber}`], ['Admitted', dateTime(a.admittedAt)], ['Attending doctor', a.doctorName || '—'],
            ['Ward rate', `${money(a.dailyRate)} / day`], ['Status', titleCase(a.status)]].map(([k, v]) => <div key={k}><dt className="text-muted">{k}</dt><dd className="font-medium">{v}</dd></div>)}
        </dl>
        {a.reason && <><p className="mt-4 text-sm font-semibold">Reason for admission</p><p className="mt-1 rounded-lg bg-ivory p-3 text-sm">{a.reason}</p></>}
        {a.dischargeSummary && <><p className="mt-4 text-sm font-semibold">Discharge note</p><p className="mt-1 whitespace-pre-wrap rounded-lg bg-ivory p-3 text-sm">{a.dischargeSummary}</p></>}
      </Card>
      <Card className="p-5">
        <h2 className="mb-3 font-display text-lg font-semibold">Bed history</h2>
        {a.transfers.length === 0 ? <p className="text-sm text-muted">No transfers.</p>
          : <ul className="space-y-2 text-sm">{a.transfers.map((t, i) => <li key={i}>{dateTime(t.at)} — {t.fromWard} {t.fromBed} → <strong>{t.toWard} {t.toBed}</strong></li>)}</ul>}
      </Card>
    </div>
  );
}

// ---------- Vitals ----------
function Sparkline({ label, values, unit }) {
  const pts = values.filter((v) => v != null).slice(-20);
  if (pts.length < 2) return null;
  const min = Math.min(...pts); const max = Math.max(...pts); const span = max - min || 1;
  const d = pts.map((v, i) => `${(i / (pts.length - 1)) * 100},${30 - ((v - min) / span) * 26 - 2}`).join(' ');
  return (
    <div className="rounded-lg border border-line p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="font-semibold">{pts.at(-1)}{unit}</p>
      <svg viewBox="0 0 100 30" className="mt-1 h-8 w-full" preserveAspectRatio="none" aria-hidden><polyline points={d} fill="none" stroke="currentColor" strokeWidth="2" className="text-forest-600" vectorEffect="non-scaling-stroke" /></svg>
    </div>
  );
}

function Vitals({ a }) {
  const { can } = useTenantAuth();
  const { data, loading, reload } = useApi(() => api.get(`/ipd/admissions/${a.id}/vitals`), [a.id]);
  const blank = Object.fromEntries(VITAL_FIELDS.map(([k]) => [k, ''])); blank.notes = '';
  const [v, setV] = useState(blank);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const rows = data || [];
  const chrono = useMemo(() => [...rows].reverse(), [rows]);
  const save = async () => {
    setErr(null); setBusy(true);
    try {
      const body = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '').map(([k, x]) => [k, k === 'notes' ? x : Number(x)]));
      const r = await api.post(`/ipd/admissions/${a.id}/vitals`, body);
      const crit = Object.values(r.data.flags).some((f) => f.startsWith('critical'));
      (crit ? notify.warning : notify.success)(crit ? 'Saved — some readings are in the critical range. Inform the doctor.' : 'Vitals saved.');
      setV(blank); reload();
    } catch (e) { setErr(e.details?.[0]?.message || e.message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-6">
      {a.status === 'admitted' && can('ipd.write') && (
        <Card className="p-5">
          <h2 className="mb-3 font-display text-lg font-semibold">Record vitals</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {VITAL_FIELDS.map(([k, l, step]) => <Input key={k} label={l} type="number" step={step} inputMode="decimal" value={v[k]} onChange={(e) => setV((s) => ({ ...s, [k]: e.target.value }))} />)}
            <Input label="Notes" className="col-span-2 sm:col-span-5" value={v.notes} onChange={(e) => setV((s) => ({ ...s, notes: e.target.value }))} />
          </div>
          {err && <Alert tone="error" className="mt-3">{err}</Alert>}
          <Button className="mt-3" onClick={save} loading={busy}><LuSave aria-hidden /> Save reading</Button>
        </Card>
      )}
      {rows.length > 1 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Sparkline label="Pulse" unit="/min" values={chrono.map((r) => r.pulseBpm)} />
          <Sparkline label="Temperature" unit=" °C" values={chrono.map((r) => (r.temperatureC == null ? null : Number(r.temperatureC)))} />
          <Sparkline label="SpO₂" unit="%" values={chrono.map((r) => r.spo2)} />
          <Sparkline label="BP systolic" unit="" values={chrono.map((r) => r.bpSystolic)} />
        </div>
      )}
      <Card>
        {loading ? <Skeleton className="h-40 w-full" /> : rows.length === 0 ? <EmptyState title="No vitals recorded yet" /> : (
          <div className="overflow-x-auto">
            <table className="table-base text-sm">
              <thead><tr><th>Time</th>{VITAL_FIELDS.map(([k, l]) => <th key={k} className="text-right">{l}</th>)}<th>By</th></tr></thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">{dateTime(r.recordedAt)}{r.notes && <p className="text-xs text-muted">{r.notes}</p>}</td>
                    {VITAL_FIELDS.map(([k]) => <td key={k} className="text-right">{r[k] == null ? '—' : <span className={cx('rounded px-1.5', FLAG_STYLE[r.flags[k]])}>{Number(r[k])}</span>}</td>)}
                    <td className="text-xs text-muted">{r.recordedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="text-xs text-muted">Highlighting uses common adult ranges to draw attention only; it is not a diagnosis.</p>
    </div>
  );
}

// ---------- Nursing notes ----------
const NOTE_CATS = [['note', 'Note'], ['medication', 'Medication given'], ['intake_output', 'Intake / output'], ['procedure', 'Procedure'], ['handover', 'Shift handover']];
function Notes({ a }) {
  const { can } = useTenantAuth();
  const { data, meta, loading, reload } = useApi(() => api.get(`/ipd/admissions/${a.id}/notes`), [a.id]);
  const blank = { category: 'note', note: '', medicineName: '', dose: '', route: '', intakeMl: '', outputMl: '', correctsNoteId: null };
  const [n, setN] = useState(blank);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setErr(null); setBusy(true);
    try {
      const body = Object.fromEntries(Object.entries(n).filter(([, x]) => x !== '' && x !== null).map(([k, x]) => [k, ['intakeMl', 'outputMl', 'correctsNoteId'].includes(k) ? Number(x) : x]));
      await api.post(`/ipd/admissions/${a.id}/notes`, body);
      notify.success(n.correctsNoteId ? 'Correction added (the original stays on record).' : 'Note added.');
      setN(blank); reload();
    } catch (e) { setErr(e.details?.[0]?.message || e.message); } finally { setBusy(false); }
  };
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      {a.status === 'admitted' && can('ipd.write') && (
        <Card className="h-fit space-y-3 p-5 lg:col-span-2">
          <h2 className="font-display text-lg font-semibold">{n.correctsNoteId ? 'Correct a note' : 'Add note'}</h2>
          {n.correctsNoteId && <Alert tone="info">Notes are never edited. Your correction is saved as a new note linked to the original. <button type="button" className="underline" onClick={() => setN(blank)}>Cancel</button></Alert>}
          <Select label="Type" options={NOTE_CATS.map(([value, label]) => ({ value, label }))} value={n.category} onChange={(e) => setN((s) => ({ ...s, category: e.target.value }))} />
          {n.category === 'medication' && <div className="grid grid-cols-3 gap-2">
            <Input label="Medicine" className="col-span-3" value={n.medicineName} onChange={(e) => setN((s) => ({ ...s, medicineName: e.target.value }))} />
            <Input label="Dose" value={n.dose} onChange={(e) => setN((s) => ({ ...s, dose: e.target.value }))} />
            <Select label="Route" placeholder="—" options={['Oral', 'IV', 'IM', 'SC', 'Inhalation', 'Topical', 'Other'].map((x) => ({ value: x, label: x }))} value={n.route} onChange={(e) => setN((s) => ({ ...s, route: e.target.value }))} className="col-span-2" />
          </div>}
          {n.category === 'intake_output' && <div className="grid grid-cols-2 gap-2">
            <Input label="Intake (ml)" type="number" min="0" value={n.intakeMl} onChange={(e) => setN((s) => ({ ...s, intakeMl: e.target.value }))} />
            <Input label="Output (ml)" type="number" min="0" value={n.outputMl} onChange={(e) => setN((s) => ({ ...s, outputMl: e.target.value }))} />
          </div>}
          <Textarea label="Note" required value={n.note} onChange={(e) => setN((s) => ({ ...s, note: e.target.value }))} />
          {err && <Alert tone="error">{err}</Alert>}
          <Button onClick={save} loading={busy} disabled={n.note.trim().length < 2}><LuPlus aria-hidden /> Save note</Button>
        </Card>
      )}
      <Card className={cx('p-5', a.status === 'admitted' && can('ipd.write') ? 'lg:col-span-3' : 'lg:col-span-5')}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-semibold">Notes</h2>
          {meta?.intakeOutput && (meta.intakeOutput.intake || meta.intakeOutput.output) ? <span className="text-sm">Intake {meta.intakeOutput.intake} ml · Output {meta.intakeOutput.output} ml</span> : null}
        </div>
        {loading ? <Skeleton className="h-32 w-full" /> : !data?.length ? <p className="text-sm text-muted">No notes yet.</p> : (
          <ul className="space-y-3">
            {data.map((x) => (
              <li key={x.id} className={cx('rounded-lg border border-line p-3 text-sm', x.isCorrected && 'opacity-60')}>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                  <span><Badge tone={x.category === 'medication' ? 'blue' : x.category === 'handover' ? 'gold' : 'gray'}>{NOTE_CATS.find(([k]) => k === x.category)?.[1]}</Badge> {dateTime(x.recordedAt)} · {x.recordedBy}</span>
                  {x.isCorrected ? <span className="font-semibold">Corrected below</span> : a.status === 'admitted' && can('ipd.write') && <button type="button" className="font-semibold text-forest-700 underline" onClick={() => setN({ ...blank, category: x.category, correctsNoteId: x.id, note: x.note })}>Correct</button>}
                </div>
                {x.correctsNoteId && <p className="mt-1 text-xs font-semibold text-gold-700">Correction of an earlier note</p>}
                {x.medicineName && <p className="mt-1 font-medium">{x.medicineName}{x.dose ? ` · ${x.dose}` : ''}{x.route ? ` · ${x.route}` : ''}</p>}
                {(x.intakeMl != null || x.outputMl != null) && <p className="mt-1 font-medium">In {x.intakeMl ?? 0} ml · Out {x.outputMl ?? 0} ml</p>}
                <p className={cx('mt-1 whitespace-pre-wrap', x.isCorrected && 'line-through')}>{x.note}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---------- Charges & deposit ----------
function Charges({ a }) {
  const { can, hasFeature } = useTenantAuth();
  const { data, loading, reload } = useApi(() => api.get(`/ipd/admissions/${a.id}/charges`), [a.id]);
  const { data: catalogue } = useApi(() => api.get('/ipd/service-charges'), []);
  const [chargeId, setChargeId] = useState('');
  const [qty, setQty] = useState('1');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(null);
  const [deposit, setDeposit] = useState(false);
  if (!hasFeature('billing')) return <Alert tone="info">Billing is not included in your plan, so charges are not tracked here.</Alert>;
  const canPost = a.status === 'admitted' && can('ipd.write') && can('billing.write');
  const add = async () => {
    setBusy('add');
    if (await withToast(() => api.post(`/ipd/admissions/${a.id}/charges`, { chargeId: Number(chargeId), quantity: Number(qty), ...(note.trim() ? { note: note.trim() } : {}) }), 'Charge added to the bill.')) { setChargeId(''); setQty('1'); setNote(''); reload(); }
    setBusy(null);
  };
  const sel = catalogue?.find((c) => String(c.id) === chargeId);
  const t = data?.totals;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-4">
        {[['Charged', t?.charged], ['Paid', t?.paid], ['Due', t?.due], ['Deposit balance', t?.depositBalance]].map(([l, v]) => (
          <Card key={l} className="p-4"><p className="text-sm text-muted">{l}</p><p className="mt-1 font-display text-2xl font-semibold">{v == null ? '—' : money(v)}</p></Card>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {can('billing.write') && <Button variant="outline" onClick={() => setDeposit(true)}><LuWallet aria-hidden /> Take deposit</Button>}
        {canPost && Number(a.dailyRate) > 0 && <Button variant="outline" loading={busy === 'bed'} onClick={async () => { setBusy('bed'); try { const r = await api.post(`/ipd/admissions/${a.id}/bed-charges`); notify.success(r.data.daysAdded ? `${r.data.daysAdded} bed day(s) added.` : 'Bed charges are up to date.'); reload(); } catch (e) { notify.error(e.message); } setBusy(null); }}><LuRefreshCw aria-hidden /> Update bed charges</Button>}
        {data?.bills?.map((b) => <Button key={b.id} variant="ghost" to={`/app/billing/${b.id}`}>{b.number || 'Draft bill'} · {titleCase(b.status)} →</Button>)}
      </div>
      {canPost && (
        <Card className="p-5">
          <h2 className="mb-3 font-display text-lg font-semibold">Add a charge</h2>
          <div className="grid gap-3 sm:grid-cols-6">
            <Select label="Service" className="sm:col-span-3" placeholder="Choose…" options={(catalogue || []).map((c) => ({ value: String(c.id), label: `${c.name} — ${money(c.price)}` }))} value={chargeId} onChange={(e) => setChargeId(e.target.value)} />
            <Input label="Qty" type="number" min="0.5" step="0.5" value={qty} onChange={(e) => setQty(e.target.value)} />
            <Input label="Note (optional)" className="sm:col-span-2" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {sel && Number(sel.price) === 0 && <p className="mt-2 text-xs text-gold-700">This service has no price yet — set it in Admissions & beds → Service charges.</p>}
          <Button className="mt-3" onClick={add} loading={busy === 'add'} disabled={!chargeId || !(Number(qty) > 0)}><LuPlus aria-hidden /> Add to bill</Button>
        </Card>
      )}
      <Card>
        {loading ? <Skeleton className="h-40 w-full" /> : !data?.items?.length ? <EmptyState icon={LuBedDouble} title="No charges yet">Bed charges are added automatically every day.</EmptyState> : (
          <div className="overflow-x-auto"><table className="table-base text-sm">
            <thead><tr><th>Date</th><th>Description</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">Amount</th></tr></thead>
            <tbody className="divide-y divide-line">
              {data.items.map((i) => <tr key={i.id}><td className="whitespace-nowrap">{i.chargeDate ? date(`${i.chargeDate}T00:00:00Z`, 'UTC') : date(i.createdAt)}</td><td>{i.description}</td><td className="text-right">{Number(i.quantity)}</td><td className="text-right">{money(i.unitPrice)}</td><td className="text-right font-medium">{money(i.amount)}</td></tr>)}
            </tbody>
          </table></div>
        )}
      </Card>
      <DepositModal open={deposit} patient={{ id: a.patientId, label: `${a.patientNumber} — ${fullName(a.patientFirstName, a.patientLastName)}` }} admissionId={a.id}
        onClose={() => setDeposit(false)} onDone={() => { setDeposit(false); reload(); }} />
    </div>
  );
}

// ---------- Discharge summary ----------
const blankRx = { medicineName: '', dosage: '', frequency: '', durationDays: '', instructions: '' };
const SUMMARY_FIELDS = [
  ['provisionalDiagnosis', 'Provisional diagnosis (at admission)', 1000], ['finalDiagnosis', 'Final diagnosis', 1000], ['presentingComplaints', 'Presenting complaints', 2000],
  ['courseInHospital', 'Course in hospital', 4000], ['proceduresDone', 'Procedures / surgery done', 2000], ['investigations', 'Key investigations', 2000],
  ['conditionAtDischarge', 'Condition at discharge', 500], ['advice', 'Advice on discharge', 2000],
];
function Summary({ a, reload: reloadAdmission }) {
  const { can } = useTenantAuth();
  const { data, meta, loading, reload } = useApi(() => api.get(`/ipd/admissions/${a.id}/discharge-summary`), [a.id]);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    if (!data) return;
    setF({ ...Object.fromEntries(SUMMARY_FIELDS.map(([k]) => [k, data[k] || ''])), followUpDate: data.followUpDate || '', dischargeType: data.dischargeType || 'regular',
      medications: (data.medications || []).map((m) => ({ ...blankRx, ...Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v ?? ''])) })) });
  }, [data]);
  if (loading || !f) return <Skeleton className="h-64 w-full" />;
  const locked = data.status === 'final' || !can('ipd.write');
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const setRx = (i, k, v) => setF((s) => ({ ...s, medications: s.medications.map((m, j) => (j === i ? { ...m, [k]: v } : m)) }));
  const save = async () => {
    setErr(null); setBusy('save');
    try {
      await api.put(`/ipd/admissions/${a.id}/discharge-summary`, { ...f, medications: f.medications.filter((m) => m.medicineName.trim()).map((m) => ({ ...m, durationDays: m.durationDays === '' ? null : Number(m.durationDays) })) });
      notify.success('Discharge summary saved.'); await reload(); return true;
    } catch (e) { setErr(e.details?.[0]?.message || e.message); return false; } finally { setBusy(null); }
  };
  const sign = async () => {
    if (!(await save())) return;
    if (!window.confirm('Sign the discharge summary? After signing it cannot be changed.')) return;
    setBusy('sign');
    try { await api.post(`/ipd/admissions/${a.id}/discharge-summary/finalize`); notify.success('Discharge summary signed.'); reload(); reloadAdmission(); } catch (e) { setErr(e.message); } finally { setBusy(null); }
  };
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge tone={data.status === 'final' ? 'green' : 'gold'}>{data.status === 'final' ? `Signed by ${data.finalizedBy} · ${dateTime(data.finalizedAt)}` : data.status === 'new' ? 'Not started' : 'Draft'}</Badge>
          {data.updatedAt && data.status !== 'final' && <span className="text-xs text-muted">Last saved {dateTime(data.updatedAt)} by {data.updatedBy}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" to={`/app/admissions/${a.id}/discharge-summary`}><LuPrinter aria-hidden /> Print</Button>
          {!locked && <Button variant="outline" onClick={save} loading={busy === 'save'}><LuSave aria-hidden /> Save draft</Button>}
          {!locked && can('ipd.discharge_summary') && <Button onClick={sign} loading={busy === 'sign'}><LuLock aria-hidden /> Sign</Button>}
        </div>
      </div>
      {err && <Alert tone="error">{err}</Alert>}
      {!locked && !can('ipd.discharge_summary') && <Alert tone="info">You can prepare the summary; a doctor signs it.</Alert>}
      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        {SUMMARY_FIELDS.map(([k, l]) => (
          <div key={k} className={['courseInHospital', 'investigations', 'advice', 'presentingComplaints'].includes(k) ? 'sm:col-span-2' : ''}>
            <Textarea label={l} required={['finalDiagnosis', 'conditionAtDischarge'].includes(k)} value={f[k]} onChange={set(k)} disabled={locked} />
            {k === 'investigations' && !locked && meta?.investigationsSuggestion && (
              <button type="button" className="mt-1 text-xs font-semibold text-forest-700 underline" onClick={() => setF((s) => ({ ...s, investigations: [s.investigations, meta.investigationsSuggestion].filter(Boolean).join('\n') }))}>Insert lab results from this stay ({meta.labCount})</button>
            )}
          </div>
        ))}
        <Select label="Type of discharge" value={f.dischargeType} onChange={set('dischargeType')} disabled={locked}
          options={[['regular', 'Regular'], ['lama', 'Left against medical advice (LAMA)'], ['referred', 'Referred to another hospital'], ['death', 'Death'], ['absconded', 'Absconded']].map(([value, label]) => ({ value, label }))} />
        <Input label="Follow-up date" type="date" value={f.followUpDate} onChange={set('followUpDate')} disabled={locked} />
      </Card>
      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Medicines on discharge</h2>
          {!locked && <Button size="sm" variant="outline" onClick={() => setF((s) => ({ ...s, medications: [...s.medications, { ...blankRx }] }))}><LuPlus aria-hidden /> Add medicine</Button>}
        </div>
        {f.medications.length === 0 && <p className="text-sm text-muted">None.</p>}
        <div className="space-y-3">
          {f.medications.map((rx, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-line p-3 sm:grid-cols-12">
              <Input label="Medicine" className="col-span-2 sm:col-span-4" value={rx.medicineName} onChange={(e) => setRx(i, 'medicineName', e.target.value)} disabled={locked} />
              <Input label="Dose" className="sm:col-span-2" value={rx.dosage} onChange={(e) => setRx(i, 'dosage', e.target.value)} disabled={locked} />
              <Input label="Frequency" className="sm:col-span-2" value={rx.frequency} onChange={(e) => setRx(i, 'frequency', e.target.value)} disabled={locked} placeholder="1-0-1" />
              <Input label="Days" type="number" min="1" className="sm:col-span-1" value={rx.durationDays} onChange={(e) => setRx(i, 'durationDays', e.target.value)} disabled={locked} />
              <Input label="Instructions" className="col-span-2 sm:col-span-2" value={rx.instructions} onChange={(e) => setRx(i, 'instructions', e.target.value)} disabled={locked} />
              {!locked && <div className="flex items-end sm:col-span-1"><Button variant="ghost" size="sm" aria-label="Remove" onClick={() => setF((s) => ({ ...s, medications: s.medications.filter((_, j) => j !== i) }))}><LuTrash2 aria-hidden /></Button></div>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
