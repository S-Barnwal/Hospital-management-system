// Front desk (Phase 4): appointment calendar, online booking requests, token queue and TV display screens.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  LuChevronLeft, LuChevronRight, LuPlus, LuCheck, LuX, LuMegaphone, LuSkipForward, LuRotateCcw, LuTicket, LuPrinter, LuMonitor, LuCopy, LuTrash2,
  LuUserPlus, LuStar, LuCircleCheck,
} from 'react-icons/lu';
import { api, qs } from '../../lib/api.js';
import { useApi } from '../../lib/hooks.js';
import { useTenantAuth } from '../../context/AuthContext.jsx';
import { notify, withToast } from '../../lib/toast.js';
import { dateTime, fullName, relative, time, todayIn, titleCase } from '../../lib/format.js';
import { Alert, Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Skeleton, StatusBadge, Textarea, cx } from '../../components/ui.jsx';
import { PatientPicker } from '../../components/Pickers.jsx';
import { formatPhone } from '../../lib/contact.js';

// ---------- Calendar ----------
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const weekStart = (ymd) => addDays(ymd, -((new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7)); // Monday
const dayLabel = (ymd, opts) => new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', ...opts }).format(new Date(`${ymd}T00:00:00Z`));
const localYmd = (iso, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

export function AppointmentCalendar({ doctors, onBook, refreshKey, canBook }) {
  const { me } = useTenantAuth();
  const tz = me.tenant.timezone;
  const today = todayIn(tz);
  const [mode, setMode] = useState(() => (typeof window !== 'undefined' && window.innerWidth < 640 ? 'day' : 'week'));
  const [anchor, setAnchor] = useState(today);
  const [doctorId, setDoctorId] = useState('');
  const days = useMemo(() => {
    if (mode === 'day') return [anchor];
    if (mode === 'week') { const s = weekStart(anchor); return Array.from({ length: 7 }, (_, i) => addDays(s, i)); }
    const first = `${anchor.slice(0, 8)}01`;
    const s = weekStart(first);
    return Array.from({ length: 42 }, (_, i) => addDays(s, i));
  }, [mode, anchor]);
  const { data, loading, error } = useApi(() => api.get(`/appointments/calendar${qs({ from: days[0], to: days[days.length - 1], doctorId })}`), [days[0], days.length, doctorId, refreshKey]);
  const byDay = useMemo(() => {
    const m = new Map(days.map((d) => [d, []]));
    for (const a of data || []) m.get(localYmd(a.startAt, tz))?.push(a);
    return m;
  }, [data, days, tz]);
  const step = (dir) => setAnchor((a) => (mode === 'day' ? addDays(a, dir) : mode === 'week' ? addDays(a, 7 * dir) : (() => {
    const d = new Date(`${a.slice(0, 8)}01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + dir); return d.toISOString().slice(0, 10);
  })()));
  const title = mode === 'month' ? dayLabel(`${anchor.slice(0, 8)}01`, { month: 'long', year: 'numeric' })
    : mode === 'week' ? `${dayLabel(days[0], { day: 'numeric', month: 'short' })} – ${dayLabel(days[6], { day: 'numeric', month: 'short', year: 'numeric' })}`
      : dayLabel(anchor, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const Item = ({ a, compact }) => (
    <li className={cx('rounded-md border-l-4 bg-white px-2 py-1 text-xs shadow-sm', { scheduled: 'border-sky-500', checked_in: 'border-gold-500', completed: 'border-forest-600', cancelled: 'border-red-400 opacity-60', no_show: 'border-slate-400 opacity-60' }[a.status])}>
      <p className="font-semibold">{time(a.startAt, tz)} {compact ? '' : `· ${a.doctorName}`}</p>
      <p className="truncate">{fullName(a.patientFirstName, a.patientLastName)}</p>
      {!compact && <p className="truncate text-muted">{a.reason || titleCase(a.visitType)}</p>}
    </li>
  );
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => step(-1)} aria-label="Previous"><LuChevronLeft aria-hidden /></Button>
          <Button size="sm" variant="outline" onClick={() => setAnchor(today)}>Today</Button>
          <Button size="sm" variant="ghost" onClick={() => step(1)} aria-label="Next"><LuChevronRight aria-hidden /></Button>
        </div>
        <p className="min-w-0 flex-1 truncate font-display text-lg font-semibold">{title}</p>
        <select className="input w-auto" value={doctorId} onChange={(e) => setDoctorId(e.target.value)} aria-label="Doctor">
          <option value="">All doctors</option>{doctors.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}</select>
        <div className="flex rounded-lg border border-line p-0.5" role="tablist">
          {['day', 'week', 'month'].map((m) => <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={cx('rounded-md px-3 py-1 text-sm font-semibold capitalize', mode === m ? 'bg-forest-900 text-white' : 'text-forest-800')}>{m}</button>)}
        </div>
      </div>
      {error && <Alert tone="error" className="m-3">{error.message}</Alert>}
      {loading && !data ? <Skeleton className="m-3 h-72" /> : mode === 'month' ? (
        <div className="grid grid-cols-7 text-xs">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="border-b border-line px-2 py-1 font-semibold text-muted">{d}</div>)}
          {days.map((d) => {
            const list = byDay.get(d) || [];
            const other = d.slice(0, 7) !== anchor.slice(0, 7);
            return (
              <button key={d} type="button" onClick={() => { setAnchor(d); setMode('day'); }} className={cx('min-h-20 border-b border-r border-line p-1 text-left align-top hover:bg-forest-50', other && 'bg-slate-50/60 text-muted', d === today && 'ring-2 ring-inset ring-gold-400')}>
                <span className="font-semibold">{Number(d.slice(8))}</span>
                {list.length > 0 && <span className="mt-1 block rounded bg-forest-100 px-1 text-[11px] font-semibold text-forest-900">{list.length} appt{list.length > 1 ? 's' : ''}</span>}
              </button>
            );
          })}
        </div>
      ) : (
        <div className={cx('grid divide-x divide-line', mode === 'week' ? 'grid-cols-1 sm:grid-cols-7' : 'grid-cols-1')}>
          {days.map((d) => {
            const list = byDay.get(d) || [];
            return (
              <section key={d} className={cx('min-h-40 p-2', d === today && 'bg-gold-50/40')} aria-label={dayLabel(d, { weekday: 'long', day: 'numeric', month: 'long' })}>
                <div className="mb-2 flex items-center justify-between">
                  <button type="button" className="text-left text-sm font-semibold hover:underline" onClick={() => { setAnchor(d); setMode('day'); }}>{dayLabel(d, { weekday: 'short', day: 'numeric', month: 'short' })}</button>
                  {canBook && d >= today && <button type="button" className="rounded p-1 text-forest-700 hover:bg-forest-50" onClick={() => onBook(d)} aria-label={`Book on ${d}`}><LuPlus aria-hidden /></button>}
                </div>
                {list.length ? <ul className="space-y-1">{list.map((a) => <Item key={a.id} a={a} compact={mode === 'week'} />)}</ul> : <p className="text-xs text-muted">—</p>}
              </section>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ---------- Online booking requests ----------
function ConfirmRequest({ req: r, onClose, onDone }) {
  const { data: matches, loading } = useApi(() => api.get(`/booking/requests/${r.id}/matches`), [r.id]);
  const [choice, setChoice] = useState('new');
  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState(false);
  const patientId = choice === 'new' ? null : choice === 'search' ? picked?.id : Number(choice);
  const confirm = async () => {
    setBusy(true);
    const out = await withToast(() => api.post(`/booking/requests/${r.id}/confirm`, { patientId: patientId ?? null }), null);
    setBusy(false);
    if (out) { notify.success(`Booked as ${out.data.appointmentNumber}.`); onDone(); }
  };
  return (
    <Modal open onClose={onClose} title={`Confirm request ${r.ref}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={confirm} loading={busy} disabled={choice === 'search' && !picked}><LuCheck aria-hidden /> Confirm appointment</Button></>}>
      <p className="mb-3 text-sm"><strong>{r.patientName}</strong> · {formatPhone(r.phone)} · {r.doctorName} · {dateTime(r.startAt)}</p>
      <fieldset className="space-y-2 text-sm">
        <legend className="label">Who is this patient?</legend>
        {loading ? <Skeleton className="h-10" /> : (matches || []).map((p) => (
          <label key={p.id} className="flex items-center gap-2 rounded-lg border border-line p-2"><input type="radio" name="who" className="accent-forest-800" checked={choice === String(p.id)} onChange={() => setChoice(String(p.id))} />
            Existing: <span className="font-mono text-xs">{p.patientNumber}</span> {fullName(p.firstName, p.lastName)}</label>
        ))}
        <label className="flex items-center gap-2 rounded-lg border border-line p-2"><input type="radio" name="who" className="accent-forest-800" checked={choice === 'new'} onChange={() => setChoice('new')} />
          <LuUserPlus aria-hidden /> Register as a new patient</label>
        <label className="flex items-center gap-2 rounded-lg border border-line p-2"><input type="radio" name="who" className="accent-forest-800" checked={choice === 'search'} onChange={() => setChoice('search')} /> Find another patient…</label>
        {choice === 'search' && <PatientPicker value={picked} onChange={setPicked} />}
      </fieldset>
      <p className="mt-3 text-xs text-muted">Same phone number does not always mean the same person (families share phones) — check the name before linking.</p>
    </Modal>
  );
}

export function OnlineRequests() {
  const { me, can } = useTenantAuth();
  const [status, setStatus] = useState('pending');
  const { data, meta, loading, error, reload } = useApi(() => api.get(`/booking/requests${qs({ status })}`), [status]);
  const [confirming, setConfirming] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [note, setNote] = useState('');
  const link = `${window.location.origin}/book/${me.tenant.slug}`;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          {['pending', 'confirmed', 'rejected', 'cancelled', ''].map((s) => <option key={s} value={s}>{s ? `${titleCase(s)} (${meta?.counts?.[s] ?? 0})` : 'All'}</option>)}</select>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Public booking page:</span>
          <a href={link} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-forest-800 underline">{link}</a>
          <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard?.writeText(link); notify.success('Link copied.'); }} aria-label="Copy link"><LuCopy aria-hidden /></Button>
        </div>
      </div>
      {!me.tenant.bookingEnabled && <Alert tone="info" className="m-4">Online booking is switched off. Turn it on in <Link className="underline" to="/app/settings">Settings → Online booking</Link>.</Alert>}
      {error && <Alert tone="error" className="m-4">{error.message}</Alert>}
      {loading ? <Skeleton className="m-4 h-32" /> : !data?.length ? <EmptyState title="No requests" /> : (
        <ul className="divide-y divide-line">
          {data.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="font-semibold">{r.patientName} <span className="font-mono text-xs text-muted">{r.ref}</span></p>
                <p className="text-sm">{r.doctorName} · <strong>{dateTime(r.startAt, me.tenant.timezone)}</strong></p>
                <p className="text-xs text-muted">{[formatPhone(r.phone), r.email, r.gender && titleCase(r.gender), r.age != null && `${r.age} y`].filter(Boolean).join(' · ')}</p>
                {r.reason && <p className="mt-1 text-sm">“{r.reason}”</p>}
                <p className="mt-1 text-xs text-muted">Requested {relative(r.createdAt)}{r.decidedBy ? ` · ${r.status} by ${r.decidedBy}` : ''}{r.appointmentNumber ? ` · ${r.appointmentNumber}` : ''}{r.decisionNote ? ` · ${r.decisionNote}` : ''}</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={r.status} />
                {r.status === 'pending' && can('appointments.write') && <>
                  {can('patients.write') && <Button size="sm" onClick={() => setConfirming(r)}><LuCheck aria-hidden /> Confirm</Button>}
                  <Button size="sm" variant="ghost" onClick={() => { setNote(''); setRejecting(r); }}><LuX aria-hidden /> Decline</Button>
                </>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {confirming && <ConfirmRequest req={confirming} onClose={() => setConfirming(null)} onDone={() => { setConfirming(null); reload(); }} />}
      {rejecting && (
        <Modal open size="sm" onClose={() => setRejecting(null)} title={`Decline ${rejecting.ref}`}
          footer={<><Button variant="ghost" onClick={() => setRejecting(null)}>Keep</Button><Button variant="danger" disabled={note.trim().length < 3}
            onClick={async () => { if (await withToast(() => api.post(`/booking/requests/${rejecting.id}/reject`, { note: note.trim() }), 'Request declined.')) { setRejecting(null); reload(); } }}>Decline</Button></>}>
          <Textarea label="Reason (e-mailed to the patient if they gave an e-mail)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Doctor on leave that day — please call to rebook." />
        </Modal>
      )}
    </Card>
  );
}

// ---------- Token queue ----------
/** Prints only the token slip (thermal-printer friendly), not the page behind the dialog. */
function printSlip() {
  document.body.classList.add('printing-slip');
  const done = () => { document.body.classList.remove('printing-slip'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
  setTimeout(done, 1000);
}

function TokenSlip({ token, onClose }) {
  const { me } = useTenantAuth();
  return (
    <Modal open size="sm" onClose={onClose} title="Token issued" footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button onClick={printSlip}><LuPrinter aria-hidden /> Print slip</Button></>}>
      <div className="token-slip mx-auto max-w-[260px] rounded-lg border-2 border-dashed border-forest-300 p-4 text-center print:border-0">
        <p className="text-sm font-semibold">{me.tenant.name}</p>
        <p className="mt-2 text-xs uppercase tracking-widest text-muted">{token.label}</p>
        <p className="font-display text-6xl font-bold text-forest-900">{token.number}</p>
        {token.room && <p className="text-sm">Room {token.room}</p>}
        <p className="mt-2 text-xs text-muted">{new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: me.tenant.timezone }).format(new Date())}</p>
        <p className="mt-1 text-[11px] text-muted">Please wait for your number on the screen.</p>
      </div>
    </Modal>
  );
}

function IssueToken({ queues, onIssued }) {
  const [key, setKey] = useState('');
  const [patient, setPatient] = useState(null);
  const [priority, setPriority] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!key && queues.length) setKey(queues[0].key); }, [queues, key]);
  const issue = async () => {
    setBusy(true);
    const r = await withToast(() => api.post('/queue/tokens', { queueKey: key, patientId: patient?.id ?? null, priority }), null);
    setBusy(false);
    if (r) { const q = queues.find((x) => x.key === key); onIssued({ ...r.data, label: q?.label, room: q?.room }); setPatient(null); setPriority(false); }
  };
  return (
    <Card className="p-4">
      <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold"><LuTicket aria-hidden /> New token</h2>
      <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr_auto_auto] sm:items-end">
        <Select label="Queue" value={key} onChange={(e) => setKey(e.target.value)} options={queues.map((q) => ({ value: q.key, label: q.isDoctor ? `${q.label}${q.room ? ` · Room ${q.room}` : ''}` : q.label }))} />
        <PatientPicker value={patient} onChange={setPatient} label="Patient (optional)" required={false} />
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" className="accent-forest-800" checked={priority} onChange={(e) => setPriority(e.target.checked)} /> <LuStar aria-hidden /> Priority</label>
        <Button onClick={issue} loading={busy} disabled={!key}><LuPlus aria-hidden /> Issue token</Button>
      </div>
      <p className="mt-2 text-xs text-muted">Checking a patient in from Appointments gives them a token automatically. Priority = senior citizen, pregnant, emergency — called before others.</p>
    </Card>
  );
}

function QueueCard({ q, onChanged }) {
  const [counter, setCounter] = useState(() => { try { return localStorage.getItem(`queue.counter.${q.key}`) || ''; } catch { return ''; } });
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const saveCounter = (v) => { setCounter(v); try { localStorage.setItem(`queue.counter.${q.key}`, v); } catch { /* private mode */ } };
  const callNext = async () => {
    setBusy(true);
    const r = await withToast(() => api.post('/queue/call-next', { queueKey: q.key, ...(counter.trim() ? { counter: counter.trim() } : {}) }), null);
    setBusy(false);
    if (r) { notify[r.data ? 'success' : 'info'](r.data ? `Token ${r.data.number} called.` : 'No one is waiting.'); onChanged(); }
  };
  const act = async (t, status) => { if (await withToast(() => api.post(`/queue/tokens/${t.id}/status`, { status, ...(status === 'called' && counter.trim() ? { counter: counter.trim() } : {}) }), null)) onChanged(); };
  const visible = q.tokens.filter((t) => showAll || ['waiting', 'called', 'skipped'].includes(t.status));
  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-2 border-b border-line p-4">
        <div className="min-w-0"><h3 className="truncate font-semibold">{q.label}</h3><p className="text-xs text-muted">{q.waiting} waiting · {q.done} done{q.estimatedWaitMinutes ? ` · ~${q.estimatedWaitMinutes} min for the last` : ''}</p></div>
        <div className="text-right"><p className="text-[11px] uppercase tracking-widest text-muted">Now</p><p className="font-display text-3xl font-bold text-forest-900">{q.current?.number ?? '—'}</p></div>
      </div>
      <div className="flex flex-wrap items-end gap-2 p-4">
        <Input label={q.isDoctor ? 'Room' : 'Counter'} className="w-28" value={counter} onChange={(e) => saveCounter(e.target.value)} placeholder={q.room || '1'} />
        <Button className="flex-1" onClick={callNext} loading={busy}><LuMegaphone aria-hidden /> Call next</Button>
      </div>
      <ul className="max-h-72 flex-1 divide-y divide-line overflow-y-auto border-t border-line text-sm">
        {visible.length === 0 && <li className="px-4 py-3 text-muted">No tokens yet today.</li>}
        {visible.map((t) => (
          <li key={t.id} className={cx('flex items-center gap-2 px-4 py-2', t.status === 'called' && 'bg-gold-50')}>
            <span className="w-10 font-mono text-base font-bold">{t.tokenNumber}</span>
            <span className="min-w-0 flex-1 truncate">{t.patientId ? fullName(t.firstName, t.lastName) : <span className="text-muted">Walk-in</span>}{t.priority && <LuStar className="ml-1 inline text-gold-600" aria-label="priority" />}</span>
            <StatusBadge status={t.status} />
            <span className="flex">
              {t.status === 'called' && <><button className="rounded p-1 hover:bg-forest-50" title="Call again" aria-label="Call again" onClick={() => act(t, 'called')}><LuRotateCcw /></button>
                <button className="rounded p-1 hover:bg-forest-50" title="Done" aria-label="Done" onClick={() => act(t, 'done')}><LuCircleCheck /></button>
                <button className="rounded p-1 hover:bg-forest-50" title="Not here — skip" aria-label="Skip" onClick={() => act(t, 'skipped')}><LuSkipForward /></button></>}
              {t.status === 'skipped' && <button className="rounded p-1 text-xs font-semibold text-forest-700 hover:bg-forest-50" onClick={() => act(t, 'waiting')}>Back to queue</button>}
              {t.status === 'waiting' && <button className="rounded p-1 hover:bg-forest-50" title="Call this token now" aria-label="Call now" onClick={() => act(t, 'called')}><LuMegaphone /></button>}
            </span>
          </li>
        ))}
      </ul>
      <button type="button" className="border-t border-line px-4 py-2 text-left text-xs font-semibold text-forest-700" onClick={() => setShowAll((x) => !x)}>{showAll ? 'Hide finished tokens' : 'Show finished tokens'}</button>
    </Card>
  );
}

