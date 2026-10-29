// Features, About, FAQ and legal pages.
import { LuCheck, LuShieldCheck, LuHeartPulse, LuServer } from 'react-icons/lu';
import { Badge, Button } from '../../components/ui.jsx';
import Reveal from '../../components/Reveal.jsx';
import { MODULES, FAQS } from './content.js';
import { BRAND } from '../../lib/format.js';

export function PageHero({ eyebrow, title, children }) {
  return (
    <section className="relative border-b border-line">
      <div className="grain absolute inset-0 -z-10" aria-hidden />
      <div className="container-page py-16 text-center">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="mx-auto mt-3 max-w-3xl font-display text-4xl font-semibold text-forest-950 sm:text-5xl">{title}</h1>
        {children && <p className="mx-auto mt-4 max-w-2xl text-lg text-muted">{children}</p>}
        <div className="gold-rule mx-auto mt-8" />
      </div>
    </section>
  );
}

const FEATURE_DETAIL = {
  patients: ['Hospital-specific patient numbers (e.g. GRE-000123)', 'Search by name, phone or number', 'Duplicate warnings on registration', 'Archive instead of delete'],
  appointments: ['Weekly doctor schedules with slot sizes', 'Free-slot lookup per day', 'Overlap protection for doctor and patient', 'Check-in, complete, cancel with reasons'],
  staff: ['Doctors, nurses, front desk, lab, pharmacy, accounts', 'Departments you configure', 'Registration numbers and consultation fees'],
  rbac: ['Owner, Admin, Manager, Receptionist, Doctor, Nurse, Lab, Pharmacist, Accountant', 'Customise permissions per role', 'No one can grant themselves more access'],
  settings: ['Hospital timezone for all dates and times', 'Patient number prefix', 'Subscription, invoices and renewal'],
  opd: ['Vitals, complaints, examination and diagnosis', 'Prescriptions with dose, frequency and duration', 'Every edit versioned; finalised notes are locked', 'Printable prescription'],
  ipd: ['Live bed board by ward', 'Admit, transfer and discharge', 'Double-booking of beds blocked by the database', 'Bed charges added to the bill on discharge'],
  billing: ['GST per line, bill-level discount', 'Sequential invoice & receipt numbers', 'Partial payments, refunds and cancellations', 'Finalised invoices cannot be edited'],
  lab: ['Test catalogue with reference ranges', 'Sample → results → verification workflow', 'Automatic high/low flags', 'Printable verified reports'],
  pharmacy: ['Batch & expiry tracking', 'First-expiry-first-out dispensing', 'Low-stock and expiry alerts', 'Full stock movement ledger'],
  reports: ['Registrations, appointments, admissions', 'Collections and outstanding bills', 'Lab volume and inventory value', 'CSV export'],
};

export function Features() {
  return (
    <>
      <PageHero eyebrow="Features" title="One system for the whole hospital">
        Start with the essentials today. Every module shares the same patient record, staff directory and permissions.
      </PageHero>
      <section className="container-page grid gap-5 py-16 md:grid-cols-2">
        {MODULES.map((m, i) => (
          <Reveal key={m.key} delay={(i % 2) * 0.06} className="card flex gap-5 p-6">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-forest-900 text-gold-400"><m.icon className="h-6 w-6" aria-hidden /></span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-xl font-semibold text-forest-950">{m.title}</h2>
                {m.status === 'soon' ? <Badge tone="gold">Coming soon</Badge> : <Badge tone="green">Available</Badge>}
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted">{m.text}</p>
              {FEATURE_DETAIL[m.key] && (
                <ul className="mt-3 space-y-1.5 text-sm text-forest-900">
                  {FEATURE_DETAIL[m.key].map((d) => <li key={d} className="flex gap-2"><LuCheck className="mt-0.5 shrink-0 text-gold-600" aria-hidden />{d}</li>)}
                </ul>
              )}
            </div>
          </Reveal>
        ))}
      </section>
      <section className="container-page pb-20 text-center">
        <Button size="lg" to="/pricing">Compare plans</Button>
      </section>
    </>
  );
}

