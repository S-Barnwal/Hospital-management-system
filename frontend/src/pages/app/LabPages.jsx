// Laboratory master data and work queues: Tests, Packages (+ price history), Samples, Results, Referral doctors.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LuPlus, LuFlaskConical, LuPencil, LuTrash2, LuSearch, LuIndianRupee, LuArrowLeft, LuPackage, LuTestTubes, LuClipboardCheck, LuUserRound, LuListTree, LuUpload, LuDownload, LuLayers, LuSlidersHorizontal } from 'react-icons/lu';
import { api, qs } from '../../lib/api.js';
import { useApi, useDebounced, useForm } from '../../lib/hooks.js';
import { useTenantAuth } from '../../context/AuthContext.jsx';
import { notify, withToast } from '../../lib/toast.js';
import { dateTime, fullName, money, titleCase } from '../../lib/format.js';
import { Alert, Badge, Button, Card, DataTable, EmptyState, Input, Modal, PageHeader, Pagination, Select, Skeleton, StatusBadge, Textarea, cx } from '../../components/ui.jsx';
import PhoneInput from '../../components/PhoneInput.jsx';
import EmailInput from '../../components/EmailInput.jsx';
import { formatPhone } from '../../lib/contact.js';
import { ParametersModal } from './LabExtras.jsx';
import { csvToObjects, downloadText, toCsv } from '../../lib/csv.js';

const ActiveBadge = ({ on }) => <Badge tone={on ? 'green' : 'gray'}>{on ? 'Active' : 'Inactive'}</Badge>;
const confirmDelete = (msg) => window.confirm(msg);

function SearchBar({ value, onChange, placeholder, children }) {
  return (
    <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-end">
      <div className="relative flex-1">
        <Input label="Search" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
        <LuSearch className="pointer-events-none absolute right-3 top-[38px] text-muted" aria-hidden />
      </div>
      {children}
    </div>
  );
}

function DepartmentInput({ f, name = 'department' }) {
  const { data } = useApi(() => api.get('/lab/departments'), []);
  return (
    <>
      <Input label="Department" list="lab-departments" placeholder="e.g. Biochemistry" {...f.bind(name)} error={f.errors[name]} />
      <datalist id="lab-departments">{(data || []).map((d) => <option key={d.id} value={d.name} />)}</datalist>
    </>
  );
}