function Screens({ queues }) {
  const { can } = useTenantAuth();
  const { data, reload } = useApi(() => api.get('/queue/screens'), []);
  const [form, setForm] = useState(null);
  const [created, setCreated] = useState(null);
  const canManage = can('settings.manage');
  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold"><LuMonitor aria-hidden /> TV display screens</h2>
        {canManage && <Button size="sm" variant="outline" onClick={() => setForm({ name: 'Waiting hall', keys: [] })}><LuPlus aria-hidden /> Add screen</Button>}
      </div>
      <p className="mb-3 text-sm text-muted">Open the screen's link on a smart TV or any browser in full-screen. It shows token numbers and rooms only — never patient names — and announces each call.</p>
      {!data?.length ? <p className="text-sm text-muted">No screens yet.</p> : (
        <ul className="divide-y divide-line text-sm">
          {data.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span><strong>{s.name}</strong> <span className="text-muted">· {s.queueKeys.length ? s.queueKeys.map((k) => queues.find((q) => q.key === k)?.label || k).join(', ') : 'all queues'} · {s.lastSeenAt ? `seen ${relative(s.lastSeenAt)}` : 'never opened'}</span></span>
              {canManage && <Button size="sm" variant="ghost" aria-label={`Remove ${s.name}`} onClick={async () => { if (window.confirm(`Remove "${s.name}"? Its link stops working immediately.`) && await withToast(() => api.del(`/queue/screens/${s.id}`), 'Screen removed.')) reload(); }}><LuTrash2 aria-hidden /></Button>}
            </li>
          ))}
        </ul>
      )}
      {form && (
        <Modal open onClose={() => setForm(null)} title="Add display screen"
          footer={<><Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button><Button disabled={form.name.trim().length < 2} onClick={async () => {
            const r = await withToast(() => api.post('/queue/screens', { name: form.name.trim(), queueKeys: form.keys }), null);
            if (r) { setForm(null); setCreated(r.data.url); reload(); }
          }}>Create</Button></>}>
          <div className="space-y-3">
            <Input label="Screen name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            <fieldset><legend className="label">Queues on this screen (none = all)</legend>
              <div className="grid gap-1 sm:grid-cols-2">{queues.map((q) => (
                <label key={q.key} className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-forest-800" checked={form.keys.includes(q.key)}
                  onChange={(e) => setForm((f) => ({ ...f, keys: e.target.checked ? [...f.keys, q.key] : f.keys.filter((k) => k !== q.key) }))} />{q.label}</label>))}</div>
            </fieldset>
          </div>
        </Modal>
      )}
      {created && (
        <Modal open onClose={() => setCreated(null)} title="Screen link" footer={<Button onClick={() => setCreated(null)}>Done</Button>}>
          <Alert tone="warning" className="mb-3">Copy this link now — for security it is shown only once. Anyone with it can see the token numbers.</Alert>
          <div className="flex gap-2"><input className="input font-mono text-xs" readOnly value={created} onFocus={(e) => e.target.select()} aria-label="Screen link" />
            <Button onClick={() => { navigator.clipboard?.writeText(created); notify.success('Link copied.'); }}><LuCopy aria-hidden /> Copy</Button></div>
        </Modal>
      )}
    </Card>
  );
}

