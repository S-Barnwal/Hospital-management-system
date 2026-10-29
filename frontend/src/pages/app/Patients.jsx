import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { LuPlus, LuSearch, LuUsers, LuArrowLeft, LuArchive, LuPencil, LuCalendarClock } from 'react-icons/lu';
import { api, qs } from '../../lib/api.js';
import { useApi, useDebounced, useForm } from '../../lib/hooks.js';
import { useTenantAuth } from '../../context/AuthContext.jsx';
import { notify, withToast } from '../../lib/toast.js';
import { age, date, dateTime, fullName, titleCase } from '../../lib/format.js';
import { Alert, Badge, Button, Card, DataTable, EmptyState, Input, Modal, PageHeader, Pagination, Select, Skeleton, StatusBadge } from '../../components/ui.jsx';

const GENDERS = [{ value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }, { value: 'other', label: 'Other' }, { value: 'unknown', label: 'Prefer not to say' }];
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((b) => ({ value: b, label: b }));
const EMPTY = { firstName: '', lastName: '', gender: '', dateOfBirth: '', phone: '', email: '', addressLine: '', city: '', bloodGroup: '', emergencyContactName: '', emergencyContactPhone: '' };

/** Register or edit a patient. Checks for likely duplicates within this hospital before creating. */
export function PatientForm({ open, onClose, onSaved, patient }) {
  const f = useForm(patient ? { ...EMPTY, ...Object.fromEntries(Object.entries(patient).map(([k, v]) => [k, v ?? ''])) } : EMPTY);
  const [dupes, setDupes] = useState(null);
  useEffect(() => { if (open && !patient) { f.setValues(EMPTY); setDupes(null); } /* eslint-disable-next-line */ }, [open]);

  const payload = (v) => Object.fromEntries(Object.keys(EMPTY).map((k) => [k, v[k] === '' ? null : v[k]]));
  const save = f.submit(async (v) => {
    if (!patient && dupes === null) {
      const r = await api.post('/patients/check-duplicates', { firstName: v.firstName, lastName: v.lastName || undefined, dateOfBirth: v.dateOfBirth || undefined, phone: v.phone || undefined });
      if (r.data.length) { setDupes(r.data); return; }
    }
    const body = payload(v);
    if (patient) {
      await api.patch(`/patients/${patient.id}`, body);
      onSaved?.(patient.id);
    } else {
      body.firstName = v.firstName;
      const r = await api.post('/patients', body);
      onSaved?.(r.data.id, r.data.patientNumber);
    }
  });

  return (
    <Modal open={open} onClose={onClose} title={patient ? 'Edit patient' : 'Register patient'} size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={f.submitting}>{dupes ? 'Register anyway' : patient ? 'Save changes' : 'Register patient'}</Button></>}>
      {dupes && (
        <Alert tone="warning" title="Possible duplicate" className="mb-5">
          <p>{dupes.length} existing patient(s) match this phone number or name and date of birth:</p>
          <ul className="mt-2 list-disc pl-5">
            {dupes.map((d) => <li key={d.id}><Link className="font-semibold underline" to={`/app/patients/${d.id}`} onClick={onClose}>{d.patientNumber}</Link> — {fullName(d.firstName, d.lastName)}{d.phone ? `, ${d.phone}` : ''}</li>)}
          </ul>
          <p className="mt-2">Open the existing record, or choose “Register anyway” if this is a different person.</p>
        </Alert>
      )}
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Input label="First name" required {...f.bind('firstName')} error={f.errors.firstName} />
        <Input label="Last name" {...f.bind('lastName')} error={f.errors.lastName} />
        <Select label="Gender" placeholder="—" options={GENDERS} {...f.bind('gender')} error={f.errors.gender} />
        <Input label="Date of birth" type="date" max={new Date().toISOString().slice(0, 10)} {...f.bind('dateOfBirth')} error={f.errors.dateOfBirth} />
        <Input label="Phone" type="tel" {...f.bind('phone')} error={f.errors.phone} />
        <Input label="E-mail" type="email" {...f.bind('email')} error={f.errors.email} />
        <Input label="Address" {...f.bind('addressLine')} error={f.errors.addressLine} className="sm:col-span-2" />
        <Input label="City" {...f.bind('city')} error={f.errors.city} />
        <Select label="Blood group" placeholder="—" options={BLOOD} {...f.bind('bloodGroup')} error={f.errors.bloodGroup} />
        <Input label="Emergency contact name" {...f.bind('emergencyContactName')} error={f.errors.emergencyContactName} />
        <Input label="Emergency contact phone" type="tel" {...f.bind('emergencyContactPhone')} error={f.errors.emergencyContactPhone} />
        {f.formError && <Alert tone="error" className="sm:col-span-2">{f.formError}</Alert>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export default function Patients() {
  const { can } = useTenantAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [archived, setArchived] = useState(false);
  const [notice, setNotice] = useState(null);
  const search = useDebounced(q);
  useEffect(() => setPage(1), [search, archived]);
  const { data, meta, loading, error, reload } = useApi(() => api.get(`/patients${qs({ q: search, page, pageSize: 20, archived })}`), [search, page, archived]);
  const showNew = params.get('new') === '1';

  return (
    <>
      <PageHeader title="Patients" subtitle="Search, register and manage patient records for this hospital."
        actions={can('patients.write') && <Button onClick={() => setParams({ new: '1' })}><LuPlus aria-hidden /> Register patient</Button>} />
      {notice && <Alert tone="success" className="mb-4">{notice}</Alert>}
      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <LuSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
            <input className="input pl-9" placeholder="Search by name, phone or patient number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search patients" />
          </div>
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" className="accent-forest-800" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Show archived
          </label>
        </div>
        <DataTable loading={loading} error={error} rows={data}
          onRowClick={(r) => navigate(`/app/patients/${r.id}`)}
          empty={<EmptyState icon={LuUsers} title={search ? 'No matching patients' : 'No patients yet'}
            action={!search && can('patients.write') && <Button onClick={() => setParams({ new: '1' })}><LuPlus aria-hidden /> Register the first patient</Button>}>
            {search ? 'Try a different name, phone or number.' : 'Registered patients will appear here.'}</EmptyState>}
          columns={[
            { key: 'patientNumber', label: 'Patient no.', render: (r) => <span className="font-mono text-xs font-semibold text-forest-800">{r.patientNumber}</span> },
            { key: 'name', label: 'Name', render: (r) => <span className="font-medium text-ink">{fullName(r.firstName, r.lastName)}</span> },
            { key: 'age', label: 'Age / gender', render: (r) => [age(r.dateOfBirth) ?? null, r.gender && titleCase(r.gender)].filter((x) => x !== null && x !== undefined).join(' · ') || '—' },
            { key: 'phone', label: 'Phone' },
            { key: 'createdAt', label: 'Registered', render: (r) => date(r.createdAt) },
          ]} />
        <Pagination meta={meta} onPage={setPage} />
      </Card>
      <PatientForm open={showNew} onClose={() => setParams({})}
        onSaved={(id, num) => { setParams({}); notify.success(`Patient ${num} registered.`); reload(); navigate(`/app/patients/${id}`); }} />
    </>
  );
}

export function PatientDetail() {
  const { id } = useParams();
  const { me, can } = useTenantAuth();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data: p, loading, error, reload } = useApi(() => api.get(`/patients/${id}`), [id]);
  const tz = me.tenant.timezone;

  if (error) return <Alert tone="error">{error.status === 404 ? 'Patient not found.' : error.message}</Alert>;
  if (loading && !p) return <Card className="p-6"><Skeleton className="h-8 w-60" /><Skeleton className="mt-4 h-40 w-full" /></Card>;

  const toggleArchive = async () => {
    setBusy(true);
    try { await api.post(`/patients/${id}/archive`, { archived: !p.isArchived }); notify.success(p.isArchived ? 'Patient restored.' : 'Patient archived (record kept, hidden from lists).'); await reload(); } catch (e) { notify.error(e.message); } finally { setBusy(false); }
  };

  const rows = [
    ['Gender', p.gender && titleCase(p.gender)], ['Date of birth', p.dateOfBirth ? `${date(p.dateOfBirth)} (${age(p.dateOfBirth)} yrs)` : null],
    ['Phone', p.phone], ['E-mail', p.email], ['Blood group', p.bloodGroup], ['Address', [p.addressLine, p.city].filter(Boolean).join(', ')],
    ['Emergency contact', [p.emergencyContactName, p.emergencyContactPhone].filter(Boolean).join(' · ')], ['Registered', dateTime(p.createdAt, tz)],
  ];

  return (
    <>
      <button onClick={() => navigate('/app/patients')} className="mb-4 flex items-center gap-1 text-sm font-medium text-forest-700 hover:text-forest-900"><LuArrowLeft aria-hidden /> All patients</button>
      <PageHeader eyebrow={p.patientNumber} title={fullName(p.firstName, p.lastName)}
        subtitle={p.isArchived ? 'This record is archived.' : undefined}
        actions={<>
          {can('appointments.write') && !p.isArchived && <Button to={`/app/appointments?new=1&patientId=${p.id}`}><LuCalendarClock aria-hidden /> Book appointment</Button>}
          {can('patients.write') && <Button variant="outline" onClick={() => setEditing(true)}><LuPencil aria-hidden /> Edit</Button>}
          {can('patients.archive') && <Button variant="ghost" loading={busy} onClick={toggleArchive}><LuArchive aria-hidden /> {p.isArchived ? 'Restore' : 'Archive'}</Button>}
        </>} />
      {p.isArchived && <Badge tone="gray" className="mb-4">Archived</Badge>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5">
          <h2 className="font-display text-lg font-semibold text-forest-950">Details</h2>
          <dl className="mt-3 divide-y divide-line text-sm">
            {rows.map(([k, v]) => <div key={k} className="grid grid-cols-5 gap-2 py-2.5"><dt className="col-span-2 text-muted">{k}</dt><dd className="col-span-3 text-ink">{v || '—'}</dd></div>)}
          </dl>
        </Card>
        <Card className="lg:col-span-2">
          <h2 className="border-b border-line px-5 py-4 font-display text-lg font-semibold text-forest-950">Visit history</h2>
          <DataTable rows={p.appointments} empty={<EmptyState icon={LuCalendarClock} title="No visits yet" />}
            columns={[
              { key: 'number', label: 'No.', render: (a) => <span className="font-mono text-xs">{a.number}</span> },
              { key: 'startAt', label: 'When', render: (a) => dateTime(a.startAt, tz) },
              { key: 'doctorName', label: 'Doctor' },
              { key: 'visitType', label: 'Type', render: (a) => titleCase(a.visitType) },
              { key: 'status', label: 'Status', render: (a) => <StatusBadge status={a.status} /> },
            ]} />
        </Card>
      </div>
      {editing && <PatientForm open patient={p} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); notify.success('Patient updated.'); reload(); }} />}
    </>
  );
}
