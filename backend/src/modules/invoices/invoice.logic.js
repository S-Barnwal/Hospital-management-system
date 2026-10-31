// Pure invoice maths and rules (no I/O) — unit-tested in tests/unit/invoices.test.js.
import { fromMinor } from '../../utils/pricing.js';

/** Rupees (number or "1234.50") → paise, rounding away float noise. */
export const paise = (v) => Math.round(Number(v || 0) * 100);

/**
 * Indian financial year label for a date (April–March, India time): 30 Oct 2026 → "2627", 15 Mar 2027 → "2627".
 */
export function financialYear(date = new Date()) {
  const ist = new Date(new Date(date).getTime() + 330 * 60 * 1000); // UTC+05:30
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? y : y - 1;
  return `${String(start % 100).padStart(2, '0')}${String((start + 1) % 100).padStart(2, '0')}`;
}

/** INV/2627/000123 — 15 characters, inside the GST limit of 16. */
export const formatInvoiceNumber = (series, fy, n) => `${series}/${fy}/${String(n).padStart(6, '0')}`;

/**
 * Totals in paise. subtotal = unit price × quantity; discount comes off before tax; tax is GST-exclusive.
 * Returns 2-dp strings ready for DECIMAL(12,2) columns.
 */
export function invoiceTotals({ unitPrice, quantity = 1, discount = 0, taxRatePercent = 0 }) {
  const sub = paise(unitPrice) * quantity;
  const disc = Math.min(paise(discount), sub);
  const taxable = sub - disc;
  const tax = Math.round((taxable * Math.round(Number(taxRatePercent) * 100)) / 10000);
  return { subtotal: fromMinor(sub), discount: fromMinor(disc), taxable: fromMinor(taxable), tax: fromMinor(tax), total: fromMinor(taxable + tax), totalMinor: taxable + tax };
}

/** CGST+SGST when seller and buyer are in the same Indian state, otherwise IGST (also for buyers abroad or unknown). */
export function isInterState({ sellerState, buyerState, buyerCountry }) {
  if (buyerCountry && buyerCountry !== 'IN') return true;
  if (!sellerState || !buyerState) return true;
  return sellerState.trim().toLowerCase() !== buyerState.trim().toLowerCase();
}

/** Splits the tax for printing. */
export function taxLines({ tax, taxRatePercent, interState }) {
  const t = paise(tax);
  const rate = Number(taxRatePercent);
  if (!t && !rate) return [];
  if (interState) return [{ label: `IGST @ ${rate}%`, amount: fromMinor(t) }];
  const half = Math.floor(t / 2);
  return [{ label: `CGST @ ${rate / 2}%`, amount: fromMinor(half) }, { label: `SGST @ ${rate / 2}%`, amount: fromMinor(t - half) }];
}

/** What may change on an invoice in each state. Issued invoices: buyer details & notes only. */
export const EDITABLE = {
  draft: ['description', 'sacCode', 'unitPrice', 'quantity', 'discount', 'taxRatePercent', 'billTo', 'notes', 'dueDate', 'paymentMethod', 'paymentRef', 'refreshSeller'],
  issued: ['billTo', 'notes', 'dueDate', 'paymentMethod', 'paymentRef', 'refreshSeller'],
  void: [],
};

/** Amount in words, Indian system: 11800 → "Rupees Eleven Thousand Eight Hundred Only". */
export function amountInWords(amount, currency = 'INR') {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (n) => (n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? ` ${ones[n % 10]}` : ''}`);
  const three = (n) => [n >= 100 ? `${ones[Math.floor(n / 100)]} Hundred` : '', two(n % 100)].filter(Boolean).join(' ');
  const words = (n) => {
    if (n === 0) return 'Zero';
    const parts = [];
    const crore = Math.floor(n / 1e7); n %= 1e7;
    const lakh = Math.floor(n / 1e5); n %= 1e5;
    const thousand = Math.floor(n / 1e3); n %= 1e3;
    if (crore) parts.push(`${words(crore)} Crore`);
    if (lakh) parts.push(`${two(lakh)} Lakh`);
    if (thousand) parts.push(`${two(thousand)} Thousand`);
    if (n) parts.push(three(n));
    return parts.join(' ');
  };
  const p = paise(amount);
  const major = Math.floor(p / 100);
  const minor = p % 100;
  const unit = currency === 'INR' ? ['Rupees', 'Paise'] : [currency, 'cents'];
  return `${unit[0]} ${words(major)}${minor ? ` and ${two(minor)} ${unit[1]}` : ''} Only`;
}

/** GST state codes (first two digits of a GSTIN) → state names as used in the address lists. */
export const GST_STATE_CODES = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana',
  '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', 10: 'Bihar', 11: 'Sikkim', 12: 'Arunachal Pradesh', 13: 'Nagaland',
  14: 'Manipur', 15: 'Mizoram', 16: 'Tripura', 17: 'Meghalaya', 18: 'Assam', 19: 'West Bengal', 20: 'Jharkhand', 21: 'Odisha',
  22: 'Chhattisgarh', 23: 'Madhya Pradesh', 24: 'Gujarat', 25: 'Dadra and Nagar Haveli and Daman and Diu', 26: 'Dadra and Nagar Haveli and Daman and Diu',
  27: 'Maharashtra', 29: 'Karnataka', 30: 'Goa', 31: 'Lakshadweep', 32: 'Kerala', 33: 'Tamil Nadu', 34: 'Puducherry',
  35: 'Andaman and Nicobar Islands', 36: 'Telangana', 37: 'Andhra Pradesh', 38: 'Ladakh',
};

/** '09AAMCD9124D1ZK' → 'Uttar Pradesh' (null if not a known code). */
export const stateFromGstin = (gstin) => GST_STATE_CODES[String(gstin || '').slice(0, 2)] ?? null;
