// The official A4 invoice (MediCore → hospital). Same layout on screen, in the print dialog and as "Save as PDF".
// Used by Super Admin → Invoices and by the hospital's Subscription page.
import { money } from '../lib/format.js';
import { countryName, formatPhone } from '../lib/contact.js';
import { cx } from './ui.jsx';

const d = (v) => (v ? new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(v)) : '—');
const lines = (...xs) => xs.filter(Boolean);
const KIND = { subscription: 'Subscription', free: 'Free plan', manual: 'Service' };

export const INVOICE_PRINT_CSS = '@media print { @page { size: A4; margin: 12mm; } body { background: #fff !important; } }';

export default function InvoiceDocument({ inv, className }) {
  const s = inv.seller || {};
  const b = inv.billTo || {};
  const cur = inv.currency || 'INR';
  const isTax = Boolean(s.gstin); // only a GST-registered seller issues a "Tax Invoice"
  const watermark = inv.status === 'void' ? 'VOID' : inv.status === 'draft' ? 'DRAFT' : inv.isSandbox ? 'TEST' : null;

  return (
    <article className={cx('relative mx-auto w-full max-w-[210mm] overflow-hidden bg-white p-8 text-[13px] leading-relaxed text-slate-900 shadow-sm ring-1 ring-line print:max-w-none print:p-0 print:shadow-none print:ring-0', className)}
      aria-label={`Invoice ${inv.number || 'draft'}`}>
      {watermark && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden>
          <span className={cx('-rotate-30 select-none text-[110px] font-black tracking-widest opacity-10', watermark === 'VOID' ? 'text-red-600' : 'text-slate-500')}>{watermark}</span>
        </div>
      )}

      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-forest-900 pb-5">
        <div className="max-w-[60%]">
          <p className="font-display text-2xl font-bold text-forest-950">{s.brand || s.name}</p>
          {s.name && s.brand && s.name !== s.brand && <p className="font-semibold">{s.name}</p>}
          {s.address && <p className="whitespace-pre-line text-slate-600">{s.address}</p>}
          <p className="text-slate-600">{lines(s.email, s.phone && formatPhone(s.phone)).join(' · ')}</p>
          {s.gstin && <p className="mt-1"><span className="font-semibold">GSTIN:</span> <span className="font-mono">{s.gstin}</span>{s.state && <> · State: {s.state}</>}</p>}
        </div>
        <div className="text-right">
          <p className="text-xl font-bold uppercase tracking-wider text-forest-900">{isTax ? 'Tax Invoice' : 'Invoice'}</p>
          <table className="ml-auto mt-2 text-left">
            <tbody>
              <tr><td className="pr-3 text-slate-500">Invoice no.</td><td className="font-mono font-semibold">{inv.number || 'Draft — not issued'}</td></tr>
              <tr><td className="pr-3 text-slate-500">Invoice date</td><td>{d(inv.issuedAt || inv.createdAt)}</td></tr>
              {inv.dueDate && <tr><td className="pr-3 text-slate-500">Due date</td><td>{d(inv.dueDate)}</td></tr>}
              <tr><td className="pr-3 text-slate-500">Place of supply</td><td>{b.state || (b.country && countryName(b.country)) || '—'}</td></tr>
              <tr><td className="pr-3 text-slate-500">Type</td><td>{KIND[inv.kind] || inv.kind}</td></tr>
            </tbody>
          </table>
        </div>
      </header>

      {/* Parties */}
      <section className="grid gap-6 py-5 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Billed to</p>
          <p className="mt-1 text-base font-semibold">{b.name}</p>
          {b.address && <p className="whitespace-pre-line">{b.address}</p>}
          <p>{lines(b.city, b.state, b.country && countryName(b.country)).join(', ')}</p>
          <p className="text-slate-600">{lines(b.email, b.phone && formatPhone(b.phone)).join(' · ')}</p>
          {b.gstin && <p className="mt-1"><span className="font-semibold">GSTIN:</span> <span className="font-mono">{b.gstin}</span></p>}
        </div>
        {(inv.planName || inv.periodStart) && (
          <div className="sm:text-right">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Subscription</p>
            {inv.planName && <p className="mt-1 font-semibold">{inv.planName} plan{inv.interval ? ` · ${inv.interval}` : ''}</p>}
            {inv.periodStart && <p>Service period: {d(inv.periodStart)} – {d(inv.periodEnd)}</p>}
            {inv.tenantSlug && <p className="text-slate-600">Workspace: {inv.tenantSlug}</p>}
          </div>
        )}
      </section>

      {/* Lines */}
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="bg-forest-900 text-white print:bg-forest-900">
            <th className="px-3 py-2 font-semibold">#</th>
            <th className="px-3 py-2 font-semibold">Description</th>
            <th className="px-3 py-2 font-semibold">SAC</th>
            <th className="px-3 py-2 text-right font-semibold">Qty</th>
            <th className="px-3 py-2 text-right font-semibold">Rate</th>
            <th className="px-3 py-2 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-line align-top">
            <td className="px-3 py-3">1</td>
            <td className="px-3 py-3">{inv.description}</td>
            <td className="px-3 py-3 font-mono">{inv.sacCode || '—'}</td>
            <td className="px-3 py-3 text-right">{inv.quantity}</td>
            <td className="px-3 py-3 text-right">{money(inv.unitPrice, cur)}</td>
            <td className="px-3 py-3 text-right">{money(inv.subtotal, cur)}</td>
          </tr>
        </tbody>
      </table>

      {/* Totals */}
      <section className="mt-4 flex flex-wrap justify-between gap-6">
        <div className="max-w-sm flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Amount in words</p>
          <p className="font-medium">{inv.amountInWords}</p>
          <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Payment</p>
          <p>{inv.paymentMethod || '—'}{inv.paymentRef ? ` · Ref. ${inv.paymentRef}` : ''}</p>
          {Number(inv.total) === 0 && <p className="mt-1 font-semibold text-forest-800">No payment due.</p>}
        </div>
        <table className="w-72 text-right">
          <tbody>
            <tr><td className="py-1 pr-4 text-slate-600">Gross amount</td><td>{money(inv.subtotal, cur)}</td></tr>
            {Number(inv.discount) > 0 && <tr><td className="py-1 pr-4 text-slate-600">Discount</td><td>− {money(inv.discount, cur)}</td></tr>}
            <tr><td className="py-1 pr-4 text-slate-600">Taxable value</td><td>{money(inv.taxable, cur)}</td></tr>
            {inv.taxLines.map((l) => <tr key={l.label}><td className="py-1 pr-4 text-slate-600">{l.label}</td><td>{money(l.amount, cur)}</td></tr>)}
            <tr className="border-t-2 border-forest-900 text-base font-bold"><td className="py-2 pr-4">Total</td><td>{money(inv.total, cur)}</td></tr>
          </tbody>
        </table>
      </section>

      {inv.notes && <section className="mt-6 rounded-md bg-slate-50 p-3 print:bg-transparent print:p-0"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Notes</p><p className="whitespace-pre-line">{inv.notes}</p></section>}
      {inv.status === 'void' && <p className="mt-4 font-semibold text-red-700">This invoice was cancelled on {d(inv.voidedAt)}. Reason: {inv.voidReason}</p>}
      {inv.isSandbox && <p className="mt-4 font-semibold text-gold-700">Test invoice from the sandbox payment gateway — not a real payment.</p>}

      <footer className="mt-10 flex items-end justify-between gap-6 border-t border-line pt-4 text-xs text-slate-500">
        <p className="max-w-md">{s.footer}</p>
        <p className="text-right">For {s.name}<br /><span className="mt-6 inline-block">Authorised signatory</span></p>
      </footer>
    </article>
  );
}
