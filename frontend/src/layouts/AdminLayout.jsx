import { useEffect, useState } from 'react';
import { NavLink, Outlet, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { LuLayoutDashboard, LuBuilding2, LuLayers, LuCreditCard, LuCalendarCheck, LuHistory, LuSettings, LuLogOut, LuMenu, LuMessageSquare, LuRepeat } from 'react-icons/lu';
import { useAdminAuth } from '../context/AuthContext.jsx';
import { LogoMark } from '../components/Logo.jsx';
import { Spinner, cx } from '../components/ui.jsx';

const NAV = [
  ['/admin/dashboard', 'Overview', LuLayoutDashboard],
  ['/admin/tenants', 'Hospitals (tenants)', LuBuilding2],
  ['/admin/plans', 'Plans', LuLayers],
  ['/admin/subscriptions', 'Subscriptions', LuRepeat],
  ['/admin/payments', 'Payments', LuCreditCard],
  ['/admin/demo-requests', 'Demo requests', LuCalendarCheck],
  ['/admin/messages', 'Contact messages', LuMessageSquare],
  ['/admin/audit-logs', 'Audit logs', LuHistory],
  ['/admin/settings', 'Website settings', LuSettings],
];

export default function AdminLayout() {
  const { admin, loading, logout } = useAdminAuth();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  useEffect(() => setOpen(false), [pathname]);
  if (loading) return <div className="grid min-h-screen place-items-center"><Spinner className="h-8 w-8" /></div>;
  if (!admin) return <Navigate to="/admin/login" replace />;

  const side = (
    <div className="flex h-full flex-col border-r border-gold-500/20 bg-[#071a14]">
      <div className="flex h-16 items-center gap-3 border-b border-white/10 px-5">
        <LogoMark className="h-8 w-8" />
        <div><p className="text-sm font-semibold text-white">Platform Admin</p><p className="text-[11px] uppercase tracking-widest text-gold-400">{admin.role.replace('_', ' ')}</p></div>
      </div>
      <nav className="flex-1 space-y-0.5 px-3 py-4" aria-label="Admin">
        {NAV.map(([to, label, Icon]) => (
          <NavLink key={to} to={to} className={({ isActive }) => cx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium',
            isActive ? 'bg-gold-500/15 text-gold-200' : 'text-forest-100/75 hover:bg-white/5 hover:text-white')}>
            <Icon className="h-4 w-4" aria-hidden />{label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-white/10 p-3">
        <p className="truncate px-3 pb-2 text-xs text-forest-300">{admin.email}</p>
        <button onClick={async () => { await logout(); navigate('/admin/login'); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-forest-100/80 hover:bg-white/5"><LuLogOut aria-hidden /> Sign out</button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f6f7f3]">
      <aside className="fixed inset-y-0 left-0 hidden w-64 lg:block">{side}</aside>
      {open && <div className="fixed inset-0 z-40 lg:hidden"><div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} /><aside className="absolute inset-y-0 left-0 w-72">{side}</aside></div>}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-white/90 px-4 backdrop-blur lg:hidden">
          <button onClick={() => setOpen(true)} className="p-2" aria-label="Open menu"><LuMenu className="h-5 w-5" /></button>
          <p className="font-semibold">Platform Admin</p>
        </header>
        <main className="px-4 py-6 sm:px-6 lg:px-8"><Outlet /></main>
      </div>
    </div>
  );
}
