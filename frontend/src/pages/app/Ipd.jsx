import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LuPlus, LuBedDouble, LuArrowRightLeft, LuLogOut, LuPencil, LuTrash2, LuWrench } from 'react-icons/lu';
import { api, qs } from '../../lib/api.js';
import { useApi, useDebounced, useForm } from '../../lib/hooks.js';
import { useTenantAuth } from '../../context/AuthContext.jsx';
import { notify, withToast } from '../../lib/toast.js';
import { dateTime, fullName, money, relative, titleCase } from '../../lib/format.js';
import { Alert, Badge, Button, Card, DataTable, EmptyState, Input, Modal, PageHeader, Pagination, Select, Skeleton, StatusBadge, Textarea, cx } from '../../components/ui.jsx';
import { PatientPicker, DoctorSelect } from '../../components/Pickers.jsx';

const WARD_TYPES = ['general', 'semi_private', 'private', 'icu', 'nicu', 'emergency', 'other'];
const BED_STYLE = {
  available: 'border-forest-200 bg-forest-50 text-forest-900 hover:border-forest-500',
  occupied: 'border-gold-400 bg-gold-50 text-gold-700 hover:border-gold-600',
  maintenance: 'border-slate-200 bg-slate-100 text-slate-500',
};

function AdmitModal({ bed, onClose, onDone }) {
  const [patient, setPatient] = useState(null);
  const [doctorId, setDoctorId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const admit = async () => {
    if (!patient) { notify.error('Choose a patient.'); return; }
    setBusy(true);
    const ok = await withToast(() => api.post('/ipd/admissions', { patientId: patient.id, bedId: bed.id, ...(doctorId ? { attendingDoctorId: Number(doctorId) } : {}), ...(reason ? { reason } : {}) }), 'Patient admitted.');
    setBusy(false);
    if (ok) onDone();
  };
  return (
    <Modal open onClose={onClose} title={`Admit to ${bed.wardName} · bed ${bed.bedNumber}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={admit} loading={busy}>Admit</Button></>}>
      <div className="space-y-4">
        <PatientPicker value={patient} onChange={setPatient} />
        <DoctorSelect label="Attending doctor" placeholder="—" value={doctorId} onChange={setDoctorId} />
        <Textarea label="Reason for admission" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Modal>
  );
}

function AdmissionModal({ admissionId, wards, onClose, onDone }) {
  const { can, hasFeature } = useTenantAuth();
  const { data: a, loading } = useApi(() => api.get(`/ipd/admissions/${admissionId}`), [admissionId]);
  const [mode, setMode] = useState(null);
  const [toBed, setToBed] = useState('');
  const [summary, setSummary] = useState('');
  const [charge, setCharge] = useState(true);
  const [busy, setBusy] = useState(false);
  const free = wards.flatMap((w) => w.beds.filter((b) => b.status === 'available').map((b) => ({ value: String(b.id), label: `${w.name} · ${b.bedNumber}` })));
  const act = async (fn, msg) => { setBusy(true); const ok = await withToast(fn, msg); setBusy(false); if (ok) onDone(ok); };
  return (
    <Modal open onClose={onClose} title={a ? `${a.number} · ${fullName(a.patientFirstName, a.patientLastName)}` : 'Admission'} size="lg">
      {loading || !a ? <Skeleton className="h-40 w-full" /> : (
        <div className="space-y-4 text-sm">
          <dl className="grid gap-3 sm:grid-cols-2">
            {[['Patient no.', a.patientNumber], ['Bed', `${a.wardName} · ${a.bedNumber}`], ['Admitted', `${dateTime(a.admittedAt)} (${relative(a.admittedAt)})`], ['Doctor', a.doctorName || '—'],
              ['Ward rate', `${money(a.dailyRate)} / day`], ['Status', a.status]].map(([k, v]) => <div key={k}><dt className="text-muted">{k}</dt><dd className="font-medium">{v}</dd></div>)}
          </dl>
          {a.reason && <p className="rounded-lg bg-ivory p-3">{a.reason}</p>}
          {a.transfers.length > 0 && <div><p className="font-semibold">Transfers</p><ul className="mt-1 space-y-1 text-xs text-muted">{a.transfers.map((t, i) => <li key={i}>{dateTime(t.at)}: {t.fromWard} {t.fromBed} → {t.toWard} {t.toBed}</li>)}</ul></div>}
          {a.status === 'admitted' && can('ipd.write') && !mode && (
            <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setMode('transfer')}><LuArrowRightLeft aria-hidden /> Transfer bed</Button><Button onClick={() => setMode('discharge')}><LuLogOut aria-hidden /> Discharge</Button></div>
          )}
          {mode === 'transfer' && (
            <div className="space-y-3 rounded-lg border border-line p-3">
              <Select label="Move to bed" placeholder={free.length ? 'Select free bed' : 'No free beds'} options={free} value={toBed} onChange={(e) => setToBed(e.target.value)} />
              <div className="flex gap-2"><Button variant="ghost" onClick={() => setMode(null)}>Back</Button><Button disabled={!toBed} loading={busy} onClick={() => act(() => api.post(`/ipd/admissions/${a.id}/transfer`, { toBedId: Number(toBed) }), 'Patient transferred.')}>Transfer</Button></div>
            </div>
          )}
          {mode === 'discharge' && (
            <div className="space-y-3 rounded-lg border border-line p-3">
              <Textarea label="Discharge summary" required value={summary} onChange={(e) => setSummary(e.target.value)} />
              {hasFeature('billing') && can('billing.write') && Number(a.dailyRate) > 0 && (
                <label className="flex items-center gap-2"><input type="checkbox" className="accent-forest-800" checked={charge} onChange={(e) => setCharge(e.target.checked)} /> Add bed charges ({money(a.dailyRate)}/day) to the patient’s bill</label>
              )}
              <div className="flex gap-2"><Button variant="ghost" onClick={() => setMode(null)}>Back</Button>
                <Button disabled={summary.trim().length < 3} loading={busy} onClick={() => act(() => api.post(`/ipd/admissions/${a.id}/discharge`, { dischargeSummary: summary.trim(), chargeBedDays: charge }), 'Patient discharged.')}>Confirm discharge</Button></div>
            </div>
          )}
          {a.dischargeSummary && <div><p className="font-semibold">Discharge summary</p><p className="mt-1 whitespace-pre-wrap rounded-lg bg-ivory p-3">{a.dischargeSummary}</p></div>}
        </div>
      )}
    </Modal>
  );
}

function BedBoard({ wards, loading, reload }) {
  const { can } = useTenantAuth();
  const [admitBed, setAdmitBed] = useState(null);
  const [admission, setAdmission] = useState(null);
  if (loading && !wards) return <Skeleton className="h-64 w-full" />;
  if (!wards?.length) return <Card><EmptyState icon={LuBedDouble} title="No wards yet">{can('ipd.configure') ? 'Create wards and beds in the Wards & beds tab.' : 'Ask an administrator to set up wards.'}</EmptyState></Card>;
  const all = wards.flatMap((w) => w.beds);
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-3 text-sm">
        {['available', 'occupied', 'maintenance'].map((s) => <span key={s} className="flex items-center gap-2"><span className={cx('h-3 w-3 rounded border', BED_STYLE[s])} />{titleCase(s)}: <strong>{all.filter((b) => b.status === s).length}</strong></span>)}
      </div>
      <div className="space-y-6">
        {wards.filter((w) => w.isActive).map((w) => (
          <Card key={w.id} className="p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><h2 className="font-display text-lg font-semibold">{w.name}</h2><span className="text-xs text-muted">{titleCase(w.wardType)} · {money(w.dailyRate)}/day · {w.beds.filter((b) => b.status === 'occupied').length}/{w.beds.length} occupied</span></div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {w.beds.map((b) => (
                <button key={b.id} disabled={b.status === 'maintenance' || (b.status === 'available' && !can('ipd.write'))}
                  onClick={() => (b.status === 'occupied' ? setAdmission(b.admissionId) : setAdmitBed({ ...b, wardName: w.name }))}
                  className={cx('min-h-20 rounded-xl border-2 p-3 text-left text-xs transition disabled:cursor-not-allowed', BED_STYLE[b.status])}>
                  <p className="text-sm font-bold">Bed {b.bedNumber}</p>
                  {b.status === 'occupied' ? <><p className="truncate font-medium">{fullName(b.patientFirstName, b.patientLastName)}</p><p className="opacity-80">{relative(b.admittedAt)}</p></>
                    : <p className="opacity-80">{b.status === 'available' ? 'Free — tap to admit' : 'Maintenance'}</p>}
                </button>
              ))}
            </div>
          </Card>
        ))}
      </div>
      {admitBed && <AdmitModal bed={admitBed} onClose={() => setAdmitBed(null)} onDone={() => { setAdmitBed(null); reload(); }} />}
      {admission && <AdmissionModal admissionId={admission} wards={wards} onClose={() => setAdmission(null)} onDone={() => { setAdmission(null); reload(); }} />}
    </>
  );
}

function Admissions({ wards, reloadWards }) {
  const [filters, setFilters] = useState({ status: 'admitted', q: '' });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const q = useDebounced(filters.q);
  useEffect(() => setPage(1), [filters.status, q]);
  const { data, meta, loading, error, reload } = useApi(() => api.get(`/ipd/admissions${qs({ status: filters.status, q, page })}`), [filters.status, q, page]);
  return (
    <Card>
      <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-3">
        <Select label="Status" placeholder="Any" value={filters.status} onChange={(e) => setFilters((s) => ({ ...s, status: e.target.value }))} options={[{ value: 'admitted', label: 'Admitted' }, { value: 'discharged', label: 'Discharged' }]} />
        <Input label="Search" className="sm:col-span-2" placeholder="Admission no., patient" value={filters.q} onChange={(e) => setFilters((s) => ({ ...s, q: e.target.value }))} />
      </div>
      <DataTable loading={loading} error={error} rows={data} onRowClick={(a) => setOpen(a.id)} empty={<EmptyState icon={LuBedDouble} title="No admissions" />}
        columns={[
          { key: 'number', label: 'Admission', render: (a) => <span className="font-mono text-xs">{a.number}</span> },
          { key: 'patient', label: 'Patient', render: (a) => <div><p className="font-medium">{fullName(a.patientFirstName, a.patientLastName)}</p><p className="font-mono text-xs text-muted">{a.patientNumber}</p></div> },
          { key: 'bed', label: 'Bed', render: (a) => `${a.wardName} · ${a.bedNumber}` },
          { key: 'admittedAt', label: 'Admitted', render: (a) => dateTime(a.admittedAt) },
          { key: 'dischargedAt', label: 'Discharged', render: (a) => dateTime(a.dischargedAt) },
          { key: 'status', label: 'Status', render: (a) => <StatusBadge status={a.status === 'admitted' ? 'active' : 'completed'} /> },
        ]} />
      <Pagination meta={meta} onPage={setPage} />
      {open && <AdmissionModal admissionId={open} wards={wards || []} onClose={() => setOpen(null)} onDone={() => { setOpen(null); reload(); reloadWards(); }} />}
    </Card>
  );
}

function WardSetup({ wards, reload }) {
  const [editing, setEditing] = useState(null);
  const [bedFor, setBedFor] = useState(null);
  const [bedNo, setBedNo] = useState('');
  const f = useForm({ name: '', wardType: 'general', dailyRate: '0', bedCount: '0', isActive: true });
  useEffect(() => {
    if (editing) f.setValues(editing === 'new' ? { name: '', wardType: 'general', dailyRate: '0', bedCount: '4', isActive: true } : { name: editing.name, wardType: editing.wardType, dailyRate: String(editing.dailyRate), isActive: editing.isActive });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  const save = f.submit(async (v) => {
    if (editing === 'new') await api.post('/ipd/wards', { name: v.name, wardType: v.wardType, dailyRate: Number(v.dailyRate), bedCount: Number(v.bedCount) });
    else await api.patch(`/ipd/wards/${editing.id}`, { name: v.name, wardType: v.wardType, dailyRate: Number(v.dailyRate), isActive: Boolean(v.isActive) });
    notify.success(editing === 'new' ? 'Ward created.' : 'Ward updated.');
    setEditing(null); reload();
  });
  const confirmDelete = async (msg, fn, ok) => { if (window.confirm(msg) && (await withToast(fn, ok))) reload(); };
  return (
    <>
      <div className="mb-4 flex justify-end"><Button onClick={() => setEditing('new')}><LuPlus aria-hidden /> Add ward</Button></div>
      {!wards?.length && <Card><EmptyState icon={LuBedDouble} title="No wards yet" /></Card>}
      <div className="space-y-4">
        {wards?.map((w) => (
          <Card key={w.id} className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><h2 className="font-display text-lg font-semibold">{w.name} {!w.isActive && <Badge tone="gray">Inactive</Badge>}</h2><p className="text-xs text-muted">{titleCase(w.wardType)} · {money(w.dailyRate)}/day · {w.beds.length} beds</p></div>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => { setBedFor(w); setBedNo(''); }}><LuPlus aria-hidden /> Bed</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(w)} aria-label="Edit ward"><LuPencil aria-hidden /></Button>
                <Button size="sm" variant="ghost" aria-label="Delete ward" onClick={() => confirmDelete(`Delete ward “${w.name}” and its beds? Only possible if no patient was ever admitted there.`, () => api.del(`/ipd/wards/${w.id}`), 'Ward deleted.')}><LuTrash2 aria-hidden /></Button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {w.beds.map((b) => (
                <span key={b.id} className={cx('inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs', BED_STYLE[b.status])}>
                  {b.bedNumber}
                  {b.status !== 'occupied' && <button title={b.status === 'maintenance' ? 'Mark available' : 'Mark under maintenance'} aria-label="Toggle maintenance"
                    onClick={async () => { if (await withToast(() => api.patch(`/ipd/beds/${b.id}`, { status: b.status === 'maintenance' ? 'available' : 'maintenance' }), 'Bed updated.')) reload(); }}><LuWrench className="h-3 w-3" /></button>}
                  {b.status !== 'occupied' && <button aria-label={`Delete bed ${b.bedNumber}`} onClick={() => confirmDelete(`Delete bed ${b.bedNumber}?`, () => api.del(`/ipd/beds/${b.id}`), 'Bed deleted.')}><LuTrash2 className="h-3 w-3" /></button>}
                </span>
              ))}
            </div>
          </Card>
        ))}
      </div>
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add ward' : 'Edit ward'} footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save} loading={f.submitting}>Save</Button></>}>
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-2" noValidate>
          <Input label="Name" required {...f.bind('name')} error={f.errors.name} className="sm:col-span-2" />
          <Select label="Type" options={WARD_TYPES.map((t) => ({ value: t, label: titleCase(t) }))} {...f.bind('wardType')} />
          <Input label="Daily rate (₹)" type="number" min="0" step="0.01" {...f.bind('dailyRate')} error={f.errors.dailyRate} />
          {editing === 'new' ? <Input label="Number of beds" type="number" min="0" max="200" {...f.bind('bedCount')} />
            : <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-forest-800" checked={Boolean(f.values.isActive)} onChange={(e) => f.setValues((s) => ({ ...s, isActive: e.target.checked }))} /> Active</label>}
          {f.formError && <Alert tone="error" className="sm:col-span-2">{f.formError}</Alert>}
        </form>
      </Modal>
      <Modal open={Boolean(bedFor)} onClose={() => setBedFor(null)} title={`Add bed to ${bedFor?.name ?? ''}`} size="sm"
        footer={<><Button variant="ghost" onClick={() => setBedFor(null)}>Cancel</Button><Button disabled={!bedNo.trim()} onClick={async () => { if (await withToast(() => api.post(`/ipd/wards/${bedFor.id}/beds`, { bedNumber: bedNo.trim() }), 'Bed added.')) { setBedFor(null); reload(); } }}>Add</Button></>}>
        <Input label="Bed number / label" value={bedNo} onChange={(e) => setBedNo(e.target.value)} />
      </Modal>
    </>
  );
}

export default function Ipd() {
  const { can } = useTenantAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'board';
  const { data: wards, loading, error, reload } = useApi(() => api.get('/ipd/wards'), []);
  const tabs = [['board', 'Bed board'], ['admissions', 'Admissions'], ...(can('ipd.configure') ? [['setup', 'Wards & beds']] : [])];
  return (
    <>
      <PageHeader title="Admissions & beds" subtitle="Live bed occupancy, admission, transfer and discharge." />
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg border border-line bg-white p-1 sm:w-fit" role="tablist">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setParams({ tab: k })} className={cx('flex-1 whitespace-nowrap rounded-md px-4 py-1.5 text-sm font-semibold', tab === k ? 'bg-forest-900 text-white' : 'text-forest-800 hover:bg-forest-50')}>{l}</button>)}
      </div>
      {error && <Alert tone="error" className="mb-4">{error.message}</Alert>}
      {tab === 'board' && <BedBoard wards={wards} loading={loading} reload={reload} />}
      {tab === 'admissions' && <Admissions wards={wards} reloadWards={reload} />}
      {tab === 'setup' && can('ipd.configure') && <WardSetup wards={wards} reload={reload} />}
    </>
  );
}
