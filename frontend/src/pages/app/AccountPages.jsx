// Users & roles, Settings, Subscription, Audit log and "coming soon" module pages.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { LuPlus, LuShieldCheck, LuHistory, LuPackage, LuFileText } from 'react-icons/lu';
import { api } from '../../lib/api.js';
import { useApi, useForm } from '../../lib/hooks.js';
import { useTenantAuth } from '../../context/AuthContext.jsx';
import { date, dateTime, money, titleCase, relative, BRAND } from '../../lib/format.js';
import { openRazorpay } from '../../lib/payments.js';
import SandboxGateway from '../../components/SandboxGateway.jsx';
import { Alert, Badge, Button, Card, DataTable, EmptyState, Input, Modal, PageHeader, Select, Skeleton, StatusBadge, cx } from '../../components/ui.jsx';

// ───────────────────────── Users & roles ─────────────────────────
function UserForm({ open, user, roles, onClose, onSaved }) {
  const f = useForm({ fullName: '', email: '', password: '', roleIds: [] });
  useEffect(() => {
    if (open) f.setValues(user ? { fullName: user.fullName, email: user.email, password: '', roleIds: user.roles.map((r) => r.id) } : { fullName: '', email: '', password: '', roleIds: [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user]);
  const toggle = (id) => f.setValues((s) => ({ ...s, roleIds: s.roleIds.includes(id) ? s.roleIds.filter((x) => x !== id) : [...s.roleIds, id] }));
  const save = f.submit(async (v) => {
    if (!v.roleIds.length) throw new Error('Select at least one role.');
    if (user) await api.patch(`/users/${user.id}`, { fullName: v.fullName, roleIds: v.roleIds });
    else await api.post('/users', v);
    onSaved();
  });
  return (
    <Modal open={open} onClose={onClose} title={user ? `Edit ${user.fullName}` : 'Add user'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={f.submitting}>Save</Button></>}>
      <form onSubmit={save} className="space-y-4" noValidate>
        <Input label="Full name" required {...f.bind('fullName')} error={f.errors.fullName} />
        {!user && <>
          <Input label="E-mail (login)" type="email" required {...f.bind('email')} error={f.errors.email} />
          <Input label="Temporary password" type="password" autoComplete="new-password" required {...f.bind('password')} error={f.errors.password} hint="Share it securely; the user can reset it with “Forgot password”." />
        </>}
        <fieldset>
          <legend className="label">Roles</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {roles?.filter((r) => r.code !== 'owner' || user?.isOwner).map((r) => (
              <label key={r.id} className={cx('flex cursor-pointer gap-3 rounded-lg border p-3 text-sm', f.values.roleIds.includes(r.id) ? 'border-forest-600 bg-forest-50' : 'border-line')}>
                <input type="checkbox" className="mt-0.5 accent-forest-800" checked={f.values.roleIds.includes(r.id)} onChange={() => toggle(r.id)} />
                <span><span className="font-semibold text-ink">{r.name}</span><span className="block text-xs text-muted">{r.description}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
        {f.formError && <Alert tone="error">{f.formError}</Alert>}
      </form>
    </Modal>
  );
}

function RoleMatrix({ roles, permissions, canEdit, myRoles, onSaved }) {
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState(null);
  const modules = useMemo(() => [...new Set(permissions?.map((p) => p.module))], [permissions]);
  const save = async () => {
    setError(null);
    try { await api.put(`/users/roles/${editing.id}/permissions`, { permissions: editing.permissions }); setEditing(null); onSaved(); } catch (e) { setError(e.message); }
  };
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead className="bg-forest-50/40">
            <tr><th scope="col">Permission</th>{roles?.map((r) => (
              <th key={r.id} scope="col" className="text-center">
                {r.name}
                {canEdit && r.code !== 'owner' && !myRoles.includes(r.code) && <button className="ml-1 text-[10px] font-semibold normal-case text-forest-700 underline" onClick={() => setEditing({ ...r })}>edit</button>}
              </th>))}</tr>
          </thead>
          <tbody className="divide-y divide-line">
            {modules.map((m) => (
              <Fragment key={m}>
                <tr className="bg-ivory"><td colSpan={(roles?.length ?? 0) + 1} className="py-2 text-xs font-bold uppercase tracking-wide text-gold-700">{titleCase(m)}</td></tr>
                {permissions.filter((p) => p.module === m).map((p) => (
                  <tr key={p.code}>
                    <td><span className="text-ink">{p.description}</span><span className="block font-mono text-[10px] text-muted">{p.code}</span></td>
                    {roles.map((r) => <td key={r.id} className="text-center">{r.permissions.includes(p.code) ? <span className="text-forest-600" aria-label="Granted">●</span> : <span className="text-slate-300" aria-label="Not granted">○</span>}</td>)}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={`Permissions — ${editing?.name ?? ''}`} size="lg"
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save}>Save</Button></>}>
        <p className="mb-4 text-sm text-muted">You can only grant permissions you hold yourself. Changes apply to every user with this role on their next request.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {permissions?.map((p) => (
            <label key={p.code} className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 accent-forest-800" checked={editing?.permissions.includes(p.code) ?? false}
                onChange={(e) => setEditing((r) => ({ ...r, permissions: e.target.checked ? [...r.permissions, p.code] : r.permissions.filter((x) => x !== p.code) }))} />
              <span>{p.description} <span className="font-mono text-[10px] text-muted">{p.code}</span></span>
            </label>
          ))}
        </div>
        {error && <Alert tone="error" className="mt-4">{error}</Alert>}
      </Modal>
    </Card>
  );
}

export function UsersRoles() {
  const { me, can } = useTenantAuth();
  const [tab, setTab] = useState('users');
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState(null);
  const users = useApi(() => api.get('/users'), []);
  const roles = useApi(() => api.get('/users/roles'), []);
  const perms = useApi(() => api.get('/users/permissions'), []);
  const setStatus = async (u, status) => {
    setError(null);
    try { await api.patch(`/users/${u.id}`, { status }); users.reload(); } catch (e) { setError(e.message); }
  };
  return (
    <>
      <PageHeader title="Users & roles" subtitle="Who can sign in to this hospital and what they can do. Permissions are enforced on the server."
        actions={can('users.manage') && tab === 'users' && <Button onClick={() => setEditing('new')}><LuPlus aria-hidden /> Add user</Button>} />
      <div className="mb-4 flex gap-1 rounded-lg border border-line bg-white p-1 sm:w-fit" role="tablist">
        {[['users', 'Users'], ['roles', 'Role permissions']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx('flex-1 rounded-md px-4 py-1.5 text-sm font-semibold', tab === k ? 'bg-forest-900 text-white' : 'text-forest-800 hover:bg-forest-50')}>{l}</button>
        ))}
      </div>
      {error && <Alert tone="error" className="mb-4">{error}</Alert>}
      {tab === 'users' ? (
        <Card>
          <DataTable loading={users.loading} error={users.error} rows={users.data} empty={<EmptyState icon={LuShieldCheck} title="No users" />}
            columns={[
              { key: 'fullName', label: 'Name', render: (u) => <div><p className="font-medium text-ink">{u.fullName} {u.isOwner && <Badge tone="gold" className="ml-1">Owner</Badge>}</p><p className="text-xs text-muted">{u.email}</p></div> },
              { key: 'roles', label: 'Roles', render: (u) => <div className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r.id} tone="green">{r.name}</Badge>)}</div> },
              { key: 'status', label: 'Status', render: (u) => <StatusBadge status={u.status} /> },
              { key: 'lastLoginAt', label: 'Last sign-in', render: (u) => (u.lastLoginAt ? relative(u.lastLoginAt) : 'Never') },
              { key: 'act', label: <span className="sr-only">Actions</span>, className: 'text-right', render: (u) => can('users.manage') && u.email !== me.user.email && (
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>Edit</Button>
                  {!u.isOwner && <Button size="sm" variant="ghost" onClick={() => setStatus(u, u.status === 'active' ? 'disabled' : 'active')}>{u.status === 'active' ? 'Disable' : 'Enable'}</Button>}
                </div>) },
            ]} />
        </Card>
      ) : (
        <RoleMatrix roles={roles.data} permissions={perms.data} canEdit={can('roles.manage')} myRoles={me.user.roles} onSaved={roles.reload} />
      )}
      <UserForm open={Boolean(editing)} user={editing === 'new' ? null : editing} roles={roles.data} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); users.reload(); }} />
    </>
  );
}

// ───────────────────────── Settings ─────────────────────────
const TIMEZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Kathmandu', 'Asia/Dhaka', 'Asia/Colombo', 'Asia/Singapore', 'Europe/London', 'America/New_York'];

export function Settings() {
  const { can, refresh } = useTenantAuth();
  const { data, loading, error } = useApi(() => api.get('/settings'), []);
  const [saved, setSaved] = useState(false);
  const f = useForm({ name: '', email: '', phone: '', city: '', state: '', timezone: 'Asia/Kolkata', prefix: '', address: '' });
  useEffect(() => {
    if (data) f.setValues({ name: data.Name, email: data.Email || '', phone: data.Phone || '', city: data.City || '', state: data.State || '', timezone: data.Timezone,
      prefix: data.settings['patient.number_prefix'] || '', address: data.settings['hospital.address'] || '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  const save = f.submit(async (v) => {
    setSaved(false);
    await api.put('/settings', { name: v.name, email: v.email || null, phone: v.phone || null, city: v.city || null, state: v.state || null, timezone: v.timezone,
      settings: { 'patient.number_prefix': v.prefix.toUpperCase() || null, 'hospital.address': v.address || null } });
    setSaved(true);
    refresh();
  });
  const ro = !can('settings.manage');
  if (error) return <Alert tone="error">{error.message}</Alert>;
  return (
    <>
      <PageHeader title="Hospital settings" subtitle="Profile and preferences for this workspace." />
      <Card className="max-w-3xl p-6">
        {loading ? <Skeleton className="h-60 w-full" /> : (
          <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
            <fieldset disabled={ro} className="contents">
              <Input label="Hospital name" required {...f.bind('name')} error={f.errors.name} className="sm:col-span-2" />
              <Input label="E-mail" type="email" {...f.bind('email')} error={f.errors.email} />
              <Input label="Phone" {...f.bind('phone')} error={f.errors.phone} />
              <Input label="City" {...f.bind('city')} />
              <Input label="State" {...f.bind('state')} />
              <Input label="Address (printed on documents)" {...f.bind('address')} className="sm:col-span-2" />
              <Select label="Timezone" options={TIMEZONES.map((t) => ({ value: t, label: t }))} {...f.bind('timezone')} hint="Used for all dates, schedules and the dashboard." />
              <Input label="Patient number prefix" maxLength={6} {...f.bind('prefix')} hint="Applies to newly registered patients, e.g. GVH-000124." />
            </fieldset>
            {f.formError && <Alert tone="error" className="sm:col-span-2">{f.formError}</Alert>}
            {saved && <Alert tone="success" className="sm:col-span-2">Settings saved.</Alert>}
            {!ro && <div className="sm:col-span-2"><Button type="submit" loading={f.submitting}>Save settings</Button></div>}
          </form>
        )}
      </Card>
    </>
  );
}

// ───────────────────────── Subscription ─────────────────────────
export function Subscription() {
  const { me, can, refresh } = useTenantAuth();
  const { data, loading, error, reload } = useApi(() => api.get('/subscription'), []);
  const [renew, setRenew] = useState({ planCode: '', interval: 'annual' });
  const [pay, setPay] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const sub = data?.subscription;
  useEffect(() => { if (sub && !renew.planCode) setRenew((r) => ({ ...r, planCode: sub.PlanCode, interval: sub.BillingInterval })); }, [sub, renew.planCode]);
  const option = data?.renewalOptions?.find((o) => o.code === renew.planCode);

  const verify = async (result) => {
    setPay(null);
    try {
      const r = await api.post('/subscription/verify', result);
      setMsg({ tone: 'success', text: `Renewed. Invoice ${r.data.invoiceNumber ?? ''} issued.` });
      reload(); refresh();
    } catch (e) { setMsg({ tone: 'error', text: e.message }); }
  };
  const start = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await api.post('/subscription/renew', renew);
      if (r.data.payment.provider === 'razorpay') {
        await verify(await openRazorpay({ ...r.data.payment, prefill: { name: me.user.name, email: me.user.email } }, { name: BRAND, description: 'Subscription renewal' }));
      } else setPay(r.data.payment);
    } catch (e) { setMsg({ tone: 'error', text: e.message }); } finally { setBusy(false); }
  };

  if (error) return <Alert tone="error">{error.message}</Alert>;
  const state = data?.state;
  return (
    <>
      <PageHeader title="Subscription" subtitle="Plan, renewal and invoices for this hospital." />
      {msg && <Alert tone={msg.tone} className="mb-4">{msg.text}</Alert>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-6">
          {loading ? <Skeleton className="h-32 w-full" /> : sub ? (
            <>
              <p className="eyebrow">Current plan</p>
              <p className="mt-2 font-display text-3xl font-semibold text-forest-950">{sub.PlanName}</p>
              <p className="text-sm capitalize text-muted">{sub.BillingInterval}</p>
              <div className="mt-4 flex items-center gap-2"><StatusBadge status={state.state === 'active' ? 'active' : state.state} />
                <span className="text-sm text-muted">{state.state === 'active' ? `renews ${date(sub.CurrentPeriodEnd, me.tenant.timezone)}` : state.state === 'grace' ? `${state.daysLeft} grace day(s) left` : 'read-only'}</span></div>
              <p className="mt-4 text-sm text-muted">Users: {sub.ActiveUsers}{sub.MaxStaffUsers ? ` of ${sub.MaxStaffUsers}` : ' (unlimited)'}</p>
            </>
          ) : <EmptyState title="No subscription" />}
        </Card>
        <Card className="p-6 lg:col-span-2">
          <h2 className="font-display text-lg font-semibold text-forest-950">Renew or change plan</h2>
          {!can('subscription.manage') ? <p className="mt-2 text-sm text-muted">Only the hospital owner can renew the subscription.</p> : (
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <Select label="Plan" value={renew.planCode} onChange={(e) => setRenew((r) => ({ ...r, planCode: e.target.value }))} options={(data?.renewalOptions || []).map((o) => ({ value: o.code, label: o.name }))} />
              <Select label="Billing" value={renew.interval} onChange={(e) => setRenew((r) => ({ ...r, interval: e.target.value }))} options={[{ value: 'monthly', label: 'Monthly' }, { value: 'annual', label: 'Annual' }]} />
              <div className="flex items-end"><Button className="w-full" onClick={start} loading={busy} disabled={!option}>Pay {option ? money(option[renew.interval].total) : ''}</Button></div>
              {option && <p className="text-xs text-muted sm:col-span-3">{money(option[renew.interval].subtotal)} + GST {money(option[renew.interval].tax)}. Early renewals extend from the current end date.</p>}
            </div>
          )}
        </Card>
      </div>
      <Card className="mt-6">
        <h2 className="border-b border-line px-5 py-4 font-display text-lg font-semibold text-forest-950">Invoices</h2>
        <DataTable rowKey="InvoiceNumber" loading={loading} rows={data?.invoices} empty={<EmptyState icon={LuFileText} title="No invoices yet" />}
          columns={[
            { key: 'InvoiceNumber', label: 'Invoice', render: (i) => <span className="font-mono text-xs">{i.InvoiceNumber} {i.IsSandbox && <Badge tone="gold">Sandbox</Badge>}</span> },
            { key: 'Description', label: 'Description' },
            { key: 'IssuedAt', label: 'Date', render: (i) => date(i.IssuedAt, me.tenant.timezone) },
            { key: 'Subtotal', label: 'Subtotal', render: (i) => money(i.Subtotal, i.Currency) },
            { key: 'TaxAmount', label: 'Tax', render: (i) => money(i.TaxAmount, i.Currency) },
            { key: 'Total', label: 'Total', render: (i) => <span className="font-semibold">{money(i.Total, i.Currency)}</span> },
          ]} />
      </Card>
      {pay && <SandboxGateway payment={pay} onAuthorised={verify} onFailed={(e) => { setPay(null); setMsg({ tone: 'error', text: e.message }); }} onClose={() => setPay(null)} />}
    </>
  );
}

// ───────────────────────── Audit log ─────────────────────────
export function AuditLog() {
  const { me } = useTenantAuth();
  const { data, loading, error } = useApi(() => api.get('/audit-logs'), []);
  return (
    <>
      <PageHeader title="Audit log" subtitle="The latest 200 actions in this hospital. Clinical details and secrets are never logged." />
      <Card>
        <DataTable rowKey="AuditLogId" loading={loading} error={error} rows={data} empty={<EmptyState icon={LuHistory} title="No activity yet" />}
          columns={[
            { key: 'CreatedAt', label: 'When', render: (a) => dateTime(a.CreatedAt, me.tenant.timezone) },
            { key: 'ActorName', label: 'Who', render: (a) => a.ActorName || titleCase(a.ActorType) },
            { key: 'Action', label: 'Action', render: (a) => <span className="font-mono text-xs">{a.Action}</span> },
            { key: 'Entity', label: 'Record', render: (a) => (a.EntityType ? `${a.EntityType} #${a.EntityId}` : '—') },
          ]} />
      </Card>
    </>
  );
}

// ───────────────────────── Not yet implemented modules ─────────────────────────
export function ComingSoon({ title, description }) {
  return (
    <>
      <PageHeader title={title} />
      <Card className="border-dashed">
        <EmptyState icon={LuPackage} title={`${title} — coming in Phase 6`}>
          {description} This module is not implemented yet, so no data is shown here. Permissions for it already exist so roles are ready when it ships.
        </EmptyState>
      </Card>
    </>
  );
}
