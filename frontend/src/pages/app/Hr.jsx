// HR: daily attendance, leave requests and monthly payroll with printable payslips.
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { LuCheckCheck, LuSave, LuPlus, LuCheck, LuX, LuCalculator, LuIndianRupee, LuPrinter, LuArrowLeft, LuPencil } from 'react-icons/lu';
import { api, qs } from '../../lib/api.js';
import { useApi } from '../../lib/hooks.js';
import { useTenantAuth } from '../../context/AuthContext.jsx';
import { notify, withToast } from '../../lib/toast.js';
import { money, titleCase, todayIn, dateTime } from '../../lib/format.js';
import { Alert, Badge, Button, Card, DataTable, EmptyState, Input, Modal, PageHeader, Select, Skeleton, StatusBadge, Textarea, cx } from '../../components/ui.jsx';
import { StaffSelect } from '../../components/Pickers.jsx';

const STATUS = [['present', 'P'], ['absent', 'A'], ['half_day', '½'], ['leave', 'L'], ['week_off', 'W'], ['holiday', 'H']];
const LEAVE_TYPES = ['casual', 'sick', 'earned', 'unpaid', 'other'].map((x) => ({ value: x, label: titleCase(x) }));
const METHODS = ['bank', 'upi', 'cash', 'card', 'other'].map((m) => ({ value: m, label: m.toUpperCase() }));

