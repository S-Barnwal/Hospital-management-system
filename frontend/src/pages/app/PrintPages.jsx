// Print-only pages: sample barcode labels and the patient ID card (QR + barcode).
import { Link, useParams } from 'react-router-dom';
import { LuArrowLeft, LuPrinter } from 'react-icons/lu';
import { api } from '../../lib/api.js';
import { useApi } from '../../lib/hooks.js';
import { useTenantAuth } from '../../context/AuthContext.jsx';
import { age, date, dateTime, fullName, titleCase } from '../../lib/format.js';
import { Alert, Button, PageHeader, Skeleton } from '../../components/ui.jsx';
import Barcode from '../../components/Barcode.jsx';
import QrCode from '../../components/QrCode.jsx';
import InvoiceDocument, { INVOICE_PRINT_CSS } from '../../components/InvoiceDocument.jsx';

const ageSex = (p) => [p.dateOfBirth && `${age(p.dateOfBirth)}y`, p.gender && titleCase(p.gender)[0]].filter(Boolean).join('/');

/** One label per sample, sized 50 × 25 mm (the most common thermal label roll). */
export function SampleLabels() {
  const { id } = useParams();
  const { me } = useTenantAuth();
  const { data: o, loading, error } = useApi(() => api.get(`/lab/orders/${id}`), [id]);
  if (error) return <Alert tone="error">{error.message}</Alert>;
  if (loading || !o) return <Skeleton className="h-40 w-full" />;
  const p = o.patient;
  const testsFor = (type) => o.items.filter((i) => (i.sampleType || 'Other') === type).map((i) => i.testName).join(', ');
  return (
    <>
      <style>{'@media print { @page { size: 50mm 25mm; margin: 0; } body { background: #fff !important; } }'}</style>
      <div className="print:hidden">
        <Link to={`/app/laboratory/${id}`} className="mb-4 flex items-center gap-1 text-sm font-medium text-forest-700"><LuArrowLeft aria-hidden /> Back to order</Link>
        <PageHeader title={`Sample labels — ${o.number}`} subtitle="One label per sample tube. Set your label printer to 50 × 25 mm, scale 100%, no margins."
          actions={<Button onClick={() => window.print()}><LuPrinter aria-hidden /> Print labels</Button>} />
        {o.samples.length === 0 && <Alert tone="info">This order has no samples.</Alert>}
      </div>
      <div className="flex flex-wrap gap-4 print:block print:gap-0">
        {o.samples.map((s) => (
          <div key={s.id} className="flex h-[25mm] w-[50mm] flex-col justify-between overflow-hidden border border-dashed border-line bg-white p-[1.5mm] text-[7pt] leading-tight text-black print:break-after-page print:border-0">
            <div className="flex justify-between gap-1 font-bold"><span className="truncate">{fullName(p.firstName, p.lastName)}</span><span className="shrink-0">{ageSex(p)}</span></div>
            <Barcode value={s.number} height={22} moduleWidth={0.9} showText={false} className="mx-auto h-[9mm] w-auto max-w-full" />
            <div className="flex justify-between gap-1"><span className="font-mono font-bold">{s.number}</span><span>{s.sampleType}</span></div>
            <div className="flex justify-between gap-1"><span className="truncate">{testsFor(s.sampleType)}</span><span className="shrink-0">{date(o.orderedAt, me.tenant.timezone)}</span></div>
          </div>
        ))}
      </div>
    </>
  );
}

