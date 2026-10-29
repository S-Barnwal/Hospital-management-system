import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { LuPlus, LuStethoscope, LuArrowLeft, LuPrinter, LuLock, LuTrash2, LuFlaskConical, LuSave } from 'react-icons/lu';
import { api, qs } from '../../lib/api.js';
import { useApi, useDebounced } from '../../lib/hooks.js';
import { useTenantAuth } from '../../context/AuthContext.jsx';
import { notify, withToast } from '../../lib/toast.js';
import { age, date, dateTime, fullName, titleCase, todayIn } from '../../lib/format.js';
import { Alert, Badge, Button, Card, DataTable, EmptyState, Input, Modal, PageHeader, Pagination, Select, Skeleton, StatusBadge, Textarea } from '../../components/ui.jsx';
import { PatientPicker, DoctorSelect } from '../../components/Pickers.jsx';
import { LabOrderModal } from './Lab.jsx';

function NewConsultation({ open, onClose, preset }) {
  const navigate = useNavigate();
  const [patient, setPatient] = useState(null);
  const [doctorId, setDoctorId] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setPatient(preset?.patient ?? null); setDoctorId(preset?.doctorId ? String(preset.doctorId) : ''); setError(null); } }, [open, preset]);
  const start = async () => {
    setError(null);
    if (!patient || !doctorId) { setError('Choose a patient and a doctor.'); return; }
    setBusy(true);
    try {
      const r = await api.post('/opd/consultations', { patientId: patient.id, doctorId: Number(doctorId), ...(preset?.appointmentId ? { appointmentId: preset.appointmentId } : {}) });
      navigate(`/app/opd/${r.data.id}`);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Start consultation" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={start} loading={busy}>Start</Button></>}>
      <div className="space-y-4">
        <PatientPicker value={patient} onChange={setPatient} />
        <DoctorSelect value={doctorId} onChange={setDoctorId} required />
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  );
}

