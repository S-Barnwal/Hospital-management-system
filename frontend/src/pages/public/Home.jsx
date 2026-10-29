import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import {
  LuArrowRight, LuCheck, LuShieldCheck, LuCreditCard, LuBuilding2, LuLock, LuDatabase, LuHospital, LuLayoutDashboard,
  LuUsers, LuCalendarClock, LuReceipt, LuActivity,
} from 'react-icons/lu';
import { Button, Badge } from '../../components/ui.jsx';
import Reveal from '../../components/Reveal.jsx';
import { MODULES, FACILITIES, FAQS } from './content.js';
import { DemoForm, DemoPoints } from './Forms.jsx';

function HeroPreview() {
  const reduce = useReducedMotion();
  const bars = [38, 52, 44, 61, 58, 70, 66, 82, 74, 88, 79, 92];
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 24, rotate: -0.6 }}
      animate={{ opacity: 1, y: 0, rotate: 0 }}
      transition={{ duration: 0.8, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
      className="relative"
    >
      <div className="absolute -inset-4 -z-10 rounded-[2rem] bg-gradient-to-br from-gold-100 via-forest-50 to-transparent blur-2xl" aria-hidden />
      <div className="overflow-hidden rounded-2xl border border-forest-900/10 bg-white shadow-[var(--shadow-lift)]">
        <div className="flex items-center justify-between border-b border-line bg-forest-950 px-4 py-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-white"><LuHospital className="text-gold-400" aria-hidden /> Green Valley Hospital</div>
          <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-medium text-forest-100">green-valley.app.example.com</span>
        </div>
        <div className="grid grid-cols-[110px_1fr] sm:grid-cols-[140px_1fr]">
          <div className="space-y-1 border-r border-line bg-forest-50/60 p-3 text-[11px] font-medium text-forest-900">
            {[[LuLayoutDashboard, 'Dashboard'], [LuUsers, 'Patients'], [LuCalendarClock, 'Appointments'], [LuReceipt, 'Billing'], [LuActivity, 'Reports']].map(([I, l], i) => (
              <div key={l} className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 ${i === 0 ? 'bg-white text-forest-950 shadow-sm ring-1 ring-gold-200' : 'text-forest-800/80'}`}><I aria-hidden />{l}</div>
            ))}
          </div>
          <div className="p-4">
            <div className="grid grid-cols-3 gap-2">
              {[['Patients', '1,245'], ['Today', '48'], ['Doctors', '18']].map(([k, v]) => (
                <div key={k} className="rounded-lg border border-line p-2.5">
                  <p className="text-[10px] text-muted">{k}</p>
                  <p className="font-display text-lg font-semibold text-forest-950">{v}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-lg border border-line p-3">
              <p className="text-[10px] font-semibold text-muted">Appointments · last 12 days</p>
              <div className="mt-2 flex h-20 items-end gap-1">
                {bars.map((h, i) => (
                  <motion.div key={i} className={`flex-1 rounded-sm ${i === bars.length - 1 ? 'bg-gold-500' : 'bg-forest-600'}`}
                    initial={reduce ? false : { height: 0 }} animate={{ height: `${h}%` }} transition={{ delay: 0.5 + i * 0.04, duration: 0.5 }} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      <p className="mt-3 text-center text-xs text-muted">Illustrative preview with sample figures</p>
    </motion.div>
  );
}

const STEPS = [
  { icon: LuLayoutDashboard, title: 'Choose a plan', text: 'Compare Starter, Professional and Enterprise. Monthly or annual, tax shown upfront.' },
  { icon: LuCreditCard, title: 'Pay securely', text: 'UPI, cards or net banking via Razorpay. Payment is verified on our server before anything is activated.' },
  { icon: LuBuilding2, title: 'Your hospital workspace', text: 'We create your organisation, owner account, roles and subscription — and sign you straight in.' },
];

export default function Home() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="grain absolute inset-0 -z-10" aria-hidden />
        <div className="container-page grid items-center gap-12 pb-20 pt-12 lg:grid-cols-2 lg:pt-20">
          <div>
            <Reveal>
              <span className="inline-flex items-center gap-2 rounded-full border border-gold-200 bg-gold-50 px-3 py-1 text-xs font-semibold text-gold-700">
                <span className="h-1.5 w-1.5 rounded-full bg-gold-500" /> Hospital management, in the cloud
              </span>
            </Reveal>
            <Reveal delay={0.05}>
              <h1 className="mt-5 font-display text-4xl font-semibold leading-[1.08] tracking-tight text-forest-950 sm:text-5xl lg:text-6xl">
                Run your hospital <em className="not-italic text-forest-600">calmly</em>,<br className="hidden sm:block" /> from front desk to <span className="relative whitespace-nowrap">discharge<svg className="absolute -bottom-2 left-0 w-full" viewBox="0 0 200 8" preserveAspectRatio="none" aria-hidden><path d="M2 6 C 60 1, 140 1, 198 5" stroke="#C8A24A" strokeWidth="3" fill="none" strokeLinecap="round" /></svg></span>.
              </h1>
            </Reveal>
            <Reveal delay={0.1}>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
                Patients, appointments, doctors and staff in one secure workspace for your hospital — with its own login, its own data and role-based access for every team member.
              </p>
            </Reveal>
            <Reveal delay={0.15}>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button size="lg" to="/pricing">Get started <LuArrowRight aria-hidden /></Button>
                <Button size="lg" variant="outline" to="/pricing">View plans</Button>
                <Button size="lg" variant="ghost" to="/book-demo">Book a demo</Button>
              </div>
            </Reveal>
            <Reveal delay={0.2}>
              <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-forest-900">
                {['Data isolated per hospital', 'Role-based access', 'UPI & card payments'].map((t) => (
                  <li key={t} className="flex items-center gap-2"><LuCheck className="text-gold-600" aria-hidden />{t}</li>
                ))}
              </ul>
            </Reveal>
          </div>
          <HeroPreview />
        </div>
      </section>

      {/* Facts — product capabilities, not marketing numbers */}
      <section className="bg-forest-900">
        <div className="container-page grid grid-cols-2 gap-px overflow-hidden py-0 md:grid-cols-4">
          {[['1 hospital = 1 workspace', 'Separate data, users & settings'], ['9 ready-made roles', 'Owner to pharmacist'],
            ['24 × 7 cloud access', 'Desktop, tablet & mobile'], ['UPI · Cards · Net banking', 'Payments via Razorpay']].map(([k, v]) => (
            <div key={k} className="px-2 py-6 text-center sm:px-4">
              <p className="font-display text-lg font-semibold text-gold-400 sm:text-xl">{k}</p>
              <p className="mt-1 text-xs text-forest-100/75 sm:text-sm">{v}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Facility strip */}
      <section className="border-y border-line bg-white">
        <div className="container-page flex flex-col items-center gap-4 py-6 md:flex-row md:justify-between">
          <p className="eyebrow">Built for</p>
          <ul className="flex flex-wrap justify-center gap-x-8 gap-y-2 text-sm font-medium text-forest-900">
            {FACILITIES.map((f) => <li key={f}>{f}</li>)}
          </ul>
        </div>
      </section>

      {/* How it works — the SaaS workflow */}
      <section className="container-page py-20">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="eyebrow">How it works</p>
          <h2 className="mt-3 font-display text-3xl font-semibold text-forest-950 sm:text-4xl">From pricing page to your own hospital dashboard in minutes</h2>
        </Reveal>
        <ol className="mt-12 grid gap-6 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal key={s.title} delay={i * 0.08} as="li" className="card relative p-6">
              <span className="absolute right-5 top-4 font-display text-5xl font-semibold text-gold-100">{i + 1}</span>
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-forest-900 text-gold-400"><s.icon className="h-5 w-5" aria-hidden /></span>
              <h3 className="mt-5 font-display text-xl font-semibold text-forest-950">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.text}</p>
            </Reveal>
          ))}
        </ol>
      </section>

      {/* Tenant isolation */}
      <section className="bg-forest-950 py-20 text-white">
        <div className="container-page grid items-center gap-12 lg:grid-cols-2">
          <Reveal>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold-400">Multi-hospital, one platform</p>
            <h2 className="mt-3 font-display text-3xl font-semibold sm:text-4xl">Shared infrastructure. Strictly separate hospitals.</h2>
            <p className="mt-4 max-w-lg leading-relaxed text-forest-100/80">
              Every hospital gets its own workspace, users and records. Access is decided on the server from the signed-in session — never from anything the browser sends — and the database refuses any link between two hospitals’ records.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-forest-100">
              {[[LuLock, 'Server-side tenant checks on every request'], [LuDatabase, 'Composite keys block cross-hospital records in SQL Server'], [LuShieldCheck, 'Audit trail of sensitive actions']].map(([I, t]) => (
                <li key={t} className="flex items-center gap-3"><I className="h-4 w-4 text-gold-400" aria-hidden />{t}</li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
              <div className="grid gap-4 sm:grid-cols-2">
                {[['Hospital A', 'Tenant A', 'Patients, doctors, bills, staff'], ['Hospital B', 'Tenant B', 'Independent records and users']].map(([h, t, d]) => (
                  <div key={h} className="rounded-xl border border-gold-500/30 bg-forest-900 p-5">
                    <div className="flex items-center justify-between"><p className="font-display text-lg font-semibold">{h}</p><span className="rounded-full bg-gold-500/15 px-2 py-0.5 text-[11px] font-semibold text-gold-400">{t}</span></div>
                    <p className="mt-2 text-sm text-forest-100/75">{d}</p>
                  </div>
                ))}
              </div>
              <div className="mx-auto my-3 h-6 w-px bg-gold-500/50" aria-hidden />
              <div className="rounded-xl border border-white/10 bg-forest-800/60 p-4 text-center text-sm text-forest-100">
                Shared application &amp; database infrastructure · <span className="font-semibold text-gold-400">tenant-level access enforced</span>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Modules */}
      <section className="container-page py-20">
        <Reveal className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <p className="eyebrow">Modules</p>
            <h2 className="mt-3 font-display text-3xl font-semibold text-forest-950 sm:text-4xl">Everything a hospital runs on</h2>
          </div>
          <Link to="/features" className="inline-flex items-center gap-1 text-sm font-semibold text-forest-700 hover:text-forest-900">All features <LuArrowRight aria-hidden /></Link>
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.slice(0, 9).map((m, i) => (
            <Reveal key={m.key} delay={(i % 3) * 0.06} className="card group p-6 transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]">
              <div className="flex items-center justify-between">
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-forest-50 text-forest-700 transition group-hover:bg-forest-900 group-hover:text-gold-400"><m.icon className="h-5 w-5" aria-hidden /></span>
                {m.status === 'soon' ? <Badge tone="gold">Coming soon</Badge> : <Badge tone="green">Available</Badge>}
              </div>
              <h3 className="mt-4 font-semibold text-forest-950">{m.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{m.text}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Book a demo */}
      <section id="book-demo" className="relative overflow-hidden border-t border-line bg-forest-50/60 py-20">
        <div className="container-page grid gap-10 lg:grid-cols-5">
          <Reveal className="lg:col-span-2">
            <p className="eyebrow">Book a demo</p>
            <h2 className="mt-3 font-display text-3xl font-semibold text-forest-950 sm:text-4xl">See it running for your hospital</h2>
            <p className="mt-3 text-muted">Share a few details and our team will schedule a 30-minute walkthrough at a time that suits you.</p>
            <div className="mt-8"><DemoPoints /></div>
          </Reveal>
          <Reveal delay={0.08} className="lg:col-span-3"><DemoForm /></Reveal>
        </div>
      </section>

      {/* FAQ teaser */}
      <section className="border-t border-line bg-white py-20">
        <div className="container-page grid gap-10 lg:grid-cols-3">
          <Reveal>
            <p className="eyebrow">Questions</p>
            <h2 className="mt-3 font-display text-3xl font-semibold text-forest-950">Answers before you buy</h2>
            <Link to="/faq" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-forest-700 hover:text-forest-900">Read all FAQs <LuArrowRight aria-hidden /></Link>
          </Reveal>
          <div className="space-y-3 lg:col-span-2">
            {FAQS.slice(0, 4).map(([q, a]) => (
              <details key={q} className="group rounded-xl border border-line bg-ivory p-5 open:bg-white">
                <summary className="flex cursor-pointer list-none items-center justify-between font-semibold text-forest-950">
                  {q}<span className="ml-4 text-gold-600 transition group-open:rotate-45" aria-hidden>+</span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-muted">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="container-page py-20">
        <Reveal className="relative overflow-hidden rounded-3xl bg-forest-900 px-6 py-14 text-center sm:px-12">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-transparent via-gold-500 to-transparent" aria-hidden />
          <h2 className="font-display text-3xl font-semibold text-white sm:text-4xl">Ready to digitise your hospital?</h2>
          <p className="mx-auto mt-3 max-w-xl text-forest-100/80">Start with the plan that fits today and upgrade as you grow. Or let us show you around first.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button size="lg" variant="gold" to="/pricing">See pricing</Button>
            <Button size="lg" variant="light" to="/book-demo">Book a demo</Button>
          </div>
        </Reveal>
      </section>
    </>
  );
}
