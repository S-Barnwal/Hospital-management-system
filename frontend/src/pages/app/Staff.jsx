import { useEffect, useState } from 'react';
import { LuPlus, LuUserCog, LuCalendarClock, LuPencil, LuTrash2, LuBuilding2 } from 'react-icons/lu';
import { api, qs } from '../../lib/api.js';
import { useApi, useDebounced, useForm } from '../../lib/hooks.js';
import { useTenantAuth } from '../../context/AuthContext.jsx';
import { money, titleCase } from '../../lib/format.js';
import { Alert, Badge, Button, Card, DataTable, EmptyState, Input, Modal, PageHeader, Pagination, Select, cx } from '../../components/ui.jsx';

const TYPES = ['doctor', 'nurse', 'receptionist', 'lab_technician', 'pharmacist', 'accountant', 'admin', 'other'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function StaffForm({ open, staff, departments, onClose, onSaved, defaultType = 'doctor' }) {
  const blank = { staffType: defaultType, fullName: '', departmentId: '', designation: '', specialization: '', registrationNumber: '', phone: '', email: '', consultationFee: '', isActive: true };
  const f = useForm(blank);
  useEffect(() => {
    if (open) f.setValues(staff ? { ...blank, ...Object.fromEntries(Object.entries(staff).map(([k, v]) => [k, v ?? ''])), departmentId: staff.departmentId ? String(staff.departmentId) : '' } : blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, staff]);
  const save = f.submit(async (v) => {
    const body = {
      staffType: v.staffType, fullName: v.fullName, departmentId: v.departmentId ? Number(v.departmentId) : null,
      designation: v.designation || null, specialization: v.specialization || null, registrationNumber: v.registrationNumber || null,
      phone: v.phone || null, email: v.email || null, consultationFee: v.consultationFee === '' ? null : Number(v.consultationFee),
      ...(staff ? { isActive: Boolean(v.isActive) } : {}),
    };
    if (staff) await api.patch(`/hr/staff/${staff.id}`, body); else await api.post('/hr/staff', body);
    onSaved();
  });
  return (
    <Modal open={open} onClose={onClose} title={staff ? `Edit ${staff.fullName}` : 'Add staff member'} size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={f.submitting}>Save</Button></>}>
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Select label="Role type" options={TYPES.map((t) => ({ value: t, label: titleCase(t) }))} {...f.bind('staffType')} error={f.errors.staffType} />
        <Input label="Full name" required {...f.bind('fullName')} error={f.errors.fullName} />
        <Select label="Department" placeholder="—" options={(departments || []).map((d) => ({ value: String(d.id), label: d.name }))} {...f.bind('departmentId')} />
        <Input label="Designation" {...f.bind('designation')} error={f.errors.designation} />
        {f.values.staffType === 'doctor' && <>
          <Input label="Specialisation" {...f.bind('specialization')} error={f.errors.specialization} />
          <Input label="Registration no." hint="Medical council registration" {...f.bind('registrationNumber')} error={f.errors.registrationNumber} />
          <Input label="Consultation fee (₹)" type="number" min="0" step="0.01" {...f.bind('consultationFee')} error={f.errors.consultationFee} />
        </>}
        <Input label="Phone" type="tel" {...f.bind('phone')} error={f.errors.phone} />
        <Input label="E-mail" type="email" {...f.bind('email')} error={f.errors.email} />
        {staff && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="accent-forest-800" checked={Boolean(f.values.isActive)} onChange={(e) => f.setValues((s) => ({ ...s, isActive: e.target.checked }))} /> Active</label>}
        {f.formError && <Alert tone="error" className="sm:col-span-2">{f.formError}</Alert>}
      </form>
    </Modal>
  );
}

function ScheduleEditor({ doctor, onClose }) {
  const [blocks, setBlocks] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!doctor) return;
    setBlocks(null);
    api.get(`/hr/staff/${doctor.id}`).then((r) => setBlocks(r.data.schedule.map(({ id, ...b }) => b))).catch((e) => setError(e.message));
  }, [doctor]);
  const update = (i, k, v) => setBlocks((bs) => bs.map((b, j) => (j === i ? { ...b, [k]: k === 'startTime' || k === 'endTime' ? v : Number(v) } : b)));
  const save = async () => {
    setSaving(true); setError(null);
    try { await api.put(`/hr/staff/${doctor.id}/schedule`, { blocks }); onClose(); } catch (e) { setError(e.message); } finally { setSaving(false); }
  };
  return (
    <Modal open={Boolean(doctor)} onClose={onClose} title={`Weekly schedule — ${doctor?.fullName ?? ''}`} size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={saving} disabled={!blocks}>Save schedule</Button></>}>
      <p className="mb-4 text-sm text-muted">Times are in the hospital timezone. Bookings must fit inside these blocks; with no blocks the doctor can be booked at any time.</p>
      {blocks?.length === 0 && <p className="mb-3 text-sm text-muted">No schedule yet.</p>}
      <div className="space-y-2">
        {blocks?.map((b, i) => (
          <div key={i} className="grid grid-cols-2 items-end gap-2 rounded-lg border border-line p-3 sm:grid-cols-5">
            <Select label="Day" value={String(b.dayOfWeek)} onChange={(e) => update(i, 'dayOfWeek', e.target.value)} options={DAYS.map((d, n) => ({ value: String(n), label: d }))} />
            <Input label="From" type="time" value={b.startTime} onChange={(e) => update(i, 'startTime', e.target.value)} />
            <Input label="To" type="time" value={b.endTime} onChange={(e) => update(i, 'endTime', e.target.value)} />
            <Select label="Slot" value={String(b.slotMinutes)} onChange={(e) => update(i, 'slotMinutes', e.target.value)} options={[10, 15, 20, 30, 60].map((m) => ({ value: String(m), label: `${m} min` }))} />
            <Button variant="ghost" onClick={() => setBlocks((bs) => bs.filter((_, j) => j !== i))} aria-label="Remove block"><LuTrash2 aria-hidden /></Button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setBlocks((bs) => [...(bs || []), { dayOfWeek: 1, startTime: '09:00', endTime: '13:00', slotMinutes: 15 }])}><LuPlus aria-hidden /> Add block</Button>
        <Button variant="ghost" size="sm" onClick={() => setBlocks([1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startTime: '09:00', endTime: '13:00', slotMinutes: 15 })))}>Mon–Sat 9–1</Button>
      </div>
      {error && <Alert tone="error" className="mt-4">{error}</Alert>}
    </Modal>
  );
}