// ───────────────────────── Tests ─────────────────────────
export function LabTests() {
  const { can } = useTenantAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const search = useDebounced(q);
  const { data: depts, reload: reloadDepts } = useApi(() => api.get('/lab/departments?all=true'), []);
  const { data, loading, error, reload } = useApi(() => api.get(`/lab/tests${qs({ all: 'true', q: search, departmentId: dept })}`), [search, dept]);
  const [editing, setEditing] = useState(null);
  const [paramsFor, setParamsFor] = useState(null);
  const [deptsOpen, setDeptsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(null);
  const [rangesFor, setRangesFor] = useState(null);
  const f = useForm({});
  useEffect(() => {
    if (editing) f.setValues(editing === 'new' ? { ...BLANK_TEST }
      : { ...Object.fromEntries(Object.entries(editing).map(([k, v]) => [k, v ?? ''])), departmentId: editing.departmentId ? String(editing.departmentId) : '',
        options: (editing.options || []).join('\n'), isActive: editing.isActive, priceReason: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  const priceChanged = editing && editing !== 'new' && Number(f.values.price) !== Number(editing.price);
  const activeDepts = (depts || []).filter((d) => d.isActive || String(d.id) === String(f.values.departmentId));
  const save = f.submit(async (v) => {
    const body = { code: v.code, name: v.name, departmentId: v.departmentId ? Number(v.departmentId) : null, description: v.description || null, sampleType: v.sampleType || null, unit: v.unit || null,
      refLow: v.refLow, refHigh: v.refHigh, refText: v.refText || null, price: v.price, isActive: Boolean(v.isActive), ...(priceChanged && v.priceReason ? { priceReason: v.priceReason } : {}),
      method: v.method || null, instrument: v.instrument || null, interpretation: v.interpretation || null, inputType: v.inputType || 'numeric',
      options: v.inputType === 'option' ? splitOptions(v.options) : [], decimals: v.decimals, tatHours: v.tatHours, sortOrder: v.sortOrder,
      criticalLow: v.inputType === 'numeric' ? v.criticalLow : null, criticalHigh: v.inputType === 'numeric' ? v.criticalHigh : null };
    if (editing === 'new') await api.post('/lab/tests', body); else await api.put(`/lab/tests/${editing.id}`, body);
    notify.success(editing === 'new' ? 'Test added.' : 'Test updated.');
    setEditing(null); reload();
  });
  return (
    <>
      <PageHeader title="Tests" subtitle="Your lab’s test menu with reference ranges and prices."
        actions={can('lab.configure') && <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setDeptsOpen(true)}><LuLayers aria-hidden /> Departments</Button>
          <Button variant="outline" onClick={() => setImportOpen('tests')}><LuUpload aria-hidden /> Import CSV</Button>
          <Button variant="outline" onClick={() => setImportOpen('ranges')}><LuUpload aria-hidden /> Import ranges</Button>
          <Button onClick={() => setEditing('new')}><LuPlus aria-hidden /> New test</Button>
        </div>} />
      <Card>
        <SearchBar value={q} onChange={setQ} placeholder="Search name, code…">
          <Select label="Department" placeholder="All departments" className="sm:w-56" value={dept} onChange={(e) => setDept(e.target.value)} options={(depts || []).map((d) => ({ value: String(d.id), label: d.name }))} />
        </SearchBar>
        <DataTable loading={loading} error={error} rows={data} empty={<EmptyState icon={LuFlaskConical} title="No tests found" />}
          columns={[
            { key: 'code', label: 'Code', render: (t) => <span className="font-mono text-xs">{t.code}</span> },
            { key: 'name', label: 'Test name', render: (t) => <span className="font-medium">{t.name}</span> },
            { key: 'department', label: 'Department', render: (t) => t.department || '—' },
            { key: 'sampleType', label: 'Sample', render: (t) => t.sampleType || '—' },
            { key: 'range', label: 'Reference range', render: (t) => (t.inputType === 'option' ? <span className="text-xs">{t.options.join(' / ')}</span>
              : <>{t.refLow != null || t.refHigh != null ? `${t.refLow ?? ''} – ${t.refHigh ?? ''} ${t.unit ?? ''}` : t.refText || '—'}
                {t.rangeCount > 0 && <span className="block text-xs text-forest-700">+ {t.rangeCount} age/gender range{t.rangeCount > 1 ? 's' : ''}</span>}</>) },
            { key: 'tatHours', label: 'TAT', render: (t) => (t.tatHours ? `${t.tatHours} h` : '—') },
            { key: 'price', label: 'Price', className: 'text-right', render: (t) => money(t.price) },
            { key: 'isActive', label: 'Status', render: (t) => <ActiveBadge on={t.isActive} /> },
            { key: 'act', label: 'Actions', className: 'text-right', render: (t) => (
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" onClick={() => navigate(`/app/lab-prices/test/${t.id}`)} aria-label="Price history" title="Price history"><LuIndianRupee aria-hidden /></Button>
                <Button size="sm" variant="ghost" onClick={() => setRangesFor(t)} aria-label="Ranges" title="Age / gender ranges & critical values"><LuSlidersHorizontal aria-hidden />{t.rangeCount > 0 && <span className="text-xs">{t.rangeCount}</span>}</Button>
                <Button size="sm" variant="ghost" onClick={() => setParamsFor(t)} aria-label="Parameters" title="Parameters (panel)"><LuListTree aria-hidden />{t.parameterCount > 0 && <span className="text-xs">{t.parameterCount}</span>}</Button>
                {can('lab.configure') && <Button size="sm" variant="ghost" onClick={() => setEditing(t)} aria-label="Edit" title="Edit"><LuPencil aria-hidden /></Button>}
                {can('lab.configure') && <Button size="sm" variant="ghost" aria-label="Delete" title="Delete" onClick={async () => { if (confirmDelete(`Delete test “${t.name}”? Only possible if it was never ordered and is in no package.`) && (await withToast(() => api.del(`/lab/tests/${t.id}`), 'Test deleted.'))) reload(); }}><LuTrash2 aria-hidden /></Button>}
              </div>) },
          ]} />
      </Card>
      {paramsFor && <ParametersModal test={paramsFor} onClose={(changed) => { setParamsFor(null); if (changed) reload(); }} />}
      {deptsOpen && <DepartmentsModal onClose={() => { setDeptsOpen(false); reloadDepts(); reload(); }} />}
      {importOpen && <ImportModal kind={importOpen} onClose={(changed) => { setImportOpen(null); if (changed) { reload(); reloadDepts(); } }} />}
      {rangesFor && <RangesModal test={rangesFor} onClose={(changed) => { setRangesFor(null); if (changed) reload(); }} />}
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing === 'new' ? 'New test' : `Edit test — ${editing?.code ?? ''}`} size="lg"
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save} loading={f.submitting}>Save</Button></>}>
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-2" noValidate>
          <Input label="Code" required {...f.bind('code')} error={f.errors.code} hint="Short unique code, e.g. CBC" />
          <Input label="Test name" required {...f.bind('name')} error={f.errors.name} />
          <Select label="Department" placeholder="— None —" {...f.bind('departmentId')} error={f.errors.departmentId}
            options={activeDepts.map((d) => ({ value: String(d.id), label: d.isActive ? d.name : `${d.name} (off)` }))} hint="Groups and orders tests on the report" />
          <Input label="Sample type" list="sample-types" {...f.bind('sampleType')} hint="Tests with the same sample type share one sample" />
          <datalist id="sample-types">{['Blood', 'Serum', 'Plasma', 'Urine', 'Stool', 'Swab', 'Sputum', 'CSF'].map((s) => <option key={s} value={s} />)}</datalist>
          <Input label="Unit" {...f.bind('unit')} />
          <Input label="Price (₹)" type="number" min="0" step="0.01" required {...f.bind('price')} error={f.errors.price} />
          <Select label="Result type" {...f.bind('inputType')} options={INPUT_TYPE_OPTIONS} hint="Single-result tests; panel parameters have their own" />
          <Input label="Decimals shown" type="number" min="0" max="6" {...f.bind('decimals')} error={f.errors.decimals} hint="Blank = as entered" />
          {f.values.inputType === 'option' && <Textarea label="Dropdown choices (one per line)" required {...f.bind('options')} error={f.errors.options} className="sm:col-span-2" placeholder={'Positive\nNegative'} />}
          <Input label="Ref. low" type="number" step="any" {...f.bind('refLow')} error={f.errors.refLow} />
          <Input label="Ref. high" type="number" step="any" {...f.bind('refHigh')} error={f.errors.refHigh} />
          {(f.values.inputType || 'numeric') === 'numeric' && <>
            <Input label="Critical low" type="number" step="any" {...f.bind('criticalLow')} error={f.errors.criticalLow} hint="Below this: critical alert" />
            <Input label="Critical high" type="number" step="any" {...f.bind('criticalHigh')} error={f.errors.criticalHigh} hint="Above this: critical alert" />
          </>}
          <Input label="Reference text (non-numeric results)" {...f.bind('refText')} className="sm:col-span-2" hint="Default range. Age / gender ranges: “Ranges” button in the list" />
          <Input label="Method" {...f.bind('method')} error={f.errors.method} placeholder="e.g. Photometry" />
          <Input label="Instrument" {...f.bind('instrument')} error={f.errors.instrument} />
          <Input label="Turnaround time (hours)" type="number" min="1" max="2160" {...f.bind('tatHours')} error={f.errors.tatHours} />
          <Input label="Order in department" type="number" min="0" max="9999" {...f.bind('sortOrder')} error={f.errors.sortOrder} hint="Lower numbers print first" />
          <Textarea label="Interpretation (printed under the result)" {...f.bind('interpretation')} error={f.errors.interpretation} className="sm:col-span-2" hint="Entered and checked by your lab; printed as written" />
          <Textarea label="Description" {...f.bind('description')} className="sm:col-span-2" />
          {priceChanged && <Input label="Reason for price change" {...f.bind('priceReason')} className="sm:col-span-2" hint="Saved in the price history" />}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-forest-800" checked={Boolean(f.values.isActive)} onChange={(e) => f.setValues((s) => ({ ...s, isActive: e.target.checked }))} /> Active (available for new orders)</label>
          {f.formError && <Alert tone="error" className="sm:col-span-2">{f.formError}</Alert>}
        </form>
      </Modal>
    </>
  );
}

const BLANK_TEST = { code: '', name: '', departmentId: '', description: '', sampleType: 'Blood', unit: '', refLow: '', refHigh: '', refText: '', price: '0', isActive: true,
  method: '', instrument: '', interpretation: '', inputType: 'numeric', options: '', decimals: '', tatHours: '', sortOrder: '', criticalLow: '', criticalHigh: '' };
const INPUT_TYPE_OPTIONS = [{ value: 'numeric', label: 'Number' }, { value: 'text', label: 'Free text' }, { value: 'option', label: 'Dropdown (choices)' }];
const splitOptions = (text) => String(text || '').split(/\r?\n|\|/).map((x) => x.trim()).filter(Boolean);

/** Department master: rename, reorder, switch off; delete only when no test uses it. */
function DepartmentsModal({ onClose }) {
  const { data, loading, error, reload } = useApi(() => api.get('/lab/departments?all=true'), []);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(null);
  const [newDept, setNewDept] = useState({ name: '', sortOrder: '100' });
  useEffect(() => { if (data) setRows(data.map((d) => ({ ...d, sortOrder: String(d.sortOrder) }))); }, [data]);
  const set = (id, k, v) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [k]: v } : r)));
  const saveRow = async (r) => {
    setBusy(r.id);
    if (await withToast(() => api.put(`/lab/departments/${r.id}`, { name: r.name.trim(), sortOrder: Number(r.sortOrder || 0), isActive: r.isActive }), 'Department saved.')) reload();
    setBusy(null);
  };
  const add = async () => {
    setBusy('new');
    if (await withToast(() => api.post('/lab/departments', { name: newDept.name.trim(), sortOrder: Number(newDept.sortOrder || 0) }), 'Department added.')) { setNewDept({ name: '', sortOrder: '100' }); reload(); }
    setBusy(null);
  };
  const remove = async (r) => {
    if (!confirmDelete(`Delete department “${r.name}”?`)) return;
    setBusy(r.id);
    if (await withToast(() => api.del(`/lab/departments/${r.id}`), 'Department deleted.')) reload();
    setBusy(null);
  };
  return (
    <Modal open onClose={onClose} size="lg" title="Lab departments" footer={<Button onClick={onClose}>Done</Button>}>
      <p className="mb-3 text-sm text-muted">Reports group tests by department, in this order (lower numbers first). Switch a department off to hide it from new tests without changing old reports.</p>
      {error && <Alert tone="error">{error.message}</Alert>}
      {loading && !data ? <Skeleton className="h-32 w-full" /> : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="grid grid-cols-2 items-end gap-2 rounded-lg border border-line p-2 sm:grid-cols-12">
              <Input label="Name" className="col-span-2 sm:col-span-5" value={r.name} onChange={(e) => set(r.id, 'name', e.target.value)} />
              <Input label="Order" type="number" min="0" max="9999" className="sm:col-span-2" value={r.sortOrder} onChange={(e) => set(r.id, 'sortOrder', e.target.value)} />
              <label className="mb-2 flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="accent-forest-800" checked={r.isActive} onChange={(e) => set(r.id, 'isActive', e.target.checked)} /> Active</label>
              <span className="mb-2 text-xs text-muted sm:col-span-1">{r.testCount} tests</span>
              <div className="col-span-2 flex justify-end gap-1 sm:col-span-2">
                <Button size="sm" variant="outline" loading={busy === r.id} onClick={() => saveRow(r)}>Save</Button>
                <Button size="sm" variant="ghost" aria-label={`Delete ${r.name}`} title="Delete" disabled={r.testCount > 0} onClick={() => remove(r)}><LuTrash2 aria-hidden /></Button>
              </div>
            </div>
          ))}
          <div className="grid grid-cols-2 items-end gap-2 rounded-lg border border-dashed border-line p-2 sm:grid-cols-12">
            <Input label="New department" className="col-span-2 sm:col-span-7" value={newDept.name} onChange={(e) => setNewDept((s) => ({ ...s, name: e.target.value }))} placeholder="e.g. Molecular Biology" />
            <Input label="Order" type="number" min="0" max="9999" className="sm:col-span-2" value={newDept.sortOrder} onChange={(e) => setNewDept((s) => ({ ...s, sortOrder: e.target.value }))} />
            <Button className="sm:col-span-3" variant="outline" loading={busy === 'new'} disabled={newDept.name.trim().length < 2} onClick={add}><LuPlus aria-hidden /> Add</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

