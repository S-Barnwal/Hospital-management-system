// Platform invoices (MediCore → hospital). Every plan purchase, renewal and free sign-up gets one automatically;
// the Super Admin can also raise manual invoices. All writes run inside the caller's transaction.
import { t } from '../../db/pool.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import { quote } from '../../utils/pricing.js';
import { financialYear, formatInvoiceNumber, invoiceTotals, isInterState, stateFromGstin } from './invoice.logic.js';

const SELLER_KEYS = ['invoice.legal_name', 'invoice.gstin', 'invoice.state', 'invoice.sac', 'invoice.footer',
  'brand.name', 'contact.address', 'contact.email', 'contact.phone'];

/** Platform (seller) details from Website settings — frozen onto each invoice when it is issued. */
export async function loadSeller(runner) {
  const rows = await runner.query(
    `SELECT SettingKey, SettingValue FROM hms.PlatformSettings WHERE SettingKey IN (${SELLER_KEYS.map((_, i) => `@k${i}`).join(', ')})`,
    Object.fromEntries(SELLER_KEYS.map((k, i) => [`k${i}`, k])));
  const s = Object.fromEntries(rows.map((r) => [r.SettingKey, r.SettingValue]));
  return {
    name: s['invoice.legal_name'] || s['brand.name'] || 'MediCore HMS',
    brand: s['brand.name'] || 'MediCore HMS',
    gstin: s['invoice.gstin'] || null,
    state: s['invoice.state'] || stateFromGstin(s['invoice.gstin']) || null, // GSTIN's first two digits give the state
    address: s['contact.address'] || null,
    email: s['contact.email'] || null,
    phone: s['contact.phone'] || null,
    sac: s['invoice.sac'] || '997331',
    footer: s['invoice.footer'] || 'This is a computer-generated invoice and does not require a signature.',
  };
}

/** The hospital's billing details as they are right now (copied onto the invoice). */
export async function loadBillTo(runner, tenantId) {
  const row = await runner.one(
    `SELECT t.Name, t.Email, t.Phone, t.City, t.State, t.Country,
            (SELECT SettingValue FROM hms.TenantSettings s WHERE s.TenantId = t.TenantId AND s.SettingKey = 'hospital.address') AS Address,
            (SELECT SettingValue FROM hms.TenantSettings s WHERE s.TenantId = t.TenantId AND s.SettingKey = 'gst.gstin') AS Gstin
     FROM hms.Tenants t WHERE t.TenantId = @tid`, { tid: tenantId });
  if (!row) throw notFound('Hospital not found.');
  return { name: row.Name, email: row.Email, phone: row.Phone, address: row.Address, city: row.City, state: row.State, country: row.Country, gstin: row.Gstin };
}

/** Next number in the financial-year series, under a row lock (no gaps from races, no duplicates). */
export async function nextInvoiceNumber(tx, { sandbox = false, at = new Date() } = {}) {
  const series = sandbox ? 'SBX' : 'INV';
  const fy = financialYear(at);
  const key = `${series}/${fy}`;
  const row = await tx.one(
    `MERGE hms.PlatformSequences WITH (HOLDLOCK) AS tgt USING (SELECT @k AS SequenceKey) AS src ON tgt.SequenceKey = src.SequenceKey
     WHEN MATCHED THEN UPDATE SET NextValue = tgt.NextValue + 1
     WHEN NOT MATCHED THEN INSERT (SequenceKey, NextValue) VALUES (@k, 2)
     OUTPUT INSERTED.NextValue - 1 AS n;`, { k: key });
  return formatInvoiceNumber(series, fy, row.n);
}

/**
 * Creates an invoice. status 'issued' gives it a number and freezes seller/buyer details; 'draft' does not.
 * `fixed` = { subtotal, tax, total } for invoices that must match money already received through the gateway.
 */
