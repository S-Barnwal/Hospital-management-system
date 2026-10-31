// Super Admin → Invoices. List / view / download (CSV), create manual invoices, edit, issue, void, delete drafts.
// Reading is open to every platform admin; changing anything needs the Super Admin role. Everything is audited.
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requirePlatformAdmin, requireSuperAdmin } from '../../middleware/auth.js';
import { asyncHandler, badRequest, conflict, notFound } from '../../utils/errors.js';
import { db, withTransaction, t } from '../../db/pool.js';
import { idParam } from '../../utils/params.js';
import { parseListQuery, pageMeta } from '../../utils/pagination.js';
import { auditPlatform } from '../../utils/audit.js';
import { optionalEmail, optionalPhone, withLocation } from '../../utils/contact.js';
import { GSTIN_RE } from '../../utils/constants.js';
import { toCsv } from '../clinical/logic.js';
import { createInvoice, loadSeller, nextInvoiceNumber, voidInvoice, backfillMissingInvoices } from './invoice.service.js';
import { EDITABLE, invoiceTotals, isInterState, taxLines, amountInWords } from './invoice.logic.js';

const router = Router();
router.use(requirePlatformAdmin);

const like = (s) => (s ? `%${String(s).replace(/[%_[\]]/g, (m) => `[${m}]`)}%` : null);

/** One shape for the admin screen, the hospital screen and the printable invoice. */
export function serialiseInvoice(r, currentSeller = null) {
  let seller = currentSeller;
  try { if (r.SellerJson) seller = JSON.parse(r.SellerJson); } catch { /* keep current */ }
  const taxable = (Number(r.Subtotal) - Number(r.DiscountAmount)).toFixed(2);
  return {
    id: r.InvoiceId, number: r.InvoiceNumber, status: r.Status, kind: r.Kind, isSandbox: Boolean(r.IsSandbox),
    tenantId: r.TenantId, tenantName: r.TenantName ?? null, tenantSlug: r.TenantSlug ?? null,
    description: r.Description, sacCode: r.SacCode, quantity: r.Quantity,
    unitPrice: r.Quantity ? (Number(r.Subtotal) / r.Quantity).toFixed(2) : r.Subtotal,
    subtotal: r.Subtotal, discount: r.DiscountAmount, taxable, taxRatePercent: Number(r.TaxRatePercent), tax: r.TaxAmount, total: r.Total, currency: r.Currency,
    isInterState: Boolean(r.IsInterState), taxLines: taxLines({ tax: r.TaxAmount, taxRatePercent: r.TaxRatePercent, interState: r.IsInterState }),
    amountInWords: amountInWords(r.Total, r.Currency),
    planName: r.PlanName ?? null, interval: r.BillingInterval, periodStart: r.PeriodStart, periodEnd: r.PeriodEnd,
    billTo: { name: r.BillToName, email: r.BillToEmail, phone: r.BillToPhone, address: r.BillToAddress, city: r.BillToCity, state: r.BillToState, country: r.BillToCountry, gstin: r.BillToGstin },
    seller, paymentMethod: r.PaymentMethod, paymentRef: r.PaymentRef, paymentId: r.PaymentId, notes: r.Notes, dueDate: r.DueDate,
    issuedAt: r.IssuedAt, createdAt: r.CreatedAt, updatedAt: r.UpdatedAt, revision: r.Revision,
    voidReason: r.VoidReason, voidedAt: r.VoidedAt,
  };
}

export const INVOICE_SQL = `
  SELECT i.*, t.Name AS TenantName, t.Slug AS TenantSlug, p.Name AS PlanName
  FROM hms.Invoices i JOIN hms.Tenants t ON t.TenantId = i.TenantId LEFT JOIN hms.Plans p ON p.PlanId = i.PlanId`;

async function loadOne(runner, id, lock = false) {
  const r = await runner.one(`/* tenant-safe: platform admin, by primary key */ ${INVOICE_SQL.replace('FROM hms.Invoices i', `FROM hms.Invoices i${lock ? ' WITH (UPDLOCK)' : ''}`)} WHERE i.InvoiceId = @id`, { id });
  if (!r) throw notFound('Invoice not found.');
  return r;
}