/** Credit-card-size patient card (85.6 × 54 mm). The QR opens the patient file for logged-in staff only. */
export function PatientCard() {
  const { id } = useParams();
  const { me } = useTenantAuth();
  const { data: p, loading, error } = useApi(() => api.get(`/patients/${id}`), [id]);
  if (error) return <Alert tone="error">{error.status === 404 ? 'Patient not found.' : error.message}</Alert>;
  if (loading || !p) return <Skeleton className="h-40 w-full" />;
  const fileUrl = `${window.location.origin}/app/patients/${p.id}`;
  return (
    <>
      <style>{'@media print { @page { size: 85.6mm 54mm; margin: 0; } body { background: #fff !important; } }'}</style>
      <div className="print:hidden">
        <Link to={`/app/patients/${id}`} className="mb-4 flex items-center gap-1 text-sm font-medium text-forest-700"><LuArrowLeft aria-hidden /> Back to patient</Link>
        <PageHeader title="Patient card" subtitle="Print on a card printer or on paper and laminate. Scanning the QR opens this patient’s file — only for signed-in staff of your hospital."
          actions={<Button onClick={() => window.print()}><LuPrinter aria-hidden /> Print card</Button>} />
      </div>
      <div className="h-[54mm] w-[85.6mm] overflow-hidden rounded-[3mm] border border-line bg-white text-black shadow-sm print:rounded-none print:border-0 print:shadow-none">
        <div className="bg-forest-900 px-[3mm] py-[1.5mm] text-[8pt] font-bold text-white print:bg-forest-900">{me.tenant.name}</div>
        <div className="flex gap-[3mm] p-[3mm]">
          <div className="min-w-0 flex-1 text-[7.5pt] leading-snug">
            <p className="truncate text-[10pt] font-bold">{fullName(p.firstName, p.lastName)}</p>
            <p className="font-mono text-[9pt] font-bold">{p.patientNumber}</p>
            <p>{[p.gender && titleCase(p.gender), p.dateOfBirth && `DOB ${p.dateOfBirth}`].filter(Boolean).join(' · ') || '—'}</p>
            {p.bloodGroup && <p>Blood group: <strong>{p.bloodGroup}</strong></p>}
            <Barcode value={p.patientNumber} height={20} moduleWidth={0.8} showText={false} className="mt-[1mm] h-[7mm] w-auto max-w-full" />
          </div>
          <QrCode value={fileUrl} size={86} label={`QR code for ${p.patientNumber}`} />
        </div>
      </div>
    </>
  );
}

/** The hospital's own copy of a platform invoice (subscription / free plan), printable as PDF. */
export function SubscriptionInvoice() {
  const { id } = useParams();
  const { data: inv, loading, error } = useApi(() => api.get(`/subscription/invoices/${id}`), [id]);
  if (error) return <Alert tone="error">{error.status === 404 ? 'Invoice not found.' : error.message}</Alert>;
  if (loading || !inv) return <Skeleton className="h-96 w-full" />;
  const print = () => { const old = document.title; document.title = `${inv.number}`.replace(/[^\w.-]+/g, '_'); window.print(); document.title = old; };
  return (
    <>
      <style>{INVOICE_PRINT_CSS}</style>
      <div className="print:hidden">
        <Link to="/app/subscription" className="mb-4 flex items-center gap-1 text-sm font-medium text-forest-700"><LuArrowLeft aria-hidden /> Subscription</Link>
        <PageHeader title={`Invoice ${inv.number}`} subtitle="Choose “Save as PDF” in the print window to download it."
          actions={<Button onClick={print}><LuPrinter aria-hidden /> Download PDF / Print</Button>} />
      </div>
      <InvoiceDocument inv={inv} />
    </>
  );
}

