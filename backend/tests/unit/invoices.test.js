import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { financialYear, formatInvoiceNumber, invoiceTotals, isInterState, taxLines, amountInWords, EDITABLE } from '../../src/modules/invoices/invoice.logic.js';

describe('Invoice numbering', () => {
  test('financial year runs April–March in India time', () => {
    assert.equal(financialYear(new Date('2026-10-30T10:00:00Z')), '2627');
    assert.equal(financialYear(new Date('2027-03-31T18:00:00Z')), '2627'); // 31 Mar 23:30 IST
    assert.equal(financialYear(new Date('2027-03-31T18:31:00Z')), '2728'); // 1 Apr 00:01 IST
    assert.equal(financialYear(new Date('2099-06-01T00:00:00Z')), '9900');
  });
  test('number fits the 16-character GST limit', () => {
    const n = formatInvoiceNumber('INV', '2627', 123);
    assert.equal(n, 'INV/2627/000123');
    assert.ok(n.length <= 16);
  });
});

describe('Invoice totals', () => {
  test('GST on taxable value after discount, exact to the paisa', () => {
    assert.deepEqual(invoiceTotals({ unitPrice: 2999, quantity: 1, discount: 0, taxRatePercent: 18 }),
      { subtotal: '2999.00', discount: '0.00', taxable: '2999.00', tax: '539.82', total: '3538.82', totalMinor: 353882 });
    const t = invoiceTotals({ unitPrice: '1000.10', quantity: 3, discount: 300.3, taxRatePercent: 18 });
    assert.equal(t.subtotal, '3000.30'); assert.equal(t.taxable, '2700.00'); assert.equal(t.tax, '486.00'); assert.equal(t.total, '3186.00');
  });
  test('free plan: full discount gives a ₹0 invoice', () => {
    const t = invoiceTotals({ unitPrice: 2999, discount: 2999, taxRatePercent: 18 });
    assert.equal(t.total, '0.00'); assert.equal(t.tax, '0.00');
  });
  test('discount can never exceed the amount', () => {
    assert.equal(invoiceTotals({ unitPrice: 100, discount: 500, taxRatePercent: 18 }).total, '0.00');
  });
});

describe('GST split', () => {
  test('same state → CGST + SGST, otherwise IGST', () => {
    assert.equal(isInterState({ sellerState: 'Maharashtra', buyerState: 'maharashtra', buyerCountry: 'IN' }), false);
    assert.equal(isInterState({ sellerState: 'Maharashtra', buyerState: 'Bihar', buyerCountry: 'IN' }), true);
    assert.equal(isInterState({ sellerState: 'Maharashtra', buyerState: 'Maharashtra', buyerCountry: 'AE' }), true);
    assert.equal(isInterState({ sellerState: null, buyerState: 'Bihar' }), true);
  });
  test('halves add back to the total even with an odd paisa', () => {
    const l = taxLines({ tax: '539.83', taxRatePercent: 18, interState: false });
    assert.deepEqual(l.map((x) => x.label), ['CGST @ 9%', 'SGST @ 9%']);
    assert.equal((Number(l[0].amount) * 100 + Number(l[1].amount) * 100) / 100, 539.83);
    assert.deepEqual(taxLines({ tax: '539.82', taxRatePercent: 18, interState: true }), [{ label: 'IGST @ 18%', amount: '539.82' }]);
    assert.deepEqual(taxLines({ tax: 0, taxRatePercent: 0, interState: true }), []);
  });
});

describe('Invoice rules', () => {
  test('amount in words (Indian system)', () => {
    assert.equal(amountInWords('3538.82'), 'Rupees Three Thousand Five Hundred Thirty Eight and Eighty Two Paise Only');
    assert.equal(amountInWords(1250000), 'Rupees Twelve Lakh Fifty Thousand Only');
    assert.equal(amountInWords(0), 'Rupees Zero Only');
  });
  test('issued invoices lock amounts; void invoices lock everything', () => {
    assert.ok(!EDITABLE.issued.includes('unitPrice'));
    assert.ok(EDITABLE.issued.includes('billTo'));
    assert.deepEqual(EDITABLE.void, []);
  });
});

test('GSTIN gives the seller state', async () => {
  const { stateFromGstin } = await import('../../src/modules/invoices/invoice.logic.js');
  assert.equal(stateFromGstin('09AAMCD9124D1ZK'), 'Uttar Pradesh');
  assert.equal(stateFromGstin('27ABCDE1234F1Z5'), 'Maharashtra');
  assert.equal(stateFromGstin(''), null);
});
