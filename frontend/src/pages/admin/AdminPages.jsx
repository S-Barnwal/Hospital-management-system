import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LuBuilding2, LuCalendarCheck, LuCreditCard, LuMessageSquare, LuArrowLeft, LuTrendingUp, LuPlus, LuTrash2, LuGift } from 'react-icons/lu';
import { api, qs } from '../../lib/api.js';
import { useApi, useDebounced, useForm } from '../../lib/hooks.js';
import { useAdminAuth } from '../../context/AuthContext.jsx';
import { notify, withToast } from '../../lib/toast.js';
import { date, dateTime, money, titleCase } from '../../lib/format.js';
import { Alert, Badge, Button, Card, DataTable, EmptyState, Input, Modal, PageHeader, Pagination, Select, Skeleton, StatCard, StatusBadge, Textarea } from '../../components/ui.jsx';
import PhoneInput from '../../components/PhoneInput.jsx';
import EmailInput from '../../components/EmailInput.jsx';
import Combobox from '../../components/Combobox.jsx';
import MapView from '../../components/MapView.jsx';
import { formatPhone, countryName } from '../../lib/contact.js';

function usePaged(path, filters) {
  const [page, setPage] = useState(1);
  const key = JSON.stringify(filters);
  useEffect(() => setPage(1), [key]);
  const res = useApi(() => api.get(`${path}${qs({ ...filters, page })}`), [key, page]);
  return { ...res, setPage };
}