export default function Queue() {
  const { can } = useTenantAuth();
  const { data, loading, error, reload } = useApi(() => api.get('/queue/board'), []);
  const [slip, setSlip] = useState(null);
  const [filter, setFilter] = useState('active');
  useEffect(() => { const t = setInterval(reload, 10000); return () => clearInterval(t); }, [reload]);
  const queues = data?.queues || [];
  const shown = filter === 'all' ? queues : queues.filter((q) => q.tokens.length || q.waiting);
  return (
    <>
      <PageHeader title="Token queue" subtitle="Issue tokens, call the next patient and show the queue on a TV. Numbers restart every day."
        actions={<Link to="/app/appointments" className="text-sm font-semibold text-forest-700 underline">Appointments</Link>} />
      {error && <Alert tone="error" className="mb-4">{error.message}</Alert>}
      {can('queue.manage') && !loading && <IssueToken queues={queues} onIssued={(t) => { setSlip(t); reload(); }} />}
      <div className="my-4 flex items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold">Queues today</h2>
        <select className="input w-auto" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Show"><option value="active">With tokens</option><option value="all">All queues</option></select>
      </div>
      {loading ? <Skeleton className="h-64" /> : !shown.length ? <EmptyState icon={LuTicket} title="No tokens yet today">Issue a token above or check a patient in.</EmptyState> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{shown.map((q) => <QueueCard key={q.key} q={q} onChanged={reload} />)}</div>
      )}
      {can('queue.manage') && <div className="mt-6"><Screens queues={queues} /></div>}
      {slip && <TokenSlip token={slip} onClose={() => setSlip(null)} />}
    </>
  );
}