export async function createInvoice(tx, inv) {
  const seller = await loadSeller(tx);
  const billTo = { ...(await loadBillTo(tx, inv.tenantId)), ...(inv.billTo || {}) };
  const taxRate = Number(inv.taxRatePercent ?? 0);
  const totals = inv.fixed
    ? { subtotal: String(inv.fixed.subtotal), discount: String(inv.fixed.discount ?? '0.00'), tax: String(inv.fixed.tax), total: String(inv.fixed.total) }
    : invoiceTotals({ unitPrice: inv.unitPrice, quantity: inv.quantity ?? 1, discount: inv.discount ?? 0, taxRatePercent: taxRate });
  const issue = (inv.status ?? 'issued') === 'issued';
  const number = issue ? await nextInvoiceNumber(tx, { sandbox: Boolean(inv.isSandbox) }) : null;
  const row = await tx.one(
    `INSERT INTO hms.Invoices (TenantId, PaymentId, InvoiceNumber, Description, Subtotal, TaxAmount, Total, Currency, IsSandbox, IssuedAt,
        Kind, Status, SubscriptionId, PlanId, BillingInterval, PeriodStart, PeriodEnd, SacCode, Quantity, DiscountAmount, TaxRatePercent, IsInterState,
        BillToName, BillToEmail, BillToPhone, BillToAddress, BillToCity, BillToState, BillToCountry, BillToGstin, SellerJson,
        PaymentMethod, PaymentRef, Notes, DueDate, CreatedBy)
     OUTPUT INSERTED.InvoiceId
     VALUES (@tid, @pay, @num, @desc, @sub, @tax, @total, @cur, @sbx, ${issue ? 'SYSUTCDATETIME()' : 'NULL'},
        @kind, @status, @subId, @plan, @interval, @ps, @pe, @sac, @qty, @disc, @rate, @inter,
        @bn, @be, @bp, @ba, @bc, @bs, @bco, @bg, @seller, @pm, @pr, @notes, @due, @by)`,
    {
      tid: inv.tenantId, pay: inv.paymentId ?? null, num: number, desc: inv.description, sub: t.money(totals.subtotal), tax: t.money(totals.tax),
      total: t.money(totals.total), cur: inv.currency || 'INR', sbx: Boolean(inv.isSandbox), kind: inv.kind, status: issue ? 'issued' : 'draft',
      subId: inv.subscriptionId ?? null, plan: inv.planId ?? null, interval: inv.interval ?? null, ps: inv.periodStart ?? null, pe: inv.periodEnd ?? null,
      sac: inv.sacCode || seller.sac, qty: inv.quantity ?? 1, disc: t.money(totals.discount), rate: t.dec(taxRate, 5, 2),
      inter: isInterState({ sellerState: seller.state, buyerState: billTo.state, buyerCountry: billTo.country }),
      bn: billTo.name, be: billTo.email ?? null, bp: billTo.phone ?? null, ba: billTo.address ?? null, bc: billTo.city ?? null, bs: billTo.state ?? null,
      bco: billTo.country ?? null, bg: billTo.gstin ?? null, seller: issue ? JSON.stringify(seller) : null,
      pm: inv.paymentMethod ?? null, pr: inv.paymentRef ?? null, notes: inv.notes ?? null, due: inv.dueDate ? t.date(new Date(`${inv.dueDate}T00:00:00Z`)) : null,
      by: inv.createdBy ?? null,
    });
  return { invoiceId: row.InvoiceId, invoiceNumber: number };
}

/** Automatic invoice for a verified gateway payment (amounts exactly as charged). */
export async function invoiceForPayment(tx, { tenantId, payment, description, subscriptionId, planId, interval, periodStart, periodEnd }) {
  const discount = Number(payment.discount ?? 0);
  const taxable = Number(payment.subtotal) - discount;
  return createInvoice(tx, {
    tenantId, kind: 'subscription', paymentId: payment.paymentId, isSandbox: payment.isSandbox, currency: payment.currency,
    description, subscriptionId, planId, interval, periodStart, periodEnd,
    taxRatePercent: taxable > 0 ? Math.round((Number(payment.tax) / taxable) * 10000) / 100 : 0,
    fixed: { subtotal: payment.subtotal, discount: discount.toFixed(2), tax: payment.tax, total: payment.total },
    notes: payment.couponCode ? `Coupon ${payment.couponCode} applied.` : undefined,
    paymentMethod: payment.isSandbox ? 'Sandbox (test)' : 'Online (Razorpay)', paymentRef: payment.providerPaymentId ?? null,
  });
}

/** ₹0 invoice for a free sign-up / free extension: list price shown, 100% promotional discount. */
export async function invoiceForFree(tx, { tenantId, plan, interval, subscriptionId, periodStart, periodEnd, renewal = false }) {
  let listPrice = 0;
  try { listPrice = Number(quote(plan, interval).subtotal); } catch { listPrice = 0; }
  return createInvoice(tx, {
    tenantId, kind: 'free', currency: plan.Currency || 'INR',
    description: `${plan.Name} plan — ${interval}${renewal ? ' (extension)' : ''} · free promotional offer`,
    subscriptionId, planId: plan.PlanId, interval, periodStart, periodEnd,
    unitPrice: listPrice, discount: listPrice, taxRatePercent: Number(plan.TaxRatePercent ?? 0),
    paymentMethod: 'Not applicable (free)', notes: 'Free while the promotional offer lasts. No payment is due.',
  });
}

