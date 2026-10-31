// Public online appointment booking (/book/:slug). The patient picks a doctor, day and free slot and sends a REQUEST;
// the hospital confirms it. No sign-in, nothing about other patients is ever shown.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { LuCalendarCheck, LuCircleCheck, LuMapPin, LuPhone, LuStethoscope } from 'react-icons/lu';
import { api, qs } from '../../lib/api.js';
import { useApi } from '../../lib/hooks.js';
import { money } from '../../lib/format.js';
import { Alert, Button, Card, Input, Select, Skeleton, Spinner, Textarea, cx } from '../../components/ui.jsx';
import PhoneInput from '../../components/PhoneInput.jsx';
import EmailInput from '../../components/EmailInput.jsx';
import { LogoMark } from '../../components/Logo.jsx';
import { formatPhone } from '../../lib/contact.js';

const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const dayChip = (ymd) => new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${ymd}T00:00:00Z`));

export default function BookOnline() {
  const { slug } = useParams();
  const { data: h, loading, error } = useApi(() => api.get(`/public/booking/${encodeURIComponent(slug)}`), [slug]);
  const [doctorId, setDoctorId] = useState('');
  const [day, setDay] = useState('');
  const [slot, setSlot] = useState('');
  const [form, setForm] = useState({ name: '', phone: '', email: '', gender: '', age: '', reason: '', consent: false, website: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [fieldErr, setFieldErr] = useState({});
  const [done, setDone] = useState(null);
  useEffect(() => { if (h && !day) setDay(h.today); }, [h, day]);
  useEffect(() => setSlot(''), [doctorId, day]);
  useEffect(() => { if (h) document.title = `Book an appointment — ${h.hospital.name}`; }, [h]);
  const { data: slots, loading: slotsLoading, error: slotsError } = useApi(
    () => (doctorId && day ? api.get(`/public/booking/${encodeURIComponent(slug)}/slots${qs({ doctorId, date: day })}`) : Promise.resolve({ data: null })), [doctorId, day]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const doctor = h?.doctors.find((d) => String(d.id) === String(doctorId));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null); setFieldErr({});
    try {
      const r = await api.post(`/public/booking/${encodeURIComponent(slug)}`, {
        doctorId: Number(doctorId), date: day, time: slot, name: form.name.trim(), phone: form.phone, ...(form.email ? { email: form.email } : {}),
        ...(form.gender ? { gender: form.gender } : {}), ...(form.age !== '' ? { age: Number(form.age) } : {}), ...(form.reason.trim() ? { reason: form.reason.trim() } : {}),
        consent: form.consent, ...(form.website ? { website: form.website } : {}),
      });
      setDone(r.data);
    } catch (e2) {
      setErr(e2.message);
      setFieldErr(Object.fromEntries((e2.details || []).map((d) => [d.path, d.message])));
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-ivory px-4 py-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-center gap-2 text-sm text-muted"><LogoMark className="h-6 w-6" /> Online appointment request</div>
        {loading && <Skeleton className="h-96 w-full" />}
        {error && <Alert tone="error" title="Not available">{error.message}</Alert>}
        {h && done && (
          <Card className="p-8 text-center">
            <LuCircleCheck className="mx-auto h-14 w-14 text-forest-600" aria-hidden />
            <h1 className="mt-3 font-display text-2xl font-semibold text-forest-950">Request sent</h1>
            <p className="mt-2">{done.doctor} · <strong>{done.when}</strong></p>
            <p className="mt-4 text-sm text-muted">Your reference</p>
            <p className="font-mono text-3xl font-bold tracking-widest text-forest-900">{done.ref}</p>
            <Alert tone="info" className="mt-6 text-left">{done.hospital} will confirm your appointment by phone, WhatsApp or e-mail. Please keep the reference number. If you need to change it, call {h.hospital.phone ? formatPhone(h.hospital.phone) : 'the hospital'}.</Alert>
          </Card>
        )}
        {h && !done && (
          <Card className="overflow-hidden">
            <div className="bg-forest-950 px-6 py-5 text-white">
              <h1 className="font-display text-2xl font-semibold text-gold-200">{h.hospital.name}</h1>
              <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-forest-100">
                {(h.hospital.address || h.hospital.city) && <span className="flex items-center gap-1"><LuMapPin aria-hidden /> {[h.hospital.address, h.hospital.city].filter(Boolean).join(', ')}</span>}
                {h.hospital.phone && <span className="flex items-center gap-1"><LuPhone aria-hidden /> {formatPhone(h.hospital.phone)}</span>}
              </p>
            </div>
            <form onSubmit={submit} className="space-y-6 p-6" noValidate>
              {h.notice && <Alert tone="info">{h.notice}</Alert>}
              {!h.doctors.length ? <Alert tone="warning">No doctors are open for online booking right now. Please call the hospital.</Alert> : (
                <>
                  <section>
                    <h2 className="mb-2 flex items-center gap-2 font-semibold"><LuStethoscope aria-hidden /> 1. Choose a doctor</h2>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {h.doctors.map((d) => (
                        <button key={d.id} type="button" onClick={() => setDoctorId(String(d.id))} aria-pressed={String(d.id) === doctorId}
                          className={cx('rounded-xl border p-3 text-left transition', String(d.id) === doctorId ? 'border-forest-700 bg-forest-50 ring-2 ring-forest-200' : 'border-line bg-white hover:border-forest-300')}>
                          <p className="font-semibold">{d.name}</p>
                          <p className="text-xs text-muted">{[d.specialization, d.department].filter(Boolean).join(' · ') || 'General'}{d.fee != null ? ` · Fee ${money(d.fee)}` : ''}</p>
                        </button>
                      ))}
                    </div>
                  </section>
                  {doctorId && (
                    <section>
                      <h2 className="mb-2 flex items-center gap-2 font-semibold"><LuCalendarCheck aria-hidden /> 2. Pick a day and time</h2>
                      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2" role="radiogroup" aria-label="Day">
                        {Array.from({ length: Math.min(14, h.maxDays + 1) }, (_, i) => addDays(h.today, i)).map((d) => (
                          <button key={d} type="button" role="radio" aria-checked={d === day} onClick={() => setDay(d)}
                            className={cx('shrink-0 rounded-lg border px-3 py-2 text-sm', d === day ? 'border-forest-800 bg-forest-900 text-white' : 'border-line bg-white')}>{i18nDay(d, h.today)}</button>
                        ))}
                        <input type="date" className="input w-auto shrink-0" min={h.today} max={addDays(h.today, h.maxDays)} value={day} onChange={(e) => setDay(e.target.value)} aria-label="Other date" />
                      </div>
                      <div className="mt-2 min-h-12">
                        {slotsLoading ? <Spinner /> : slotsError ? <Alert tone="error">{slotsError.message}</Alert> : !slots?.slots.length
                          ? <p className="text-sm text-muted">No free times on this day — try another day.</p>
                          : <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Time">{slots.slots.map((s) => (
                            <button key={s} type="button" role="radio" aria-checked={slot === s} onClick={() => setSlot(s)}
                              className={cx('rounded-lg border px-3 py-1.5 font-mono text-sm', slot === s ? 'border-forest-800 bg-forest-900 text-white' : 'border-line bg-white hover:border-forest-400')}>{s}</button>))}</div>}
                      </div>
                    </section>
                  )}
                  {slot && (
                    <section className="grid gap-4 sm:grid-cols-2">
                      <h2 className="font-semibold sm:col-span-2">3. Patient details</h2>
                      <Input label="Patient's full name" required value={form.name} onChange={set('name')} error={fieldErr.name} autoComplete="name" />
                      <PhoneInput label="Mobile number" required value={form.phone} onChange={set('phone')} error={fieldErr.phone} />
                      <EmailInput label="E-mail (optional)" value={form.email} onChange={set('email')} error={fieldErr.email} />
                      <div className="grid grid-cols-2 gap-3">
                        <Select label="Gender" placeholder="—" value={form.gender} onChange={set('gender')} options={[{ value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }, { value: 'other', label: 'Other' }]} />
                        <Input label="Age" type="number" min="0" max="120" value={form.age} onChange={set('age')} error={fieldErr.age} />
                      </div>
                      <Textarea label="Reason for visit (optional)" className="sm:col-span-2" maxLength={300} value={form.reason} onChange={set('reason')} />
                      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" value={form.website} onChange={set('website')} aria-hidden />
                      <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" className="mt-1 accent-forest-800" checked={form.consent} onChange={set('consent')} />
                        I agree that {h.hospital.name} may contact me on this number / e-mail about this appointment.</label>
                      {err && <Alert tone="error" className="sm:col-span-2">{err}</Alert>}
                      <div className="sm:col-span-2">
                        <Button type="submit" size="lg" className="w-full sm:w-auto" loading={busy} disabled={!form.consent || form.name.trim().length < 2 || !form.phone}>
                          Request {doctor?.name} · {dayChip(day)} {slot}
                        </Button>
                        <p className="mt-2 text-xs text-muted">This is a request. The hospital confirms it before it becomes an appointment.</p>
                      </div>
                    </section>
                  )}
                </>
              )}
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}

function i18nDay(d, today) {
  if (d === today) return 'Today';
  if (d === addDays(today, 1)) return 'Tomorrow';
  return dayChip(d);
}