const IMPORT_KINDS = {
  tests: {
    title: 'Import tests from CSV', endpoint: '/lab/tests/import', maxRows: 500, file: 'lab-tests-template.csv',
    columns: ['code', 'name', 'department', 'sampleType', 'unit', 'refLow', 'refHigh', 'refText', 'criticalLow', 'criticalHigh', 'price', 'inputType', 'options', 'decimals', 'method', 'instrument', 'tatHours', 'interpretation'],
    examples: [['GLU-F', 'Glucose fasting (example)', 'Biochemistry', 'Serum', 'mg/dL', '', '', '', '', '', '0', 'numeric', '', '0', '', '', '', ''],
      ['HBSAG-EX', 'HBsAg (example)', 'Serology & Immunology', 'Serum', '', '', '', '', '', '', '0', 'option', 'Reactive|Non-reactive', '', '', '', '', '']],
    help: 'One test per line. Ranges, units and interpretations are imported exactly as written — your lab must check them before use. Missing departments are created. Panel parameters are added afterwards from the test list.',
    ready: (c) => `Ready: ${c.create} new, ${c.update} to update, ${c.skip} skipped.${c.newDepartments?.length ? ` New departments: ${c.newDepartments.join(', ')}.` : ''}`,
    done: (c) => `Imported: ${c.create} new, ${c.update} updated, ${c.skip} skipped.`,
    canImport: (c) => c.create + c.update > 0,
  },
  ranges: {
    title: 'Import age / gender ranges from CSV', endpoint: '/lab/ranges/import', maxRows: 2000, file: 'lab-ranges-template.csv',
    columns: ['testCode', 'parameter', 'gender', 'ageFrom', 'ageFromUnit', 'ageTo', 'ageToUnit', 'low', 'high', 'text', 'criticalLow', 'criticalHigh'],
    examples: [['CBC', 'Haemoglobin', 'male', '18', 'y', '', 'y', '', '', '', '', ''], ['CBC', 'Haemoglobin', 'female', '18', 'y', '', 'y', '', '', '', '', '']],
    help: 'One range per line: test code, parameter name (blank for a single-result test), gender any / male / female, age band from–to (to is not included; blank = no limit) in d / m / y. The file REPLACES all ranges of every test it names. Values are your lab’s own — the template rows are only examples to fill in.',
    ready: (c) => `Ready: ${c.ranges} ranges for ${c.tests} test(s). Existing ranges of these tests will be replaced.`,
    done: (c) => `Imported ${c.ranges} ranges for ${c.tests} test(s).`,
    canImport: (c) => c.ranges > 0,
  },
};