function Departments({ can }) {
  const { data, loading, error, reload } = useApi(() => api.get('/hr/departments'), []);
  const [name, setName] = useState('');
  const [err, setErr] = useState(null);
  const add = async (e) => {
    e.preventDefault(); setErr(null);
    try { await api.post('/hr/departments', { name }); setName(''); reload(); } catch (x) { setErr(x.message); }
  };
  return (
    <Card>
      {can('departments.manage') && (
        <form onSubmit={add} className="flex flex-col gap-2 border-b border-line p-4 sm:flex-row sm:items-end">
          <Input label="New department" value={name} onChange={(e) => setName(e.target.value)} className="flex-1" />
          <Button type="submit" disabled={name.trim().length < 2}><LuPlus aria-hidden /> Add</Button>
        </form>
      )}
      {err && <Alert tone="error" className="m-4">{err}</Alert>}
      <DataTable loading={loading} error={error} rows={data} empty={<EmptyState icon={LuBuilding2} title="No departments" />}
        columns={[
          { key: 'name', label: 'Department', render: (d) => <span className="font-medium">{d.name}</span> },
          { key: 'staffCount', label: 'Active staff' },
          { key: 'isActive', label: 'Status', render: (d) => <Badge tone={d.isActive ? 'green' : 'gray'}>{d.isActive ? 'Active' : 'Inactive'}</Badge> },
          { key: 'act', label: <span className="sr-only">Actions</span>, className: 'text-right', render: (d) => can('departments.manage') && (
            <Button size="sm" variant="ghost" onClick={async () => { await api.patch(`/hr/departments/${d.id}`, { isActive: !d.isActive }).catch((x) => setErr(x.message)); reload(); }}>{d.isActive ? 'Deactivate' : 'Activate'}</Button>) },
        ]} />
    </Card>
  );
}

