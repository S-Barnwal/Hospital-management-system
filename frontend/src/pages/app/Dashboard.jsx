import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { LuUsers, LuCalendarClock, LuStethoscope, LuUserCog, LuBedDouble, LuReceipt, LuArrowRight, LuPlus, LuIndianRupee, LuPill, LuFlaskConical } from 'react-icons/lu';
import { notify } from '../../lib/toast.js';
import { api } from '../../lib/api.js';
import { useApi } from '../../lib/hooks.js';
import { profileFor } from '../../lib/facility.js';
import { useTenantAuth } from '../../context/AuthContext.jsx';
import { Alert, Button, Card, EmptyState, PageHeader, Skeleton, StatCard, StatusBadge } from '../../components/ui.jsx';
import BarChart from '../../components/BarChart.jsx';
import { dateTime, fullName, money, relative, titleCase } from '../../lib/format.js';

const fmt = (n) => (n === null || n === undefined ? '—' : new Intl.NumberFormat('en-IN').format(n));

export default function Dashboard() {
  const { me, can } = useTenantAuth();
  const hidden = profileFor(me.tenant.facilityType).hide;
  const showOpd = !hidden.includes('/app/opd');
  const showBeds = !hidden.includes('/app/admissions');
  const { data, loading, error } = useApi(() => api.get('/dashboard/summary'), []);
  const w = data?.widgets;
  const tz = me.tenant.timezone;
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: tz }).format(new Date()));
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  // Surface important alerts once per browser session as toasts.
  useEffect(() => {
    if (!data?.alerts?.length) return;
    let seen = '';
    try { seen = sessionStorage.getItem('hms_alerts_seen') || ''; } catch { /* storage unavailable */ }
    const key = data.alerts.map((a) => a.message).join('|');
    if (seen === key) return;
    data.alerts.forEach((a) => (a.level === 'danger' ? notify.error(a.message) : a.level === 'warning' ? notify.warning(a.message) : notify.info(a.message)));
    try { sessionStorage.setItem('hms_alerts_seen', key); } catch { /* ignore */ }
  }, [data]);

  return (
    <>
      <PageHeader eyebrow={new Intl.DateTimeFormat('en-IN', { dateStyle: 'full', timeZone: tz }).format(new Date())}
        title={`${greeting}, ${me.user.name.split(' ')[0]}`}
        subtitle={`Here’s what’s happening at ${me.tenant.name} today.`}
        actions={<>
          {can('patients.write') && <Button variant="outline" to="/app/patients?new=1"><LuPlus aria-hidden /> Register patient</Button>}
          {can('appointments.write') && <Button to="/app/appointments?new=1"><LuPlus aria-hidden /> Book appointment</Button>}
        </>} />

      {error && <Alert tone="error" className="mb-6">{error.message}</Alert>}
      {data?.alerts?.map((a) => <Alert key={a.message} tone={a.level === 'danger' ? 'error' : a.level} className="mb-4">{a.message}</Alert>)}
      {!me.tenant.hasLocation && can('settings.manage') && (
        <Alert tone="info" className="mb-4" title="Add your hospital’s location">
          Put a pin on the map so patients get correct directions and our team knows where you are. <Link to="/app/settings#location" className="font-semibold underline">Add location</Link>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Registered patients" icon={LuUsers} loading={loading} value={fmt(w?.totalPatients)} unavailable={w && w.totalPatients === null}
          hint={w?.newPatientsThisMonth != null ? `${fmt(w.newPatientsThisMonth)} new this month` : undefined} />
        <StatCard label="Today’s appointments" icon={LuCalendarClock} loading={loading} value={fmt(w?.todaysAppointments?.total)} unavailable={w && !w.todaysAppointments}
          hint={w?.todaysAppointments ? `${fmt(w.todaysAppointments.byStatus.checked_in ?? 0)} checked in · ${fmt(w.todaysAppointments.byStatus.completed ?? 0)} completed` : undefined} />
        {showOpd && <StatCard label="OPD visits completed today" icon={LuStethoscope} loading={loading} value={fmt(w?.opdVisitsToday)} unavailable={w && w.opdVisitsToday === null} />}
        <StatCard label="Doctors / other staff" icon={LuUserCog} loading={loading} value={w && w.doctors !== null ? `${fmt(w.doctors)} / ${fmt(w.staff)}` : '—'} unavailable={w && w.doctors === null} />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {showBeds && w?.beds && <StatCard label="Occupied beds" icon={LuBedDouble} value={`${fmt(w.beds.occupied)} / ${fmt(w.beds.total)}`} hint={w.beds.total ? `${Math.round((w.beds.occupied / w.beds.total) * 100)}% occupancy` : 'No beds set up yet'} />}
        {w?.collections && <StatCard label="Collected today" icon={LuIndianRupee} value={money(w.collections.today)} hint={`${money(w.collections.month)} this month (net of refunds)`} />}
        {w?.pendingPayments && <StatCard label="Pending payments" icon={LuReceipt} value={money(w.pendingPayments.amount)} hint={`${fmt(w.pendingPayments.bills)} unpaid bill(s)`} />}
        {w && w.lowStock !== null && w.lowStock !== undefined && <StatCard label="Low-stock medicines" icon={LuPill} value={fmt(w.lowStock)} hint="At or below reorder level" />}
        {w?.pendingLab && <StatCard label="Lab orders pending" icon={LuFlaskConical} value={fmt(w.pendingLab.orders)} hint={`${fmt(w.pendingLab.samples)} sample(s) to collect · not yet verified`} />}
        {w && w.expensesThisMonth !== null && w.expensesThisMonth !== undefined && <StatCard label="Expenses this month" icon={LuReceipt} value={money(w.expensesThisMonth)} hint="Recorded under Expenses" />}
        {showOpd && w && w.consultationsToday !== null && w.consultationsToday !== undefined && <StatCard label="Consultations finalised today" icon={LuStethoscope} value={fmt(w.consultationsToday)} />}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="min-w-0 p-5 xl:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold text-forest-950">Appointments · last 14 days</h2>
            <span className="text-xs text-muted">Excludes cancelled</span>
          </div>
          <div className="mt-4">
            {loading ? <Skeleton className="h-44 w-full" /> : data?.appointmentTrend?.length
              ? <BarChart data={data.appointmentTrend} valueKey="appointments" label="Appointments per day, last 14 days" />
              : <EmptyState title="No data yet">Appointments you book will appear here.</EmptyState>}
          </div>
        </Card>

        <Card className="min-w-0 p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold text-forest-950">Upcoming</h2>
            {can('appointments.read') && <Link to="/app/appointments" className="flex items-center gap-1 text-xs font-semibold text-forest-700">All <LuArrowRight aria-hidden /></Link>}
          </div>
          <ul className="mt-3 divide-y divide-line">
            {loading && [0, 1, 2].map((i) => <li key={i} className="py-3"><Skeleton className="h-4 w-3/4" /><Skeleton className="mt-2 h-3 w-1/2" /></li>)}
            {!loading && !data?.upcomingAppointments?.length && <li><EmptyState title="Nothing scheduled">Upcoming appointments will be listed here.</EmptyState></li>}
            {data?.upcomingAppointments?.map((a) => (
              <li key={a.AppointmentId} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{fullName(a.FirstName, a.LastName)}</p>
                  <p className="truncate text-xs text-muted">{dateTime(a.StartAt, tz)} · {a.DoctorName}</p>
                </div>
                <StatusBadge status={a.Status} />
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="mt-6 p-5">
        <h2 className="font-display text-lg font-semibold text-forest-950">Recent activity</h2>
        <ul className="mt-3 divide-y divide-line">
          {loading && <li className="py-3"><Skeleton className="h-4 w-1/2" /></li>}
          {!loading && !data?.recentActivity?.length && <li className="py-4 text-sm text-muted">No activity yet.</li>}
          {data?.recentActivity?.map((a, i) => (
            <li key={i} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span><span className="font-medium text-ink">{a.ActorName || 'System'}</span> <span className="text-muted">{titleCase(a.Action.replace('.', ' · '))}</span></span>
              <span className="shrink-0 text-xs text-muted">{relative(a.CreatedAt)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
