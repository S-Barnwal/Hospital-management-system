// Phase 4 account pages: support tickets with the software provider, branches of a hospital group, sign-in history.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LuPlus, LuArrowLeft, LuSend, LuLifeBuoy, LuBuilding2, LuExternalLink, LuLock } from 'react-icons/lu';
import { api, qs } from '../../lib/api.js';
import { useApi } from '../../lib/hooks.js';
import { useTenantAuth } from '../../context/AuthContext.jsx';
import { notify, withToast } from '../../lib/toast.js';
import { dateTime, money, relative, titleCase } from '../../lib/format.js';
import { Alert, Badge, Button, Card, DataTable, EmptyState, Input, Modal, PageHeader, Select, Skeleton, StatCard, Textarea, cx } from '../../components/ui.jsx';

const TONE = { open: 'gold', awaiting_support: 'gold', awaiting_hospital: 'blue', resolved: 'green', closed: 'gray' };
const LABEL = { open: 'open', awaiting_support: 'with support', awaiting_hospital: 'reply needed', resolved: 'resolved', closed: 'closed' };
const TicketBadge = ({ status }) => <Badge tone={TONE[status] || 'gray'}>{LABEL[status] || status}</Badge>;
const PRIVACY = 'Please do not write patient names, phone numbers or medical details in a ticket. Describe the screen and steps instead (e.g. “Billing → bill INV2026-000045 → Finalise shows an error”).';

export function Support() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const { data, loading, error, reload } = useApi(() => api.get(`/support/tickets${qs({ status })}`), [status]);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const create = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.post('/support/tickets', { subject: form.subject.trim(), category: form.category, priority: form.priority, message: form.message.trim() });
      notify.success(`Ticket ${r.data.number} created. Our team will reply here and by e-mail.`);
      navigate(`/app/support/${r.data.id}`);
    } catch (e) { setErr(e.details?.length ? e.details.map((d) => d.message).join(' · ') : e.message); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader title="Help & support" subtitle="Ask the MediCore team about billing, problems or new features. Works even if your plan has lapsed."
        actions={<Button onClick={() => { setErr(null); setForm({ subject: '', category: 'technical', priority: 'normal', message: '' }); }}><LuPlus aria-hidden /> New ticket</Button>} />
      <Card>
        <div className="border-b border-line p-4"><select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All tickets</option>{Object.entries(LABEL).map(([k, l]) => <option key={k} value={k}>{titleCase(l)}</option>)}</select></div>
        <DataTable loading={loading} error={error} rows={data} onRowClick={(k) => navigate(`/app/support/${k.id}`)}
          empty={<EmptyState icon={LuLifeBuoy} title="No tickets yet">Raise one whenever you need help.</EmptyState>} columns={[
            { key: 'number', label: 'Ticket', render: (k) => <span className="font-mono text-xs font-semibold">{k.number}</span> },
            { key: 'subject', label: 'Subject', render: (k) => <div><p className="font-medium">{k.subject}</p><p className="text-xs text-muted">{titleCase(k.category)} · {k.createdBy || ''}</p></div> },
            { key: 'status', label: 'Status', render: (k) => <TicketBadge status={k.status} /> },
            { key: 'updatedAt', label: 'Updated', render: (k) => <span title={dateTime(k.updatedAt)}>{relative(k.updatedAt)}</span> }]} />
      </Card>
      {form && (
        <Modal open onClose={() => setForm(null)} title="New support ticket" size="lg"
          footer={<><Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button><Button onClick={create} loading={busy} disabled={form.subject.trim().length < 4 || form.message.trim().length < 2}><LuSend aria-hidden /> Send</Button></>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Subject" className="sm:col-span-2" maxLength={200} value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} />
            <Select label="Category" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              options={[['technical', 'Something is not working'], ['billing', 'Plan, payment or invoice'], ['account', 'Users, sign-in or access'], ['feature', 'Feature request'], ['other', 'Other']].map(([value, label]) => ({ value, label }))} />
            <Select label="Priority" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
              options={[['low', 'Low'], ['normal', 'Normal'], ['high', 'High — work is slowed'], ['urgent', 'Urgent — work has stopped']].map(([value, label]) => ({ value, label }))} />
            <Textarea label="Describe the problem" className="sm:col-span-2" rows={6} maxLength={4000} value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} />
            <Alert tone="warning" className="sm:col-span-2">{PRIVACY}</Alert>
            {err && <Alert tone="error" className="sm:col-span-2">{err}</Alert>}
          </div>
        </Modal>
      )}
    </>
  );
}

