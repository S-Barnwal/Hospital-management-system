// Book a Demo and Contact pages — both persist to SQL Server via the API.
import { useState } from 'react';
import { LuCalendarCheck, LuMail, LuPhone, LuMapPin, LuCircleCheck } from 'react-icons/lu';
import { api } from '../../lib/api.js';
import { useApi, useForm } from '../../lib/hooks.js';
import { Alert, Button, Card, Input, Select, Textarea } from '../../components/ui.jsx';
import { PageHero } from './InfoPages.jsx';

export { FACILITY_OPTIONS } from '../../lib/facility.js';
import { FACILITY_OPTIONS } from '../../lib/facility.js';
import PhoneInput from '../../components/PhoneInput.jsx';
import EmailInput from '../../components/EmailInput.jsx';
import LocationFields from '../../components/LocationFields.jsx';

/** Hidden honeypot field — real users never fill it; simple bots do. */
const Honeypot = ({ bind }) => (
  <div className="absolute -left-[9999px]" aria-hidden="true">
    <label>Website<input tabIndex={-1} autoComplete="off" {...bind('website')} /></label>
  </div>
);

function Success({ title, children, onReset }) {
  return (
    <Card className="p-10 text-center">
      <LuCircleCheck className="mx-auto h-12 w-12 text-forest-600" aria-hidden />
      <h2 className="mt-4 font-display text-2xl font-semibold text-forest-950">{title}</h2>
      <p className="mt-2 text-muted">{children}</p>
      {onReset && <Button variant="outline" className="mt-6" onClick={onReset}>Submit another</Button>}
    </Card>
  );
}

const clean = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== '' && v !== null && v !== undefined));

/** Demo booking form — used on the Book a Demo page and on the home page. Saves to SQL Server. */
export function DemoForm() {
  const [done, setDone] = useState(null);
  const f = useForm({ orgName: '', contactName: '', email: '', phone: '', country: 'IN', state: '', city: '', facilityType: '', expectedUsers: '', preferredAt: '', message: '', website: '' });
  const onSubmit = f.submit(async (v) => {
    const body = clean({ ...v, expectedUsers: v.expectedUsers ? Number(v.expectedUsers) : undefined, preferredAt: v.preferredAt ? new Date(v.preferredAt).toISOString() : undefined });
    const res = await api.post('/demo-requests', body);
    setDone(res.data.message);
  });
  if (done) return <Success title="Demo request received" onReset={() => { setDone(null); f.setValues((s) => ({ ...s, message: '' })); }}>{done}</Success>;
  return (
    <Card className="relative p-5 sm:p-8">
      <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2 sm:gap-5">
        <Honeypot bind={f.bind} />
        <Input label="Hospital / organisation" required {...f.bind('orgName')} error={f.errors.orgName} className="sm:col-span-2" />
        <Input label="Contact person" required autoComplete="name" {...f.bind('contactName')} error={f.errors.contactName} />
        <EmailInput label="Work e-mail" required {...f.bind('email')} error={f.errors.email} />
        <PhoneInput label="Phone" required defaultCountry={f.values.country || 'IN'} {...f.bind('phone')} error={f.errors.phone} />
        <LocationFields form={f} />
        <Select label="Facility type" placeholder="Select…" options={FACILITY_OPTIONS} {...f.bind('facilityType')} error={f.errors.facilityType} />
        <Input label="Expected users" type="number" min="1" inputMode="numeric" {...f.bind('expectedUsers')} error={f.errors.expectedUsers} />
        <Input label="Preferred date & time" type="datetime-local" {...f.bind('preferredAt')} error={f.errors.preferredAt} className="sm:col-span-2" />
        <Textarea label="Anything we should know?" {...f.bind('message')} error={f.errors.message} className="sm:col-span-2" />
        {f.formError && <Alert tone="error" className="sm:col-span-2">{f.formError}</Alert>}
        <div className="sm:col-span-2"><Button type="submit" size="lg" loading={f.submitting} className="w-full sm:w-auto">Request demo</Button></div>
      </form>
    </Card>
  );
}

export const DEMO_POINTS = [['Tailored walkthrough', 'We focus on the modules that matter for your facility type.'],
  ['Migration advice', 'Bring your current registers — we’ll show how to move patient lists in.'],
  ['Pricing guidance', 'Find the right plan, or a custom Enterprise quote for larger hospitals.']];

export function DemoPoints() {
  return (
    <div className="space-y-5">
      {DEMO_POINTS.map(([t, d]) => (
        <div key={t} className="flex gap-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-gold-50 text-gold-700"><LuCalendarCheck aria-hidden /></span>
          <div><p className="font-semibold text-forest-950">{t}</p><p className="text-sm text-muted">{d}</p></div>
        </div>
      ))}
    </div>
  );
}

export function BookDemo() {
  return (
    <>
      <PageHero eyebrow="Book a demo" title="See it with your own workflow">
        A 30-minute walkthrough with our team. We’ll tailor it to your facility and answer setup questions.
      </PageHero>
      <section className="container-page grid gap-10 py-14 lg:grid-cols-5">
        <aside className="lg:col-span-2"><DemoPoints /></aside>
        <div className="lg:col-span-3"><DemoForm /></div>
      </section>
    </>
  );
}

export function Contact() {
  const [done, setDone] = useState(null);
  const { data: site } = useApi(() => api.get('/site-settings'), []);
  const f = useForm({ name: '', email: '', phone: '', subject: '', message: '', website: '' });
  const onSubmit = f.submit(async (v) => {
    const body = clean(v);
    const res = await api.post('/contact', body);
    setDone(res.data.message);
  });
  return (
    <>
      <PageHero eyebrow="Contact" title="We’d love to hear from you" />
      <section className="container-page grid gap-10 py-14 lg:grid-cols-5">
        <aside className="space-y-4 lg:col-span-2">
          {[[LuMail, 'E-mail', site?.['contact.email']], [LuPhone, 'Phone', site?.['contact.phone']], [LuMapPin, 'Address', site?.['contact.address']]].map(([I, l, v]) => (
            <Card key={l} className="flex items-center gap-4 p-5">
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-forest-900 text-gold-400"><I aria-hidden /></span>
              <div><p className="text-xs font-semibold uppercase tracking-wide text-muted">{l}</p><p className="font-medium text-forest-950">{v || '—'}</p></div>
            </Card>
          ))}
        </aside>
        <div className="lg:col-span-3">
          {done ? <Success title="Message sent">{done}</Success> : (
            <Card className="relative p-6 sm:p-8">
              <form onSubmit={onSubmit} noValidate className="grid gap-5 sm:grid-cols-2">
                <Honeypot bind={f.bind} />
                <Input label="Name" required {...f.bind('name')} error={f.errors.name} />
                <EmailInput label="E-mail" required {...f.bind('email')} error={f.errors.email} />
                <PhoneInput label="Phone" {...f.bind('phone')} error={f.errors.phone} />
                <Input label="Subject" {...f.bind('subject')} error={f.errors.subject} />
                <Textarea label="Message" required {...f.bind('message')} error={f.errors.message} className="sm:col-span-2" hint="At least 10 characters." />
                {f.formError && <Alert tone="error" className="sm:col-span-2">{f.formError}</Alert>}
                <div className="sm:col-span-2"><Button type="submit" size="lg" loading={f.submitting}>Send message</Button></div>
              </form>
            </Card>
          )}
        </div>
      </section>
    </>
  );
}
