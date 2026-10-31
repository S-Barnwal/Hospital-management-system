// Super Admin — Phase 4: revenue (MRR), monitoring, coupons, sign-in history, support tickets and hospital groups.
import { Fragment, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  LuTrendingUp, LuWallet, LuUsers, LuHourglass, LuPlus, LuPencil, LuTrash2, LuArrowLeft, LuServer, LuDatabase, LuTriangleAlert, LuCircleCheck,
  LuLock, LuSend, LuStickyNote, LuRefreshCw,
} from 'react-icons/lu';
import { api, qs } from '../../lib/api.js';
import { useApi, useDebounced } from '../../lib/hooks.js';
import { useAdminAuth } from '../../context/AuthContext.jsx';
import { notify, withToast } from '../../lib/toast.js';
import { date, dateTime, money, relative, titleCase } from '../../lib/format.js';
import { Alert, Badge, Button, Card, DataTable, EmptyState, Input, Modal, PageHeader, Pagination, Select, Skeleton, StatCard, StatusBadge, Textarea, cx } from '../../components/ui.jsx';
import BarChart from '../../components/BarChart.jsx';

function usePaged(path, filters) {
  const [page, setPage] = useState(1);
  const key = JSON.stringify(filters);
  useEffect(() => setPage(1), [key]);
  const res = useApi(() => api.get(`${path}${qs({ ...filters, page })}`), [key, page]);
  return { ...res, setPage };
}

// ---------- Revenue ----------
export function Revenue() {
  const { data: r, loading, error } = useApi(() => api.get('/admin/revenue'), []);
  if (error) return <Alert tone="error">{error.message}</Alert>;
  const series = (r?.monthly || []).map((m) => ({ date: m.month, value: Number(m.collected) }));
  return (
    <>
      <PageHeader title="Revenue" subtitle="Recurring revenue from hospital subscriptions (excluding GST and sandbox payments)." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="MRR" value={r ? money(r.mrr) : ''} loading={loading} icon={LuTrendingUp} hint="Monthly recurring revenue" />
        <StatCard label="ARR" value={r ? money(r.arr) : ''} loading={loading} icon={LuWallet} hint="MRR × 12" />
        <StatCard label="Paying hospitals" value={r?.hospitals.paying} loading={loading} icon={LuUsers} hint={r ? `ARPA ${money(r.arpa)} / month` : ''} />
        <StatCard label="Free · trial" value={r ? `${r.hospitals.free} · ${r.hospitals.trial}` : ''} loading={loading} icon={LuHourglass} hint={r ? `${r.newThisMonth} new this month · ${r.lapsedLast30} lapsed in 30 days` : ''} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Card className="p-5 lg:col-span-3">
          <h2 className="mb-3 font-display text-lg font-semibold">Collected per month (12 months)</h2>
          {loading ? <Skeleton className="h-48" /> : series.length ? <BarChart data={series} valueKey="value" label="Collections per month" lastLabel="This month" /> : <EmptyState title="No live payments yet" />}
        </Card>
        <Card className="lg:col-span-2">
          <h2 className="border-b border-line px-5 py-4 font-display text-lg font-semibold">By plan</h2>
          <DataTable rowKey="code" loading={loading} rows={r?.byPlan} empty={<EmptyState title="No active subscriptions" />} columns={[
            { key: 'plan', label: 'Plan' }, { key: 'hospitals', label: 'Hospitals', render: (p) => `${p.hospitals} (${p.paying} paying)` },
            { key: 'mrr', label: 'MRR', className: 'text-right', render: (p) => <span className="font-semibold">{money(p.mrr)}</span> }]} />
        </Card>
      </div>
      {r && (
        <Card className="mt-6">
          <DataTable rowKey="month" rows={[...r.monthly].reverse()} empty={<EmptyState title="No payments" />} columns={[
            { key: 'month', label: 'Month' }, { key: 'payments', label: 'Payments' }, { key: 'newHospitals', label: 'New sign-ups' },
            { key: 'discount', label: 'Coupon discounts', render: (m) => money(m.discount) }, { key: 'tax', label: 'GST', render: (m) => money(m.tax) },
            { key: 'collected', label: 'Collected', className: 'text-right', render: (m) => <span className="font-semibold">{money(m.collected)}</span> }]} />
          <p className="px-5 py-3 text-xs text-muted">{r.note}</p>
        </Card>
      )}
    </>
  );
}

