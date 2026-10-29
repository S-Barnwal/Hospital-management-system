import { useEffect, useState } from 'react';
import { NavLink, Outlet, Navigate, useLocation, useNavigate, Link } from 'react-router-dom';
import {
  LuLayoutDashboard, LuUsers, LuCalendarClock, LuStethoscope, LuUserCog, LuBedDouble, LuReceipt, LuFlaskConical, LuPill,
  LuChartBar, LuShieldCheck, LuSettings, LuCreditCard, LuLogOut, LuMenu, LuHistory, LuBell, LuChevronRight,
} from 'react-icons/lu';
import { useTenantAuth } from '../context/AuthContext.jsx';
import { LogoMark } from '../components/Logo.jsx';
import { Alert, Spinner, cx } from '../components/ui.jsx';
import Toasts from '../components/Toasts.jsx';

export const APP_NAV = [
  { section: 'Overview' },
  { to: '/app/dashboard', label: 'Dashboard', icon: LuLayoutDashboard, perm: 'dashboard.view' },
  { section: 'Front office' },
  { to: '/app/patients', label: 'Patients', icon: LuUsers, perm: 'patients.read' },
  { to: '/app/appointments', label: 'Appointments', icon: LuCalendarClock, perm: 'appointments.read' },
  { to: '/app/staff', label: 'Doctors & staff', icon: LuUserCog, perm: 'staff.read' },
  { section: 'Clinical & finance' },
  { to: '/app/opd', label: 'OPD', icon: LuStethoscope, perm: 'opd.read', feature: 'opd' },
  { to: '/app/admissions', label: 'Admissions & beds', icon: LuBedDouble, perm: 'ipd.read', feature: 'ipd' },
  { to: '/app/billing', label: 'Billing', icon: LuReceipt, perm: 'billing.read', feature: 'billing' },
  { to: '/app/laboratory', label: 'Laboratory', icon: LuFlaskConical, perm: 'lab.read', feature: 'laboratory' },
  { to: '/app/pharmacy', label: 'Pharmacy', icon: LuPill, perm: 'pharmacy.read', feature: 'pharmacy' },
  { to: '/app/reports', label: 'Reports', icon: LuChartBar, perm: 'reports.read', feature: 'reports' },
  { section: 'Administration' },
  { to: '/app/users-roles', label: 'Users & roles', icon: LuShieldCheck, perm: 'users.read' },
  { to: '/app/audit-log', label: 'Audit log', icon: LuHistory, perm: 'audit.read' },
  { to: '/app/settings', label: 'Settings', icon: LuSettings, perm: 'settings.read' },
  { to: '/app/subscription', label: 'Subscription', icon: LuCreditCard, perm: 'subscription.read' },
];

function Sidebar({ can, hasFeature, onNavigate }) {
  const items = APP_NAV.filter((n, i, arr) => {
    if (n.section) {
      // hide a section header when the user can see nothing under it
      const next = arr.slice(i + 1);
      const end = next.findIndex((x) => x.section);
      return next.slice(0, end === -1 ? undefined : end).some((x) => can(x.perm));
    }
    return can(n.perm);
  });
  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4" aria-label="Hospital">
      {items.map((n) => n.section ? (
        <p key={n.section} className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-forest-300/70 first:pt-0">{n.section}</p>
      ) : (
        <NavLink key={n.to} to={n.to} onClick={onNavigate}
          className={({ isActive }) => cx('group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
            isActive ? 'bg-white/10 text-white shadow-[inset_3px_0_0_var(--color-gold-500)]' : 'text-forest-100/80 hover:bg-white/5 hover:text-white')}>
          <n.icon className="h-4 w-4 shrink-0" aria-hidden />
          <span className="flex-1">{n.label}</span>
          {n.feature && !hasFeature(n.feature) && <span className="rounded bg-gold-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-gold-400">Upgrade</span>}
        </NavLink>
      ))}
    </nav>
  );
}

export default function AppLayout() {
  const { me, loading, logout, can, hasFeature } = useTenantAuth();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  useEffect(() => setOpen(false), [pathname]);

  if (loading) return <div className="grid min-h-screen place-items-center"><Spinner className="h-8 w-8" /></div>;
  if (!me) return <Navigate to="/login" replace state={{ from: pathname }} />;

  const current = APP_NAV.find((n) => n.to && pathname.startsWith(n.to));
  const sub = me.subscription;
  const initials = me.user.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();

  const sidebar = (
    <div className="flex h-full flex-col bg-forest-950">
      <div className="flex h-16 items-center gap-3 border-b border-white/10 px-5">
        <LogoMark className="h-8 w-8" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{me.tenant.name}</p>
          <p className="truncate text-[11px] text-forest-300">{me.tenant.slug}</p>
        </div>
      </div>
      <Sidebar can={can} hasFeature={hasFeature} onNavigate={() => setOpen(false)} />
      <div className="border-t border-white/10 p-3">
        <button onClick={async () => { await logout(); navigate('/login'); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-forest-100/80 hover:bg-white/5 hover:text-white">
          <LuLogOut className="h-4 w-4" aria-hidden /> Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f6f7f3] print:bg-white">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block print:hidden">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-forest-950/50" onClick={() => setOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 w-72">{sidebar}</aside>
        </div>
      )}
      <div className="lg:pl-64 print:pl-0">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-white/90 px-4 backdrop-blur sm:px-6 print:hidden">
          <button className="rounded-md p-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><LuMenu className="h-5 w-5" /></button>
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm text-muted">
            <Link to="/app/dashboard" className="hover:text-ink">{me.tenant.name}</Link>
            {current && <><LuChevronRight aria-hidden /><span className="truncate font-medium text-ink">{current.label}</span></>}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="relative grid h-9 w-9 place-items-center rounded-full text-muted" title={`${me.unreadNotifications} unread notifications`}>
              <LuBell className="h-5 w-5" aria-hidden />
              {me.unreadNotifications > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-gold-500" />}
              <span className="sr-only">{me.unreadNotifications} unread notifications</span>
            </span>
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-forest-900 text-xs font-bold text-gold-400">{initials}</span>
              <div className="hidden text-right sm:block">
                <p className="text-sm font-semibold leading-tight text-ink">{me.user.name}</p>
                <p className="text-[11px] capitalize text-muted">{me.user.roles.join(', ').replace(/_/g, ' ')}</p>
              </div>
            </div>
          </div>
        </header>
        <Toasts />
        <main className="px-4 py-6 sm:px-6 lg:px-8">
          {sub?.state === 'grace' && <Alert tone="warning" className="mb-5">Your subscription period has ended — {sub.daysLeft} day(s) of grace left. <Link className="font-semibold underline" to="/app/subscription">Renew now</Link></Alert>}
          {sub?.state === 'expired' && <Alert tone="error" className="mb-5">Subscription expired. Your data is safe but read-only. <Link className="font-semibold underline" to="/app/subscription">Renew to continue</Link></Alert>}
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** Guard for a single page: shows a friendly message instead of a broken page if the role lacks access. */
export function RequirePerm({ perm, feature, children }) {
  const { can, hasFeature } = useTenantAuth();
  if (feature && !hasFeature(feature)) {
    return (
      <Alert tone="warning" title="Not included in your plan">
        This module is not part of your current subscription. <Link to="/app/subscription" className="font-semibold underline">Upgrade your plan</Link> to use it.
      </Alert>
    );
  }
  if (!can(perm)) return <Alert tone="warning" title="No access">Your role does not include access to this page. Ask your hospital administrator.</Alert>;
  return children;
}