// ---------- List & export ----------
function listFilter(q) {
  return {
    where: `WHERE (@q IS NULL OR i.InvoiceNumber LIKE @q OR t.Name LIKE @q OR i.BillToName LIKE @q OR i.Description LIKE @q)
      AND (@status IS NULL OR i.Status = @status) AND (@kind IS NULL OR i.Kind = @kind) AND (@tenant IS NULL OR i.TenantId = @tenant)
      AND (@sbx IS NULL OR i.IsSandbox = @sbx)
      AND (@from IS NULL OR ISNULL(i.IssuedAt, i.CreatedAt) >= @from) AND (@to IS NULL OR ISNULL(i.IssuedAt, i.CreatedAt) < DATEADD(DAY, 1, @to))`,
    params: {
      q: like(q.q), status: ['draft', 'issued', 'void'].includes(q.status) ? q.status : null, kind: ['subscription', 'free', 'manual'].includes(q.kind) ? q.kind : null,
      tenant: /^\d+$/.test(q.tenantId || '') ? Number(q.tenantId) : null, sbx: q.sandbox === 'true' ? true : q.sandbox === 'false' ? false : null,
      from: /^\d{4}-\d{2}-\d{2}$/.test(q.from || '') ? t.date(new Date(`${q.from}T00:00:00Z`)) : null,
      to: /^\d{4}-\d{2}-\d{2}$/.test(q.to || '') ? t.date(new Date(`${q.to}T00:00:00Z`)) : null,
    },
  };
}

router.get('/', asyncHandler(async (req, res) => {
  const lq = parseListQuery(req.query, { issued: 'ISNULL(i.IssuedAt, i.CreatedAt)', number: 'i.InvoiceNumber', total: 'i.Total', hospital: 't.Name' }, 'issued');
  const { where, params } = listFilter(req.query);
  const [rows, total, sums] = await db.many(`
    /* tenant-safe: platform admin invoice register across hospitals (billing data only, no patient data) */
    ${INVOICE_SQL} ${where} ORDER BY ${lq.orderBy} OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY;
    SELECT COUNT(*) AS total FROM hms.Invoices i JOIN hms.Tenants t ON t.TenantId = i.TenantId ${where};
    SELECT ISNULL(SUM(CASE WHEN i.Status = 'issued' THEN i.Total END), 0) AS issuedTotal,
           ISNULL(SUM(CASE WHEN i.Status = 'issued' THEN i.TaxAmount END), 0) AS taxTotal,
           ISNULL(SUM(CASE WHEN i.Status = 'issued' THEN 1 ELSE 0 END), 0) AS issuedCount,
           ISNULL(SUM(CASE WHEN i.Status = 'draft' THEN 1 ELSE 0 END), 0) AS draftCount,
           ISNULL(SUM(CASE WHEN i.Status = 'void' THEN 1 ELSE 0 END), 0) AS voidCount
    FROM hms.Invoices i JOIN hms.Tenants t ON t.TenantId = i.TenantId ${where};`,
  { ...params, offset: lq.offset, size: lq.pageSize });
  res.json({ data: rows.map((r) => serialiseInvoice(r)), meta: { ...pageMeta(lq, total[0].total), summary: sums[0] } });
}));

