import { useEffect, useState } from 'react';
import { NavLink, Outlet, Link, useLocation } from 'react-router-dom';
import { LuMenu, LuX, LuMail, LuPhone, LuMapPin } from 'react-icons/lu';
import Logo from '../components/Logo.jsx';
import { Button, cx } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { BRAND } from '../lib/format.js';

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/features', label: 'Features' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/book-demo', label: 'Book a Demo' },
  { to: '/about', label: 'About' },
  { to: '/faq', label: 'FAQ' },
  { to: '/contact', label: 'Contact' },
];

export default function PublicLayout() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [site, setSite] = useState({});
  const { pathname } = useLocation();

  useEffect(() => { setOpen(false); window.scrollTo(0, 0); }, [pathname]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => { api.get('/site-settings').then((r) => setSite(r.data || {})).catch(() => {}); }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
      <header className={cx('sticky top-0 z-40 transition', scrolled ? 'border-b border-line bg-ivory/90 backdrop-blur' : 'bg-ivory')}>
        <div className="container-page flex h-16 items-center justify-between gap-6">
          <Logo />
          <nav className="hidden items-center gap-0.5 lg:flex" aria-label="Main">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}
                className={({ isActive }) => cx('relative whitespace-nowrap rounded-md px-2.5 py-2 text-sm font-medium transition xl:px-3',
                  isActive ? 'text-forest-900 after:absolute after:inset-x-3 after:-bottom-0.5 after:h-0.5 after:rounded after:bg-gold-500' : 'text-muted hover:text-forest-900')}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="hidden items-center gap-2 lg:flex">
            <Button variant="ghost" to="/login">Login</Button>
            <Button to="/pricing">Register</Button>
          </div>
          <button className="rounded-md p-2 text-forest-900 lg:hidden" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="mobile-nav" aria-label="Toggle menu">
            {open ? <LuX className="h-6 w-6" /> : <LuMenu className="h-6 w-6" />}
          </button>
        </div>
        {open && (
          <nav id="mobile-nav" className="border-t border-line bg-ivory lg:hidden" aria-label="Mobile">
            <div className="container-page flex flex-col gap-1 py-3">
              {NAV.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx('rounded-md px-3 py-2.5 text-sm font-medium', isActive ? 'bg-forest-50 text-forest-900' : 'text-ink')}>
                  {n.label}
                </NavLink>
              ))}
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button variant="outline" to="/login">Login</Button>
                <Button to="/pricing">Register</Button>
              </div>
              <Button variant="gold" to="/book-demo" className="mt-1">Book a demo</Button>
            </div>
          </nav>
        )}
      </header>

      <main id="main" className="flex-1"><Outlet /></main>

      <footer className="bg-forest-950 text-forest-100">
        <div className="container-page grid gap-10 py-14 md:grid-cols-12">
          <div className="md:col-span-4">
            <Logo light />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-forest-200/80">
              Cloud hospital management for clinics, nursing homes and multi-specialty hospitals across India.
            </p>
            <div className="mt-6 space-y-2 text-sm text-forest-200/90">
              {site['contact.email'] && <p className="flex items-center gap-2"><LuMail className="text-gold-400" aria-hidden />{site['contact.email']}</p>}
              {site['contact.phone'] && <p className="flex items-center gap-2"><LuPhone className="text-gold-400" aria-hidden />{site['contact.phone']}</p>}
              {site['contact.address'] && <p className="flex items-start gap-2"><LuMapPin className="mt-0.5 text-gold-400" aria-hidden />{site['contact.address']}</p>}
            </div>
          </div>
          {[
            ['Product', [['/features', 'Features'], ['/pricing', 'Pricing'], ['/book-demo', 'Book a demo'], ['/login', 'Hospital sign in']]],
            ['Company', [['/about', 'About'], ['/contact', 'Contact'], ['/faq', 'FAQ']]],
            ['Legal', [['/terms', 'Terms of Service'], ['/privacy', 'Privacy Policy'], ['/cancellation', 'Subscription & cancellation']]],
          ].map(([title, links]) => (
            <div key={title} className="md:col-span-2 lg:col-span-2">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold-400">{title}</p>
              <ul className="mt-4 space-y-2.5 text-sm">
                {links.map(([to, label]) => <li key={to}><Link to={to} className="text-forest-100/85 hover:text-white">{label}</Link></li>)}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t border-white/10">
          <div className="container-page flex flex-col justify-between gap-2 py-5 text-xs text-forest-200/70 sm:flex-row">
            <p>© {new Date().getFullYear()} {BRAND}. All rights reserved.</p>
            <p>Patient data stays isolated per hospital. Built for Indian healthcare.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
