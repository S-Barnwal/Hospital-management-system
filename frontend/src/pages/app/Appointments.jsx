import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LuPlus, LuCalendarClock, LuLogIn, LuCheck, LuX, LuCalendarDays } from 'react-icons/lu';
import { api, qs } from '../../lib/api.js';
import { useApi, useDebounced, useForm } from '../../lib/hooks.js';
import { useTenantAuth } from '../../context/AuthContext.jsx';
import { notify, withToast } from '../../lib/toast.js';
import { fullName, time, todayIn, titleCase } from '../../lib/format.js';
import { Alert, Button, Card, DataTable, EmptyState, Input, Modal, PageHeader, Pagination, Select, Spinner, StatusBadge, Textarea, cx } from '../../components/ui.jsx';

function useDoctors() {
  return useApi(() => api.get('/hr/staff?type=doctor&pageSize=100'), []);
}

function SlotPicker({ doctorId, date, value, onChange }) {
  const { data, loading, error } = useApi(() => (doctorId && date ? api.get(`/appointments/availability${qs({ doctorId, date })}`) : Promise.resolve({ data: null })), [doctorId, date]);
  if (!doctorId || !date) return <p className="text-sm text-muted">Choose a doctor and date to see free slots.</p>;
  if (loading) return <Spinner />;
  if (error) return <Alert tone="error">{error.message}</Alert>;
  if (!data?.scheduleConfigured) {
    return <Input label="Time" type="time" required value={value} onChange={(e) => onChange(e.target.value)} hint="No weekly schedule set for this doctor — enter any time." />;
  }
  if (!data.slots.length) return <Alert tone="warning">No free slots on this day.</Alert>;
  return (
    <div>
      <p className="label">Free slots</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Free slots">
        {data.slots.map((s) => (
          <button key={s} type="button" role="radio" aria-checked={value === s} onClick={() => onChange(s)}
            className={cx('rounded-md border px-3 py-1.5 text-sm font-medium', value === s ? 'border-forest-800 bg-forest-900 text-white' : 'border-line bg-white hover:border-forest-300')}>{s}</button>
        ))}
      </div>
    </div>
  );
}

