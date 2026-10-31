// OPD helpers: prescription templates ("sets") and the follow-up list.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LuPlus, LuTrash2, LuArrowLeft, LuCalendarPlus, LuClipboardList } from 'react-icons/lu';
import { api, qs } from '../../lib/api.js';
import { useApi } from '../../lib/hooks.js';
import { useTenantAuth } from '../../context/AuthContext.jsx';
import { notify, withToast } from '../../lib/toast.js';
import { date, fullName } from '../../lib/format.js';
import { formatPhone } from '../../lib/contact.js';
import { Alert, Badge, Button, Card, DataTable, EmptyState, Input, Modal, PageHeader, Textarea, cx } from '../../components/ui.jsx';
import { DoctorSelect } from '../../components/Pickers.jsx';

const blankRx = { medicineName: '', dosage: '', frequency: '', durationDays: '', instructions: '' };
const cleanItems = (items) => items.filter((m) => m.medicineName.trim()).map((m) => ({ ...m, durationDays: m.durationDays === '' || m.durationDays == null ? null : Number(m.durationDays) }));

/** Create / edit a template. `initial` may come from a consultation ("Save as template"). */
export function TemplateEditor({ open, template, initial, onClose, onSaved }) {
  const [f, setF] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const src = template || initial || {};
    setErr(null);
    setF({ name: src.name || '', doctorId: src.doctorId ? String(src.doctorId) : '', diagnosis: src.diagnosis || '', advice: src.advice || '',
      items: (src.items?.length ? src.items : [blankRx]).map((m) => ({ ...blankRx, ...Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v ?? ''])) })) });
  }, [open, template, initial]);
  if (!open || !f) return null;
  const setItem = (i, k, v) => setF((s) => ({ ...s, items: s.items.map((m, j) => (j === i ? { ...m, [k]: v } : m)) }));
  const save = async () => {
    setErr(null); setBusy(true);
    try {
      const body = { name: f.name.trim(), doctorId: f.doctorId ? Number(f.doctorId) : null, diagnosis: f.diagnosis, advice: f.advice, items: cleanItems(f.items) };
      if (template) await api.put(`/opd/templates/${template.id}`, body); else await api.post('/opd/templates', body);
      notify.success('Template saved.'); onSaved?.();
    } catch (e) { setErr(e.details?.[0]?.message || e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} size="lg" title={template ? `Edit “${template.name}”` : 'New prescription template'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={f.name.trim().length < 2}>Save template</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Template name" required placeholder="e.g. Viral fever — adult" value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} />
          <DoctorSelect label="Belongs to" placeholder="All doctors (shared)" value={f.doctorId} onChange={(v) => setF((s) => ({ ...s, doctorId: v }))} />
          <Textarea label="Diagnosis (optional)" value={f.diagnosis} onChange={(e) => setF((s) => ({ ...s, diagnosis: e.target.value }))} />
          <Textarea label="Advice (optional)" value={f.advice} onChange={(e) => setF((s) => ({ ...s, advice: e.target.value }))} />
        </div>
        <div className="space-y-2">
          {f.items.map((m, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-line p-3 sm:grid-cols-12">
              <Input label="Medicine" className="col-span-2 sm:col-span-4" value={m.medicineName} onChange={(e) => setItem(i, 'medicineName', e.target.value)} />
              <Input label="Dose" className="sm:col-span-2" value={m.dosage} onChange={(e) => setItem(i, 'dosage', e.target.value)} placeholder="1 tab" />
              <Input label="Frequency" className="sm:col-span-2" value={m.frequency} onChange={(e) => setItem(i, 'frequency', e.target.value)} placeholder="1-0-1" />
              <Input label="Days" type="number" min="1" className="sm:col-span-1" value={m.durationDays} onChange={(e) => setItem(i, 'durationDays', e.target.value)} />
              <Input label="Instructions" className="col-span-2 sm:col-span-2" value={m.instructions} onChange={(e) => setItem(i, 'instructions', e.target.value)} placeholder="After food" />
              <div className="flex items-end sm:col-span-1"><Button variant="ghost" size="sm" aria-label="Remove" onClick={() => setF((s) => ({ ...s, items: s.items.filter((_, j) => j !== i) }))}><LuTrash2 aria-hidden /></Button></div>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => setF((s) => ({ ...s, items: [...s.items, { ...blankRx }] }))}><LuPlus aria-hidden /> Add medicine</Button>
        </div>
        {err && <Alert tone="error">{err}</Alert>}
      </div>
    </Modal>
  );
}

/** Pick a template inside a consultation. onApply(template) — the caller merges it into the form. */
export function TemplatePicker({ open, doctorId, onClose, onApply }) {
  const { data, loading } = useApi(() => (open ? api.get(`/opd/templates${qs({ doctorId })}`) : Promise.resolve({ data: [] })), [open, doctorId]);
  const [q, setQ] = useState('');
  const list = (data || []).filter((t) => !q || `${t.name} ${t.diagnosis || ''}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal open={open} onClose={onClose} title="Apply a prescription template" size="lg" footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      <input className="input mb-3" placeholder="Search templates" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search templates" />
      {loading ? <p className="text-sm text-muted">Loading…</p> : list.length === 0 ? <EmptyState icon={LuClipboardList} title="No templates yet">Create them under OPD → Templates, or use “Save as template” on a consultation.</EmptyState> : (
        <ul className="max-h-[60vh] space-y-2 overflow-auto">
          {list.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => onApply(t)} className="w-full rounded-lg border border-line p-3 text-left text-sm hover:border-forest-500 hover:bg-forest-50">
                <p className="font-semibold">{t.name} {t.doctorName ? <Badge tone="blue">{t.doctorName}</Badge> : <Badge tone="gray">Shared</Badge>}</p>
                {t.diagnosis && <p className="text-xs text-muted">{t.diagnosis}</p>}
                <p className="mt-1 text-xs">{t.items.map((m) => [m.medicineName, m.dosage, m.frequency, m.durationDays && `${m.durationDays}d`].filter(Boolean).join(' ')).join(' · ')}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

export function RxTemplates() {
  const { can } = useTenantAuth();
  const { data, loading, error, reload } = useApi(() => api.get('/opd/templates?all=true'), []);
  const [editing, setEditing] = useState(null);
  return (
    <>
      <Link to="/app/opd" className="mb-4 flex items-center gap-1 text-sm font-medium text-forest-700"><LuArrowLeft aria-hidden /> OPD</Link>
      <PageHeader title="Prescription templates" subtitle="Ready-made sets of medicines (with diagnosis and advice) that doctors apply in one click and then adjust."
        actions={can('opd.write') && <Button onClick={() => setEditing('new')}><LuPlus aria-hidden /> New template</Button>} />
      <Card>
        <DataTable loading={loading} error={error} rows={data} onRowClick={can('opd.write') ? (t) => setEditing(t) : undefined}
          empty={<EmptyState icon={LuClipboardList} title="No templates yet" />}
          columns={[
            { key: 'name', label: 'Template', render: (t) => <span className="font-medium">{t.name} {!t.isActive && <Badge tone="gray">Inactive</Badge>}</span> },
            { key: 'doctorName', label: 'Doctor', render: (t) => t.doctorName || 'Shared' },
            { key: 'diagnosis', label: 'Diagnosis', render: (t) => <span className="line-clamp-1">{t.diagnosis || '—'}</span> },
            { key: 'items', label: 'Medicines', render: (t) => t.items.length },
            { key: 'del', label: <span className="sr-only">Delete</span>, className: 'text-right', render: (t) => can('opd.write') && <Button size="sm" variant="ghost" aria-label={`Delete ${t.name}`} onClick={async (e) => { e.stopPropagation(); if (window.confirm(`Delete template “${t.name}”?`) && await withToast(() => api.del(`/opd/templates/${t.id}`), 'Template deleted.')) reload(); }}><LuTrash2 aria-hidden /></Button> },
          ]} />
      </Card>
      <TemplateEditor open={Boolean(editing)} template={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
    </>
  );
}

const VIEWS = [['week', 'Due ±7 days'], ['overdue', 'Overdue'], ['today', 'Today'], ['all', 'All open']];
const BUCKET = { overdue: ['red', 'Overdue'], today: ['gold', 'Today'], upcoming: ['blue', 'Upcoming'] };
export function FollowUps() {
  const { can } = useTenantAuth();
  const [view, setView] = useState('week');
  const [doctorId, setDoctorId] = useState('');
  const { data, loading, error } = useApi(() => api.get(`/opd/follow-ups${qs({ view, doctorId })}`), [view, doctorId]);
  return (
    <>
      <PageHeader title="Follow-ups" subtitle="Patients a doctor asked to see again who have not yet come back or booked. Reminders go out automatically the day before." />
      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
          <div className="flex gap-1 rounded-lg border border-line bg-white p-1" role="tablist">
            {VIEWS.map(([k, l]) => <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)} className={cx('rounded-md px-3 py-1.5 text-sm font-semibold', view === k ? 'bg-forest-900 text-white' : 'text-forest-800 hover:bg-forest-50')}>{l}</button>)}
          </div>
          <div className="w-64"><DoctorSelect label="Doctor" placeholder="All doctors" value={doctorId} onChange={setDoctorId} /></div>
        </div>
        <DataTable loading={loading} error={error} rows={data} rowKey="consultationId" empty={<EmptyState title="No follow-ups here" />}
          columns={[
            { key: 'followUpDate', label: 'Due', render: (r) => <span className="whitespace-nowrap">{date(`${r.followUpDate}T00:00:00Z`, 'UTC')} <Badge tone={BUCKET[r.bucket][0]}>{BUCKET[r.bucket][1]}</Badge></span> },
            { key: 'patient', label: 'Patient', render: (r) => <div><Link className="font-medium text-forest-800 hover:underline" to={`/app/patients/${r.patientId}`}>{fullName(r.patientFirstName, r.patientLastName)}</Link><p className="text-xs text-muted">{r.patientNumber} · {formatPhone(r.phone) || 'no phone'}</p></div> },
            { key: 'doctorName', label: 'Doctor' },
            { key: 'diagnosis', label: 'Last diagnosis', render: (r) => <span className="line-clamp-1">{r.diagnosis || '—'}</span> },
            { key: 'last', label: 'Last visit', render: (r) => <Link className="text-xs text-forest-700 underline" to={`/app/opd/${r.consultationId}`}>{r.consultationNumber}</Link> },
            { key: 'book', label: <span className="sr-only">Book</span>, className: 'text-right', render: (r) => can('appointments.write') && <Button size="sm" variant="outline" to={`/app/appointments?new=1&patientId=${r.patientId}&doctorId=${r.doctorId}&date=${r.followUpDate}`}><LuCalendarPlus aria-hidden /> Book</Button> },
          ]} />
      </Card>
    </>
  );
}