router.get('/export.csv', asyncHandler(async (req, res) => {
  const { where, params } = listFilter(req.query);
  const rows = await db.query(`/* tenant-safe: platform admin export */ SELECT TOP 20000 i.*, t.Name AS TenantName, t.Slug AS TenantSlug, p.Name AS PlanName
    FROM hms.Invoices i JOIN hms.Tenants t ON t.TenantId = i.TenantId LEFT JOIN hms.Plans p ON p.PlanId = i.PlanId ${where} ORDER BY ISNULL(i.IssuedAt, i.CreatedAt) DESC`, params);
  await auditPlatform(req, 'admin.invoices_exported', 'invoice', null, { rows: rows.length });
  const cols = [
    { key: 'InvoiceNumber', label: 'Invoice no.' }, { label: 'Date', value: (r) => (r.IssuedAt ? new Date(r.IssuedAt).toISOString().slice(0, 10) : '') },
    { key: 'Status', label: 'Status' }, { key: 'Kind', label: 'Type' }, { key: 'TenantName', label: 'Hospital' }, { key: 'BillToGstin', label: 'Buyer GSTIN' },
    { key: 'BillToState', label: 'Place of supply' }, { key: 'Description', label: 'Description' }, { key: 'SacCode', label: 'SAC' },
    { key: 'Subtotal', label: 'Gross' }, { key: 'DiscountAmount', label: 'Discount' },
    { label: 'Taxable value', value: (r) => (Number(r.Subtotal) - Number(r.DiscountAmount)).toFixed(2) },
    { label: 'IGST', value: (r) => (r.IsInterState ? r.TaxAmount : '0.00') },
    { label: 'CGST', value: (r) => (r.IsInterState ? '0.00' : (Math.floor(Math.round(Number(r.TaxAmount) * 100) / 2) / 100).toFixed(2)) },
    { label: 'SGST', value: (r) => (r.IsInterState ? '0.00' : ((Math.round(Number(r.TaxAmount) * 100) - Math.floor(Math.round(Number(r.TaxAmount) * 100) / 2)) / 100).toFixed(2)) },
    { key: 'Total', label: 'Total' }, { key: 'Currency', label: 'Currency' }, { label: 'Sandbox', value: (r) => (r.IsSandbox ? 'yes' : 'no') },
    { key: 'PaymentRef', label: 'Payment ref.' }, { key: 'VoidReason', label: 'Void reason' },
  ];
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="invoices_${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(`﻿${toCsv(rows, cols)}`);
}));

/** Creates the invoice for any paid payment / free subscription that has none (idempotent). */
router.post('/backfill', requireSuperAdmin, asyncHandler(async (req, res) => {
  const r = await backfillMissingInvoices({ db, withTransaction });
  await auditPlatform(req, 'admin.invoices_backfilled', 'invoice', null, r);
  res.json({ data: r });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const r = await loadOne(db, idParam(req.params.id));
  res.json({ data: serialiseInvoice(r, r.SellerJson ? null : await loadSeller(db)) });
}));

// ---------- Create / edit ----------
const money = z.coerce.number().min(0).max(1e9);
const billToSchema = withLocation(z.object({
  name: z.string().trim().min(2).max(200),
  email: optionalEmail,
  phone: optionalPhone,
  address: z.string().trim().max(300).nullable().optional(),
  gstin: z.string().trim().toUpperCase().regex(GSTIN_RE, 'Enter a valid 15-character GSTIN.').or(z.literal('')).nullable().optional(),
}).strict());

const lineFields = {
  description: z.string().trim().min(3).max(300),
  sacCode: z.string().trim().regex(/^\d{4,8}$/, 'SAC/HSN must be 4–8 digits.').or(z.literal('')).optional(),
  unitPrice: money,
  quantity: z.coerce.number().int().min(1).max(1000).default(1),
  discount: money.default(0),
  taxRatePercent: z.coerce.number().min(0).max(28).default(18),
};
const extraFields = {
  billTo: billToSchema.optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).nullable().optional(),
  paymentMethod: z.string().trim().max(40).nullable().optional(),
  paymentRef: z.string().trim().max(100).nullable().optional(),
};
const createSchema = z.object({ tenantId: z.coerce.number().int().positive(), ...lineFields, ...extraFields, issue: z.boolean().default(false) }).strict()
  .refine((b) => b.discount <= b.unitPrice * b.quantity, { path: ['discount'], message: 'Discount cannot be more than the amount.' });
const editSchema = z.object({
  ...Object.fromEntries(Object.entries(lineFields).map(([k, v]) => [k, v.optional()])),
  ...extraFields,
  refreshSeller: z.literal(true).optional(), // copy the CURRENT Website settings → seller details onto this invoice
  reason: z.string().trim().min(3, 'Say why the invoice is being changed.').max(300),
}).strict();

const cleanBillTo = (b) => (b ? { ...b, gstin: b.gstin || null, address: b.address || null } : undefined);