function Attendance() {
  const { me, can } = useTenantAuth();
  const tz = me.tenant.timezone;
  const [date, setDate] = useState(todayIn(tz));
  const { data, meta, loading, error, reload } = useApi(() => api.get(`/hr/attendance${qs({ date })}`), [date]);
  const [marks, setMarks] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setMarks(Object.fromEntries(data.map((r) => [r.staffId, { status: r.status || (r.approvedLeave ? 'leave' : ''), checkIn: r.checkIn || '', checkOut: r.checkOut || '' }]))); }, [data]);
  const canMark = can('hr.attendance');
  const counts = useMemo(() => Object.values(marks).reduce((a, m) => { if (m.status) a[m.status] = (a[m.status] || 0) + 1; return a; }, {}), [marks]);
  const set = (id, patch) => setMarks((m) => ({ ...m, [id]: { ...m[id], ...patch } }));
  const save = async () => {
    const entries = Object.entries(marks).filter(([, m]) => m.status).map(([staffId, m]) => ({ staffId: Number(staffId), status: m.status, checkIn: m.checkIn || null, checkOut: m.checkOut || null }));
    if (!entries.length) { notify.error('Mark at least one person.'); return; }
    setBusy(true);
    if (await withToast(() => api.put('/hr/attendance', { date, entries }), 'Attendance saved.')) reload();
    setBusy(false);
  };
  return (
    <Card>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line p-4">
        <Input label="Date" type="date" max={meta?.today} value={date} onChange={(e) => setDate(e.target.value)} />
        <p className="text-sm text-muted">{STATUS.map(([k]) => (counts[k] ? `${titleCase(k)} ${counts[k]}` : null)).filter(Boolean).join(' · ') || 'Nothing marked yet'}</p>
        {canMark && <div className="flex gap-2">
          <Button variant="outline" onClick={() => setMarks((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.status ? v : { ...v, status: 'present' }])))}><LuCheckCheck aria-hidden /> Mark rest present</Button>
          <Button onClick={save} loading={busy}><LuSave aria-hidden /> Save</Button></div>}
      </div>
      {error && <div className="p-4"><Alert tone="error">{error.message}</Alert></div>}
      {loading ? <Skeleton className="m-4 h-40" /> : !data?.length ? <EmptyState title="No active staff" /> : (
        <ul className="divide-y divide-line">
          {data.map((r) => {
            const m = marks[r.staffId] || {};
            return (
              <li key={r.staffId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-44 flex-1"><p className="font-medium">{r.fullName}</p><p className="text-xs text-muted">{r.designation || titleCase(r.staffType)}{r.approvedLeave ? ` · approved ${r.approvedLeave} leave` : ''}</p></div>
                <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={`Attendance of ${r.fullName}`}>
                  {STATUS.map(([k, short]) => (
                    <button key={k} type="button" role="radio" aria-checked={m.status === k} disabled={!canMark} title={titleCase(k)} aria-label={titleCase(k)} onClick={() => set(r.staffId, { status: k })}
                      className={cx('h-9 w-9 rounded-lg border text-sm font-bold transition', m.status === k
                        ? { present: 'border-forest-700 bg-forest-700 text-white', absent: 'border-red-600 bg-red-600 text-white', half_day: 'border-gold-500 bg-gold-500 text-forest-950' }[k] || 'border-forest-300 bg-forest-100 text-forest-900'
                        : 'border-line bg-white text-muted hover:border-forest-300')}>{short}</button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input type="time" className="input w-32" value={m.checkIn || ''} disabled={!canMark} onChange={(e) => set(r.staffId, { checkIn: e.target.value })} aria-label="Check in" />
                  <input type="time" className="input w-32" value={m.checkOut || ''} disabled={!canMark} onChange={(e) => set(r.staffId, { checkOut: e.target.value })} aria-label="Check out" />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="px-4 py-3 text-xs text-muted">P present · A absent · ½ half day · L leave · W weekly off · H holiday. Unmarked days count as paid in payroll; only absences, half days and unpaid leave reduce pay.</p>
    </Card>
  );
}

function Leaves() {
  const { me, can } = useTenantAuth();
  const tz = me.tenant.timezone;
  const [status, setStatus] = useState('pending');
  const { data, loading, error, reload } = useApi(() => api.get(`/hr/leaves${qs({ status })}`), [status]);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      await api.post('/hr/leaves', { staffId: Number(form.staffId), leaveType: form.leaveType, fromDate: form.fromDate, toDate: form.halfDay ? form.fromDate : form.toDate,
        halfDay: Boolean(form.halfDay), ...(form.reason.trim() ? { reason: form.reason.trim() } : {}) });
      notify.success('Leave request added.'); setForm(null); reload();
    } catch (e) { setErr(e.details?.[0]?.message ? `${e.message} ${e.details[0].message}` : e.message); } finally { setBusy(false); }
  };
  const decide = async (l, s) => { if (await withToast(() => api.post(`/hr/leaves/${l.id}/decide`, { status: s }), s === 'approved' ? 'Leave approved.' : 'Leave rejected.')) reload(); };
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
        <select className="input max-w-48" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All</option>{['pending', 'approved', 'rejected', 'cancelled'].map((x) => <option key={x} value={x}>{titleCase(x)}</option>)}</select>
        {(can('hr.attendance') || can('hr.leave')) && <Button onClick={() => { setErr(null); setForm({ staffId: '', leaveType: 'casual', fromDate: todayIn(tz), toDate: todayIn(tz), halfDay: false, reason: '' }); }}><LuPlus aria-hidden /> New leave request</Button>}
      </div>
      <DataTable loading={loading} error={error} rows={data} empty={<EmptyState title="No leave requests" />}
        columns={[
          { key: 'staffName', label: 'Staff', render: (l) => <span className="font-medium">{l.staffName}</span> },
          { key: 'leaveType', label: 'Type', render: (l) => titleCase(l.leaveType) },
          { key: 'fromDate', label: 'Dates', render: (l) => (l.fromDate === l.toDate ? l.fromDate : `${l.fromDate} → ${l.toDate}`) },
          { key: 'days', label: 'Days' },
          { key: 'reason', label: 'Reason', render: (l) => <span className="line-clamp-2 max-w-xs text-sm">{l.reason || '—'}</span> },
          { key: 'status', label: 'Status', render: (l) => <div><StatusBadge status={l.status} />{l.decidedBy && <p className="text-[11px] text-muted">{l.decidedBy} · {dateTime(l.decidedAt, tz)}</p>}</div> },
          { key: 'act', label: <span className="sr-only">Actions</span>, className: 'text-right', render: (l) => l.status === 'pending' && (
            <div className="flex justify-end gap-1">
              {can('hr.leave') && <><Button size="sm" variant="ghost" onClick={() => decide(l, 'approved')} aria-label="Approve"><LuCheck aria-hidden /></Button>
                <Button size="sm" variant="ghost" onClick={() => decide(l, 'rejected')} aria-label="Reject"><LuX aria-hidden /></Button></>}
              <Button size="sm" variant="ghost" onClick={async () => { if (await withToast(() => api.post(`/hr/leaves/${l.id}/cancel`), 'Request cancelled.')) reload(); }}>Cancel</Button>
            </div>) },
        ]} />
      {form && (
        <Modal open onClose={() => setForm(null)} title="New leave request"
          footer={<><Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button><Button onClick={submit} loading={busy} disabled={!form.staffId}>Save</Button></>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <StaffSelect label="Staff member" required value={form.staffId} onChange={(v) => setForm((x) => ({ ...x, staffId: v }))} />
            <Select label="Leave type" options={LEAVE_TYPES} value={form.leaveType} onChange={(e) => setForm((x) => ({ ...x, leaveType: e.target.value }))} />
            <Input label="From" type="date" value={form.fromDate} onChange={(e) => setForm((x) => ({ ...x, fromDate: e.target.value }))} />
            <Input label="To" type="date" value={form.halfDay ? form.fromDate : form.toDate} disabled={form.halfDay} onChange={(e) => setForm((x) => ({ ...x, toDate: e.target.value }))} />
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="accent-forest-800" checked={form.halfDay} onChange={(e) => setForm((x) => ({ ...x, halfDay: e.target.checked }))} /> Half day</label>
            <Textarea label="Reason" className="sm:col-span-2" value={form.reason} onChange={(e) => setForm((x) => ({ ...x, reason: e.target.value }))} />
            <p className="text-xs text-muted sm:col-span-2">Only <strong>unpaid</strong> leave reduces salary. Approving marks the days as leave in attendance.</p>
            {err && <Alert tone="error" className="sm:col-span-2">{err}</Alert>}
          </div>
        </Modal>
      )}
    </Card>
  );
}

function Payroll() {
  const { me } = useTenantAuth();
  const tz = me.tenant.timezone;
  const [month, setMonth] = useState(todayIn(tz).slice(0, 7));
  const { data, meta, loading, error, reload } = useApi(() => api.get(`/hr/payroll${qs({ month })}`), [month]);
  const [salaryFor, setSalaryFor] = useState(null);
  const [salary, setSalary] = useState('');
  const [adjust, setAdjust] = useState(null);
  const [pay, setPay] = useState(null);
  const [method, setMethod] = useState('bank');
  const totals = (data || []).reduce((a, r) => { const n = Number(r.run?.net ?? r.preview?.net ?? 0); a.net += n; if (r.run?.status === 'paid') a.paid += n; return a; }, { net: 0, paid: 0 });
  return (
    <Card>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line p-4">
        <Input label="Month" type="month" value={month} max={todayIn(tz).slice(0, 7)} onChange={(e) => setMonth(e.target.value)} />
        <p className="text-sm">Net payable <strong>{money(totals.net)}</strong> · paid {money(totals.paid)}</p>
        <Button onClick={async () => { const r = await withToast(() => api.post('/hr/payroll/generate', { month }), null); if (r) { notify.success(`${r.data.payslips} payslip(s) prepared from attendance.`); reload(); } }}><LuCalculator aria-hidden /> Prepare payslips</Button>
      </div>
      <DataTable loading={loading} error={error} rows={data} rowKey="staffId" empty={<EmptyState title="No active staff" />}
        columns={[
          { key: 'fullName', label: 'Staff', render: (r) => <div><p className="font-medium">{r.fullName}</p><p className="text-xs text-muted">{r.designation || titleCase(r.staffType)}</p></div> },
          { key: 'monthlySalary', label: 'Monthly salary', render: (r) => <button type="button" className="inline-flex items-center gap-1 text-forest-800 hover:underline" onClick={() => { setSalaryFor(r); setSalary(r.monthlySalary ?? ''); }}>{r.monthlySalary == null ? 'Set salary' : money(r.monthlySalary)} <LuPencil className="h-3 w-3" aria-hidden /></button> },
          { key: 'att', label: 'Attendance', render: (r) => <span className="text-xs">A {r.absent} · ½ {r.half_day} · unpaid leave {r.unpaidLeave}<br /><span className="text-muted">{r.marked} of {meta?.days} days marked</span></span> },
          { key: 'paid', label: 'Paid days', render: (r) => r.run?.paidDays ?? r.preview?.paidDays ?? '—' },
          { key: 'net', label: 'Net pay', className: 'text-right', render: (r) => (r.run ? <span className="font-semibold">{money(r.run.net)}</span> : r.preview ? <span className="text-muted">{money(r.preview.net)} (preview)</span> : '—') },
          { key: 'status', label: 'Status', render: (r) => (r.run ? <StatusBadge status={r.run.status} /> : <Badge tone="gray">not prepared</Badge>) },
          { key: 'act', label: <span className="sr-only">Actions</span>, className: 'text-right', render: (r) => r.run && (
            <div className="flex justify-end gap-1">
              {r.run.status === 'draft' && <Button size="sm" variant="ghost" onClick={() => setAdjust({ ...r.run, name: r.fullName, allowances: String(r.run.allowances), deductions: String(r.run.deductions), notes: r.run.notes || '' })}>Adjust</Button>}
              {r.run.status === 'draft' && <Button size="sm" onClick={() => { setPay({ ...r.run, name: r.fullName }); setMethod('bank'); }}><LuIndianRupee aria-hidden /> Pay</Button>}
              <Button size="sm" variant="ghost" to={`/app/payslips/${r.run.id}`} aria-label="Payslip"><LuPrinter aria-hidden /></Button>
            </div>) },
        ]} />
      <p className="px-4 py-3 text-xs text-muted">Pay = salary × paid days ÷ days in month (+ allowances − deductions). Paying records the amount under Expenses → Salaries. Paid payslips are final.</p>
      {salaryFor && (
        <Modal open size="sm" onClose={() => setSalaryFor(null)} title={`Salary — ${salaryFor.fullName}`}
          footer={<><Button variant="ghost" onClick={() => setSalaryFor(null)}>Cancel</Button><Button onClick={async () => { if (await withToast(() => api.put(`/hr/staff/${salaryFor.staffId}/salary`, { monthlySalary: salary === '' ? null : Number(salary) }), 'Salary saved.')) { setSalaryFor(null); reload(); } }}>Save</Button></>}>
          <Input label="Monthly salary (₹)" type="number" min="0" step="1" value={salary} onChange={(e) => setSalary(e.target.value)} hint="Leave empty to exclude this person from payroll. Only people with payroll permission see salaries." />
        </Modal>
      )}
      {adjust && (
        <Modal open size="sm" onClose={() => setAdjust(null)} title={`Adjust — ${adjust.name}`}
          footer={<><Button variant="ghost" onClick={() => setAdjust(null)}>Cancel</Button><Button onClick={async () => { if (await withToast(() => api.put(`/hr/payroll/${adjust.id}`, { allowances: Number(adjust.allowances || 0), deductions: Number(adjust.deductions || 0), notes: adjust.notes || null }), 'Payslip updated.')) { setAdjust(null); reload(); } }}>Save</Button></>}>
          <div className="space-y-3">
            <p className="text-sm">Gross for paid days: <strong>{money(adjust.gross)}</strong></p>
            <Input label="Allowances / bonus (₹)" type="number" min="0" value={adjust.allowances} onChange={(e) => setAdjust((a) => ({ ...a, allowances: e.target.value }))} />
            <Input label="Deductions — advance, PF, TDS (₹)" type="number" min="0" value={adjust.deductions} onChange={(e) => setAdjust((a) => ({ ...a, deductions: e.target.value }))} />
            <Textarea label="Note on payslip" value={adjust.notes} onChange={(e) => setAdjust((a) => ({ ...a, notes: e.target.value }))} />
          </div>
        </Modal>
      )}
      {pay && (
        <Modal open size="sm" onClose={() => setPay(null)} title={`Pay ${pay.name}`}
          footer={<><Button variant="ghost" onClick={() => setPay(null)}>Cancel</Button><Button onClick={async () => { if (await withToast(() => api.post(`/hr/payroll/${pay.id}/pay`, { method }), 'Salary paid and recorded under Expenses.')) { setPay(null); reload(); } }}>Pay {money(pay.net)}</Button></>}>
          <Select label="Paid by" options={METHODS} value={method} onChange={(e) => setMethod(e.target.value)} />
        </Modal>
      )}
    </Card>
  );
}

export default function Hr() {
  const { can } = useTenantAuth();
  const [params, setParams] = useSearchParams();
  const tabs = [...(can('hr.attendance') || can('staff.read') ? [['attendance', 'Attendance']] : []), ...(can('hr.attendance') || can('hr.leave') ? [['leave', 'Leave']] : []), ...(can('hr.payroll') ? [['payroll', 'Payroll']] : [])];
  const tab = tabs.some(([k]) => k === params.get('tab')) ? params.get('tab') : tabs[0]?.[0];
  return (
    <>
      <PageHeader title="Attendance & payroll" subtitle="Daily attendance, leave and monthly salary for your staff." />
      <div className="mb-4 flex w-full overflow-x-auto rounded-lg border border-line bg-white p-1 sm:w-fit" role="tablist">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setParams({ tab: k })} className={cx('whitespace-nowrap rounded-md px-4 py-1.5 text-sm font-semibold', tab === k ? 'bg-forest-900 text-white' : 'text-forest-800 hover:bg-forest-50')}>{l}</button>)}
      </div>
      {tab === 'attendance' && <Attendance />}
      {tab === 'leave' && <Leaves />}
      {tab === 'payroll' && <Payroll />}
      {!tabs.length && <Alert tone="info">You do not have HR permissions.</Alert>}
    </>
  );
}

/** Printable payslip (A5-friendly). */
export function Payslip() {
  const { id } = useParams();
  const { data: p, loading, error } = useApi(() => api.get(`/hr/payroll/${id}`), [id]);
  if (error) return <Alert tone="error">{error.message}</Alert>;
  if (loading || !p) return <Skeleton className="h-64 w-full" />;
  const monthName = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${p.month}-01T00:00:00Z`));
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link to="/app/hr?tab=payroll" className="flex items-center gap-1 text-sm font-medium text-forest-700"><LuArrowLeft aria-hidden /> Payroll</Link>
        <Button onClick={() => window.print()}><LuPrinter aria-hidden /> Print / Save as PDF</Button>
      </div>
      <Card className="mx-auto max-w-2xl p-8 print:border-0 print:shadow-none">
        <div className="border-b-2 border-forest-900 pb-4">
          <p className="font-display text-2xl font-bold text-forest-950">{p.hospitalName}</p>
          <p className="text-sm text-muted">{[p.hospitalAddress, p.hospitalPhone].filter(Boolean).join(' · ')}</p>
          <p className="mt-3 text-sm font-bold uppercase tracking-widest">Payslip — {monthName}</p>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <dt className="text-muted">Name</dt><dd className="font-semibold">{p.staffName}</dd>
          <dt className="text-muted">Designation</dt><dd>{p.designation || titleCase(p.staffType)}</dd>
          {p.department && <><dt className="text-muted">Department</dt><dd>{p.department}</dd></>}
          <dt className="text-muted">Paid days</dt><dd>{p.paidDays} of {p.daysInMonth}</dd>
        </dl>
        <table className="mt-6 w-full text-sm"><tbody className="divide-y divide-line">
          <tr><td className="py-2">Monthly salary</td><td className="text-right">{money(p.monthlySalary)}</td></tr>
          <tr><td className="py-2">Earned for {p.paidDays} day(s)</td><td className="text-right">{money(p.gross)}</td></tr>
          <tr><td className="py-2">Allowances / bonus</td><td className="text-right">+ {money(p.allowances)}</td></tr>
          <tr><td className="py-2">Deductions</td><td className="text-right">− {money(p.deductions)}</td></tr>
          <tr className="border-t-2 border-forest-900 text-base font-bold"><td className="py-2">Net pay</td><td className="text-right">{money(p.net)}</td></tr>
        </tbody></table>
        {p.notes && <p className="mt-3 text-sm text-muted">Note: {p.notes}</p>}
        <p className="mt-4 text-sm">{p.status === 'paid' ? `Paid by ${String(p.paymentMethod).toUpperCase()} on ${new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(p.paidAt))}` : 'Not paid yet (draft).'}</p>
        <div className="mt-12 flex justify-between text-xs text-muted"><span className="border-t border-ink px-6 pt-1">Employee signature</span><span className="border-t border-ink px-6 pt-1">Authorised signatory</span></div>
      </Card>
    </>
  );
}