/** CSV import (tests or ranges): check first (nothing saved), then import. All-or-nothing on the server. */
function ImportModal({ kind, onClose }) {
  const K = IMPORT_KINDS[kind];
  const [rows, setRows] = useState(null);
  const [fileName, setFileName] = useState('');
  const [mode, setMode] = useState('skip');
  const [check, setCheck] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const template = () => downloadText(K.file, `${toCsv([K.columns, ...K.examples])}\r\n`);
  const readFile = async (file) => {
    setErr(null); setCheck(null); setRows(null); setFileName(file?.name || '');
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setErr('The file is larger than 2 MB.'); return; }
    const list = csvToObjects(await file.text());
    if (!list.length) { setErr('No rows found. The first line must be the column names (download the template).'); return; }
    if (list.length > K.maxRows) { setErr(`The file has ${list.length} rows; import at most ${K.maxRows} at a time.`); return; }
    setRows(list);
  };
  const run = async (dryRun) => {
    setBusy(true); setErr(null);
    try {
      const r = await api.post(K.endpoint, { rows, dryRun, ...(kind === 'tests' ? { mode } : {}) });
      if (dryRun) setCheck(r.data);
      else { notify.success(K.done(r.data)); onClose(true); }
    } catch (e) { setErr(e.message); if (e.details) setCheck((c) => ({ ...(c || {}), errors: e.details.map((d) => ({ line: d.path, message: d.message })) })); }
    finally { setBusy(false); }
  };
  const canImport = check && !check.errors?.length && K.canImport(check);
  return (
    <Modal open onClose={() => onClose(false)} size="lg" title={K.title}
      footer={<><Button variant="ghost" onClick={() => onClose(false)}>Cancel</Button>
        <Button variant="outline" disabled={!rows} loading={busy && !check} onClick={() => run(true)}>Check file</Button>
        <Button disabled={!canImport} loading={busy && Boolean(check)} onClick={() => run(false)}>Import</Button></>}>
      <div className="space-y-3 text-sm">
        <p className="text-muted">{K.help}</p>
        <Button size="sm" variant="ghost" onClick={template}><LuDownload aria-hidden /> Download template</Button>
        <Input label="CSV file" type="file" accept=".csv,text/csv" onChange={(e) => readFile(e.target.files?.[0])} hint={fileName && rows ? `${fileName}: ${rows.length} rows` : `Up to ${K.maxRows} rows, 2 MB`} />
        {kind === 'tests' && <Select label="Codes that already exist" value={mode} onChange={(e) => { setMode(e.target.value); setCheck(null); }}
          options={[{ value: 'skip', label: 'Skip them (keep my current tests)' }, { value: 'update', label: 'Update them from the file' }]} />}
        {check && (
          <Alert tone={check.errors?.length ? 'error' : 'success'}>
            {check.errors?.length ? `${check.errors.length} line(s) need fixing — nothing will be saved until the file is correct.` : K.ready(check)}
          </Alert>
        )}
        {check?.errors?.length > 0 && (
          <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-line p-2 text-xs">
            {check.errors.map((e, i) => <li key={i}><span className="font-semibold">{typeof e.line === 'number' ? `Line ${e.line}` : e.line}{e.code ? ` (${e.code})` : ''}:</span> {e.message}</li>)}
          </ul>
        )}
        {err && !check?.errors?.length && <Alert tone="error">{err}</Alert>}
      </div>
    </Modal>
  );
}

const AGE_UNIT_OPTIONS = [{ value: 'd', label: 'days' }, { value: 'm', label: 'months' }, { value: 'y', label: 'years' }];
const blankRange = (parameterId = '') => ({ parameterId, gender: 'any', ageFrom: '', ageFromUnit: 'y', ageTo: '', ageToUnit: 'y', refLow: '', refHigh: '', refText: '', criticalLow: '', criticalHigh: '' });
const cellStr = (v) => (v == null ? '' : String(v));

/**
 * Age / gender ranges of one test (and of each panel parameter). The patient's age and gender pick the range when an
 * order is placed; with no match the test's default range is used.
 */