router.post('/', requireSuperAdmin, validate(createSchema), asyncHandler(async (req, res) => {
  const b = req.body;
  const out = await withTransaction(async (tx) => {
    const tenant = await tx.one('SELECT TenantId FROM hms.Tenants WHERE TenantId = @tid', { tid: b.tenantId });
    if (!tenant) throw badRequest('Choose a hospital.');
    const r = await createInvoice(tx, {
      tenantId: b.tenantId, kind: 'manual', status: b.issue ? 'issued' : 'draft', description: b.description, sacCode: b.sacCode || null,
      unitPrice: b.unitPrice, quantity: b.quantity, discount: b.discount, taxRatePercent: b.taxRatePercent,
      billTo: cleanBillTo(b.billTo), notes: b.notes || null, dueDate: b.dueDate || null, paymentMethod: b.paymentMethod || null, paymentRef: b.paymentRef || null,
      createdBy: req.admin.platformUserId,
    });
    await auditPlatform(req, b.issue ? 'admin.invoice_issued' : 'admin.invoice_drafted', 'invoice', r.invoiceId, { number: r.invoiceNumber, kind: 'manual' }, b.tenantId, tx);
    return r;
  });
  res.status(201).json({ data: { id: out.invoiceId, number: out.invoiceNumber } });
}));

router.put('/:id', requireSuperAdmin, validate(editSchema), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const { reason, ...b } = req.body;
  await withTransaction(async (tx) => {
    const cur = await loadOne(tx, id, true);
    const allowed = EDITABLE[cur.Status];
    const blocked = Object.keys(b).filter((k) => !allowed.includes(k));
    if (blocked.length) {
      throw conflict(cur.Status === 'void'
        ? 'A void invoice cannot be changed.'
        : `An issued invoice's amounts and description are locked (${blocked.join(', ')}). Void it and create a new invoice instead.`, 'INVOICE_LOCKED');
    }
    const seller = (b.refreshSeller || !cur.SellerJson) ? await loadSeller(tx) : JSON.parse(cur.SellerJson);
    const bt = b.billTo ? cleanBillTo(b.billTo) : null;
    const next = {
      description: b.description ?? cur.Description, sacCode: b.sacCode === undefined ? cur.SacCode : (b.sacCode || seller.sac),
      quantity: b.quantity ?? cur.Quantity, unitPrice: b.unitPrice ?? Number(cur.Subtotal) / (cur.Quantity || 1),
      discount: b.discount ?? Number(cur.DiscountAmount), taxRatePercent: b.taxRatePercent ?? Number(cur.TaxRatePercent),
    };
    const totals = cur.Status === 'draft' ? invoiceTotals(next)
      : { subtotal: String(cur.Subtotal), discount: String(cur.DiscountAmount), tax: String(cur.TaxAmount), total: String(cur.Total) };
    if (cur.Status === 'draft' && Number(next.discount) > Number(next.unitPrice) * next.quantity) throw badRequest('Discount cannot be more than the amount.');
    const buyer = bt ?? { name: cur.BillToName, email: cur.BillToEmail, phone: cur.BillToPhone, address: cur.BillToAddress, city: cur.BillToCity, state: cur.BillToState, country: cur.BillToCountry, gstin: cur.BillToGstin };
    await tx.exec(
      `/* tenant-safe: platform admin, by primary key */ UPDATE hms.Invoices SET Description = @desc, SacCode = @sac, Quantity = @qty, Subtotal = @sub, DiscountAmount = @disc,
         TaxRatePercent = @rate, TaxAmount = @tax, Total = @total, IsInterState = @inter,
         BillToName = @bn, BillToEmail = @be, BillToPhone = @bp, BillToAddress = @ba, BillToCity = @bc, BillToState = @bs, BillToCountry = @bco, BillToGstin = @bg,
         Notes = @notes, DueDate = @due, PaymentMethod = @pm, PaymentRef = @pr, SellerJson = CASE WHEN @rs = 1 THEN @seller ELSE SellerJson END,
         Revision = Revision + 1, UpdatedAt = SYSUTCDATETIME()
       WHERE InvoiceId = @id`,
      {
        id, desc: next.description, sac: next.sacCode, qty: next.quantity, sub: t.money(totals.subtotal), disc: t.money(totals.discount),
        rate: t.dec(next.taxRatePercent, 5, 2), tax: t.money(totals.tax), total: t.money(totals.total),
        inter: isInterState({ sellerState: seller.state, buyerState: buyer.state, buyerCountry: buyer.country }),
        bn: buyer.name, be: buyer.email ?? null, bp: buyer.phone ?? null, ba: buyer.address ?? null, bc: buyer.city ?? null, bs: buyer.state ?? null, bco: buyer.country ?? null, bg: buyer.gstin ?? null,
        notes: b.notes === undefined ? cur.Notes : (b.notes || null),
        due: b.dueDate === undefined ? cur.DueDate : (b.dueDate ? t.date(new Date(`${b.dueDate}T00:00:00Z`)) : null),
        rs: Boolean(b.refreshSeller && cur.Status !== 'draft'), seller: JSON.stringify(seller),
        pm: b.paymentMethod === undefined ? cur.PaymentMethod : (b.paymentMethod || null), pr: b.paymentRef === undefined ? cur.PaymentRef : (b.paymentRef || null),
      });
    // Keep what changed (field names + old buyer name/GSTIN/total) so the audit log shows the history.
    await auditPlatform(req, 'admin.invoice_edited', 'invoice', id, {
      number: cur.InvoiceNumber, status: cur.Status, revision: cur.Revision + 1, reason, fields: Object.keys(b).join(','),
      before: { buyer: cur.BillToName, gstin: cur.BillToGstin, state: cur.BillToState, total: cur.Total, ...(b.refreshSeller ? { seller: cur.SellerJson } : {}) },
    }, cur.TenantId, tx);
  });
  res.json({ data: { ok: true } });
}));

