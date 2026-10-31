// Users & roles, Settings, Subscription, Audit log and "coming soon" module pages.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import HospitalLocation from '../../components/HospitalLocation.jsx';
import { LuPlus, LuShieldCheck, LuHistory, LuPackage, LuFileText, LuTrash2 } from 'react-icons/lu';
import { api } from '../../lib/api.js';
import { useApi, useForm } from '../../lib/hooks.js';
import { FACILITY_OPTIONS, profileFor } from '../../lib/facility.js';
import { useTenantAuth } from '../../context/AuthContext.jsx';
import { notify, withToast } from '../../lib/toast.js';
import { date, dateTime, money, titleCase, relative, BRAND } from '../../lib/format.js';
import { openRazorpay } from '../../lib/payments.js';
import SandboxGateway from '../../components/SandboxGateway.jsx';
import { Alert, Badge, Button, Card, DataTable, EmptyState, Input, Modal, PageHeader, Select, Skeleton, StatusBadge, Textarea, cx } from '../../components/ui.jsx';
import PhoneInput from '../../components/PhoneInput.jsx';
import EmailInput from '../../components/EmailInput.jsx';
import LocationFields from '../../components/LocationFields.jsx';
import { LoginHistory } from './AccountExtras.jsx';

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
    notify.success(user ? 'User updated.' : 'User created.');
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
    try { await api.put(`/users/roles/${editing.id}/permissions`, { permissions: editing.permissions }); notify.success('Role permissions saved.'); setEditing(null); onSaved(); } catch (e) { setError(e.message); }
  };
  return (
    <Card className="overflow-hidden">
      <div className="relative overflow-x-auto">
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
    try { await api.patch(`/users/${u.id}`, { status }); notify.success(status === 'active' ? 'User enabled.' : 'User disabled and signed out.'); users.reload(); } catch (e) { notify.error(e.message); }
  };
  return (
    <>
      <PageHeader title="Users & roles" subtitle="Who can sign in to this hospital and what they can do. Permissions are enforced on the server."
        actions={can('users.manage') && tab === 'users' && <Button onClick={() => setEditing('new')}><LuPlus aria-hidden /> Add user</Button>} />
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg border border-line bg-white p-1 sm:w-fit" role="tablist">
        {[['users', 'Users'], ['roles', 'Role permissions'], ['logins', 'Sign-in history']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx('flex-1 whitespace-nowrap rounded-md px-4 py-1.5 text-sm font-semibold', tab === k ? 'bg-forest-900 text-white' : 'text-forest-800 hover:bg-forest-50')}>{l}</button>
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
                  {!u.isOwner && <Button size="sm" variant="ghost" aria-label={`Delete ${u.fullName}`} onClick={async () => { if (window.confirm(`Delete the login for ${u.fullName}? Their past actions stay in the audit log.`) && (await withToast(() => api.del(`/users/${u.id}`), 'User deleted.'))) users.reload(); }}><LuTrash2 aria-hidden /></Button>}
                </div>) },
            ]} />
        </Card>
      ) : tab === 'roles' ? (
        <RoleMatrix roles={roles.data} permissions={perms.data} canEdit={can('roles.manage')} myRoles={me.user.roles} onSaved={roles.reload} />
      ) : <LoginHistory />}
      <UserForm open={Boolean(editing)} user={editing === 'new' ? null : editing} roles={roles.data} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); users.reload(); }} />
    </>
  );
}

// ───────────────────────── Settings ─────────────────────────
const TIMEZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Kathmandu', 'Asia/Dhaka', 'Asia/Colombo', 'Asia/Singapore', 'Europe/London', 'America/New_York'];