export default function Opd() {
  const { me, can } = useTenantAuth();
  const tz = me.tenant.timezone;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState({ date: todayIn(tz), status: '', q: '' });
  const [page, setPage] = useState(1);
  const q = useDebounced(filters.q);
  useEffect(() => setPage(1), [filters.date, filters.status, q]);
  const { data, meta, loading, error } = useApi(() => api.get(`/opd/consultations${qs({ date: filters.date, status: filters.status, q, page })}`), [filters.date, filters.status, q, page]);
  const { data: todays } = useApi(() => api.get(`/appointments${qs({ date: todayIn(tz), pageSize: 50 })}`), []);
  const waiting = (todays || []).filter((a) => ['scheduled', 'checked_in'].includes(a.status));
  const [preset, setPreset] = useState(null);

  return (
    <>
      <PageHeader title="OPD" subtitle="Consultations, vitals, diagnosis and prescriptions."
        actions={can('opd.write') && <Button onClick={() => { setPreset(null); setParams({ new: '1' }); }}><LuPlus aria-hidden /> New consultation</Button>} />

      {can('opd.write') && waiting.length > 0 && (
        <Card className="mb-6 p-4">
          <h2 className="mb-3 text-sm font-semibold text-forest-950">Today’s queue ({waiting.length})</h2>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {waiting.map((a) => (
              <button key={a.id} onClick={() => { setPreset({ patient: { id: a.patientId, label: `${a.patientNumber} — ${fullName(a.patientFirstName, a.patientLastName)}` }, doctorId: a.doctorId, appointmentId: a.id }); setParams({ new: '1' }); }}
                className="min-w-48 shrink-0 rounded-lg border border-line bg-white p-3 text-left text-sm hover:border-forest-300 hover:bg-forest-50">
                <p className="font-semibold text-ink">{fullName(a.patientFirstName, a.patientLastName)}</p>
                <p className="text-xs text-muted">{new Intl.DateTimeFormat('en-IN', { timeStyle: 'short', timeZone: tz }).format(new Date(a.startAt))} · {a.doctorName}</p>
                <div className="mt-1"><StatusBadge status={a.status} /></div>
              </button>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-3">
          <Input label="Date" type="date" value={filters.date} onChange={(e) => setFilters((s) => ({ ...s, date: e.target.value }))} />
          <Select label="Status" placeholder="Any" value={filters.status} onChange={(e) => setFilters((s) => ({ ...s, status: e.target.value }))}
            options={[{ value: 'draft', label: 'Draft' }, { value: 'final', label: 'Final' }]} />
          <Input label="Search" placeholder="Patient, number or diagnosis" value={filters.q} onChange={(e) => setFilters((s) => ({ ...s, q: e.target.value }))} />
        </div>
        <DataTable loading={loading} error={error} rows={data} onRowClick={(c) => navigate(`/app/opd/${c.id}`)}
          empty={<EmptyState icon={LuStethoscope} title="No consultations" action={filters.date && <Button variant="outline" onClick={() => setFilters((s) => ({ ...s, date: '' }))}>Show all dates</Button>}>Nothing for this filter.</EmptyState>}
          columns={[
            { key: 'number', label: 'No.', render: (c) => <span className="font-mono text-xs">{c.number}</span> },
            { key: 'createdAt', label: 'When', render: (c) => dateTime(c.createdAt, tz) },
            { key: 'patient', label: 'Patient', render: (c) => <div><p className="font-medium text-ink">{fullName(c.patientFirstName, c.patientLastName)}</p><p className="font-mono text-xs text-muted">{c.patientNumber}</p></div> },
            { key: 'doctorName', label: 'Doctor' },
            { key: 'diagnosis', label: 'Diagnosis', render: (c) => <span className="line-clamp-1 max-w-xs">{c.diagnosis || c.chiefComplaint || '—'}</span> },
            { key: 'status', label: 'Status', render: (c) => <Badge tone={c.status === 'final' ? 'green' : 'gold'}>{c.status}</Badge> },
          ]} />
        <Pagination meta={meta} onPage={setPage} />
      </Card>
      <NewConsultation open={params.get('new') === '1'} preset={preset} onClose={() => setParams({})} />
    </>
  );
}

const VITALS = [
  ['temperatureC', 'Temp (°C)', '0.1'], ['pulseBpm', 'Pulse (bpm)', '1'], ['bpSystolic', 'BP systolic', '1'], ['bpDiastolic', 'BP diastolic', '1'],
  ['respiratoryRate', 'Resp. rate', '1'], ['spo2', 'SpO₂ (%)', '1'], ['weightKg', 'Weight (kg)', '0.1'], ['heightCm', 'Height (cm)', '0.1'],
];
const blankRx = { medicineName: '', dosage: '', frequency: '', durationDays: '', instructions: '' };

export function ConsultationDetail() {
  const { id } = useParams();
  const { me, can, hasFeature } = useTenantAuth();
  const navigate = useNavigate();
  const tz = me.tenant.timezone;
  const { data: c, loading, error, reload } = useApi(() => api.get(`/opd/consultations/${id}`), [id]);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(null);
  const [labOpen, setLabOpen] = useState(false);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [charge, setCharge] = useState(true);

  useEffect(() => {
    if (!c) return;
    setForm({
      chiefComplaint: c.chiefComplaint || '', symptoms: c.symptoms || '', examination: c.examination || '', diagnosis: c.diagnosis || '', advice: c.advice || '',
      followUpDate: c.followUpDate || '', vitals: Object.fromEntries(VITALS.map(([k]) => [k, c.vitals[k] ?? ''])),
      prescriptions: c.prescriptions.length ? c.prescriptions.map((p) => ({ ...blankRx, ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v ?? ''])) })) : [],
    });
  }, [c]);

  if (error) return <Alert tone="error">{error.status === 404 ? 'Consultation not found.' : error.message}</Alert>;
  if (loading && !c) return <Card className="p-6"><Skeleton className="h-64 w-full" /></Card>;
  if (!form) return null;
  const locked = c.status === 'final' || !can('opd.write');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setV = (k) => (e) => setForm((f) => ({ ...f, vitals: { ...f.vitals, [k]: e.target.value } }));
  const setRx = (i, k, v) => setForm((f) => ({ ...f, prescriptions: f.prescriptions.map((p, j) => (j === i ? { ...p, [k]: v } : p)) }));

  const save = async () => {
    setBusy('save');
    try {
      await api.put(`/opd/consultations/${id}`, { ...form, prescriptions: form.prescriptions.filter((p) => p.medicineName.trim()) });
      notify.success('Saved. Previous version kept in history.');
      await reload();
      return true;
    } catch (e) { notify.error(e.message); return false; } finally { setBusy(null); }
  };
  const finalize = async () => {
    if (!(await save())) return;
    setBusy('final');
    try {
      const r = await api.post(`/opd/consultations/${id}/finalize`, { chargeConsultation: charge });
      setFinalizeOpen(false);
      notify.success(r.data.billId ? 'Finalised and consultation fee added to the patient’s draft bill.' : 'Consultation finalised.');
      reload();
    } catch (e) { notify.error(e.message); setFinalizeOpen(false); } finally { setBusy(null); }
  };

  const p = c.patient;
  return (
    <>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link to="/app/opd" className="flex items-center gap-1 text-sm font-medium text-forest-700"><LuArrowLeft aria-hidden /> OPD</Link>
        <div className="flex flex-wrap gap-2">
          {hasFeature('laboratory') && can('lab.write') && <Button variant="outline" onClick={() => setLabOpen(true)}><LuFlaskConical aria-hidden /> Order lab tests</Button>}
          <Button variant="outline" onClick={() => window.print()}><LuPrinter aria-hidden /> Print</Button>
          {!locked && <Button variant="outline" onClick={save} loading={busy === 'save'}><LuSave aria-hidden /> Save draft</Button>}
          {!locked && <Button onClick={() => setFinalizeOpen(true)}><LuLock aria-hidden /> Finalise</Button>}
          {!locked && <Button variant="ghost" aria-label="Discard draft" onClick={async () => { if (window.confirm('Discard this draft consultation? This cannot be undone.') && (await withToast(() => api.del(`/opd/consultations/${id}`), 'Draft discarded.'))) navigate('/app/opd'); }}><LuTrash2 aria-hidden /></Button>}
        </div>
      </div>

      <div className="mb-6 hidden print:block">
        <p className="font-display text-2xl font-semibold">{me.tenant.name}</p>
        <p className="text-sm">{c.doctor.name}{c.doctor.specialization ? ` · ${c.doctor.specialization}` : ''}{c.doctor.registrationNumber ? ` · Reg. ${c.doctor.registrationNumber}` : ''}</p>
        <hr className="my-3" />
      </div>

      <PageHeader eyebrow={`${c.number} · ${dateTime(c.createdAt, tz)}`} title={fullName(p.firstName, p.lastName)}
        subtitle={`${p.patientNumber} · ${[p.gender && titleCase(p.gender), p.dateOfBirth && `${age(p.dateOfBirth)} yrs`, p.bloodGroup].filter(Boolean).join(' · ')} · ${c.doctor.name}`} />
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <Badge tone={c.status === 'final' ? 'green' : 'gold'}>{c.status === 'final' ? `Final · ${dateTime(c.finalizedAt, tz)}` : 'Draft'}</Badge>
        <span className="text-xs text-muted">Version {c.version}{c.versions.length ? ` · ${c.versions.length} earlier version(s) kept` : ''}</span>
      </div>
      {c.status === 'final' && <Alert tone="info" className="mb-4 print:hidden">This record is finalised and locked against changes.</Alert>}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card className="p-5">
            <h2 className="mb-4 font-display text-lg font-semibold">Vitals</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {VITALS.map(([k, l, step]) => <Input key={k} label={l} type="number" step={step} inputMode="decimal" value={form.vitals[k]} onChange={setV(k)} disabled={locked} />)}
            </div>
          </Card>
          <Card className="space-y-4 p-5">
            <h2 className="font-display text-lg font-semibold">Clinical notes</h2>
            <Input label="Chief complaint" value={form.chiefComplaint} onChange={set('chiefComplaint')} disabled={locked} />
            <Textarea label="Symptoms / history" value={form.symptoms} onChange={set('symptoms')} disabled={locked} />
            <Textarea label="Examination findings" value={form.examination} onChange={set('examination')} disabled={locked} />
            <Textarea label="Diagnosis" value={form.diagnosis} onChange={set('diagnosis')} disabled={locked} hint="Recorded by the treating doctor. The software does not suggest diagnoses." />
          </Card>
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">℞ Prescription</h2>
              {!locked && <Button size="sm" variant="outline" onClick={() => setForm((f) => ({ ...f, prescriptions: [...f.prescriptions, { ...blankRx }] }))}><LuPlus aria-hidden /> Add medicine</Button>}
            </div>
            {form.prescriptions.length === 0 && <p className="text-sm text-muted">No medicines prescribed.</p>}
            <div className="space-y-3">
              {form.prescriptions.map((rx, i) => (
                <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-line p-3 sm:grid-cols-12">
                  <Input label="Medicine" className="col-span-2 sm:col-span-4" value={rx.medicineName} onChange={(e) => setRx(i, 'medicineName', e.target.value)} disabled={locked} />
                  <Input label="Dose" className="sm:col-span-2" value={rx.dosage} onChange={(e) => setRx(i, 'dosage', e.target.value)} disabled={locked} placeholder="1 tab" />
                  <Input label="Frequency" className="sm:col-span-2" value={rx.frequency} onChange={(e) => setRx(i, 'frequency', e.target.value)} disabled={locked} placeholder="1-0-1" />
                  <Input label="Days" type="number" min="1" className="sm:col-span-1" value={rx.durationDays} onChange={(e) => setRx(i, 'durationDays', e.target.value)} disabled={locked} />
                  <Input label="Instructions" className="col-span-2 sm:col-span-2" value={rx.instructions} onChange={(e) => setRx(i, 'instructions', e.target.value)} disabled={locked} placeholder="After food" />
                  {!locked && <div className="flex items-end sm:col-span-1"><Button variant="ghost" size="sm" onClick={() => setForm((f) => ({ ...f, prescriptions: f.prescriptions.filter((_, j) => j !== i) }))} aria-label="Remove"><LuTrash2 aria-hidden /></Button></div>}
                </div>
              ))}
            </div>
          </Card>
        </div>
        <div className="space-y-6">
          <Card className="space-y-4 p-5">
            <h2 className="font-display text-lg font-semibold">Advice & follow-up</h2>
            <Textarea label="Advice" value={form.advice} onChange={set('advice')} disabled={locked} />
            <Input label="Follow-up date" type="date" value={form.followUpDate} onChange={set('followUpDate')} disabled={locked} />
          </Card>
          <Card className="p-5 print:hidden">
            <h2 className="mb-2 font-display text-lg font-semibold">Lab orders</h2>
            {c.labOrders.length === 0 ? <p className="text-sm text-muted">None.</p> : (
              <ul className="space-y-2 text-sm">{c.labOrders.map((o) => <li key={o.id} className="flex justify-between"><Link className="font-mono text-forest-700 underline" to={`/app/laboratory/${o.id}`}>{o.number}</Link><StatusBadge status={o.status} /></li>)}</ul>
            )}
          </Card>
          {c.versions.length > 0 && (
            <Card className="p-5 print:hidden">
              <h2 className="mb-2 font-display text-lg font-semibold">History</h2>
              <ul className="space-y-1 text-xs text-muted">{c.versions.map((v) => <li key={v.version}>Version {v.version} saved {dateTime(v.changedAt, tz)}</li>)}</ul>
            </Card>
          )}
        </div>
      </div>

      <Modal open={finalizeOpen} onClose={() => setFinalizeOpen(false)} title="Finalise consultation" size="sm"
        footer={<><Button variant="ghost" onClick={() => setFinalizeOpen(false)}>Cancel</Button><Button onClick={finalize} loading={busy === 'final'}>Finalise</Button></>}>
        <p className="text-sm text-muted">Once finalised the record cannot be edited. The linked appointment is marked completed.</p>
        {hasFeature('billing') && can('billing.write') && Number(c.doctor.consultationFee) > 0 && (
          <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" className="accent-forest-800" checked={charge} onChange={(e) => setCharge(e.target.checked)} />
            Add consultation fee (₹{Number(c.doctor.consultationFee)}) to the patient’s bill</label>
        )}
      </Modal>
      {labOpen && <LabOrderModal open onClose={() => setLabOpen(false)} preset={{ patient: { id: p.id, label: `${p.patientNumber} — ${fullName(p.firstName, p.lastName)}` }, doctorId: c.doctor.id, consultationId: c.id }} onSaved={() => { setLabOpen(false); reload(); }} />}
      <p className="mt-8 hidden text-xs print:block">Printed {date(new Date(), tz)} · {c.number}</p>
    </>
  );
}