router.post('/:id/issue', requireSuperAdmin, asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const number = await withTransaction(async (tx) => {
    const cur = await loadOne(tx, id, true);
    if (cur.Status !== 'draft') throw conflict('Only a draft can be issued.', 'NOT_DRAFT');
    const n = await nextInvoiceNumber(tx, { sandbox: Boolean(cur.IsSandbox) });
    const seller = await loadSeller(tx);
    await tx.exec(`/* tenant-safe: platform admin, by primary key */ UPDATE hms.Invoices SET Status = 'issued', InvoiceNumber = @n, IssuedAt = SYSUTCDATETIME(), SellerJson = @s,
                     IsInterState = @inter, UpdatedAt = SYSUTCDATETIME() WHERE InvoiceId = @id`,
    { id, n, s: JSON.stringify(seller), inter: isInterState({ sellerState: seller.state, buyerState: cur.BillToState, buyerCountry: cur.BillToCountry }) });
    await auditPlatform(req, 'admin.invoice_issued', 'invoice', id, { number: n }, cur.TenantId, tx);
    return n;
  });
  res.json({ data: { number } });
}));

router.post('/:id/void', requireSuperAdmin, validate(z.object({ reason: z.string().trim().min(5, 'Give a reason (at least 5 characters).').max(500) }).strict()),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    await withTransaction(async (tx) => {
      const cur = await loadOne(tx, id, true);
      await voidInvoice(tx, { invoiceId: id, reason: req.body.reason, by: req.admin.platformUserId });
      await auditPlatform(req, 'admin.invoice_voided', 'invoice', id, { number: cur.InvoiceNumber, reason: req.body.reason, total: cur.Total }, cur.TenantId, tx);
    });
    res.json({ data: { ok: true } });
  }));

router.delete('/:id', requireSuperAdmin, asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  await withTransaction(async (tx) => {
    const cur = await loadOne(tx, id, true);
    if (cur.Status !== 'draft') throw conflict('Issued invoices are never deleted. Void it instead (the number stays in the register).', 'NOT_DRAFT');
    await tx.exec('/* tenant-safe: platform admin, by primary key */ DELETE FROM hms.Invoices WHERE InvoiceId = @id AND Status = \'draft\'', { id });
    await auditPlatform(req, 'admin.invoice_draft_deleted', 'invoice', id, { description: cur.Description }, cur.TenantId, tx);
  });
  res.json({ data: { ok: true } });
}));

export default router;