export function Settings() {
  const { me, can, refresh } = useTenantAuth();
  const { data, loading, error, reload } = useApi(() => api.get('/settings'), []);
  const [saved, setSaved] = useState(false);
  const f = useForm({ name: '', email: '', phone: '', country: '', city: '', state: '', timezone: 'Asia/Kolkata', prefix: '', address: '' });
  useEffect(() => {
    if (data) f.setValues({ name: data.Name, email: data.Email || '', phone: data.Phone || '', country: data.Country || 'IN', city: data.City || '', state: data.State || '', timezone: data.Timezone, facilityType: data.FacilityType || 'other',
      prefix: data.settings['patient.number_prefix'] || '', address: data.settings['hospital.address'] || '',
      gstin: data.settings['gst.gstin'] || '', sac: data.settings['gst.sac_default'] || '',
      mfa: data.settings['security.mfa_admins'] === 'on', whatsapp: data.settings['notify.whatsapp'] !== 'off', summary: data.settings['notify.daily_summary'] !== 'off',
      followUp: data.settings['notify.follow_up'] !== 'off', stockAlerts: data.settings['notify.stock_alerts'] !== 'off', autoBed: data.settings['ipd.auto_bed_charges'] !== 'off',
      upiId: data.settings['payment.upi_id'] || '', upiName: data.settings['payment.upi_name'] || '',
      booking: data.settings['booking.enabled'] === 'on', bookingNotice: data.settings['booking.notice'] || '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  const save = f.submit(async (v) => {
    setSaved(false);
    await api.put('/settings', { name: v.name, email: v.email || null, phone: v.phone || null, country: v.country || null, city: v.city || null, state: v.state || null, timezone: v.timezone, facilityType: v.facilityType || null,
      settings: {
        'patient.number_prefix': v.prefix.toUpperCase() || null, 'hospital.address': v.address || null,
        'gst.gstin': v.gstin.trim().toUpperCase() || null, 'gst.sac_default': v.sac.trim() || null,
        'security.mfa_admins': v.mfa ? 'on' : 'off', 'notify.whatsapp': v.whatsapp ? 'on' : 'off', 'notify.daily_summary': v.summary ? 'on' : 'off',
        'notify.follow_up': v.followUp ? 'on' : 'off', 'notify.stock_alerts': v.stockAlerts ? 'on' : 'off', 'ipd.auto_bed_charges': v.autoBed ? 'on' : 'off',
        'payment.upi_id': (v.upiId || '').trim() || null, 'payment.upi_name': (v.upiName || '').trim() || null,
        'booking.enabled': v.booking ? 'on' : 'off', 'booking.notice': (v.bookingNotice || '').trim() || null,
      } });
    setSaved(true);
    notify.success('Settings saved.');
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
              <EmailInput label="E-mail" {...f.bind('email')} error={f.errors.email} />
              <PhoneInput label="Phone" defaultCountry={f.values.country || 'IN'} {...f.bind('phone')} error={f.errors.phone} />
              <LocationFields form={f} disabled={ro} />
              <Input label="Address (printed on documents)" {...f.bind('address')} className="sm:col-span-2" />
              <Select label="Timezone" options={TIMEZONES.map((t) => ({ value: t, label: t }))} {...f.bind('timezone')} hint="Used for all dates, schedules and the dashboard." />
              <Input label="Patient number prefix" maxLength={6} {...f.bind('prefix')} hint="Applies to newly registered patients, e.g. GVH-000124." />
              <Select label="Facility type" options={FACILITY_OPTIONS} {...f.bind('facilityType')} className="sm:col-span-2"
                hint={`Arranges the menu for your kind of facility. ${profileFor(f.values.facilityType).note} (Only the menu changes — your plan and data stay the same.)`} />
              <p className="eyebrow mt-4 sm:col-span-2">GST</p>
              <Input label="Hospital GSTIN" maxLength={15} placeholder="27ABCDE1234F1Z5" {...f.bind('gstin')} hint="Printed on invoices. Leave empty if not registered." />
              <Input label="Default SAC for services" inputMode="numeric" maxLength={8} placeholder="9993" {...f.bind('sac')} hint="9993 = human health services. Medicines use their own HSN code." />

              <p className="eyebrow mt-4 sm:col-span-2">Security & messages</p>
              <Toggle f={f} name="mfa" label="2-step sign-in for owners and admins"
                hint="After the password, a 6-digit code is e-mailed to them. Recommended." />
              <Toggle f={f} name="whatsapp" label="Appointment messages to patients"
                hint="Confirmation when booked and a reminder one day before — by WhatsApp, or by e-mail when WhatsApp is not set up or the patient has no mobile number." />
              <Toggle f={f} name="summary" label="Daily summary e-mail to the owner" hint="Sent every evening after 8 pm." />
              <Toggle f={f} name="followUp" label="Follow-up reminders to patients" hint="The day before a follow-up date the doctor set — by e-mail, or WhatsApp when switched on above. Not sent if the patient already booked or came back." />
              <Toggle f={f} name="stockAlerts" label="Pharmacy alert e-mail" hint="Once a day to the owner and pharmacists: expired, expiring (30 days) and low-stock medicines. Only when there is something to report." />
              <Toggle f={f} name="autoBed" label="Charge bed days automatically (IPD)" hint="Adds one bed charge per day, at the ward’s daily rate, to every admitted patient’s bill. Never charges the same day twice." />
              <p className="eyebrow mt-4 sm:col-span-2">Payments (UPI)</p>
              <Input label="Hospital UPI ID" placeholder="cityhospital@okhdfcbank" {...f.bind('upiId')} hint="Patients pay bill payment links straight to this UPI ID. Money never passes through MediCore." />
              <Input label="Name shown in the UPI app" maxLength={50} placeholder="City Hospital" {...f.bind('upiName')} />
              <p className="eyebrow mt-4 sm:col-span-2">Online booking</p>
              <Toggle f={f} name="booking" label="Let patients request appointments online"
                hint="Adds a public booking page with your doctors and their free slots. Requests wait under Appointments → Online requests until your staff confirm them. Only doctors with a weekly schedule are listed." />
              {f.values.booking && <div className="sm:col-span-2 rounded-lg bg-forest-50 p-3 text-sm">Your booking link: <a className="font-mono text-xs text-forest-800 underline" href={`/book/${me.tenant.slug}`} target="_blank" rel="noopener noreferrer">{`${window.location.origin}/book/${me.tenant.slug}`}</a> — share it on your website, Google profile or WhatsApp.</div>}
              <Textarea label="Note shown on the booking page (optional)" maxLength={300} className="sm:col-span-2" {...f.bind('bookingNotice')} placeholder="Please arrive 10 minutes early and bring old reports." />
              {data && !data.messaging?.email && <Alert tone="warning" className="sm:col-span-2">E-mail sending is in <strong>test mode</strong> on this server — messages are written to the server log, not delivered. Ask your administrator to set up SMTP (see documentation chapter 15) before relying on 2-step sign-in.</Alert>}
            </fieldset>
            {f.formError && <Alert tone="error" className="sm:col-span-2">{f.formError}</Alert>}
            {saved && <Alert tone="success" className="sm:col-span-2">Settings saved.</Alert>}
            {!ro && <div className="sm:col-span-2"><Button type="submit" loading={f.submitting}>Save settings</Button></div>}
          </form>
        )}
      </Card>
      <HospitalLocation data={data} readOnly={ro} onSaved={reload} />
      <MessagingSettings />
    </>
  );
}

function Toggle({ f, name, label, hint }) {
  return (
    <label className="flex items-start gap-3 rounded-lg border border-line p-3 text-sm sm:col-span-2">
      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-forest-800" checked={Boolean(f.values[name])} onChange={(e) => f.setValues((v) => ({ ...v, [name]: e.target.checked }))} />
      <span><span className="font-semibold">{label}</span><span className="block text-xs text-muted">{hint}</span></span>
    </label>
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
  const [coupon, setCoupon] = useState({ code: '', applied: null, error: null, busy: false });
  const sub = data?.subscription;
  useEffect(() => { if (sub && !renew.planCode) setRenew((r) => ({ ...r, planCode: sub.PlanCode, interval: sub.BillingInterval })); }, [sub, renew.planCode]);
  const option = data?.renewalOptions?.find((o) => o.code === renew.planCode);
  // A coupon is priced for one plan + billing interval; changing either clears it.
  useEffect(() => setCoupon((c) => (c.applied ? { ...c, applied: null } : c)), [renew.planCode, renew.interval]);
  const price = coupon.applied?.amount ?? option?.[renew.interval];
  const applyCoupon = async () => {
    setCoupon((c) => ({ ...c, busy: true, error: null }));
    try {
      const r = await api.post('/subscription/coupon-preview', { ...renew, couponCode: coupon.code.trim() });
      setCoupon((c) => ({ ...c, busy: false, applied: r.data }));
    } catch (e) { setCoupon((c) => ({ ...c, busy: false, applied: null, error: e.message })); }
  };

  const verify = async (result) => {
    setPay(null);
    try {
      const r = await api.post('/subscription/verify', result);
      notify.success(`Renewed. Invoice ${r.data.invoiceNumber ?? ''} issued.`);
      setMsg({ tone: 'success', text: `Renewed. Invoice ${r.data.invoiceNumber ?? ''} issued.` });
      reload(); refresh();
    } catch (e) { setMsg({ tone: 'error', text: e.message }); }
  };
  const start = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await api.post('/subscription/renew', { ...renew, ...(coupon.applied ? { couponCode: coupon.applied.code } : {}) });
      if (r.data.free) {
        const text = `Extended free of charge until ${date(r.data.periodEnd, me.tenant.timezone)}.${r.data.invoiceNumber ? ` Invoice ${r.data.invoiceNumber} (₹0) issued.` : ''}`;
        notify.success(text); setMsg({ tone: 'success', text }); reload(); refresh();
        return;
      }
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
              <p className="text-sm capitalize text-muted">{sub.BillingInterval} {sub.IsFree && <Badge tone="gold" className="ml-1 normal-case">Free for now</Badge>}{sub.IsTrial && <Badge tone="gold" className="ml-1 normal-case">Free trial</Badge>}</p>
              {sub.IsTrial && <p className="mt-2 text-sm">Your trial ends on <strong>{date(sub.CurrentPeriodEnd, me.tenant.timezone)}</strong>. Choose a plan and pay any time — the paid period starts after the trial.</p>}
              <div className="mt-4 flex items-center gap-2"><StatusBadge status={state.state === 'active' ? 'active' : state.state} />
                <span className="text-sm text-muted">{state.free ? 'free while the offer lasts — we will e-mail you before charging starts' : state.state === 'active' ? `renews ${date(sub.CurrentPeriodEnd, me.tenant.timezone)}` : state.state === 'grace' ? `${state.daysLeft} grace day(s) left` : 'read-only'}</span></div>
              <p className="mt-4 text-sm text-muted">Users: {sub.ActiveUsers}{sub.MaxStaffUsers ? ` of ${sub.MaxStaffUsers}` : ' (unlimited)'}</p>
            </>
          ) : <EmptyState title="No subscription" />}
        </Card>
        <Card className="p-6 lg:col-span-2">
          <h2 className="font-display text-lg font-semibold text-forest-950">Renew or change plan</h2>
          {!can('subscription.manage') ? <p className="mt-2 text-sm text-muted">Only the hospital owner can renew the subscription.</p> : (
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <Select label="Plan" value={renew.planCode} onChange={(e) => setRenew((r) => ({ ...r, planCode: e.target.value }))} options={(data?.renewalOptions || []).map((o) => ({ value: o.code, label: o.isFree ? `${o.name} (free for now)` : o.name }))} />
              <Select label="Billing" value={renew.interval} onChange={(e) => setRenew((r) => ({ ...r, interval: e.target.value }))} options={[{ value: 'monthly', label: 'Monthly' }, { value: 'annual', label: 'Annual' }]} />
              <div className="flex items-end"><Button className="w-full" onClick={start} loading={busy} disabled={!option}>{option?.isFree ? 'Switch / extend free' : `Pay ${price ? money(price.total) : ''}`}</Button></div>
              {option?.isFree && <p className="text-xs text-muted sm:col-span-3">This plan is free for now — no payment needed.</p>}
              {option && !option.isFree && (
                <div className="flex flex-wrap items-end gap-2 sm:col-span-3">
                  <Input label="Coupon code" className="w-48" value={coupon.code} maxLength={30} onChange={(e) => setCoupon({ code: e.target.value.toUpperCase(), applied: null, error: null, busy: false })} error={coupon.error} />
                  <Button variant="outline" onClick={applyCoupon} loading={coupon.busy} disabled={coupon.code.trim().length < 3}>Apply</Button>
                  {coupon.applied && <Badge tone="green">{coupon.applied.code} applied — you save {money(coupon.applied.amount.discount)}</Badge>}
                </div>
              )}
              {option && !option.isFree && price && <p className="text-xs text-muted sm:col-span-3">{money(price.subtotal)}{Number(price.discount) > 0 ? ` − discount ${money(price.discount)}` : ''} + GST {money(price.tax)} = <strong>{money(price.total)}</strong>. Early renewals extend from the current end date.</p>}
            </div>
          )}
        </Card>
      </div>
      <Card className="mt-6">
        <h2 className="border-b border-line px-5 py-4 font-display text-lg font-semibold text-forest-950">Invoices</h2>
        <DataTable rowKey="InvoiceId" loading={loading} rows={data?.invoices} empty={<EmptyState icon={LuFileText} title="No invoices yet" />}
          columns={[
            { key: 'InvoiceNumber', label: 'Invoice', render: (i) => <Link to={`/app/subscription/invoices/${i.InvoiceId}`} className="font-mono text-xs font-semibold text-forest-800 hover:underline">{i.InvoiceNumber} {i.IsSandbox && <Badge tone="gold">Sandbox</Badge>} {i.Status === 'void' && <Badge tone="red">Void</Badge>}</Link> },
            { key: 'Description', label: 'Description' },
            { key: 'IssuedAt', label: 'Date', render: (i) => date(i.IssuedAt, me.tenant.timezone) },
            { key: 'Subtotal', label: 'Subtotal', render: (i) => money(i.Subtotal, i.Currency) },
            { key: 'TaxAmount', label: 'Tax', render: (i) => money(i.TaxAmount, i.Currency) },
            { key: 'Total', label: 'Total', render: (i) => <span className="font-semibold">{money(i.Total, i.Currency)}</span> },
            { key: 'dl', label: <span className="sr-only">Download</span>, render: (i) => <Link to={`/app/subscription/invoices/${i.InvoiceId}`} className="text-xs font-semibold text-forest-700 hover:underline">View / PDF</Link> },
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

// ───────────────────────── Message log ─────────────────────────
const MSG_TONE = { sent: 'green', logged: 'gold', failed: 'red', skipped: 'gray', pending: 'blue' };
export function MessageLog() {
  const { me } = useTenantAuth();
  const [channel, setChannel] = useState('');
  const { data, meta, loading, error } = useApi(() => api.get(`/message-log${channel ? `?channel=${channel}` : ''}`), [channel]);
  return (
    <>
      <PageHeader title="Message log" subtitle="Every e-mail and WhatsApp message the system sent for your hospital (last 200). Phone numbers and e-mails are partly hidden for privacy." />
      {meta && (!meta.email || !meta.whatsapp) && (
        <Alert tone="info" className="mb-4">Test mode for {[!meta.email && 'e-mail', !meta.whatsapp && 'WhatsApp'].filter(Boolean).join(' and ')}: messages are marked <strong>logged</strong> and written to the server log instead of being delivered.</Alert>
      )}
      <Card>
        <div className="border-b border-line p-4 sm:w-64">
          <Select label="Channel" placeholder="All" value={channel} onChange={(e) => setChannel(e.target.value)} options={[{ value: 'email', label: 'E-mail' }, { value: 'whatsapp', label: 'WhatsApp' }]} />
        </div>
        <DataTable loading={loading} error={error} rows={data} empty={<EmptyState title="No messages yet" />}
          columns={[
            { key: 'createdAt', label: 'When', render: (m) => <span className="whitespace-nowrap text-xs">{dateTime(m.createdAt, me.tenant.timezone)}</span> },
            { key: 'channel', label: 'Channel', render: (m) => (m.channel === 'email' ? 'E-mail' : 'WhatsApp') },
            { key: 'recipient', label: 'To', render: (m) => <span className="font-mono text-xs">{m.recipient}</span> },
            { key: 'template', label: 'Message', render: (m) => <div><p>{titleCase(m.template)}</p>{m.subject && <p className="text-xs text-muted">{m.subject}</p>}</div> },
            { key: 'status', label: 'Status', render: (m) => <div><Badge tone={MSG_TONE[m.status] || 'gray'}>{m.status}</Badge>{m.error && <p className="max-w-xs text-xs text-red-700">{m.error}</p>}</div> },
          ]} />
      </Card>
    </>
  );
}

// ───────────────────────── Messaging (sender identity + optional own account) ─────────────────────────
export function MessagingSettings() {
  const { can } = useTenantAuth();
  const { data, loading, error, reload } = useApi(() => api.get('/settings/messaging'), []);
  const [replyTo, setReplyTo] = useState('');
  const [em, setEm] = useState(null);
  const [wa, setWa] = useState(null);
  const [test, setTest] = useState({ channel: 'email', to: '' });
  const [busy, setBusy] = useState(null);
  useEffect(() => {
    if (!data) return;
    setReplyTo(data.replyTo);
    setEm({ ...data.email, password: '' });
    setWa({ ...data.whatsapp, token: '' });
  }, [data]);
  if (error) return <Alert tone="error">{error.message}</Alert>;
  if (loading || !data || !em || !wa) return <Skeleton className="h-40 w-full" />;
  const ro = !can('settings.manage');
  const run = async (key, fn, ok) => { setBusy(key); try { await fn(); if (ok) notify.success(ok); await reload(); } catch (e) { notify.error(e.message); } finally { setBusy(null); } };
  const ownReady = data.ownAccountAllowed && data.encryptionReady;
  const setE = (k) => (e) => setEm((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const setW = (k) => (e) => setWa((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  return (
    <Card className="mt-6 max-w-3xl p-6">
      <h2 className="font-display text-xl font-semibold">Messages to patients</h2>
      <p className="mt-1 text-sm text-muted">E-mails and WhatsApp messages go out in <strong>your hospital’s name</strong>. Patients’ replies come to your reply-to address.</p>
      <div className="mt-4 rounded-lg bg-ivory p-3 text-sm">
        <p><span className="text-muted">Patients see e-mails from:</span> <strong className="break-all">{data.preview.from}</strong></p>
        <p><span className="text-muted">Their replies go to:</span> <strong className="break-all">{data.preview.replyTo || '— (set below)'}</strong></p>
        <p><span className="text-muted">Sent using:</span> {data.preview.via === 'hospital' ? 'your own account' : 'the MediCore platform account'}</p>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <EmailInput label="Reply-to e-mail" className="min-w-64 flex-1" value={replyTo} disabled={ro} onChange={(e) => setReplyTo(e.target.value)} hint="Leave empty to use the hospital e-mail from the settings above." />
        {!ro && <Button variant="outline" loading={busy === 'reply'} onClick={() => run('reply', () => api.put('/settings/messaging', { replyTo: replyTo.trim() }), 'Reply-to saved.')}>Save</Button>}
      </div>

      <h3 className="mt-8 font-semibold">Use your own e-mail & WhatsApp account <Badge tone="gold" className="ml-1">Enterprise</Badge></h3>
      {!data.ownAccountAllowed && <p className="mt-1 text-sm text-muted">Optional. On the Enterprise plan you can send from your own domain (e.g. reports@yourhospital.com) and your own WhatsApp Business number. Until then, messages use the platform account in your hospital’s name.</p>}
      {data.ownAccountAllowed && !data.encryptionReady && <Alert tone="warning" className="mt-2">Ask the platform administrator to set <code>MESSAGING_ENCRYPTION_KEY</code> on the server first — it is needed to store your passwords securely.</Alert>}
      {ownReady && (
        <fieldset disabled={ro} className="mt-3 space-y-6">
          <div className="grid gap-3 rounded-lg border border-line p-4 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm font-semibold sm:col-span-2"><input type="checkbox" className="accent-forest-800" checked={em.enabled} onChange={setE('enabled')} /> Send e-mails from our own SMTP server</label>
            <Input label="SMTP server" placeholder="smtp.zoho.in" value={em.host} onChange={setE('host')} />
            <Select label="Port" value={String(em.port)} onChange={setE('port')} options={[587, 465, 2525, 25].map((p) => ({ value: String(p), label: String(p) }))} />
            <Input label="Username" value={em.user} onChange={setE('user')} autoComplete="off" />
            <Input label="Password" type="password" value={em.password} onChange={setE('password')} autoComplete="new-password" placeholder={em.hasPassword ? '•••••• saved — leave empty to keep' : ''} />
            <EmailInput label="From e-mail" placeholder="reports@yourhospital.com" value={em.fromEmail} onChange={setE('fromEmail')} />
            <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" className="accent-forest-800" checked={em.secure} onChange={setE('secure')} /> SSL (port 465)</label>
          </div>
          <div className="grid gap-3 rounded-lg border border-line p-4 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm font-semibold sm:col-span-2"><input type="checkbox" className="accent-forest-800" checked={wa.enabled} onChange={setW('enabled')} /> Send WhatsApp from our own WhatsApp Business number</label>
            <Input label="Phone number ID" inputMode="numeric" value={wa.phoneNumberId} onChange={setW('phoneNumberId')} hint="From Meta → WhatsApp → API setup" />
            <Input label="Permanent access token" type="password" value={wa.token} onChange={setW('token')} autoComplete="off" placeholder={wa.hasToken ? '•••••• saved — leave empty to keep' : ''} />
            <p className="text-xs text-muted sm:col-span-2">Your WhatsApp account needs the same four approved templates as described in the documentation (chapter 15).</p>
          </div>
          {!ro && <Button loading={busy === 'own'} onClick={() => run('own', () => api.put('/settings/messaging', {
            email: { enabled: em.enabled, host: em.host.trim(), port: Number(em.port), secure: em.secure, user: em.user.trim(), fromEmail: em.fromEmail.trim(), ...(em.password ? { password: em.password } : {}) },
            whatsapp: { enabled: wa.enabled, phoneNumberId: wa.phoneNumberId.trim(), ...(wa.token ? { token: wa.token.trim() } : {}) },
          }), 'Messaging account saved. Passwords are stored encrypted.')}>Save own account</Button>}
        </fieldset>
      )}

      {!ro && (
        <div className="mt-8 border-t border-line pt-4">
          <h3 className="font-semibold">Send a test message</h3>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <Select label="Channel" value={test.channel} onChange={(e) => setTest({ channel: e.target.value, to: '' })} options={[{ value: 'email', label: 'E-mail' }, { value: 'whatsapp', label: 'WhatsApp' }]} />
            {test.channel === 'email'
              ? <EmailInput label="Send to e-mail" className="min-w-56 flex-1" value={test.to} onChange={(e) => setTest((t) => ({ ...t, to: e.target.value }))} />
              : <PhoneInput label="Send to WhatsApp number" className="min-w-72 flex-1" value={test.to} onChange={(e) => setTest((t) => ({ ...t, to: e.target.value }))} />}
            <Button variant="outline" loading={busy === 'test'} disabled={test.to.trim().length < 5} onClick={() => run('test', async () => {
              const r = await api.post('/settings/messaging/test', { channel: test.channel, to: test.to.trim() });
              const s = r.data.status;
              if (s === 'sent') notify.success(`Test sent to ${r.data.masked}.`);
              else if (s === 'logged') notify.warning('Test mode: the message was written to the server log, not delivered.');
              else notify.error(r.data.error || 'Could not send the test message.');
            })}>Send test</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