/** Issued → void (never deleted). */
export async function voidInvoice(tx, { invoiceId, reason, by }) {
  const inv = await tx.one('/* tenant-safe: platform admin, by primary key */ SELECT Status FROM hms.Invoices WITH (UPDLOCK) WHERE InvoiceId = @id', { id: invoiceId });
  if (!inv) throw notFound('Invoice not found.');
  if (inv.Status === 'void') throw conflict('This invoice is already void.', 'ALREADY_VOID');
  if (inv.Status === 'draft') throw badRequest('Drafts are deleted, not voided.');
  await tx.exec(`/* tenant-safe: platform admin, by primary key */ UPDATE hms.Invoices SET Status = 'void', VoidReason = @r, VoidedAt = SYSUTCDATETIME(), VoidedBy = @by,
                   Revision = Revision + 1, UpdatedAt = SYSUTCDATETIME() WHERE InvoiceId = @id`, { id: invoiceId, r: reason, by });
}

/**
 * Safety net: creates the invoice for any paid payment or free subscription that has none
 * (e.g. hospitals that signed up before invoices existed, or before the server was updated).
 * Idempotent — each payment / free subscription gets at most one invoice. Runs on server start and from
 * Super Admin → Invoices → "Create missing invoices".
 */
export async function backfillMissingInvoices({ db, withTransaction }) {
  if (!(await db.one(`/* tenant-safe: schema check only */ SELECT CASE WHEN COL_LENGTH('hms.Invoices', 'Kind') IS NULL THEN 0 ELSE 1 END AS ok`)).ok) return { created: 0, skipped: 'migration 010 not applied' };
  let created = 0;
  const payments = await db.query(`/* tenant-safe: platform job over all hospitals' subscription payments */
    SELECT TOP 500 p.PaymentId, p.TenantId, p.SubscriptionId, p.PlanId, p.BillingInterval, p.Purpose, p.Subtotal, p.TaxAmount, p.Amount, p.Currency, p.IsSandbox,
           p.ProviderPaymentId, pl.Name AS PlanName, s.CurrentPeriodStart, s.CurrentPeriodEnd
    FROM hms.Payments p LEFT JOIN hms.Plans pl ON pl.PlanId = p.PlanId LEFT JOIN hms.Subscriptions s ON s.SubscriptionId = p.SubscriptionId AND s.TenantId = p.TenantId
    WHERE p.Status = 'paid' AND p.TenantId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM hms.Invoices i WHERE i.PaymentId = p.PaymentId)`);
  for (const p of payments) {
    await withTransaction(async (tx) => {
      const again = await tx.one('/* tenant-safe: by payment id */ SELECT 1 AS x FROM hms.Invoices WITH (UPDLOCK, HOLDLOCK) WHERE PaymentId = @id', { id: p.PaymentId });
      if (again) return;
      await invoiceForPayment(tx, {
        tenantId: p.TenantId, description: `${p.PlanName ?? 'Subscription'} ${p.Purpose === 'renewal' ? 'renewal' : 'plan'} — ${p.BillingInterval ?? ''}`.trim(),
        payment: { paymentId: p.PaymentId, subtotal: p.Subtotal, tax: p.TaxAmount, total: p.Amount, currency: p.Currency, isSandbox: p.IsSandbox, providerPaymentId: p.ProviderPaymentId },
        subscriptionId: p.SubscriptionId, planId: p.PlanId, interval: p.BillingInterval, periodStart: p.CurrentPeriodStart, periodEnd: p.CurrentPeriodEnd,
      });
      created += 1;
    });
  }
  const free = await db.query(`/* tenant-safe: platform job over all hospitals' free subscriptions */
    SELECT TOP 500 s.SubscriptionId, s.TenantId, s.BillingInterval, s.CurrentPeriodStart, s.CurrentPeriodEnd, pl.*
    FROM hms.Subscriptions s JOIN hms.Plans pl ON pl.PlanId = s.PlanId
    WHERE s.IsFree = 1 AND NOT EXISTS (SELECT 1 FROM hms.Invoices i WHERE i.TenantId = s.TenantId AND i.SubscriptionId = s.SubscriptionId)`);
  for (const s of free) {
    await withTransaction(async (tx) => {
      const again = await tx.one('SELECT 1 AS x FROM hms.Invoices WITH (UPDLOCK, HOLDLOCK) WHERE TenantId = @tid AND SubscriptionId = @sid', { tid: s.TenantId, sid: s.SubscriptionId });
      if (again) return;
      await invoiceForFree(tx, { tenantId: s.TenantId, plan: s, interval: s.BillingInterval, subscriptionId: s.SubscriptionId, periodStart: s.CurrentPeriodStart, periodEnd: s.CurrentPeriodEnd });
      created += 1;
    });
  }
  return { created };
}