const DS_TYPE = { regular: 'Regular discharge', lama: 'Left against medical advice (LAMA)', referred: 'Referred to another hospital', death: 'Death', absconded: 'Absconded' };
/** Printable discharge summary (A4). Shows a DRAFT banner until a doctor signs it. */
export function DischargeSummaryPrint() {
  const { id } = useParams();
  const { me } = useTenantAuth();
  const tz = me.tenant.timezone;
  const { data: a, loading, error } = useApi(() => api.get(`/ipd/admissions/${id}`), [id]);
  const { data: s, loading: sLoading } = useApi(() => api.get(`/ipd/admissions/${id}/discharge-summary`), [id]);
  if (error) return <Alert tone="error">{error.status === 404 ? 'Admission not found.' : error.message}</Alert>;
  if (loading || sLoading || !a || !s) return <Skeleton className="h-64 w-full" />;
  const row = (label, value) => value ? <section className="mt-4 break-inside-avoid"><h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</h3><p className="mt-1 whitespace-pre-wrap">{value}</p></section> : null;
  return (
    <>
      <style>{'@media print { @page { size: A4; margin: 14mm; } body { background: #fff !important; } }'}</style>
      <div className="print:hidden">
        <Link to={`/app/admissions/${id}?tab=summary`} className="mb-4 flex items-center gap-1 text-sm font-medium text-forest-700"><LuArrowLeft aria-hidden /> Back to admission</Link>
        <PageHeader title="Discharge summary" actions={<Button onClick={() => window.print()}><LuPrinter aria-hidden /> Print / Save as PDF</Button>} />
        {s.status !== 'final' && <Alert tone="warning" className="mb-4">Not signed yet — it prints with a DRAFT mark.</Alert>}
      </div>
      <article className="relative mx-auto max-w-[210mm] bg-white p-8 text-sm text-slate-900 ring-1 ring-line print:p-0 print:ring-0">
        {s.status !== 'final' && <p className="absolute right-8 top-8 rounded border-2 border-red-500 px-2 text-lg font-black text-red-600 print:right-0 print:top-0">DRAFT</p>}
        <header className="border-b-2 border-forest-900 pb-3">
          <p className="font-display text-2xl font-bold text-forest-950">{me.tenant.name}</p>
          <p className="mt-1 text-center text-base font-bold uppercase tracking-widest">Discharge summary</p>
        </header>
        <table className="mt-4 w-full text-sm"><tbody>
          <tr><td className="py-0.5 pr-2 font-semibold">Patient</td><td>{fullName(a.patientFirstName, a.patientLastName)}</td><td className="pr-2 font-semibold">Patient no.</td><td>{a.patientNumber}</td></tr>
          <tr><td className="py-0.5 pr-2 font-semibold">Age / Sex</td><td>{[a.dateOfBirth && `${age(a.dateOfBirth)} yrs`, a.gender && titleCase(a.gender)].filter(Boolean).join(' / ') || '—'}</td><td className="pr-2 font-semibold">IPD no.</td><td>{a.number}</td></tr>
          <tr><td className="py-0.5 pr-2 font-semibold">Admitted</td><td>{date(a.admittedAt, tz)}</td><td className="pr-2 font-semibold">Discharged</td><td>{a.dischargedAt ? date(a.dischargedAt, tz) : '—'}</td></tr>
          <tr><td className="py-0.5 pr-2 font-semibold">Ward / bed</td><td>{a.wardName} · {a.bedNumber}</td><td className="pr-2 font-semibold">Consultant</td><td>{a.doctorName || '—'}</td></tr>
          <tr><td className="py-0.5 pr-2 font-semibold">Discharge type</td><td colSpan={3}>{DS_TYPE[s.dischargeType] || '—'}</td></tr>
        </tbody></table>
        {row('Provisional diagnosis', s.provisionalDiagnosis)}
        {row('Final diagnosis', s.finalDiagnosis)}
        {row('Presenting complaints', s.presentingComplaints)}
        {row('Course in hospital', s.courseInHospital)}
        {row('Procedures / surgery', s.proceduresDone)}
        {row('Investigations', s.investigations)}
        {row('Condition at discharge', s.conditionAtDischarge)}
        {s.medications?.length > 0 && (
          <section className="mt-4 break-inside-avoid">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Medicines on discharge</h3>
            <table className="mt-1 w-full border-collapse text-sm"><thead><tr className="border-b border-slate-300 text-left"><th className="py-1">Medicine</th><th>Dose</th><th>Frequency</th><th>Days</th><th>Instructions</th></tr></thead>
              <tbody>{s.medications.map((m, i) => <tr key={i} className="border-b border-slate-100"><td className="py-1 font-medium">{m.medicineName}</td><td>{m.dosage}</td><td>{m.frequency}</td><td>{m.durationDays}</td><td>{m.instructions}</td></tr>)}</tbody></table>
          </section>
        )}
        {row('Advice', s.advice)}
        {s.followUpDate && row('Follow-up', date(`${s.followUpDate}T00:00:00Z`, 'UTC'))}
        <footer className="mt-12 flex items-end justify-between text-xs">
          <p className="text-slate-500">In an emergency, come to the hospital immediately or call your doctor.</p>
          <p className="text-right">{s.status === 'final' ? <>Signed by <strong>{s.finalizedBy}</strong><br />{dateTime(s.finalizedAt, tz)}</> : 'Not signed'}<br />{a.doctorName}{a.doctorRegNo ? ` · Reg. ${a.doctorRegNo}` : ''}</p>
        </footer>
      </article>
    </>
  );
}