export function About() {
  return (
    <>
      <PageHero eyebrow="About" title={`Why we built ${BRAND}`}>
        Small and mid-sized hospitals deserve software that is affordable, secure and pleasant to use every day.
      </PageHero>
      <section className="container-page grid gap-6 py-16 md:grid-cols-3">
        {[
          [LuHeartPulse, 'Made for care teams', 'Fewer clicks at the front desk, clear schedules for doctors and dependable records for everyone.'],
          [LuShieldCheck, 'Security by design', 'Hospital-level data isolation, server-enforced permissions, hashed passwords and audit logs from day one.'],
          [LuServer, 'Cloud, not servers', 'No installation or hardware to maintain. Use it from any modern browser on desktop, tablet or phone.'],
        ].map(([I, t, d]) => (
          <Reveal key={t} className="card p-6">
            <I className="h-7 w-7 text-gold-600" aria-hidden />
            <h2 className="mt-4 font-display text-xl font-semibold text-forest-950">{t}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{d}</p>
          </Reveal>
        ))}
      </section>
    </>
  );
}

export function Faq() {
  return (
    <>
      <PageHero eyebrow="FAQ" title="Frequently asked questions" />
      <section className="container-page max-w-3xl space-y-3 py-16">
        {FAQS.map(([q, a]) => (
          <details key={q} className="group rounded-xl border border-line bg-white p-5">
            <summary className="flex cursor-pointer list-none items-center justify-between font-semibold text-forest-950">
              {q}<span className="ml-4 text-gold-600 transition group-open:rotate-45" aria-hidden>+</span>
            </summary>
            <p className="mt-3 text-sm leading-relaxed text-muted">{a}</p>
          </details>
        ))}
      </section>
    </>
  );
}

const LEGAL = {
  terms: {
    title: 'Terms of Service',
    sections: [
      ['Service', `${BRAND} provides cloud software for managing hospital operations on a subscription basis.`],
      ['Accounts', 'The hospital owner is responsible for the users they create and for keeping credentials confidential.'],
      ['Your data', 'Hospital and patient data belongs to the hospital. We process it only to provide the service.'],
      ['Clinical responsibility', 'The software records information entered by your staff. It does not provide medical advice or diagnoses.'],
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    sections: [
      ['What we collect', 'Account details of hospital users, hospital profile data, billing information and the records your staff enter.'],
      ['How we protect it', 'Encryption in transit, per-hospital isolation, role-based access, hashed passwords and audit logs.'],
      ['Your rights', 'Contact us to access, correct or export data. Patient requests are handled with the hospital as data fiduciary.'],
    ],
  },
  cancellation: {
    title: 'Subscription & cancellation policy',
    sections: [
      ['Billing', 'Plans are billed monthly or annually in advance. Taxes are shown before payment.'],
      ['Renewal & grace period', 'If a subscription is not renewed, a grace period applies, after which the workspace becomes read-only.'],
      ['Data retention', 'We do not delete hospital data automatically when a subscription ends. Contact us for export or deletion.'],
      ['Refunds', 'Refund eligibility is decided case-by-case according to the agreement with your organisation.'],
    ],
  },
};

export function Legal({ kind }) {
  const doc = LEGAL[kind];
  return (
    <>
      <PageHero eyebrow="Legal" title={doc.title} />
      <section className="container-page max-w-3xl py-14">
        <div className="mb-8 rounded-xl border border-gold-200 bg-gold-50 p-4 text-sm text-gold-700">
          Template text — have this page reviewed by your legal advisor before going live.
        </div>
        <div className="space-y-8">
          {doc.sections.map(([h, p]) => (
            <div key={h}>
              <h2 className="font-display text-xl font-semibold text-forest-950">{h}</h2>
              <p className="mt-2 leading-relaxed text-muted">{p}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