function RangesModal({ test, onClose }) {
  const { can } = useTenantAuth();
  const { data, loading, error } = useApi(() => api.get(`/lab/tests/${test.id}/ranges`), [test.id]);
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => {
    if (data) setRows(data.ranges.map((x) => ({ ...Object.fromEntries(Object.entries(x).map(([k, v]) => [k, cellStr(v)])), ageFrom: x.ageFrom ? String(x.ageFrom) : '' })));
  }, [data]);
  const targets = data ? [{ value: '', label: data.parameters.length ? `${test.name} (whole test)` : test.name },
    ...data.parameters.map((p) => ({ value: String(p.id), label: p.name }))] : [];
  const set = (i, k, v) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.put(`/lab/tests/${test.id}/ranges`, { ranges: rows.map(({ id: _id, sortOrder: _s, ...x }) => x) });
      notify.success(`${r.data.count} range(s) saved. New orders use them; old reports keep their ranges.`);
      onClose(true);
    } catch (e) { setErr(e.details?.length ? e.details.map((d) => d.message).join(' · ') : e.message); } finally { setBusy(false); }
  };
  const defaults = (pid) => {
    const d = pid ? data.parameters.find((p) => String(p.id) === pid) : data.test;
    if (!d) return '';
    const rng = d.refLow != null || d.refHigh != null ? `${d.refLow ?? ''} – ${d.refHigh ?? ''}` : d.refText || 'none';
    const crit = d.criticalLow != null || d.criticalHigh != null ? ` · critical < ${d.criticalLow ?? '—'} / > ${d.criticalHigh ?? '—'}` : '';
    return `Default: ${rng}${crit}`;
  };
  return (
    <Modal open onClose={() => onClose(false)} size="lg" title={`Ranges — ${test.name}`}
      footer={<><Button variant="ghost" onClick={() => onClose(false)}>Cancel</Button>{can('lab.configure') && <Button onClick={save} loading={busy} disabled={!rows}>Save ranges</Button>}</>}>
      <p className="mb-3 text-sm text-muted">Add a row per gender and age band. The age band includes “from” and stops before “to” (blank “to” = no upper limit).
        When an order is placed, the narrowest band for the patient’s gender wins; with no match the default range below is used. Critical values raise an alert that must be acknowledged before verifying.</p>
      {error && <Alert tone="error">{error.message}</Alert>}
      {loading || !rows ? <Skeleton className="h-32 w-full" /> : (
        <div className="space-y-2">
          {rows.map((x, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-line p-2">
              <div className="flex flex-wrap items-end gap-2">
                {targets.length > 1 && <Select label="For" className="min-w-40 flex-1" value={x.parameterId} onChange={(e) => set(i, 'parameterId', e.target.value)} options={targets} />}
                <Select label="Gender" className="w-28" value={x.gender} onChange={(e) => set(i, 'gender', e.target.value)}
                  options={[{ value: 'any', label: 'Any' }, { value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }]} />
                <Input label="Age from" type="number" min="0" className="w-20" value={x.ageFrom} onChange={(e) => set(i, 'ageFrom', e.target.value)} placeholder="0" />
                <Select label="Unit" className="w-24" value={x.ageFromUnit} onChange={(e) => set(i, 'ageFromUnit', e.target.value)} options={AGE_UNIT_OPTIONS} aria-label="Age from unit" />
                <Input label="Age to" type="number" min="1" className="w-20" value={x.ageTo} onChange={(e) => set(i, 'ageTo', e.target.value)} placeholder="—" />
                <Select label="Unit" className="w-24" value={x.ageToUnit} onChange={(e) => set(i, 'ageToUnit', e.target.value)} options={AGE_UNIT_OPTIONS} aria-label="Age to unit" />
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <Input label="Low" type="number" step="any" className="w-24" value={x.refLow} onChange={(e) => set(i, 'refLow', e.target.value)} />
                <Input label="High" type="number" step="any" className="w-24" value={x.refHigh} onChange={(e) => set(i, 'refHigh', e.target.value)} />
                <Input label="Text" className="w-32" value={x.refText} onChange={(e) => set(i, 'refText', e.target.value)} placeholder="e.g. Negative" />
                <Input label="Critical low" type="number" step="any" className="w-24" value={x.criticalLow} onChange={(e) => set(i, 'criticalLow', e.target.value)} />
                <Input label="Critical high" type="number" step="any" className="w-24" value={x.criticalHigh} onChange={(e) => set(i, 'criticalHigh', e.target.value)} />
                <span className="mb-2 flex-1 text-xs text-muted">{defaults(x.parameterId)}</span>
                <Button size="sm" variant="ghost" className="mb-1" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label={`Remove range ${i + 1}`}><LuTrash2 aria-hidden /></Button>
              </div>
            </div>
          ))}
          {rows.length === 0 && <p className="rounded-lg bg-ivory p-3 text-sm text-muted">No age / gender ranges — every patient gets the default range ({defaults('').replace('Default: ', '')}).</p>}
          {can('lab.configure') && <Button size="sm" variant="outline" onClick={() => setRows((rs) => [...rs, blankRange(rs.at(-1)?.parameterId ?? '')])}><LuPlus aria-hidden /> Add range</Button>}
        </div>
      )}
      {err && <Alert tone="error" className="mt-3">{err}</Alert>}
    </Modal>
  );
}

// ───────────────────────── Packages ─────────────────────────
export function LabPackages() {
  const { can } = useTenantAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const search = useDebounced(q);
  const { data, loading, error, reload } = useApi(() => api.get(`/lab/packages${qs({ all: 'true', q: search })}`), [search]);
  return (
    <>
      <PageHeader title="Packages" subtitle="Bundles of tests sold together at a package price."
        actions={can('lab.configure') && <Button to="/app/lab-packages/new"><LuPlus aria-hidden /> New package</Button>} />
      <Card>
        <SearchBar value={q} onChange={setQ} placeholder="Search name, code…" />
        <DataTable loading={loading} error={error} rows={data} empty={<EmptyState icon={LuPackage} title="No packages yet">Create a package such as “Full body check-up”.</EmptyState>}
          columns={[
            { key: 'code', label: 'Code', render: (p) => <span className="whitespace-nowrap font-mono text-xs">{p.code}</span> },
            { key: 'name', label: 'Package name', render: (p) => <span className="font-medium">{p.name}</span> },
            { key: 'department', label: 'Department', render: (p) => p.department || '—' },
            { key: 'testCount', label: '# Tests', className: 'text-right' },
            { key: 'individualTotal', label: 'Individual total', className: 'text-right', render: (p) => money(p.individualTotal) },
            { key: 'price', label: 'Package price', className: 'text-right', render: (p) => <span className="font-semibold">{money(p.price)}</span> },
            { key: 'savings', label: 'Savings', className: 'text-right', render: (p) => <span className={Number(p.savings) >= 0 ? 'text-forest-700' : 'text-red-700'}>{money(p.savings)}</span> },
            { key: 'isActive', label: 'Status', render: (p) => <ActiveBadge on={p.isActive} /> },
            { key: 'act', label: 'Actions', className: 'text-right', render: (p) => (
              <div className="flex justify-end gap-1">
                {can('lab.configure') && <Button size="sm" variant="ghost" onClick={() => navigate(`/app/lab-packages/${p.id}/edit`)} aria-label="Edit" title="Edit"><LuPencil aria-hidden /></Button>}
                <Button size="sm" variant="ghost" onClick={() => navigate(`/app/lab-prices/package/${p.id}`)} aria-label="Price history" title="Price history"><LuIndianRupee aria-hidden /></Button>
                {can('lab.configure') && <Button size="sm" variant="ghost" aria-label="Delete" title="Delete" onClick={async () => { if (confirmDelete(`Delete package “${p.name}”? Only possible if it was never ordered.`) && (await withToast(() => api.del(`/lab/packages/${p.id}`), 'Package deleted.'))) reload(); }}><LuTrash2 aria-hidden /></Button>}
              </div>) },
          ]} />
      </Card>
    </>
  );
}