export function SupportTicket() {
  const { id } = useParams();
  const { data: k, loading, error, reload } = useApi(() => api.get(`/support/tickets/${id}`), [id]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  if (error) return <Alert tone="error">{error.message}</Alert>;
  if (loading || !k) return <Skeleton className="h-64 w-full" />;
  const send = async () => {
    setBusy(true);
    if (await withToast(() => api.post(`/support/tickets/${id}/messages`, { body: body.trim() }), 'Message sent.')) { setBody(''); reload(); }
    setBusy(false);
  };
  return (
    <>
      <Link to="/app/support" className="mb-4 flex items-center gap-1 text-sm font-medium text-forest-700"><LuArrowLeft aria-hidden /> All tickets</Link>
      <PageHeader eyebrow={k.number} title={k.subject} subtitle={`${titleCase(k.category)} · ${titleCase(k.priority)} priority · opened ${dateTime(k.createdAt)}`}
        actions={<div className="flex items-center gap-2"><TicketBadge status={k.status} />{k.status !== 'closed' && <Button variant="outline" size="sm" onClick={async () => { if (await withToast(() => api.post(`/support/tickets/${id}/close`), 'Ticket closed.')) reload(); }}>Close ticket</Button>}</div>} />
      <div className="mx-auto max-w-3xl space-y-3">
        {k.messages.map((m) => (
          <div key={m.id} className={cx('flex', m.authorType === 'support' ? 'justify-start' : 'justify-end')}>
            <Card className={cx('max-w-[90%] p-4', m.authorType === 'support' ? 'bg-forest-50/60' : 'bg-white')}>
              <p className="mb-1 text-xs text-muted"><span className="font-semibold text-ink">{m.authorName}</span> · {dateTime(m.createdAt)}</p>
              <p className="whitespace-pre-wrap break-words text-sm">{m.body}</p>
            </Card>
          </div>
        ))}
        {k.status === 'closed' ? <Alert tone="info">This ticket is closed. Open a new ticket if you still need help.</Alert> : (
          <Card className="p-4">
            <Textarea label="Your reply" rows={4} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} hint={PRIVACY} />
            <div className="mt-3 flex justify-end"><Button onClick={send} loading={busy} disabled={body.trim().length < 2}><LuSend aria-hidden /> Send</Button></div>
          </Card>
        )}
      </div>
    </>
  );
}

export function Branches() {
  const { me } = useTenantAuth();
  const { data, loading, error } = useApi(() => api.get('/branches'), []);
  if (error) return <Alert tone="error">{error.message}</Alert>;
  if (loading || !data) return <Skeleton className="h-64 w-full" />;
  if (!data.group) {
    return (
      <>
        <PageHeader title="Branches" />
        <EmptyState icon={LuBuilding2} title="This hospital is not part of a group">If your organisation runs several hospitals or clinics on MediCore, ask support to link them. Each branch keeps its own data and users. <Link className="underline" to="/app/support">Contact support</Link></EmptyState>
      </>
    );
  }
  const t = data.totals;
  return (
    <>
      <PageHeader eyebrow={data.group.name} title="Branches" subtitle={`Headline figures for the ${t.branchesCounted} branch(es) where you have an account. Each branch is a separate workspace.`} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Appointments today" value={t.appointmentsToday} />
        <StatCard label="New patients today" value={t.newPatientsToday} />
        <StatCard label="In-patients now" value={t.inpatients} />
        <StatCard label="Collected this month" value={money(t.collectedThisMonth)} hint={`${money(t.collectedToday)} today`} />
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.branches.map((b) => (
          <Card key={b.tenantId} className={cx('p-5', b.isCurrent && 'ring-2 ring-gold-400')}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><h2 className="truncate font-display text-lg font-semibold">{b.branchName || b.name}</h2><p className="truncate text-xs text-muted">{b.branchName ? `${b.name} · ` : ''}{b.city || ''}</p></div>
              {b.isCurrent ? <Badge tone="gold">this branch</Badge> : b.status !== 'active' ? <Badge tone="gray">{b.status}</Badge> : null}
            </div>
            {b.figures ? (
              <dl className="mt-4 grid grid-cols-2 gap-y-1 text-sm">
                <dt className="text-muted">Appointments today</dt><dd className="text-right font-semibold">{b.figures.appointmentsToday}</dd>
                <dt className="text-muted">Waiting now</dt><dd className="text-right font-semibold">{b.figures.waitingNow}</dd>
                <dt className="text-muted">New patients</dt><dd className="text-right font-semibold">{b.figures.newPatientsToday}</dd>
                <dt className="text-muted">In-patients</dt><dd className="text-right font-semibold">{b.figures.inpatients}</dd>
                <dt className="text-muted">Collected today</dt><dd className="text-right font-semibold">{money(b.figures.collectedToday)}</dd>
              </dl>
            ) : <p className="mt-4 flex items-center gap-2 text-sm text-muted"><LuLock aria-hidden /> {b.accessible ? 'Not active' : 'You have no account in this branch.'}</p>}
            {!b.isCurrent && b.accessible && b.status === 'active' && (
              <a className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-forest-700 underline" href={`/login?workspace=${encodeURIComponent(b.slug)}&email=${encodeURIComponent(me.user.email)}`}>
                Sign in to this branch <LuExternalLink aria-hidden /></a>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}

/** Sign-in history tab of Users & roles. */
export function LoginHistory() {
  const [result, setResult] = useState('');
  const { data, loading, error } = useApi(() => api.get(`/users/login-history${qs({ result })}`), [result]);
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
        <p className="text-sm text-muted">Every sign-in to this hospital's accounts in the last 180 days. Repeated failures lock the account for 15 minutes.</p>
        <select className="input w-auto" value={result} onChange={(e) => setResult(e.target.value)} aria-label="Result"><option value="">All</option><option value="ok">Successful</option><option value="failed">Failed</option></select>
      </div>
      <DataTable loading={loading} error={error} rows={data} empty={<EmptyState title="No sign-ins recorded yet" />} columns={[
        { key: 'createdAt', label: 'When', render: (e) => dateTime(e.createdAt) },
        { key: 'name', label: 'User', render: (e) => <div><p>{e.name || '—'}</p><p className="text-xs text-muted">{e.email}</p></div> },
        { key: 'success', label: 'Result', render: (e) => (e.success ? <Badge tone="green">signed in</Badge> : <Badge tone="red">{titleCase(e.reason)}</Badge>) },
        { key: 'device', label: 'Device' }, { key: 'ip', label: 'IP address', render: (e) => <span className="font-mono text-xs">{e.ip}</span> }]} />
    </Card>
  );
}