// ---------- Monitoring ----------
const fmtUptime = (s) => (s > 86400 ? `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h` : s > 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}m`);
export function Monitoring() {
  const { data: m, loading, error, reload } = useApi(() => api.get('/admin/monitoring'), []);
  useEffect(() => { const t = setInterval(reload, 30000); return () => clearInterval(t); }, [reload]);
  if (error) return <Alert tone="error" title="Health check failed">{error.message}</Alert>;
  const failingJobs = m?.jobs.list.filter((j) => j.lastOk === false || j.stale) ?? [];
  return (
    <>
      <PageHeader title="Monitoring" subtitle="Server, database, background jobs and sign-in health. Refreshes every 30 seconds."
        actions={<Button variant="outline" onClick={reload}><LuRefreshCw aria-hidden /> Refresh</Button>} />
      {m && (failingJobs.length || m.paidNotProvisioned
        ? <Alert tone="warning" className="mb-4" title="Needs attention">{[failingJobs.length ? `${failingJobs.length} background job(s) failing or late` : null, m.paidNotProvisioned ? `${m.paidNotProvisioned} paid sign-up(s) not provisioned` : null].filter(Boolean).join(' · ')}</Alert>
        : <Alert tone="success" className="mb-4">All systems normal.</Alert>)}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="API uptime" value={m ? fmtUptime(m.server.uptimeSec) : ''} loading={loading} icon={LuServer} hint={m ? `Node ${m.server.node} · ${m.server.memoryMb.rss} MB` : ''} />
        <StatCard label="Database" value={m ? `${m.database.latencyMs} ms` : ''} loading={loading} icon={LuDatabase} hint="Round-trip of a test query" />
        <StatCard label="Server errors" value={m?.server.errors5xx} loading={loading} icon={LuTriangleAlert} hint={m ? `${m.server.requests} requests since start` : ''} />
        <StatCard label="Sign-ins (24 h)" value={m ? `${m.logins24h.ok ?? 0} ok` : ''} loading={loading} icon={LuLock} hint={m ? `${m.logins24h.failed ?? 0} failed · ${m.logins24h.locked ?? 0} lock-outs` : ''} />
      </div>
      {m && (
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <h2 className="border-b border-line px-5 py-4 font-display text-lg font-semibold">Background jobs {!m.jobs.enabled && <Badge tone="red">disabled</Badge>}</h2>
            <DataTable rowKey="name" rows={m.jobs.list} columns={[
              { key: 'name', label: 'Job', render: (j) => <span className="font-mono text-xs">{j.name}</span> },
              { key: 'lastOk', label: 'Last run', render: (j) => (j.lastOk == null ? <Badge tone="gray">never</Badge> : j.lastOk ? <Badge tone="green">ok</Badge> : <Badge tone="red">failed</Badge>) },
              { key: 'lastFinishedAt', label: 'When', render: (j) => (j.lastFinishedAt ? <span title={dateTime(j.lastFinishedAt)}>{relative(j.lastFinishedAt)}{j.stale && <Badge tone="gold" className="ml-1">late</Badge>}</span> : '—') },
              { key: 'lastDurationMs', label: 'Took', render: (j) => (j.lastDurationMs != null ? `${j.lastDurationMs} ms` : '—') },
              { key: 'failures', label: 'Failures', render: (j) => (j.runs ? `${j.failures} / ${j.runs}` : '—') },
              { key: 'lastError', label: 'Last error', render: (j) => <span className="line-clamp-2 max-w-xs text-xs text-red-700">{j.lastError || ''}</span> }]} />
          </Card>
          <Card className="p-5 text-sm">
            <h2 className="mb-3 font-display text-lg font-semibold">Platform</h2>
            <dl className="grid grid-cols-2 gap-y-2">
              <dt className="text-muted">Active hospitals</dt><dd className="text-right font-semibold">{m.activeHospitals}</dd>
              <dt className="text-muted">Signed-in sessions</dt><dd className="text-right font-semibold">{m.activeSessions}</dd>
              <dt className="text-muted">Tickets waiting</dt><dd className="text-right font-semibold"><Link className="underline" to="/admin/support">{m.ticketsWaiting}</Link></dd>
              <dt className="text-muted">Abandoned checkouts (7 d)</dt><dd className="text-right font-semibold">{m.abandonedCheckouts}</dd>
              <dt className="text-muted">Paid, not provisioned</dt><dd className={cx('text-right font-semibold', m.paidNotProvisioned && 'text-red-700')}>{m.paidNotProvisioned}</dd>
              {Object.entries(m.messages24h).map(([k, v]) => <Fragment key={k}><dt className="text-muted">Messages {k} (24 h)</dt><dd className="text-right font-semibold">{v}</dd></Fragment>)}
            </dl>
          </Card>
          <Card className="lg:col-span-3">
            <h2 className="border-b border-line px-5 py-4 font-display text-lg font-semibold">Recent server errors (since last restart)</h2>
            {m.server.recentErrors.length ? (
              <ul className="divide-y divide-line text-sm">{m.server.recentErrors.map((e, i) => <li key={i} className="flex flex-wrap gap-3 px-5 py-2"><span className="text-muted">{dateTime(e.at)}</span><span className="font-mono text-xs">{e.method} {e.path}</span><Badge tone="red">{e.code}</Badge></li>)}</ul>
            ) : <p className="flex items-center gap-2 px-5 py-4 text-sm text-forest-700"><LuCircleCheck aria-hidden /> No server errors.</p>}
          </Card>
        </div>
      )}
    </>
  );
}

// ---------- Coupons ----------
const blankCoupon = { code: '', description: '', kind: 'percent', value: '', planCodes: [], interval: '', appliesTo: 'both', validFrom: '', validUntil: '', maxRedemptions: '', oncePerHospital: true, isActive: true };
const toLocalInput = (iso) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');

function CouponForm({ coupon, plans, onClose, onSaved }) {
  const [v, setV] = useState(coupon ? {
    code: coupon.code, description: coupon.description || '', kind: coupon.percentOff != null ? 'percent' : 'amount', value: String(coupon.percentOff ?? coupon.amountOff),
    planCodes: coupon.planCodes, interval: coupon.interval || '', appliesTo: coupon.appliesTo, validFrom: toLocalInput(coupon.validFrom), validUntil: toLocalInput(coupon.validUntil),
    maxRedemptions: coupon.maxRedemptions ?? '', oncePerHospital: coupon.oncePerHospital, isActive: coupon.isActive,
  } : blankCoupon);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const save = async () => {
    setBusy(true); setErr(null);
    const body = {
      code: v.code, description: v.description || null, percentOff: v.kind === 'percent' ? Number(v.value) : null, amountOff: v.kind === 'amount' ? Number(v.value) : null,
      planCodes: v.planCodes, interval: v.interval || null, appliesTo: v.appliesTo, validFrom: v.validFrom ? new Date(v.validFrom).toISOString() : null,
      validUntil: v.validUntil ? new Date(v.validUntil).toISOString() : null, maxRedemptions: v.maxRedemptions === '' ? null : Number(v.maxRedemptions),
      oncePerHospital: v.oncePerHospital, isActive: v.isActive,
    };
    try {
      if (coupon) await api.put(`/admin/coupons/${coupon.id}`, body); else await api.post('/admin/coupons', body);
      notify.success('Coupon saved.'); onSaved();
    } catch (e) { setErr(e.details?.length ? `${e.message} ${e.details.map((d) => d.message).join(' · ')}` : e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open size="lg" onClose={onClose} title={coupon ? `Edit coupon ${coupon.code}` : 'New coupon'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!v.code || !v.value}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Code" required value={v.code} onChange={(e) => setV((x) => ({ ...x, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') }))} hint="Customers type this, e.g. LAUNCH20" disabled={coupon?.redeemed > 0} />
        <Input label="Description" value={v.description} onChange={set('description')} hint="Shown to the customer when applied" />
        <Select label="Discount type" options={[{ value: 'percent', label: 'Percentage off' }, { value: 'amount', label: 'Fixed amount off (₹)' }]} value={v.kind} onChange={set('kind')} />
        <Input label={v.kind === 'percent' ? 'Percent off (max 95)' : 'Amount off (₹, before GST)'} type="number" min="1" max={v.kind === 'percent' ? 95 : undefined} required value={v.value} onChange={set('value')} />
        <Select label="Applies to" options={[{ value: 'both', label: 'New sign-ups and renewals' }, { value: 'signup', label: 'New sign-ups only' }, { value: 'renewal', label: 'Renewals only' }]} value={v.appliesTo} onChange={set('appliesTo')} />
        <Select label="Billing" placeholder="Monthly and annual" options={[{ value: 'monthly', label: 'Monthly only' }, { value: 'annual', label: 'Annual only' }]} value={v.interval} onChange={set('interval')} />
        <fieldset className="sm:col-span-2"><legend className="label">Plans (none ticked = every plan)</legend>
          <div className="flex flex-wrap gap-4">{plans.filter((p) => !p.contactSales).map((p) => (
            <label key={p.code} className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-forest-800" checked={v.planCodes.includes(p.code)}
              onChange={(e) => setV((x) => ({ ...x, planCodes: e.target.checked ? [...x.planCodes, p.code] : x.planCodes.filter((c) => c !== p.code) }))} />{p.name}</label>))}</div>
        </fieldset>
        <Input label="Valid from" type="datetime-local" value={v.validFrom} onChange={set('validFrom')} />
        <Input label="Valid until" type="datetime-local" value={v.validUntil} onChange={set('validUntil')} />
        <Input label="Maximum uses (blank = unlimited)" type="number" min="1" value={v.maxRedemptions} onChange={set('maxRedemptions')} />
        <div className="flex flex-col justify-end gap-2 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" className="accent-forest-800" checked={v.oncePerHospital} onChange={set('oncePerHospital')} /> Once per hospital</label>
          <label className="flex items-center gap-2"><input type="checkbox" className="accent-forest-800" checked={v.isActive} onChange={set('isActive')} /> Active</label>
        </div>
        <p className="text-xs text-muted sm:col-span-2">The discount comes off the plan price before GST. A coupon can never take the amount below ₹1. It is counted only when the payment succeeds.</p>
        {err && <Alert tone="error" className="sm:col-span-2">{err}</Alert>}
      </div>
    </Modal>
  );
}

export function Coupons() {
  const { admin } = useAdminAuth();
  const { data, loading, error, reload } = useApi(() => api.get('/admin/coupons'), []);
  const { data: plans } = useApi(() => api.get('/admin/plans'), []);
  const [edit, setEdit] = useState(null);
  const su = admin.role === 'super_admin';
  return (
    <>
      <PageHeader title="Coupons" subtitle="Discount codes for new sign-ups and renewals." actions={su && <Button onClick={() => setEdit({})}><LuPlus aria-hidden /> New coupon</Button>} />
      <Card>
        <DataTable loading={loading} error={error} rows={data} empty={<EmptyState title="No coupons yet" />} columns={[
          { key: 'code', label: 'Code', render: (c) => <div><span className="font-mono font-semibold">{c.code}</span>{c.description && <p className="text-xs text-muted">{c.description}</p>}</div> },
          { key: 'value', label: 'Discount', render: (c) => (c.percentOff != null ? `${Number(c.percentOff)}%` : money(c.amountOff)) },
          { key: 'rules', label: 'Rules', render: (c) => <span className="text-xs">{[titleCase(c.appliesTo === 'both' ? 'sign-up & renewal' : c.appliesTo), c.interval, c.planCodes.length ? c.planCodes.join(', ') : 'all plans', c.oncePerHospital ? 'once per hospital' : null].filter(Boolean).join(' · ')}</span> },
          { key: 'validUntil', label: 'Valid', render: (c) => <span className="text-xs">{c.validFrom ? date(c.validFrom) : 'now'} → {c.validUntil ? date(c.validUntil) : 'no end'}</span> },
          { key: 'redeemed', label: 'Used', render: (c) => `${c.redeemed}${c.maxRedemptions ? ` / ${c.maxRedemptions}` : ''}` },
          { key: 'totalDiscount', label: 'Given', render: (c) => money(c.totalDiscount) },
          { key: 'isActive', label: 'Status', render: (c) => <Badge tone={c.isActive ? 'green' : 'gray'}>{c.isActive ? 'active' : 'off'}</Badge> },
          { key: 'act', label: <span className="sr-only">Actions</span>, className: 'text-right', render: (c) => su && (
            <div className="flex justify-end gap-1">
              <Button size="sm" variant="ghost" onClick={() => setEdit(c)} aria-label={`Edit ${c.code}`}><LuPencil aria-hidden /></Button>
              {c.redeemed === 0 && <Button size="sm" variant="ghost" aria-label={`Delete ${c.code}`} onClick={async () => { if (window.confirm(`Delete coupon ${c.code}?`) && await withToast(() => api.del(`/admin/coupons/${c.id}`), 'Coupon deleted.')) reload(); }}><LuTrash2 aria-hidden /></Button>}
            </div>) }]} />
      </Card>
      {edit && <CouponForm coupon={edit.id ? edit : null} plans={plans || []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </>
  );
}

// ---------- Sign-in history ----------
export function LoginHistory() {
  const [filters, setFilters] = useState({ q: '', type: '', result: '' });
  const debounced = useDebounced(filters);
  const { data, meta, loading, error, setPage } = usePaged('/admin/login-history', debounced);
  return (
    <>
      <PageHeader title="Sign-in history" subtitle="Every sign-in attempt to hospital workspaces and to this admin portal (kept 180 days)." />
      <Card>
        <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-3">
          <input className="input" placeholder="E-mail, IP or hospital…" value={filters.q} onChange={(e) => setFilters((s) => ({ ...s, q: e.target.value }))} aria-label="Search" />
          <select className="input" value={filters.type} onChange={(e) => setFilters((s) => ({ ...s, type: e.target.value }))} aria-label="Who"><option value="">Hospitals and admins</option><option value="tenant">Hospital users</option><option value="platform">Super Admins</option></select>
          <select className="input" value={filters.result} onChange={(e) => setFilters((s) => ({ ...s, result: e.target.value }))} aria-label="Result"><option value="">Any result</option><option value="ok">Successful</option><option value="failed">Failed</option></select>
        </div>
        <DataTable loading={loading} error={error} rows={data} empty={<EmptyState title="No sign-ins" />} columns={[
          { key: 'createdAt', label: 'When', render: (e) => dateTime(e.createdAt) },
          { key: 'email', label: 'Account', render: (e) => <div><p className="text-sm">{e.email || '—'}</p><p className="text-xs text-muted">{e.subjectType === 'platform' ? 'Super Admin' : e.hospital || 'Unknown workspace'}</p></div> },
          { key: 'success', label: 'Result', render: (e) => (e.success ? <Badge tone="green">signed in</Badge> : <Badge tone="red">{titleCase(e.reason)}</Badge>) },
          { key: 'device', label: 'Device' }, { key: 'ip', label: 'IP', render: (e) => <span className="font-mono text-xs">{e.ip}</span> }]} />
        <Pagination meta={meta} onPage={setPage} />
      </Card>
    </>
  );
}

// ---------- Support ----------
const TICKET_TONE = { open: 'gold', awaiting_support: 'gold', awaiting_hospital: 'blue', resolved: 'green', closed: 'gray' };
export const TicketStatus = ({ status }) => <Badge tone={TICKET_TONE[status] || 'gray'}>{String(status).replace(/_/g, ' ')}</Badge>;
const PRIORITY_TONE = { urgent: 'red', high: 'gold', normal: 'gray', low: 'gray' };

export function SupportQueue() {
  const [filters, setFilters] = useState({ status: 'waiting', q: '' });
  const debounced = useDebounced(filters);
  const { data, meta, loading, error, setPage } = usePaged('/admin/support/tickets', debounced);
  const counts = meta?.counts || {};
  return (
    <>
      <PageHeader title="Support tickets" subtitle="Questions and problems raised by hospitals. Reply here; the hospital is e-mailed." />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <div className="flex flex-wrap gap-1" role="tablist">
            {[['waiting', `Needs reply (${(counts.open || 0) + (counts.awaiting_support || 0)})`], ['awaiting_hospital', `Waiting for hospital (${counts.awaiting_hospital || 0})`], ['resolved', 'Resolved'], ['closed', 'Closed'], ['', 'All']].map(([k, l]) => (
              <button key={k} role="tab" aria-selected={filters.status === k} onClick={() => setFilters((s) => ({ ...s, status: k }))}
                className={cx('rounded-md px-3 py-1.5 text-sm font-semibold', filters.status === k ? 'bg-forest-900 text-white' : 'text-forest-800 hover:bg-forest-50')}>{l}</button>))}
          </div>
          <input className="input ml-auto max-w-xs" placeholder="Search subject, number, hospital…" value={filters.q} onChange={(e) => setFilters((s) => ({ ...s, q: e.target.value }))} aria-label="Search" />
        </div>
        <DataTable loading={loading} error={error} rows={data} empty={<EmptyState title="Nothing here" />} columns={[
          { key: 'number', label: 'Ticket', render: (k) => <Link to={`/admin/support/${k.id}`} className="font-mono text-xs font-semibold text-forest-800 underline">{k.number}</Link> },
          { key: 'subject', label: 'Subject', render: (k) => <div><Link to={`/admin/support/${k.id}`} className="font-medium hover:underline">{k.subject}</Link><p className="text-xs text-muted">{k.hospitalName} · {titleCase(k.category)}</p></div> },
          { key: 'priority', label: 'Priority', render: (k) => <Badge tone={PRIORITY_TONE[k.priority]}>{k.priority}</Badge> },
          { key: 'status', label: 'Status', render: (k) => <TicketStatus status={k.status} /> },
          { key: 'assignedTo', label: 'Assigned', render: (k) => k.assignedTo || '—' },
          { key: 'updatedAt', label: 'Updated', render: (k) => <span title={dateTime(k.updatedAt)}>{relative(k.updatedAt)}</span> }]} />
        <Pagination meta={meta} onPage={setPage} />
      </Card>
    </>
  );
}

export function SupportTicketAdmin() {
  const { id } = useParams();
  const { data: k, loading, error, reload } = useApi(() => api.get(`/admin/support/tickets/${id}`), [id]);
  const { data: team } = useApi(() => api.get('/admin/team'), []);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  if (error) return <Alert tone="error">{error.message}</Alert>;
  if (loading || !k) return <Skeleton className="h-64 w-full" />;
  const send = async (internal, resolve = false) => {
    setBusy(true);
    if (await withToast(() => api.post(`/admin/support/tickets/${id}/messages`, { body, internal, resolve }), internal ? 'Note added.' : 'Reply sent to the hospital.')) { setBody(''); reload(); }
    setBusy(false);
  };
  const patch = async (b) => { if (await withToast(() => api.patch(`/admin/support/tickets/${id}`, b), 'Ticket updated.')) reload(); };
  return (
    <>
      <Link to="/admin/support" className="mb-4 flex items-center gap-1 text-sm font-medium text-forest-700"><LuArrowLeft aria-hidden /> Support tickets</Link>
      <PageHeader eyebrow={`${k.number} · ${k.hospitalName}`} title={k.subject} subtitle={`${titleCase(k.category)} · opened ${dateTime(k.createdAt)} by ${k.createdBy || 'a hospital user'}${k.createdByEmail ? ` (${k.createdByEmail})` : ''}`} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {k.messages.map((m) => (
            <Card key={m.id} className={cx('p-4', m.isInternal ? 'border-dashed border-gold-400 bg-gold-50/40' : m.authorType === 'support' ? 'bg-forest-50/50' : '')}>
              <p className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted"><span className="font-semibold text-ink">{m.authorName}</span>{m.isInternal && <Badge tone="gold">internal note</Badge>}<span>{dateTime(m.createdAt)}</span></p>
              <p className="whitespace-pre-wrap break-words text-sm">{m.body}</p>
            </Card>
          ))}
          <Card className="p-4">
            <Textarea label="Reply" rows={5} value={body} onChange={(e) => setBody(e.target.value)} hint="Never ask hospitals to send patient details here." />
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button variant="ghost" disabled={body.trim().length < 2} loading={busy} onClick={() => send(true)}><LuStickyNote aria-hidden /> Internal note</Button>
              <Button variant="outline" disabled={body.trim().length < 2} loading={busy} onClick={() => send(false, true)}>Reply & resolve</Button>
              <Button disabled={body.trim().length < 2} loading={busy} onClick={() => send(false)}><LuSend aria-hidden /> Reply</Button>
            </div>
          </Card>
        </div>
        <Card className="h-fit space-y-3 p-4">
          <p className="flex items-center justify-between text-sm">Status <TicketStatus status={k.status} /></p>
          <Select label="Change status" value={k.status} options={['open', 'awaiting_support', 'awaiting_hospital', 'resolved', 'closed'].map((x) => ({ value: x, label: titleCase(x) }))} onChange={(e) => patch({ status: e.target.value })} />
          <Select label="Priority" value={k.priority} options={['low', 'normal', 'high', 'urgent'].map((x) => ({ value: x, label: titleCase(x) }))} onChange={(e) => patch({ priority: e.target.value })} />
          <Select label="Assigned to" placeholder="Nobody" value={k.assignedToId ?? ''} options={(team || []).map((u) => ({ value: u.id, label: u.name }))} onChange={(e) => patch({ assignedToId: e.target.value ? Number(e.target.value) : null })} />
          <Link to={`/admin/tenants/${k.tenantId}`} className="block text-sm font-semibold text-forest-700 underline">Open hospital</Link>
        </Card>
      </div>
    </>
  );
}

// ---------- Hospital groups ----------
export function Groups() {
  const { admin } = useAdminAuth();
  const { data, loading, error, reload } = useApi(() => api.get('/admin/groups'), []);
  const [edit, setEdit] = useState(null);
  const su = admin.role === 'super_admin';
  const save = async () => {
    const body = { name: edit.name.trim(), notes: edit.notes.trim() || null };
    if (await withToast(() => (edit.id ? api.put(`/admin/groups/${edit.id}`, body) : api.post('/admin/groups', body)), 'Group saved.')) { setEdit(null); reload(); }
  };
  return (
    <>
      <PageHeader title="Hospital groups" subtitle="Multi-branch customers: several hospital workspaces owned by one organisation."
        actions={su && <Button onClick={() => setEdit({ name: '', notes: '' })}><LuPlus aria-hidden /> New group</Button>} />
      <Alert tone="info" className="mb-4">Each branch keeps its own data, users and subscription. Add a hospital to a group from its page (Hospitals → open → Change group). Owners/admins who have an account in several branches then see those branches' headline figures together.</Alert>
      {error && <Alert tone="error">{error.message}</Alert>}
      {loading ? <Skeleton className="h-40" /> : !data?.length ? <EmptyState title="No groups yet" /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.map((g) => (
            <Card key={g.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div><h2 className="font-display text-lg font-semibold">{g.name}</h2>{g.notes && <p className="text-sm text-muted">{g.notes}</p>}</div>
                {su && <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEdit({ id: g.id, name: g.name, notes: g.notes || '' })} aria-label="Edit group"><LuPencil aria-hidden /></Button>
                  {!g.hospitals.length && <Button size="sm" variant="ghost" aria-label="Delete group" onClick={async () => { if (window.confirm(`Delete group ${g.name}?`) && await withToast(() => api.del(`/admin/groups/${g.id}`), 'Group deleted.')) reload(); }}><LuTrash2 aria-hidden /></Button>}
                </div>}
              </div>
              <ul className="mt-3 divide-y divide-line text-sm">
                {g.hospitals.map((h) => <li key={h.tenantId} className="flex items-center justify-between gap-2 py-2"><Link className="font-medium hover:underline" to={`/admin/tenants/${h.tenantId}`}>{h.name}{h.branchName ? ` · ${h.branchName}` : ''}</Link><span className="text-xs text-muted">{h.city || ''} · {h.planName || '—'}</span></li>)}
                {!g.hospitals.length && <li className="py-2 text-muted">No hospitals yet.</li>}
              </ul>
            </Card>
          ))}
        </div>
      )}
      {edit && (
        <Modal open size="sm" onClose={() => setEdit(null)} title={edit.id ? 'Edit group' : 'New group'}
          footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save} disabled={edit.name.trim().length < 2}>Save</Button></>}>
          <div className="space-y-3"><Input label="Organisation name" value={edit.name} onChange={(e) => setEdit((x) => ({ ...x, name: e.target.value }))} />
            <Textarea label="Notes" value={edit.notes} onChange={(e) => setEdit((x) => ({ ...x, notes: e.target.value }))} /></div>
        </Modal>
      )}
    </>
  );
}