export default function Staff() {
  const { can } = useTenantAuth();
  const [tab, setTab] = useState('doctor');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null); // null | 'new' | staff
  const [schedule, setSchedule] = useState(null);
  const search = useDebounced(q);
  useEffect(() => setPage(1), [tab, search]);
  const depts = useApi(() => api.get('/hr/departments'), []);
  const type = tab === 'doctor' ? 'doctor' : 'non_doctor';
  const { data, meta, loading, error, reload } = useApi(
    () => (tab === 'departments' ? Promise.resolve({ data: [] }) : api.get(`/hr/staff${qs({ type, q: search, page, includeInactive: true })}`)), [tab, search, page]);

  return (
    <>
      <PageHeader title="Doctors & staff" subtitle="Manage your team, departments and doctor availability."
        actions={can('staff.write') && tab !== 'departments' && <Button onClick={() => setEditing('new')}><LuPlus aria-hidden /> Add {tab === 'doctor' ? 'doctor' : 'staff'}</Button>} />
      <div className="mb-4 flex gap-1 rounded-lg border border-line bg-white p-1 sm:w-fit" role="tablist">
        {[['doctor', 'Doctors'], ['staff', 'Other staff'], ['departments', 'Departments']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cx('flex-1 rounded-md px-4 py-1.5 text-sm font-semibold', tab === k ? 'bg-forest-900 text-white' : 'text-forest-800 hover:bg-forest-50')}>{l}</button>
        ))}
      </div>
      {tab === 'departments' ? <Departments can={can} /> : (
        <Card>
          <div className="border-b border-line p-4"><input className="input" placeholder="Search by name, specialisation or phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search staff" /></div>
          <DataTable loading={loading} error={error} rows={data}
            empty={<EmptyState icon={LuUserCog} title={`No ${tab === 'doctor' ? 'doctors' : 'staff'} yet`}
              action={can('staff.write') && <Button onClick={() => setEditing('new')}><LuPlus aria-hidden /> Add {tab === 'doctor' ? 'a doctor' : 'staff'}</Button>} />}
            columns={[
              { key: 'fullName', label: 'Name', render: (s) => <div><p className="font-medium text-ink">{s.fullName}</p><p className="text-xs text-muted">{s.designation}</p></div> },
              { key: 'type', label: tab === 'doctor' ? 'Specialisation' : 'Role', render: (s) => (tab === 'doctor' ? s.specialization || '—' : titleCase(s.staffType)) },
              { key: 'departmentName', label: 'Department' },
              ...(tab === 'doctor' ? [{ key: 'fee', label: 'Fee', render: (s) => money(s.consultationFee) }] : []),
              { key: 'phone', label: 'Phone' },
              { key: 'isActive', label: 'Status', render: (s) => <Badge tone={s.isActive ? 'green' : 'gray'}>{s.isActive ? 'Active' : 'Inactive'}</Badge> },
              { key: 'act', label: <span className="sr-only">Actions</span>, className: 'text-right', render: (s) => can('staff.write') && (
                <div className="flex justify-end gap-1">
                  {s.staffType === 'doctor' && <Button size="sm" variant="outline" onClick={() => setSchedule(s)}><LuCalendarClock aria-hidden /> Schedule</Button>}
                  <Button size="sm" variant="ghost" onClick={() => setEditing(s)} aria-label={`Edit ${s.fullName}`}><LuPencil aria-hidden /></Button>
                </div>) },
            ]} />
          <Pagination meta={meta} onPage={setPage} />
        </Card>
      )}
      <StaffForm open={Boolean(editing)} defaultType={tab === 'doctor' ? 'doctor' : 'nurse'} staff={editing === 'new' ? null : editing} departments={depts.data?.filter((d) => d.isActive)}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
      <ScheduleEditor doctor={schedule} onClose={() => setSchedule(null)} />
    </>
  );
}