export function AdminDashboard() {
  const { data, loading, error } = useApi(() => api.get('/admin/overview'), []);
  const c = data?.counts;
  return (
    <>
      <PageHeader eyebrow="Platform" title="Overview" subtitle={data?.note} />
      {error && <Alert tone="error" className="mb-4">{error.message}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active hospitals" icon={LuBuilding2} loading={loading} value={c?.activeTenants} hint={c ? `${c.suspendedTenants} suspended` : undefined} />
        <StatCard label="Collected this month" icon={LuTrendingUp} loading={loading} value={c ? money(c.collectedThisMonth) : ''} hint={c ? `${c.paidThisMonth} live payments · ${c.sandboxPayments} sandbox (excluded)` : undefined} />
        <StatCard label="New demo requests" icon={LuCalendarCheck} loading={loading} value={c?.newDemoRequests} />
        <StatCard label="New contact messages" icon={LuMessageSquare} loading={loading} value={c?.newContactMessages} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="border-b border-line px-5 py-4 font-display text-lg font-semibold">Newest hospitals</h2>
          <DataTable rowKey="TenantId" loading={loading} rows={data?.recentTenants} empty={<EmptyState title="No tenants yet" />}
            columns={[
              { key: 'Name', label: 'Hospital', render: (t) => <Link className="font-medium text-forest-800 hover:underline" to={`/admin/tenants/${t.TenantId}`}>{t.Name}</Link> },
              { key: 'Status', label: 'Status', render: (t) => <StatusBadge status={t.Status} /> },
              { key: 'CreatedAt', label: 'Created', render: (t) => date(t.CreatedAt) },
            ]} />
        </Card>
        <Card>
          <h2 className="border-b border-line px-5 py-4 font-display text-lg font-semibold">Renewals due within 14 days</h2>
          <DataTable rowKey="TenantId" loading={loading} rows={data?.expiring} empty={<EmptyState title="Nothing due" />}
            columns={[
              { key: 'Name', label: 'Hospital', render: (t) => <Link className="font-medium text-forest-800 hover:underline" to={`/admin/tenants/${t.TenantId}`}>{t.Name}</Link> },
              { key: 'CurrentPeriodEnd', label: 'Period ends', render: (t) => date(t.CurrentPeriodEnd) },
              { key: 'Status', label: 'Status', render: (t) => <StatusBadge status={t.Status} /> },
            ]} />
        </Card>
      </div>
    </>
  );
}

export function Tenants() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const search = useDebounced(q);
  const { data, meta, loading, error, setPage } = usePaged('/admin/tenants', { q: search, status });
  return (
    <>
      <PageHeader title="Hospitals" subtitle="Every tenant on the platform. Patient data is never shown here." />
      <Card>
        <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-3">
          <input className="input sm:col-span-2" placeholder="Search name, workspace or e-mail" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tenants" />
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">
            <option value="">All statuses</option>{['active', 'suspended', 'deactivated', 'pending'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </select>
        </div>
        <DataTable rowKey="TenantId" loading={loading} error={error} rows={data} onRowClick={(t) => navigate(`/admin/tenants/${t.TenantId}`)} empty={<EmptyState icon={LuBuilding2} title="No hospitals found" />}
          columns={[
            { key: 'Name', label: 'Hospital', render: (t) => <div><p className="font-medium text-ink">{t.Name}</p><p className="text-xs text-muted">{t.Slug}</p></div> },
            { key: 'City', label: 'Location', render: (t) => [t.City, t.State].filter(Boolean).join(', ') || '—' },
            { key: 'PlanName', label: 'Plan', render: (t) => t.PlanName || '—' },
            { key: 'CurrentPeriodEnd', label: 'Period ends', render: (t) => date(t.CurrentPeriodEnd) },
            { key: 'Status', label: 'Status', render: (t) => <StatusBadge status={t.Status} /> },
          ]} />
        <Pagination meta={meta} onPage={setPage} />
      </Card>
    </>
  );
}

export function TenantDetail() {
  const { id } = useParams();
  const { admin } = useAdminAuth();
  const { data: t, loading, error, reload } = useApi(() => api.get(`/admin/tenants/${id}`), [id]);
  const [action, setAction] = useState(null);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState(null);
  if (error) return <Alert tone="error">{error.message}</Alert>;
  if (loading || !t) return <Skeleton className="h-64 w-full" />;
  const apply = async () => {
    setErr(null);
    try { await api.post(`/admin/tenants/${id}/status`, { status: action, reason }); notify.success(action === 'active' ? 'Hospital reactivated.' : 'Hospital suspended and users signed out.'); setAction(null); setReason(''); reload(); } catch (e) { setErr(e.message); }
  };
  return (
    <>
      <Link to="/admin/tenants" className="mb-4 flex items-center gap-1 text-sm font-medium text-forest-700"><LuArrowLeft aria-hidden /> All hospitals</Link>
      <PageHeader eyebrow={t.Slug} title={t.Name} subtitle={`${t.City || ''} · ${titleCase(t.FacilityType || '')} · ${t.Timezone}`}
        actions={admin.role === 'super_admin' && (t.Status === 'active'
          ? <Button variant="danger" onClick={() => setAction('suspended')}>Suspend</Button>
          : <Button onClick={() => setAction('active')}>Reactivate</Button>)} />
      <div className="mb-4 flex flex-wrap items-center gap-2"><StatusBadge status={t.Status} />
        {t.subscriptions[0]?.IsTrial && <Badge tone="gold">Free trial</Badge>}{t.subscriptions[0]?.IsFree && <Badge tone="green">Free plan</Badge>}
        {t.SuspendedReason && <span className="text-sm text-muted">Reason: {t.SuspendedReason}</span>}</div>
      <BranchGroupCard tenant={t} canEdit={admin.role === 'super_admin'} onSaved={reload} />
      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Active users" value={t.usage.activeUsers} />
        <StatCard label="Patients" value={t.usage.patients} />
        <StatCard label="Staff" value={t.usage.staff} />
        <StatCard label="Appointments" value={t.usage.appointments} />
      </div>
      <p className="mt-2 text-xs text-muted">Usage counts only — the admin portal does not expose patient records. Viewing this page is audit-logged.</p>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="border-b border-line px-5 py-4 font-display text-lg font-semibold">Subscriptions</h2>
          <DataTable rowKey="SubscriptionId" rows={t.subscriptions} empty={<EmptyState title="None" />} columns={[
            { key: 'PlanName', label: 'Plan' }, { key: 'BillingInterval', label: 'Billing', render: (s) => titleCase(s.BillingInterval) },
            { key: 'CurrentPeriodEnd', label: 'Period', render: (s) => `${date(s.CurrentPeriodStart)} → ${date(s.CurrentPeriodEnd)}` },
            { key: 'Status', label: 'Status', render: (s) => <StatusBadge status={s.Status} /> }]} />
        </Card>
        <Card>
          <h2 className="border-b border-line px-5 py-4 font-display text-lg font-semibold">Payments</h2>
          <DataTable rowKey="PaymentId" rows={t.payments} empty={<EmptyState title="None" />} columns={[
            { key: 'CreatedAt', label: 'Date', render: (p) => date(p.CreatedAt) },
            { key: 'Amount', label: 'Amount', render: (p) => <>{money(p.Amount, p.Currency)} {p.IsSandbox && <Badge tone="gold">Sandbox</Badge>}</> },
            { key: 'InvoiceNumber', label: 'Invoice' }, { key: 'Status', label: 'Status', render: (p) => <StatusBadge status={p.Status} /> }]} />
        </Card>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="p-5 text-sm">
          <p className="font-semibold">Owner(s)</p>{t.owners.map((o) => <p key={o.Email} className="text-muted">{o.FullName} · {o.Email}</p>)}
          <p className="mt-4 font-semibold">Contact & location</p>
          <p className="text-muted">{[t.Email, formatPhone(t.Phone)].filter(Boolean).join(' · ') || '—'}</p>
          <p className="text-muted">{[t.City, t.State, t.Country && countryName(t.Country), t.PostalCode].filter(Boolean).join(', ') || 'Location not set'}</p>
          {t.Latitude != null && <a className="mt-1 inline-block text-xs font-semibold text-forest-700 underline" target="_blank" rel="noopener noreferrer"
            href={`https://www.openstreetmap.org/?mlat=${t.Latitude}&mlon=${t.Longitude}#map=17/${t.Latitude}/${t.Longitude}`}>Open in map</a>}
        </Card>
        {t.Latitude != null
          ? <MapView markers={[{ id: t.TenantId, lat: Number(t.Latitude), lng: Number(t.Longitude), title: t.Name }]} height={220} zoom={14} />
          : <Card className="grid place-items-center p-5 text-sm text-muted">The hospital has not placed its pin on the map yet.</Card>}
      </div>
      <Modal open={Boolean(action)} onClose={() => setAction(null)} title={action === 'active' ? 'Reactivate hospital' : 'Suspend hospital'} size="sm"
        footer={<><Button variant="ghost" onClick={() => setAction(null)}>Cancel</Button><Button variant={action === 'active' ? 'primary' : 'danger'} disabled={reason.trim().length < 3} onClick={apply}>Confirm</Button></>}>
        <p className="mb-3 text-sm text-muted">{action === 'active' ? 'Users will be able to sign in again.' : 'All users are signed out immediately. Data is kept.'}</p>
        <Textarea label="Reason (audit-logged)" value={reason} onChange={(e) => setReason(e.target.value)} />
        {err && <Alert tone="error" className="mt-3">{err}</Alert>}
      </Modal>
    </>
  );
}

/** Which hospital group (multi-branch) this hospital belongs to. */
function BranchGroupCard({ tenant, canEdit, onSaved }) {
  const { data: groups } = useApi(() => api.get('/admin/groups'), []);
  const [edit, setEdit] = useState(null);
  const current = groups?.find((g) => g.id === tenant.GroupId);
  return (
    <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
      <p><span className="font-semibold">Group:</span> {current ? `${current.name}${tenant.BranchName ? ` · ${tenant.BranchName}` : ''} (${current.hospitals.length} hospital${current.hospitals.length === 1 ? '' : 's'})` : 'Not in a group (single hospital)'}</p>
      {canEdit && <Button size="sm" variant="outline" onClick={() => setEdit({ groupId: tenant.GroupId ?? '', branchName: tenant.BranchName ?? '' })}>Change group</Button>}
      {edit && (
        <Modal open size="sm" onClose={() => setEdit(null)} title="Hospital group (branches)"
          footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={async () => {
            if (await withToast(() => api.put(`/admin/tenants/${tenant.TenantId}/group`, { groupId: edit.groupId ? Number(edit.groupId) : null, branchName: edit.branchName.trim() || null }), 'Group updated.')) { setEdit(null); onSaved(); }
          }}>Save</Button></>}>
          <div className="space-y-3">
            <Select label="Group" placeholder="No group" options={(groups || []).map((g) => ({ value: g.id, label: g.name }))} value={edit.groupId} onChange={(e) => setEdit((x) => ({ ...x, groupId: e.target.value }))} />
            <Input label="Branch name" placeholder="e.g. Andheri branch" value={edit.branchName} onChange={(e) => setEdit((x) => ({ ...x, branchName: e.target.value }))} />
            <p className="text-xs text-muted">Branches stay fully separate workspaces. Owners and admins with an account in several branches see their headline figures together. Create groups under <Link className="underline" to="/admin/groups">Hospital groups</Link>.</p>
          </div>
        </Modal>
      )}
    </Card>
  );
}

function PlanEditor({ plan, onClose, onSaved }) {
  const f = useForm(null);
  const [features, setFeatures] = useState([]);
  useEffect(() => {
    if (!plan) return;
    f.setValues({ name: plan.name, tagline: plan.tagline || '', description: plan.description || '', monthlyPrice: plan.monthlyPrice ?? '', annualPrice: plan.annualPrice ?? '',
      taxRatePercent: plan.taxRatePercent, maxStaffUsers: plan.limits.staffUsers ?? '', maxBranches: plan.limits.branches ?? '', contactSales: plan.contactSales,
      popular: plan.popular, isActive: plan.isActive, sortOrder: plan.sortOrder, trialDays: plan.trialDays ?? 0 });
    setFeatures(plan.features.map((x) => ({ ...x })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);
  const save = f.submit(async (v) => {
    const n = (x) => (x === '' || x === null ? null : Number(x));
    await api.put(`/admin/plans/${plan.id}`, {
      name: v.name, tagline: v.tagline || null, description: v.description || null, monthlyPrice: n(v.monthlyPrice), annualPrice: n(v.annualPrice),
      taxRatePercent: Number(v.taxRatePercent), maxStaffUsers: n(v.maxStaffUsers), maxBranches: n(v.maxBranches), contactSales: Boolean(v.contactSales),
      popular: Boolean(v.popular), isActive: Boolean(v.isActive), sortOrder: Number(v.sortOrder), trialDays: Number(v.trialDays || 0), features,
    });
    notify.success('Plan saved.');
    onSaved();
  });
  if (!plan || !f.values) return null;
  const check = (k, l) => <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-forest-800" checked={Boolean(f.values[k])} onChange={(e) => f.setValues((s) => ({ ...s, [k]: e.target.checked }))} />{l}</label>;
  return (
    <Modal open onClose={onClose} title={`Edit plan — ${plan.name}`} size="lg" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={f.submitting}>Save plan</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Name" {...f.bind('name')} error={f.errors.name} />
        <Input label="Tagline" {...f.bind('tagline')} />
        <Textarea label="Description" {...f.bind('description')} className="sm:col-span-2" />
        <Input label="Monthly price (₹, excl. tax)" type="number" step="0.01" {...f.bind('monthlyPrice')} error={f.errors.monthlyPrice} />
        <Input label="Annual price (₹, excl. tax)" type="number" step="0.01" {...f.bind('annualPrice')} error={f.errors.annualPrice} />
        <Input label="Tax rate %" type="number" step="0.01" {...f.bind('taxRatePercent')} />
        <Input label="Sort order" type="number" {...f.bind('sortOrder')} />
        <Input label="Max staff users (blank = unlimited)" type="number" {...f.bind('maxStaffUsers')} />
        <Input label="Max branches (blank = unlimited)" type="number" {...f.bind('maxBranches')} hint="How many hospitals one group may have on this plan." />
        <Input label="Free trial (days, 0 = no trial)" type="number" min="0" max="90" {...f.bind('trialDays')} error={f.errors.trialDays}
          hint="New hospitals can start without paying; after the trial they renew like any paid plan. One trial per e-mail / phone." />
        <div className="flex flex-wrap gap-5 sm:col-span-2">{check('contactSales', 'Contact sales (no online purchase)')}{check('popular', 'Mark as popular')}{check('isActive', 'Active')}</div>
        <div className="sm:col-span-2">
          <p className="label">Features</p>
          <div className="space-y-2">
            {features.map((ft, i) => (
              <div key={i} className="flex items-center gap-2">
                <input type="checkbox" className="accent-forest-800" checked={ft.included} onChange={(e) => setFeatures((fs) => fs.map((x, j) => (j === i ? { ...x, included: e.target.checked } : x)))} aria-label="Included" />
                <input className="input" value={ft.label} onChange={(e) => setFeatures((fs) => fs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} aria-label="Feature label" />
                <code className="hidden text-xs text-muted sm:block">{ft.key}</code>
                <Button variant="ghost" size="sm" onClick={() => setFeatures((fs) => fs.filter((_, j) => j !== i))} aria-label="Remove"><LuTrash2 aria-hidden /></Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => { const key = window.prompt('Feature key (lowercase, underscores)'); if (key && /^[a-z_]{2,60}$/.test(key)) setFeatures((fs) => [...fs, { key, label: titleCase(key), included: true }]); }}><LuPlus aria-hidden /> Add feature</Button>
          </div>
        </div>
        {f.formError && <Alert tone="error" className="sm:col-span-2">{f.formError}</Alert>}
      </div>
    </Modal>
  );
}

export function Plans() {
  const { admin } = useAdminAuth();
  const { data, loading, error, reload } = useApi(() => api.get('/admin/plans'), []);
  const [editing, setEditing] = useState(null);
  const [freeMode, setFreeMode] = useState(null); // { free, plan|null }
  const priced = (data || []).filter((p) => !p.contactSales);
  const allFree = priced.length > 0 && priced.every((p) => p.isFree);
  const anyFreeNow = priced.some((p) => p.isFree);
  const isSuper = admin.role === 'super_admin';
  return (
    <>
      <PageHeader title="Plans" subtitle="Prices and features shown on the public pricing page. Changes apply to new purchases and renewals."
        actions={isSuper && priced.length > 0 && (
          allFree
            ? <Button variant="outline" onClick={() => setFreeMode({ free: false, plan: null })}>Start charging (all plans)</Button>
            : <Button variant="gold" onClick={() => setFreeMode({ free: true, plan: null })}><LuGift aria-hidden /> Make all plans free</Button>
        )} />
      {error && <Alert tone="error">{error.message}</Alert>}
      {anyFreeNow && (
        <Alert tone="success" className="mb-4" title="Free-for-now mode is ON">
          The website shows a "Hurray! Free for now" banner and hospitals on the free plans register without paying.
          {` ${priced.reduce((n, p) => n + (p.freeHospitals || 0), 0)} hospital(s) are on a free subscription.`}
        </Alert>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        {loading && <Skeleton className="h-48" />}
        {data?.map((p) => (
          <Card key={p.id} className="p-6">
            <div className="flex items-start justify-between"><h2 className="font-display text-xl font-semibold">{p.name}</h2><div className="flex gap-1">{p.popular && <Badge tone="gold">Popular</Badge>}{p.isFree && <Badge tone="gold">Free now</Badge>}<Badge tone={p.isActive ? 'green' : 'gray'}>{p.isActive ? 'Active' : 'Hidden'}</Badge></div></div>
            <p className="mt-1 text-sm text-muted">{p.tagline}</p>
            <p className="mt-4 text-sm">{p.contactSales ? 'Contact sales' : <>{money(p.monthlyPrice)} / mo · {money(p.annualPrice)} / yr <span className="text-muted">+{p.taxRatePercent}% tax</span></>}</p>
            <p className="mt-1 text-xs text-muted">Users: {p.limits.staffUsers ?? 'unlimited'} · Branches: {p.limits.branches ?? 'unlimited'}</p>
            {p.isFree && <p className="mt-1 text-xs font-medium text-gold-700">Free since {date(p.freeSince)} · {p.freeHospitals} hospital(s) on free</p>}
            {isSuper && (
              <div className="mt-4 flex flex-wrap gap-2">
                {!p.contactSales && (p.isFree
                  ? <Button variant="outline" size="sm" onClick={() => setFreeMode({ free: false, plan: p })}>Start charging</Button>
                  : <Button variant="gold" size="sm" onClick={() => setFreeMode({ free: true, plan: p })}><LuGift aria-hidden /> Make free</Button>)}
                <Button variant="outline" size="sm" onClick={() => setEditing(p)}>Edit plan</Button>
                <Button variant="ghost" size="sm" onClick={async () => { if (window.confirm(`Delete plan ${p.name}? Only possible if nobody has bought it.`) && (await withToast(() => api.del(`/admin/plans/${p.id}`), 'Plan deleted.'))) reload(); }}>Delete</Button>
              </div>
            )}
          </Card>
        ))}
      </div>
      <PlanEditor plan={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
      <FreeModeModal mode={freeMode} onClose={() => setFreeMode(null)} onDone={() => { setFreeMode(null); reload(); }} />
    </>
  );
}

/** Confirm "make free" / "start charging". Charging asks for a notice period for hospitals already on free. */
function FreeModeModal({ mode, onClose, onDone }) {
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  if (!mode) return null;
  const target = mode.plan ? `the ${mode.plan.name} plan` : 'all plans';
  const run = async () => {
    setBusy(true);
    const ok = await withToast(() => api.post('/admin/plans/free-mode', { free: mode.free, ...(mode.plan ? { planId: mode.plan.id } : {}), ...(mode.free ? {} : { noticeDays: Number(days) }) }),
      mode.free ? 'Free mode is on. The website now shows the free banner.' : 'Charging started. Free hospitals have been given their notice period.');
    setBusy(false);
    if (ok) onDone();
  };
  return (
    <Modal open onClose={onClose} title={mode.free ? `Make ${target} free?` : `Start charging for ${target}?`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant={mode.free ? 'gold' : 'primary'} loading={busy} onClick={run}>{mode.free ? 'Yes, make free' : 'Start charging'}</Button></>}>
      {mode.free ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-forest-900">
          <li>The public website shows <strong>"Hurray! Free for now — register your hospital"</strong>.</li>
          <li>New hospitals register <strong>without payment</strong> and get their own separate, private workspace straight away.</li>
          <li>One free workspace per owner e-mail. Contact-sales plans stay as they are.</li>
          <li>You can start charging again at any time from here.</li>
        </ul>
      ) : (
        <div className="space-y-3 text-sm text-forest-900">
          <p>New sign-ups will have to pay again. Hospitals that joined for free keep working for a notice period, get reminder e-mails, and are then asked to pay from their Subscription page (their data is never deleted).</p>
          <Input label="Notice period (days)" type="number" min={0} max={90} value={days} onChange={(e) => setDays(e.target.value)} hint="0–90 days. Default 7." />
        </div>
      )}
    </Modal>
  );
}

export function Subscriptions() {
  const [status, setStatus] = useState('');
  const { data, meta, loading, error, setPage } = usePaged('/admin/subscriptions', { status });
  return (
    <>
      <PageHeader title="Subscriptions" />
      <Card>
        <div className="border-b border-line p-4 sm:w-64"><select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option>{['active', 'past_due', 'expired', 'cancelled'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</select></div>
        <DataTable rowKey="SubscriptionId" loading={loading} error={error} rows={data} empty={<EmptyState title="No subscriptions" />} columns={[
          { key: 'TenantName', label: 'Hospital', render: (s) => <Link className="font-medium text-forest-800 hover:underline" to={`/admin/tenants/${s.TenantId}`}>{s.TenantName}</Link> },
          { key: 'PlanName', label: 'Plan' }, { key: 'BillingInterval', label: 'Billing', render: (s) => titleCase(s.BillingInterval) },
          { key: 'CurrentPeriodEnd', label: 'Period ends', render: (s) => date(s.CurrentPeriodEnd) },
          { key: 'Status', label: 'Status', render: (s) => <StatusBadge status={new Date(s.CurrentPeriodEnd) < new Date() && s.Status === 'active' ? 'grace' : s.Status} /> }]} />
        <Pagination meta={meta} onPage={setPage} />
      </Card>
    </>
  );
}

export function Payments() {
  const [status, setStatus] = useState('');
  const { data, meta, loading, error, setPage } = usePaged('/admin/payments', { status });
  return (
    <>
      <PageHeader title="Payments" subtitle="Sandbox payments are labelled and never count as revenue." />
      <Card>
        <div className="border-b border-line p-4 sm:w-64"><select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option>{['created', 'paid', 'failed', 'refunded'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</select></div>
        <DataTable rowKey="PaymentId" loading={loading} error={error} rows={data} empty={<EmptyState icon={LuCreditCard} title="No payments" />} columns={[
          { key: 'CreatedAt', label: 'Created', render: (p) => dateTime(p.CreatedAt) },
          { key: 'who', label: 'Hospital', render: (p) => p.TenantName || <span className="text-muted">{p.OnboardingOrg} (onboarding)</span> },
          { key: 'Purpose', label: 'Purpose', render: (p) => titleCase(p.Purpose) },
          { key: 'Provider', label: 'Provider', render: (p) => <>{titleCase(p.Provider)} {p.IsSandbox && <Badge tone="gold">Sandbox</Badge>}</> },
          { key: 'Amount', label: 'Amount', render: (p) => money(p.Amount, p.Currency) },
          { key: 'ProviderOrderId', label: 'Order / payment', render: (p) => <span className="font-mono text-[11px]">{p.ProviderOrderId}<br />{p.ProviderPaymentId}</span> },
          { key: 'Status', label: 'Status', render: (p) => <span title={p.FailureReason || ''}><StatusBadge status={p.Status} /></span> }]} />
        <Pagination meta={meta} onPage={setPage} />
      </Card>
    </>
  );
}

function DemoDetail({ id, onClose, onSaved }) {
  const { admin } = useAdminAuth();
  const { data, loading, reload } = useApi(() => (id ? api.get(`/admin/demo-requests/${id}`) : Promise.resolve({ data: null })), [id]);
  const [note, setNote] = useState('');
  const [err, setErr] = useState(null);
  const patch = async (body) => {
    setErr(null);
    try { await api.patch(`/admin/demo-requests/${id}`, body); notify.success('Demo request updated.'); setNote(''); reload(); onSaved(); } catch (e) { setErr(e.message); }
  };
  return (
    <Modal open={Boolean(id)} onClose={onClose} title={data ? data.OrgName : 'Demo request'} size="lg">
      {loading || !data ? <Skeleton className="h-40 w-full" /> : (
        <div className="space-y-5">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {[['Contact', data.ContactName], ['E-mail', data.Email], ['Phone', formatPhone(data.Phone)], ['Location', [data.City, data.State, data.Country].filter(Boolean).join(', ')], ['Facility', titleCase(data.FacilityType || '')], ['Expected users', data.ExpectedUsers],
              ['Preferred time', dateTime(data.PreferredAt)], ['Received', dateTime(data.CreatedAt)]].map(([k, v]) => <div key={k}><dt className="text-muted">{k}</dt><dd className="font-medium">{v || '—'}</dd></div>)}
          </dl>
          {data.Message && <p className="rounded-lg bg-ivory p-3 text-sm">{data.Message}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Status" value={data.Status} onChange={(e) => patch({ status: e.target.value })} options={['new', 'contacted', 'scheduled', 'completed', 'closed'].map((s) => ({ value: s, label: titleCase(s) }))} />
            <Select label="Assigned to" placeholder="Unassigned" value={data.AssignedTo ? String(data.AssignedTo) : ''} onChange={(e) => patch({ assignedTo: e.target.value ? Number(e.target.value) : null })}
              options={data.assignees.map((a) => ({ value: String(a.PlatformUserId), label: a.FullName }))} />
          </div>
          <div>
            <Textarea label="Add follow-up note" value={note} onChange={(e) => setNote(e.target.value)} />
            <Button className="mt-2" size="sm" disabled={!note.trim()} onClick={() => patch({ note: note.trim() })}>Add note</Button>
          </div>
          {err && <Alert tone="error">{err}</Alert>}
          {admin?.role === 'super_admin' && <Button variant="ghost" size="sm" onClick={async () => { if (window.confirm('Delete this demo request permanently?') && (await withToast(() => api.del(`/admin/demo-requests/${id}`), 'Demo request deleted.'))) { onSaved(); onClose(); } }}>Delete request</Button>}
          <ul className="space-y-2">
            {data.notes.map((n) => <li key={n.NoteId} className="rounded-lg border border-line p-3 text-sm"><p>{n.Note}</p><p className="mt-1 text-xs text-muted">{n.Author} · {dateTime(n.CreatedAt)}</p></li>)}
          </ul>
        </div>
      )}
    </Modal>
  );
}

export function DemoRequests() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const search = useDebounced(q);
  const { data, meta, loading, error, setPage, reload } = usePaged('/admin/demo-requests', { status, q: search });
  return (
    <>
      <PageHeader title="Demo requests" subtitle="Submitted from the public Book a Demo page." />
      <Card>
        <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-3">
          <input className="input sm:col-span-2" placeholder="Search organisation, contact, e-mail or city" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option>{['new', 'contacted', 'scheduled', 'completed', 'closed'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</select>
        </div>
        <DataTable rowKey="DemoRequestId" loading={loading} error={error} rows={data} onRowClick={(d) => setOpen(d.DemoRequestId)} empty={<EmptyState icon={LuCalendarCheck} title="No demo requests" />} columns={[
          { key: 'OrgName', label: 'Organisation', render: (d) => <div><p className="font-medium">{d.OrgName}</p><p className="text-xs text-muted">{d.City}</p></div> },
          { key: 'ContactName', label: 'Contact', render: (d) => <div><p>{d.ContactName}</p><p className="text-xs text-muted">{d.Email}</p></div> },
          { key: 'PreferredAt', label: 'Preferred', render: (d) => dateTime(d.PreferredAt) },
          { key: 'AssignedToName', label: 'Assigned', render: (d) => d.AssignedToName || '—' },
          { key: 'Status', label: 'Status', render: (d) => <StatusBadge status={d.Status} /> }]} />
        <Pagination meta={meta} onPage={setPage} />
      </Card>
      <DemoDetail id={open} onClose={() => setOpen(null)} onSaved={reload} />
    </>
  );
}

export function Messages() {
  const { data, meta, loading, error, setPage } = usePaged('/admin/contact-messages', {});
  return (
    <>
      <PageHeader title="Contact messages" />
      <Card>
        <DataTable rowKey="ContactMessageId" loading={loading} error={error} rows={data} empty={<EmptyState icon={LuMessageSquare} title="No messages" />} columns={[
          { key: 'CreatedAt', label: 'Received', render: (m) => dateTime(m.CreatedAt) },
          { key: 'Name', label: 'From', render: (m) => <div><p className="font-medium">{m.Name}</p><p className="text-xs text-muted">{m.Email} {formatPhone(m.Phone)}</p></div> },
          { key: 'Message', label: 'Message', render: (m) => <div className="max-w-md"><p className="font-medium">{m.Subject}</p><p className="line-clamp-2 text-muted">{m.Message}</p></div> }]} />
        <Pagination meta={meta} onPage={setPage} />
      </Card>
    </>
  );
}

export function AuditLogs() {
  const [filters, setFilters] = useState({ action: '', actorType: '', tenantId: '' });
  const debounced = useDebounced(filters);
  const { data, meta, loading, error, setPage } = usePaged('/admin/audit-logs', debounced);
  return (
    <>
      <PageHeader title="Audit logs" subtitle="Platform-wide security and administrative events." />
      <Card>
        <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-3">
          <input className="input" placeholder="Action contains… (e.g. login)" value={filters.action} onChange={(e) => setFilters((s) => ({ ...s, action: e.target.value }))} aria-label="Action" />
          <select className="input" value={filters.actorType} onChange={(e) => setFilters((s) => ({ ...s, actorType: e.target.value }))} aria-label="Actor type"><option value="">Any actor</option>{['tenant', 'platform', 'system', 'public'].map((a) => <option key={a} value={a}>{titleCase(a)}</option>)}</select>
          <input className="input" placeholder="Tenant ID" inputMode="numeric" value={filters.tenantId} onChange={(e) => setFilters((s) => ({ ...s, tenantId: e.target.value.replace(/\D/g, '') }))} aria-label="Tenant ID" />
        </div>
        <DataTable rowKey="AuditLogId" loading={loading} error={error} rows={data} empty={<EmptyState title="No events" />} columns={[
          { key: 'CreatedAt', label: 'When', render: (a) => dateTime(a.CreatedAt) },
          { key: 'TenantName', label: 'Hospital', render: (a) => a.TenantName || '—' },
          { key: 'ActorType', label: 'Actor', render: (a) => `${titleCase(a.ActorType)}${a.ActorId ? ` #${a.ActorId}` : ''}` },
          { key: 'Action', label: 'Action', render: (a) => <span className="font-mono text-xs">{a.Action}</span> },
          { key: 'Metadata', label: 'Details', render: (a) => <span className="font-mono text-[11px] text-muted">{a.Metadata}</span> },
          { key: 'IpAddress', label: 'IP' }]} />
        <Pagination meta={meta} onPage={setPage} />
      </Card>
    </>
  );
}

export function AdminSettings() {
  const { admin } = useAdminAuth();
  const { data, loading } = useApi(() => api.get('/admin/settings'), []);
  const f = useForm({ 'brand.name': '', 'contact.email': '', 'contact.phone': '', 'contact.address': '',
    'invoice.legal_name': '', 'invoice.gstin': '', 'invoice.state': '', 'invoice.sac': '', 'invoice.footer': '', 'support.email': '' });
  const { data: inStates } = useApi(() => api.get('/geo/states?country=IN'), []);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (data) f.setValues((s) => ({ ...s, ...data })); /* eslint-disable-next-line */ }, [data]);
  const save = f.submit(async (v) => { setSaved(false); await api.put('/admin/settings', Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x ?? '']))); setSaved(true); notify.success('Website settings saved.'); });
  return (
    <>
      <PageHeader title="Website settings" subtitle="Contact details shown on the public website footer and Contact page." />
      <Card className="max-w-2xl p-6">
        {loading ? <Skeleton className="h-40" /> : (
          <form onSubmit={save} className="space-y-4">
            <fieldset disabled={admin.role !== 'super_admin'} className="space-y-4">
              <Input label="Brand name" {...f.bind('brand.name')} />
              <EmailInput label="Contact e-mail" {...f.bind('contact.email')} error={f.errors['contact.email']} />
              <PhoneInput label="Contact phone" {...f.bind('contact.phone')} error={f.errors['contact.phone']} />
              <Input label="Address" {...f.bind('contact.address')} hint="Also printed on invoices as the seller address." />
              <EmailInput label="Support inbox (ticket alerts)" {...f.bind('support.email')} error={f.errors['support.email']} hint="New hospital messages on support tickets are e-mailed here. Empty = the contact e-mail." />
              <p className="eyebrow pt-4">Invoices (seller details)</p>
              <Input label="Legal / registered business name" placeholder="Saitix Technologies Pvt. Ltd." {...f.bind('invoice.legal_name')} error={f.errors['invoice.legal_name']} />
              <Input label="GSTIN" maxLength={15} placeholder="27ABCDE1234F1Z5" {...f.bind('invoice.gstin')} error={f.errors['invoice.gstin']}
                hint="With a GSTIN, invoices are titled “Tax Invoice” and show CGST+SGST (same state) or IGST (other state)." />
              <Combobox label="State of GST registration" value={f.values['invoice.state'] || ''} options={(inStates || []).map((x) => ({ value: x.name, label: x.name, keywords: x.code }))}
                onChange={(v) => f.setValues((s0) => ({ ...s0, 'invoice.state': v }))} placeholder="Search state…" error={f.errors['invoice.state']}
                hint="Leave empty to take it from the GSTIN (first two digits, e.g. 09 = Uttar Pradesh)." />
              <Input label="Default SAC code" inputMode="numeric" placeholder="997331" {...f.bind('invoice.sac')} error={f.errors['invoice.sac']} hint="997331 = licensing services for the right to use software (common for SaaS). Confirm with your CA." />
              <Input label="Invoice footer" {...f.bind('invoice.footer')} />
              <p className="text-xs text-muted">Changes apply to invoices issued from now on; already-issued invoices keep the details they were issued with.</p>
            </fieldset>
            {f.formError && <Alert tone="error">{f.formError}</Alert>}
            {saved && <Alert tone="success">Saved.</Alert>}
            {admin.role === 'super_admin' && <Button type="submit" loading={f.submitting}>Save</Button>}
          </form>
        )}
      </Card>
    </>
  );
}