function PatientPicker({ value, onChange, error }) {
  const [q, setQ] = useState('');
  const search = useDebounced(q);
  const { data } = useApi(() => (search.length >= 2 ? api.get(`/patients${qs({ q: search, pageSize: 8 })}`) : Promise.resolve({ data: [] })), [search]);
  if (value) {
    return (
      <div>
        <p className="label">Patient</p>
        <div className="flex items-center justify-between rounded-lg border border-forest-200 bg-forest-50 px-3 py-2 text-sm">
          <span><span className="font-semibold">{value.label}</span></span>
          <button type="button" className="text-forest-700 underline" onClick={() => onChange(null)}>Change</button>
        </div>
      </div>
    );
  }
  return (
    <div className="relative">
      <Input label="Patient" required placeholder="Search name, phone or patient no." value={q} onChange={(e) => setQ(e.target.value)} error={error} />
      {data?.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-line bg-white shadow-[var(--shadow-lift)]">
          {data.map((p) => (
            <li key={p.id}><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-forest-50"
              onClick={() => onChange({ id: p.id, label: `${p.patientNumber} — ${fullName(p.firstName, p.lastName)}` })}>
              <span className="font-mono text-xs text-forest-700">{p.patientNumber}</span> {fullName(p.firstName, p.lastName)} <span className="text-muted">{p.phone}</span>
            </button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BookingModal({ open, onClose, onSaved, tz, presetPatientId, existing }) {
  const doctors = useDoctors();
  const [patient, setPatient] = useState(null);
  const f = useForm({ doctorId: '', date: todayIn(tz), time: '', durationMinutes: '15', visitType: 'opd', reason: '' });

  useEffect(() => {
    if (!open) return;
    if (existing) {
      f.setValues({ doctorId: String(existing.doctorId), date: todayIn(tz), time: '', durationMinutes: '15', visitType: existing.visitType, reason: existing.reason || '' });
      setPatient({ id: existing.patientId, label: `${existing.patientNumber} — ${fullName(existing.patientFirstName, existing.patientLastName)}` });
    } else if (presetPatientId) {
      api.get(`/patients/${presetPatientId}`).then((r) => setPatient({ id: r.data.id, label: `${r.data.patientNumber} — ${fullName(r.data.firstName, r.data.lastName)}` })).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, presetPatientId, existing]);

  const save = f.submit(async (v) => {
    if (!patient) { f.setErrors({ patientId: 'Select a patient.' }); throw new Error('Select a patient.'); }
    if (!v.time) throw new Error('Choose a time slot.');
    if (existing) {
      await api.post(`/appointments/${existing.id}/reschedule`, { date: v.date, time: v.time, doctorId: Number(v.doctorId), durationMinutes: Number(v.durationMinutes) });
    } else {
      await api.post('/appointments', {
        patientId: patient.id, doctorId: Number(v.doctorId), date: v.date, time: v.time, durationMinutes: Number(v.durationMinutes),
        visitType: v.visitType, ...(v.reason ? { reason: v.reason } : {}),
      });
    }
    onSaved();
  });

  return (
    <Modal open={open} onClose={onClose} title={existing ? `Reschedule ${existing.number}` : 'Book appointment'} size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={f.submitting}>{existing ? 'Reschedule' : 'Book'}</Button></>}>
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
        <div className="sm:col-span-2">{existing ? <p className="text-sm">Patient: <strong>{patient?.label}</strong></p> : <PatientPicker value={patient} onChange={setPatient} error={f.errors.patientId} />}</div>
        <Select label="Doctor" required placeholder={doctors.loading ? 'Loading…' : 'Select doctor'} {...f.bind('doctorId')}
          options={(doctors.data || []).map((d) => ({ value: String(d.id), label: `${d.fullName}${d.specialization ? ` — ${d.specialization}` : ''}` }))} />
        <Input label="Date" type="date" required min={todayIn(tz)} {...f.bind('date')} />
        <div className="sm:col-span-2"><SlotPicker doctorId={f.values.doctorId} date={f.values.date} value={f.values.time} onChange={(t) => f.setValues((s) => ({ ...s, time: t }))} /></div>
        <Select label="Duration" options={[15, 20, 30, 45, 60].map((m) => ({ value: String(m), label: `${m} minutes` }))} {...f.bind('durationMinutes')} />
        {!existing && <Select label="Visit type" options={[{ value: 'opd', label: 'OPD' }, { value: 'follow_up', label: 'Follow-up' }, { value: 'teleconsult', label: 'Teleconsult' }]} {...f.bind('visitType')} />}
        {!existing && <Textarea label="Reason for visit" {...f.bind('reason')} className="sm:col-span-2" />}
        {!doctors.loading && !doctors.data?.length && <Alert tone="warning" className="sm:col-span-2">Add a doctor under Doctors &amp; staff first.</Alert>}
        {f.formError && <Alert tone="error" className="sm:col-span-2">{f.formError}</Alert>}
        <p className="text-xs text-muted sm:col-span-2">Times are in the hospital timezone ({tz}).</p>
      </form>
    </Modal>
  );
}

export default function Appointments() {
  const { me, can } = useTenantAuth();
  const tz = me.tenant.timezone;
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState({ date: todayIn(tz), doctorId: '', status: '' });
  const [page, setPage] = useState(1);
  const [cancelling, setCancelling] = useState(null);
  const [rescheduling, setRescheduling] = useState(null);
  const [actionError, setActionError] = useState(null);
  const doctors = useDoctors();
  useEffect(() => setPage(1), [filters]);
  const { data, meta, loading, error, reload } = useApi(() => api.get(`/appointments${qs({ ...filters, page, pageSize: 25 })}`), [filters, page]);

  const setStatus = async (a, status, cancelReason) => {
    setActionError(null);
    try { await api.post(`/appointments/${a.id}/status`, { status, ...(cancelReason ? { cancelReason } : {}) }); notify.success(`Appointment ${a.number} ${status.replace('_', ' ')}.`); reload(); } catch (e) { notify.error(e.message); }
  };

  return (
    <>
      <PageHeader title="Appointments" subtitle={`All times shown in ${tz}.`}
        actions={can('appointments.write') && <Button onClick={() => setParams({ new: '1' })}><LuPlus aria-hidden /> Book appointment</Button>} />
      {actionError && <Alert tone="error" className="mb-4">{actionError}</Alert>}
      <Card>
        <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-4">
          <Input label="Date" type="date" value={filters.date} onChange={(e) => setFilters((s) => ({ ...s, date: e.target.value }))} />
          <Select label="Doctor" placeholder="All doctors" value={filters.doctorId} onChange={(e) => setFilters((s) => ({ ...s, doctorId: e.target.value }))}
            options={(doctors.data || []).map((d) => ({ value: String(d.id), label: d.fullName }))} />
          <Select label="Status" placeholder="Any status" value={filters.status} onChange={(e) => setFilters((s) => ({ ...s, status: e.target.value }))}
            options={['scheduled', 'checked_in', 'completed', 'cancelled', 'no_show'].map((s) => ({ value: s, label: titleCase(s) }))} />
          <div className="flex items-end"><Button variant="outline" className="w-full" onClick={() => setFilters((s) => ({ ...s, date: '' }))}><LuCalendarDays aria-hidden /> All dates</Button></div>
        </div>
        <DataTable loading={loading} error={error} rows={data}
          empty={<EmptyState icon={LuCalendarClock} title="No appointments">Nothing matches these filters.</EmptyState>}
          columns={[
            { key: 'startAt', label: 'Time', render: (a) => <div><p className="font-semibold text-ink">{time(a.startAt, tz)}</p>{!filters.date && <p className="text-xs text-muted">{new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: tz }).format(new Date(a.startAt))}</p>}</div> },
            { key: 'patient', label: 'Patient', render: (a) => <div><p className="font-medium text-ink">{fullName(a.patientFirstName, a.patientLastName)}</p><p className="font-mono text-xs text-muted">{a.patientNumber}</p></div> },
            { key: 'doctorName', label: 'Doctor', render: (a) => <div><p>{a.doctorName}</p><p className="text-xs text-muted">{a.departmentName}</p></div> },
            { key: 'visitType', label: 'Type', render: (a) => titleCase(a.visitType) },
            { key: 'status', label: 'Status', render: (a) => <StatusBadge status={a.status} /> },
            { key: 'actions', label: <span className="sr-only">Actions</span>, className: 'text-right', render: (a) => can('appointments.write') && (
              <div className="flex justify-end gap-1">
                {a.status === 'scheduled' && <Button size="sm" variant="outline" onClick={() => setStatus(a, 'checked_in')}><LuLogIn aria-hidden /> Check in</Button>}
                {a.status === 'checked_in' && <Button size="sm" onClick={() => setStatus(a, 'completed')}><LuCheck aria-hidden /> Complete</Button>}
                {a.status === 'scheduled' && <Button size="sm" variant="ghost" onClick={() => setRescheduling(a)}>Reschedule</Button>}
                {['scheduled', 'checked_in'].includes(a.status) && <Button size="sm" variant="ghost" onClick={() => setCancelling(a)} aria-label="Cancel appointment"><LuX aria-hidden /></Button>}
              </div>
            ) },
          ]} />
        <Pagination meta={meta} onPage={setPage} />
      </Card>

      <BookingModal open={params.get('new') === '1'} tz={tz} presetPatientId={params.get('patientId')}
        onClose={() => setParams({})} onSaved={() => { setParams({}); notify.success('Appointment booked.'); reload(); }} />
      {rescheduling && <BookingModal open tz={tz} existing={rescheduling} onClose={() => setRescheduling(null)} onSaved={() => { setRescheduling(null); notify.success('Appointment rescheduled.'); reload(); }} />}
      <CancelDialog appt={cancelling} onClose={() => setCancelling(null)} onConfirm={async (reason) => { await setStatus(cancelling, 'cancelled', reason); setCancelling(null); }} />
    </>
  );
}

function CancelDialog({ appt, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setReason(''), [appt]);
  return (
    <Modal open={Boolean(appt)} onClose={onClose} title={`Cancel ${appt?.number ?? ''}`} size="sm"
      footer={<><Button variant="ghost" onClick={onClose}>Keep</Button><Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={async () => { setBusy(true); try { await onConfirm(reason.trim()); } finally { setBusy(false); } }}>Cancel appointment</Button></>}>
      <Textarea label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} />
    </Modal>
  );
}