export function PackageForm() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const { data: tests } = useApi(() => api.get('/lab/tests?all=true'), []);
  const { data: pkg, loading, error } = useApi(() => (isNew ? Promise.resolve({ data: null }) : api.get(`/lab/packages/${id}`)), [id]);
  const f = useForm({ name: '', department: '', description: '', price: '', isActive: 'true' });
  const [selected, setSelected] = useState([]);
  const [filter, setFilter] = useState('');
  useEffect(() => {
    if (pkg) {
      f.setValues({ name: pkg.name, department: pkg.department ?? '', description: pkg.description ?? '', isActive: pkg.isActive ? 'true' : 'false' });
      setSelected(pkg.testIds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pkg]);
  const chosen = (tests || []).filter((t) => selected.includes(t.id));
  const individual = chosen.reduce((a, t) => a + Number(t.price), 0);
  const save = f.submit(async (v) => {
    if (!selected.length) { const e = new Error('Select at least one test.'); throw e; }
    const body = { name: v.name, department: v.department || null, description: v.description || null, isActive: v.isActive === 'true', testIds: selected };
    if (isNew) { const r = await api.post('/lab/packages', { ...body, price: v.price }); notify.success(`Package ${r.data.code} created.`); }
    else { await api.put(`/lab/packages/${id}`, body); notify.success('Package updated.'); }
    navigate('/app/lab-packages');
  });
  if (error) return <Alert tone="error">{error.status === 404 ? 'Package not found.' : error.message}</Alert>;
  if (!isNew && loading) return <Skeleton className="h-64 w-full" />;
  const shown = (tests || []).filter((t) => !filter || `${t.name} ${t.code}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <>
      <Link to="/app/lab-packages" className="mb-4 flex items-center gap-1 text-sm font-medium text-forest-700"><LuArrowLeft aria-hidden /> Packages</Link>
      <PageHeader title={isNew ? 'New package' : `Edit package — ${pkg?.code}`} />
      <Card className="p-5">
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-6" noValidate>
          <Input label="Package name" required className="sm:col-span-3" {...f.bind('name')} error={f.errors.name} />
          <div className="sm:col-span-2"><DepartmentInput f={f} /></div>
          <Select label="Status" className="sm:col-span-1" options={[{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }]} {...f.bind('isActive')} />
          <Textarea label="Description" className="sm:col-span-6" {...f.bind('description')} />
          <div className="sm:col-span-6">
            <p className="label">Included tests <span className="text-gold-700">*</span> <span className="font-normal text-muted">({selected.length} selected · individual total {money(individual)})</span></p>
            <Input placeholder="Filter tests…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <div className="mt-2 max-h-80 overflow-y-auto rounded-lg border border-line">
              <table className="table-base">
                <thead className="bg-forest-50/40"><tr><th className="w-10"><span className="sr-only">Select</span></th><th>Test</th><th className="text-right">Price</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {shown.map((t) => (
                    <tr key={t.id} className={cx('cursor-pointer', selected.includes(t.id) && 'bg-forest-50/60')} onClick={() => setSelected((s) => (s.includes(t.id) ? s.filter((x) => x !== t.id) : [...s, t.id]))}>
                      <td><input type="checkbox" className="accent-forest-800" checked={selected.includes(t.id)} readOnly aria-label={`Include ${t.name}`} /></td>
                      <td>{t.name} <span className="text-xs text-muted">({t.code})</span>{!t.isActive && <Badge tone="gray" className="ml-2">Inactive</Badge>}</td>
                      <td className="text-right">{money(t.price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {isNew ? (
            <div className="sm:col-span-2">
              <Input label="Package price (₹)" required type="number" min="0" step="0.01" {...f.bind('price')} error={f.errors.price}
                hint={f.values.price !== '' ? `Patient saves ${money(individual - Number(f.values.price || 0))}` : 'Usually less than the individual total'} />
            </div>
          ) : (
            <p className="text-sm text-muted sm:col-span-6">Current price: <strong className="text-ink">{money(pkg.price)}</strong>. To change it, use <Link className="font-semibold text-forest-700 underline" to={`/app/lab-prices/package/${id}`}>Price history</Link> so every change keeps a reason.</p>
          )}
          {f.formError && <Alert tone="error" className="sm:col-span-6">{f.formError}</Alert>}
          <div className="flex flex-wrap gap-2 sm:col-span-6">
            <Button type="submit" loading={f.submitting}>{isNew ? 'Create package' : 'Save changes'}</Button>
            <Button variant="outline" to="/app/lab-packages">Cancel</Button>
            {!isNew && <Button variant="outline" to={`/app/lab-prices/package/${id}`}>Price history</Button>}
          </div>
        </form>
      </Card>
    </>
  );
}

// ───────────────────────── Price history (test or package) ─────────────────────────
export function PriceHistory() {
  const { type, id } = useParams();
  const { me, can } = useTenantAuth();
  const tz = me.tenant.timezone;
  const base = type === 'package' ? 'packages' : 'tests';
  const { data, loading, error, reload } = useApi(() => api.get(`/lab/${base}/${id}/prices`), [type, id]);
  const f = useForm({ price: '', reason: '' });
  const save = f.submit(async (v) => {
    await api.post(`/lab/${base}/${id}/prices`, { price: v.price, reason: v.reason });
    notify.success('New price saved.');
    f.setValues({ price: '', reason: '' });
    reload();
  });
  if (error) return <Alert tone="error">{error.status === 404 ? 'Not found.' : error.message}</Alert>;
  if (loading && !data) return <Skeleton className="h-64 w-full" />;
  const { item, history } = data;
  const back = type === 'package' ? '/app/lab-packages' : '/app/lab-tests';
  return (
    <>
      <PageHeader title={`Price history — ${item.name} (${item.code})`} />
      {type === 'package' && <Alert tone="info" className="mb-4">Current individual test total ({item.testCount} tests): <strong>{money(item.individualTotal)}</strong></Alert>}
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <p className="border-b border-line px-5 py-3 font-semibold">Timeline (newest first)</p>
          <ul className="divide-y divide-line">
            {history.map((h, i) => (
              <li key={h.id} className="px-5 py-3">
                <p className="flex items-center gap-2 text-lg font-semibold">{money(h.price)} {i === 0 && <Badge tone="green">Current</Badge>}</p>
                <p className="text-sm text-muted">Effective: {dateTime(h.effectiveAt, tz)}</p>
                <p className="text-sm text-muted">Reason: {h.reason}{h.changedBy ? ` · By: ${h.changedBy}` : ''}</p>
              </li>
            ))}
            {history.length === 0 && <li className="px-5 py-3 text-sm"><p className="font-semibold">{money(item.price)} <Badge tone="green">Current</Badge></p><p className="text-muted">No changes recorded yet.</p></li>}
          </ul>
        </Card>
        {can('lab.configure') && (
          <Card className="h-fit lg:col-span-2">
            <p className="border-b border-line px-5 py-3 font-semibold">Add new price</p>
            <form onSubmit={save} className="space-y-3 p-5" noValidate>
              <Input label="New price (₹)" required type="number" min="0" step="0.01" {...f.bind('price')} error={f.errors.price} />
              <Input label="Reason" required placeholder="Added test, promotional pricing…" {...f.bind('reason')} error={f.errors.reason} />
              {f.formError && <Alert tone="error">{f.formError}</Alert>}
              <Button type="submit" className="w-full" loading={f.submitting}>Save new price</Button>
            </form>
          </Card>
        )}
      </div>
      <Button variant="outline" className="mt-6" to={back}><LuArrowLeft aria-hidden /> Back to {type === 'package' ? 'packages' : 'tests'}</Button>
    </>
  );
}

// ───────────────────────── Samples ─────────────────────────
const SAMPLE_STATUSES = ['pending', 'collected', 'received', 'rejected'];
export function LabSamples() {
  const { me, can } = useTenantAuth();
  const tz = me.tenant.timezone;
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const search = useDebounced(q);
  useEffect(() => setPage(1), [search, status]);
  const { data, meta, loading, error, reload } = useApi(() => api.get(`/lab/samples${qs({ q: search, status, page })}`), [search, status, page]);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');
  const act = async (s, action, msg, body = {}) => { if (await withToast(() => api.post(`/lab/samples/${s.id}/${action}`, body), msg)) reload(); };
  return (
    <>
      <PageHeader title="Samples" subtitle="Collect, receive or reject samples. Orders move forward automatically when all their samples are collected." />
      <Card>
        <SearchBar value={q} onChange={setQ} placeholder="Sample #, order #, patient…">
          <Select label="Status" placeholder="All statuses" className="sm:w-48" value={status} onChange={(e) => setStatus(e.target.value)} options={SAMPLE_STATUSES.map((s) => ({ value: s, label: titleCase(s) }))} />
        </SearchBar>
        <DataTable loading={loading} error={error} rows={data} empty={<EmptyState icon={LuTestTubes} title="No samples found" />}
          columns={[
            { key: 'number', label: 'Sample #', render: (s) => <span className="whitespace-nowrap font-mono text-xs">{s.number}</span> },
            { key: 'orderNumber', label: 'Order #', render: (s) => <Link className="font-mono text-xs text-forest-700 underline" to={`/app/laboratory/${s.orderId}`}>{s.orderNumber}</Link> },
            { key: 'patient', label: 'Patient', render: (s) => <div><p className="font-medium">{fullName(s.patientFirstName, s.patientLastName)}</p><p className="text-xs text-muted">{s.patientNumber}</p></div> },
            { key: 'sampleType', label: 'Type', render: (s) => <div><p>{s.sampleType}</p><p className="line-clamp-1 max-w-[12rem] text-xs text-muted">{s.tests}</p></div> },
            { key: 'status', label: 'Status', render: (s) => <div><StatusBadge status={s.status} />{s.priority === 'urgent' && <Badge tone="red" className="ml-1">Urgent</Badge>}{s.status === 'rejected' && <p className="text-xs text-red-700">{s.rejectReason}</p>}</div> },
            { key: 'collectedAt', label: 'Collected', render: (s) => <span className="text-xs">{s.collectedAt ? dateTime(s.collectedAt, tz) : '—'}</span> },
            { key: 'receivedAt', label: 'Received', render: (s) => <span className="text-xs">{s.receivedAt ? dateTime(s.receivedAt, tz) : '—'}</span> },
            { key: 'act', label: 'Actions', className: 'text-right', render: (s) => can('lab.write') && (
              <div className="flex justify-end gap-1">
                {['pending', 'rejected'].includes(s.status) && <Button size="sm" onClick={() => act(s, 'collect', 'Sample collected.')}>{s.status === 'rejected' ? 'Recollect' : 'Collect'}</Button>}
                {s.status === 'collected' && <Button size="sm" variant="outline" onClick={() => act(s, 'receive', 'Sample received in lab.')}>Receive</Button>}
                {['collected', 'received'].includes(s.status) && ['ordered', 'sample_collected'].includes(s.orderStatus) && <Button size="sm" variant="ghost" onClick={() => { setRejecting(s); setReason(''); }}>Reject</Button>}
              </div>) },
          ]} />
        <Pagination meta={meta} onPage={setPage} />
      </Card>
      <Modal open={Boolean(rejecting)} onClose={() => setRejecting(null)} title={`Reject sample ${rejecting?.number ?? ''}`} size="sm"
        footer={<><Button variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button><Button variant="danger" disabled={reason.trim().length < 3} onClick={() => { const s = rejecting; setRejecting(null); act(s, 'reject', 'Sample rejected — recollect it.', { reason: reason.trim() }); }}>Reject</Button></>}>
        <Textarea label="Reason" placeholder="Haemolysed, insufficient quantity, wrong container…" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </>
  );
}

// ───────────────────────── Results & reports ─────────────────────────
const RESULT_TABS = [
  ['pending', 'Awaiting results', 'sample_collected'],
  ['review', 'Awaiting verification', 'completed'],
  ['reports', 'Verified reports', 'verified'],
];
export function LabResults() {
  const { me } = useTenantAuth();
  const tz = me.tenant.timezone;
  const navigate = useNavigate();
  const [tab, setTab] = useState('pending');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const search = useDebounced(q);
  useEffect(() => setPage(1), [tab, search]);
  const status = RESULT_TABS.find((x) => x[0] === tab)[2];
  const { data, meta, loading, error } = useApi(() => api.get(`/lab/orders${qs({ status, q: search, page })}`), [status, search, page]);
  return (
    <>
      <PageHeader title="Results & reports" subtitle="Enter results, verify them, and print verified reports." />
      <div className="mb-4 flex flex-wrap gap-1 rounded-lg border border-line bg-white p-1 sm:w-fit" role="tablist">
        {RESULT_TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx('flex-1 rounded-md px-4 py-1.5 text-sm font-semibold', tab === k ? 'bg-forest-900 text-white' : 'text-forest-800 hover:bg-forest-50')}>{l}</button>
        ))}
      </div>
      <Card>
        <SearchBar value={q} onChange={setQ} placeholder="Order #, patient name or number…" />
        <DataTable loading={loading} error={error} rows={data} onRowClick={(o) => navigate(`/app/laboratory/${o.id}`)}
          empty={<EmptyState icon={LuClipboardCheck} title={tab === 'reports' ? 'No verified reports' : 'Nothing waiting here'} />}
          columns={[
            { key: 'number', label: 'Order #', render: (o) => <div><p className="whitespace-nowrap font-mono text-xs">{o.number}</p>{o.priority === 'urgent' && <Badge tone="red">Urgent</Badge>}</div> },
            { key: 'patient', label: 'Patient', render: (o) => <div><p className="font-medium">{fullName(o.patientFirstName, o.patientLastName)}</p><p className="text-xs text-muted">{o.patientNumber}</p></div> },
            { key: 'tests', label: 'Tests', render: (o) => <span className="line-clamp-2 max-w-xs text-xs">{o.tests}</span> },
            { key: 'referralName', label: 'Referred by', render: (o) => o.referralName || o.doctorName || 'Self' },
            { key: 'when', label: tab === 'reports' ? 'Verified' : 'Ordered', render: (o) => <span className="text-xs">{dateTime(tab === 'reports' ? o.verifiedAt : o.orderedAt, tz)}</span> },
            { key: 'go', label: <span className="sr-only">Open</span>, className: 'text-right', render: () => <span className="text-sm font-semibold text-forest-700">{tab === 'pending' ? 'Enter results →' : tab === 'review' ? 'Review →' : 'View / print →'}</span> },
          ]} />
        <Pagination meta={meta} onPage={setPage} />
      </Card>
    </>
  );
}

// ───────────────────────── Referral doctors ─────────────────────────
export function ReferralDoctors() {
  const { can, hasFeature } = useTenantAuth();
  const [q, setQ] = useState('');
  const search = useDebounced(q);
  const { data, loading, error, reload } = useApi(() => api.get(`/lab/referrals${qs({ all: 'true', q: search })}`), [search]);
  const [editing, setEditing] = useState(null);
  const f = useForm({});
  useEffect(() => {
    if (editing) f.setValues(editing === 'new' ? { name: '', qualification: '', clinic: '', phone: '', email: '', commissionPercent: '0', isActive: true }
      : { ...Object.fromEntries(Object.entries(editing).map(([k, v]) => [k, v ?? ''])), isActive: editing.isActive });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  const save = f.submit(async (v) => {
    const body = { name: v.name, qualification: v.qualification || null, clinic: v.clinic || null, phone: v.phone || null, email: v.email || null,
      commissionPercent: v.commissionPercent || 0, isActive: Boolean(v.isActive) };
    if (editing === 'new') await api.post('/lab/referrals', body); else await api.put(`/lab/referrals/${editing.id}`, body);
    notify.success('Referral doctor saved.');
    setEditing(null); reload();
  });
  return (
    <>
      <PageHeader title="Referral doctors" subtitle="Outside doctors who send patients for tests — track their business and commission."
        actions={can('lab.configure') && <Button onClick={() => setEditing('new')}><LuPlus aria-hidden /> Add doctor</Button>} />
      <Card>
        <SearchBar value={q} onChange={setQ} placeholder="Name, clinic or phone…" />
        <DataTable loading={loading} error={error} rows={data} empty={<EmptyState icon={LuUserRound} title="No referral doctors" />}
          columns={[
            { key: 'name', label: 'Doctor', render: (r) => <div><p className="font-medium">{r.name}</p><p className="text-xs text-muted">{r.qualification}</p></div> },
            { key: 'clinic', label: 'Clinic', render: (r) => r.clinic || '—' },
            { key: 'phone', label: 'Contact', render: (r) => <div className="text-xs"><p>{formatPhone(r.phone) || '—'}</p><p className="text-muted">{r.email}</p></div> },
            { key: 'commissionPercent', label: 'Commission', className: 'text-right', render: (r) => `${Number(r.commissionPercent)}%` },
            { key: 'orders', label: 'Orders', className: 'text-right' },
            { key: 'business', label: 'Business', className: 'text-right', render: (r) => money(r.business) },
            { key: 'isActive', label: 'Status', render: (r) => <ActiveBadge on={r.isActive} /> },
            { key: 'act', label: 'Actions', className: 'text-right', render: (r) => can('lab.configure') && (
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEditing(r)} aria-label="Edit"><LuPencil aria-hidden /></Button>
                <Button size="sm" variant="ghost" aria-label="Delete" onClick={async () => { if (confirmDelete(`Delete ${r.name}? Only possible if they have no orders.`) && (await withToast(() => api.del(`/lab/referrals/${r.id}`), 'Deleted.'))) reload(); }}><LuTrash2 aria-hidden /></Button>
              </div>) },
          ]} />
      </Card>
      {hasFeature('reports') && <p className="mt-3 text-xs text-muted">Commission payable for any period is shown under Analytics.</p>}
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add referral doctor' : 'Edit referral doctor'}
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save} loading={f.submitting}>Save</Button></>}>
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-2" noValidate>
          <Input label="Name" required {...f.bind('name')} error={f.errors.name} className="sm:col-span-2" />
          <Input label="Qualification" placeholder="MBBS, MD" {...f.bind('qualification')} />
          <Input label="Clinic / hospital" {...f.bind('clinic')} />
          <PhoneInput label="Phone" {...f.bind('phone')} error={f.errors.phone} className="sm:col-span-2" />
          <EmailInput label="E-mail" {...f.bind('email')} error={f.errors.email} />
          <Input label="Commission (%)" type="number" min="0" max="100" step="0.01" {...f.bind('commissionPercent')} error={f.errors.commissionPercent} />
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" className="accent-forest-800" checked={Boolean(f.values.isActive)} onChange={(e) => f.setValues((s) => ({ ...s, isActive: e.target.checked }))} /> Active</label>
          {f.formError && <Alert tone="error" className="sm:col-span-2">{f.formError}</Alert>}
        </form>
      </Modal>
    </>
  );
}
