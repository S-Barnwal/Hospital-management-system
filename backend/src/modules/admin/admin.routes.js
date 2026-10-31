// Platform Super Admin API. Every route requires a platform session (separate from hospital users).
// Cross-tenant reads are limited to platform metadata (tenants, subscriptions, payments, usage counts):
// the admin API intentionally exposes NO patient or clinical data.
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requirePlatformAdmin, requireSuperAdmin } from '../../middleware/auth.js';
import { asyncHandler, notFound, badRequest } from '../../utils/errors.js';
import { db, withTransaction, t, sql } from '../../db/pool.js';
import { idParam, dateParam } from '../../utils/params.js';
import { parseListQuery, pageMeta } from '../../utils/pagination.js';
import { auditPlatform } from '../../utils/audit.js';
import { serialisePlan } from '../public/public.routes.js';
import { setPlansFree } from '../onboarding/onboarding.service.js';
import { isValidEmail, parsePhone } from '../../utils/contact.js';
import { GSTIN_RE } from '../../utils/constants.js';
import { stateFromGstin } from '../invoices/invoice.logic.js';
import platformRoutes from './platform.routes.js';

const router = Router();
router.use(requirePlatformAdmin);

const like = (s) => (s ? `%${String(s).replace(/[%_[\]]/g, (m) => `[${m}]`)}%` : null);

router.get('/overview', asyncHandler(async (_req, res) => {
  const [counts, recentTenants, expiring] = await db.many(`
    SELECT
      (SELECT COUNT(*) FROM hms.Tenants WHERE Status = 'active') AS activeTenants,
      (SELECT COUNT(*) FROM hms.Tenants WHERE Status = 'suspended') AS suspendedTenants,
      (SELECT COUNT(*) FROM hms.DemoRequests WHERE Status = 'new') AS newDemoRequests,
      (SELECT COUNT(*) FROM hms.ContactMessages WHERE Status = 'new') AS newContactMessages,
      (SELECT COUNT(*) FROM hms.Payments WHERE Status = 'paid' AND IsSandbox = 0
         AND PaidAt >= DATEFROMPARTS(YEAR(SYSUTCDATETIME()), MONTH(SYSUTCDATETIME()), 1)) AS paidThisMonth,
      (SELECT ISNULL(SUM(Amount), 0) FROM hms.Payments WHERE Status = 'paid' AND IsSandbox = 0
         AND PaidAt >= DATEFROMPARTS(YEAR(SYSUTCDATETIME()), MONTH(SYSUTCDATETIME()), 1)) AS collectedThisMonth,
      (SELECT COUNT(*) FROM hms.Payments WHERE Status = 'paid' AND IsSandbox = 1) AS sandboxPayments;
    SELECT TOP 5 TenantId, Slug, Name, Status, CreatedAt FROM hms.Tenants ORDER BY CreatedAt DESC;
    SELECT TOP 10 t.TenantId, t.Name, t.Slug, s.CurrentPeriodEnd, s.Status
      FROM hms.Subscriptions s JOIN hms.Tenants t ON t.TenantId = s.TenantId
      WHERE s.CurrentPeriodEnd < DATEADD(DAY, 14, SYSUTCDATETIME()) AND s.Status IN ('active','past_due')
      ORDER BY s.CurrentPeriodEnd;`);
  res.json({ data: { counts: counts[0], recentTenants, expiring, note: 'Revenue excludes sandbox payments.' } });
}));

// ---------- Tenants ----------
router.get('/tenants', asyncHandler(async (req, res) => {
  const lq = parseListQuery(req.query, { created: 't.CreatedAt', name: 't.Name', status: 't.Status' }, 'created');
  const params = { q: like(req.query.q), status: req.query.status || null, offset: lq.offset, size: lq.pageSize };
  const where = `WHERE (@q IS NULL OR t.Name LIKE @q OR t.Slug LIKE @q OR t.Email LIKE @q) AND (@status IS NULL OR t.Status = @status)`;
  const [rows, total] = await db.many(`
    SELECT t.TenantId, t.Slug, t.Name, t.Email, t.City, t.FacilityType, t.Status, t.CreatedAt,
           sub.PlanName, sub.Status AS SubStatus, sub.CurrentPeriodEnd
    FROM hms.Tenants t
    OUTER APPLY (SELECT TOP 1 p.Name AS PlanName, s.Status, s.CurrentPeriodEnd FROM hms.Subscriptions s
                 JOIN hms.Plans p ON p.PlanId = s.PlanId WHERE s.TenantId = t.TenantId ORDER BY s.CurrentPeriodEnd DESC) sub
    ${where} ORDER BY ${lq.orderBy} OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY;
    SELECT COUNT(*) AS total FROM hms.Tenants t ${where};`, params);
  res.json({ data: rows, meta: pageMeta(lq, total[0].total) });
}));

router.get('/tenants/:id', asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const [tenant, subs, payments, usage, owners] = await db.many(`
    SELECT TenantId, Slug, Name, Email, Phone, City, State, Country, PostalCode, Latitude, Longitude, FacilityType, Status, Timezone, Currency, SuspendedReason, CreatedAt, GroupId, BranchName FROM hms.Tenants WHERE TenantId = @id;
    SELECT s.SubscriptionId, p.Name AS PlanName, s.BillingInterval, s.Status, s.CurrentPeriodStart, s.CurrentPeriodEnd, s.GraceDays, s.IsFree, s.IsTrial
      FROM hms.Subscriptions s JOIN hms.Plans p ON p.PlanId = s.PlanId WHERE s.TenantId = @id ORDER BY s.CurrentPeriodEnd DESC;
    SELECT p.PaymentId, p.Purpose, p.Provider, p.IsSandbox, p.Amount, p.Currency, p.Status, p.PaidAt, p.CreatedAt, i.InvoiceNumber
      FROM hms.Payments p LEFT JOIN hms.Invoices i ON i.PaymentId = p.PaymentId WHERE p.TenantId = @id ORDER BY p.CreatedAt DESC;
    SELECT (SELECT COUNT(*) FROM hms.Users WHERE TenantId = @id AND Status = 'active') AS activeUsers,
           (SELECT COUNT(*) FROM hms.Patients WHERE TenantId = @id AND IsArchived = 0) AS patients,
           (SELECT COUNT(*) FROM hms.StaffMembers WHERE TenantId = @id AND IsActive = 1) AS staff,
           (SELECT COUNT(*) FROM hms.Appointments WHERE TenantId = @id) AS appointments;
    SELECT FullName, Email FROM hms.Users WHERE TenantId = @id AND IsOwner = 1;`, { id });
  if (!tenant[0]) throw notFound('Tenant not found.');
  await auditPlatform(req, 'admin.tenant_viewed', 'tenant', id, null, id);
  res.json({ data: { ...tenant[0], subscriptions: subs, payments, usage: usage[0], owners } });
}));

router.post('/tenants/:id/status', requireSuperAdmin,
  validate(z.object({ status: z.enum(['active', 'suspended', 'deactivated']), reason: z.string().trim().min(3).max(500) }).strict()),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    await withTransaction(async (tx) => {
      const n = await tx.exec(
        `UPDATE hms.Tenants SET Status = @status, SuspendedReason = CASE WHEN @status = 'active' THEN NULL ELSE @reason END, UpdatedAt = SYSUTCDATETIME()
         WHERE TenantId = @id AND Status <> 'pending'`, { id, status: req.body.status, reason: req.body.reason });
      if (!n) throw notFound('Tenant not found or still pending.');
      if (req.body.status !== 'active') {
        // Sign everyone out of a suspended/deactivated tenant immediately.
        await tx.exec(`UPDATE hms.UserSessions SET RevokedAt = SYSUTCDATETIME() WHERE TenantId = @id AND RevokedAt IS NULL`, { id });
      }
      await auditPlatform(req, `admin.tenant_${req.body.status}`, 'tenant', id, { reason: req.body.reason }, id, tx);
    });
    res.json({ data: { ok: true } });
  }));

// ---------- Hospital map (business location only) ----------
router.get('/hospital-locations', asyncHandler(async (_req, res) => {
  const rows = await db.query(`/* tenant-safe: platform admin map across hospitals (name/address only, no patient data) */
    SELECT t.TenantId, t.Name, t.Slug, t.Status, t.City, t.State, t.Country, t.PostalCode, t.Latitude, t.Longitude, t.LocationUpdatedAt, t.FacilityType,
           sub.PlanName,
           (SELECT SettingValue FROM hms.TenantSettings s WHERE s.TenantId = t.TenantId AND s.SettingKey = 'hospital.address') AS Address
    FROM hms.Tenants t
    OUTER APPLY (SELECT TOP 1 p.Name AS PlanName FROM hms.Subscriptions s JOIN hms.Plans p ON p.PlanId = s.PlanId
                 WHERE s.TenantId = t.TenantId ORDER BY s.CurrentPeriodEnd DESC) sub
    WHERE t.Status <> 'pending'
    ORDER BY t.Name`);
  res.json({ data: rows.map((r) => ({ ...r, Latitude: r.Latitude === null ? null : Number(r.Latitude), Longitude: r.Longitude === null ? null : Number(r.Longitude) })) });
}));

// ---------- Plans ----------
router.get('/plans', asyncHandler(async (_req, res) => {
  const [plans, features, freeCounts] = await db.many(`
    SELECT * FROM hms.Plans ORDER BY SortOrder, PlanId;
    SELECT PlanId, FeatureKey, Label, IsIncluded FROM hms.PlanFeatures ORDER BY SortOrder;
    /* tenant-safe: platform admin count across hospitals, no hospital data */
    SELECT PlanId, COUNT(*) AS n FROM hms.Subscriptions WHERE IsFree = 1 AND Status IN ('active','past_due') GROUP BY PlanId;`);
  const freeBy = new Map(freeCounts.map((r) => [r.PlanId, r.n]));
  res.json({ data: plans.map((p) => ({ ...serialisePlan(p, features), id: p.PlanId, isActive: Boolean(p.IsActive), sortOrder: p.SortOrder,
    monthlyPrice: p.MonthlyPrice, annualPrice: p.AnnualPrice, freeSince: p.FreeSince, trialDays: Number(p.TrialDays || 0),
    freeHospitals: freeBy.get(p.PlanId) ?? 0 })) });
}));

/**
 * "Free for now" switch. planId omitted = every priced plan at once.
 * free=false starts charging: hospitals on free subscriptions get `noticeDays` (default 7) and are then asked to renew.
 */
router.post('/plans/free-mode', requireSuperAdmin,
  validate(z.object({
    free: z.boolean(),
    planId: z.coerce.number().int().positive().optional(),
    noticeDays: z.coerce.number().int().min(0).max(90).default(7),
  }).strict()),
  asyncHandler(async (req, res) => {
    const { free, planId, noticeDays } = req.body;
    const result = await withTransaction(async (tx) => {
      const ids = planId ? [planId]
        : (await tx.query('SELECT PlanId FROM hms.Plans WHERE IsContactSales = 0')).map((r) => r.PlanId);
      const r = await setPlansFree(tx, { planIds: ids, free, noticeDays });
      await auditPlatform(req, free ? 'admin.plans_made_free' : 'admin.plans_charging_started', 'plan', planId ?? null,
        { plans: r.changed, noticeDays: free ? null : noticeDays, hospitalsMovedToPaid: r.movedToPaid }, null, tx);
      return r;
    });
    res.json({ data: result });
  }));

const money = z.union([z.number(), z.string()]).transform((v) => Number(v)).refine((v) => Number.isFinite(v) && v >= 0 && v < 1e10, 'Invalid amount')
  .transform((v) => v.toFixed(2));
const planSchema = z.object({
  name: z.string().trim().min(2).max(100),
  tagline: z.string().trim().max(200).nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  monthlyPrice: money.nullable(),
  annualPrice: money.nullable(),
  taxRatePercent: z.coerce.number().min(0).max(100),
  maxStaffUsers: z.coerce.number().int().positive().nullable(),
  maxBranches: z.coerce.number().int().positive().nullable(),
  contactSales: z.boolean(),
  popular: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.coerce.number().int().min(0).max(1000),
  trialDays: z.coerce.number().int().min(0).max(90).default(0),
  features: z.array(z.object({ key: z.string().regex(/^[a-z_]{2,60}$/), label: z.string().trim().min(2).max(200), included: z.boolean() }).strict()).max(50),
}).strict().refine((p) => p.contactSales || (p.monthlyPrice !== null && p.annualPrice !== null), 'Prices are required unless the plan is contact-sales.');

async function savePlan(tx, planId, b) {
  await tx.exec(
    `UPDATE hms.Plans SET Name = @name, Tagline = @tag, Description = @desc, MonthlyPrice = @mp, AnnualPrice = @ap, TaxRatePercent = @tax,
       MaxStaffUsers = @staff, MaxBranches = @branches, IsContactSales = @cs, IsPopular = @pop, IsActive = @active, SortOrder = @sort, TrialDays = @trial, UpdatedAt = SYSUTCDATETIME()
     WHERE PlanId = @id`,
    { id: planId, name: b.name, tag: b.tagline ?? null, desc: b.description ?? null, mp: t.money(b.monthlyPrice), ap: t.money(b.annualPrice),
      tax: { type: sql.Decimal(5, 2), value: b.taxRatePercent }, staff: b.maxStaffUsers, branches: b.maxBranches,
      cs: b.contactSales, pop: b.popular, active: b.isActive, sort: b.sortOrder, trial: b.trialDays ?? 0 });
  await tx.exec('DELETE FROM hms.PlanFeatures WHERE PlanId = @id', { id: planId });
  let i = 0;
  for (const f of b.features) {
    await tx.exec('INSERT INTO hms.PlanFeatures (PlanId, FeatureKey, Label, IsIncluded, SortOrder) VALUES (@id, @k, @l, @inc, @s)',
      { id: planId, k: f.key, l: f.label, inc: f.included, s: (i += 1) });
  }
}

router.put('/plans/:id', requireSuperAdmin, validate(planSchema), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  await withTransaction(async (tx) => {
    const exists = await tx.one('SELECT PlanId FROM hms.Plans WHERE PlanId = @id', { id });
    if (!exists) throw notFound('Plan not found.');
    await savePlan(tx, id, req.body);
    await auditPlatform(req, 'admin.plan_updated', 'plan', id, { name: req.body.name, monthly: req.body.monthlyPrice, annual: req.body.annualPrice }, null, tx);
  });
  res.json({ data: { ok: true } });
}));

router.post('/plans', requireSuperAdmin,
  validate(z.object({ code: z.string().regex(/^[a-z0-9_-]{2,50}$/) }).passthrough()),
  asyncHandler(async (req, res) => {
    const { code, ...rest } = req.body;
    const parsed = planSchema.safeParse(rest);
    if (!parsed.success) throw badRequest('Validation failed.', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    const id = await withTransaction(async (tx) => {
      const row = await tx.one(`INSERT INTO hms.Plans (Code, Name, IsContactSales) OUTPUT INSERTED.PlanId VALUES (@code, @name, 1)`, { code, name: parsed.data.name });
      await savePlan(tx, row.PlanId, parsed.data);
      await auditPlatform(req, 'admin.plan_created', 'plan', row.PlanId, { code }, null, tx);
      return row.PlanId;
    });
    res.status(201).json({ data: { id } });
  }));

// ---------- Subscriptions & payments ----------
router.get('/subscriptions', asyncHandler(async (req, res) => {
  const lq = parseListQuery(req.query, { end: 's.CurrentPeriodEnd', created: 's.CreatedAt' }, 'end');
  const params = { status: req.query.status || null, offset: lq.offset, size: lq.pageSize };
  const [rows, total] = await db.many(`
    SELECT s.SubscriptionId, t.TenantId, t.Name AS TenantName, t.Slug, p.Name AS PlanName, s.BillingInterval, s.Status, s.CurrentPeriodStart, s.CurrentPeriodEnd, s.GraceDays
    FROM hms.Subscriptions s JOIN hms.Tenants t ON t.TenantId = s.TenantId JOIN hms.Plans p ON p.PlanId = s.PlanId
    WHERE (@status IS NULL OR s.Status = @status)
    ORDER BY ${lq.orderBy} OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY;
    SELECT COUNT(*) AS total FROM hms.Subscriptions s WHERE (@status IS NULL OR s.Status = @status);`, params);
  res.json({ data: rows, meta: pageMeta(lq, total[0].total) });
}));

router.get('/payments', asyncHandler(async (req, res) => {
  const lq = parseListQuery(req.query, { created: 'p.CreatedAt', amount: 'p.Amount' }, 'created');
  const params = { status: req.query.status || null, offset: lq.offset, size: lq.pageSize };
  const [rows, total] = await db.many(`
    SELECT p.PaymentId, p.Purpose, p.Provider, p.IsSandbox, p.ProviderOrderId, p.ProviderPaymentId, p.Amount, p.Currency, p.Status, p.FailureReason,
           p.CreatedAt, p.PaidAt, t.Name AS TenantName, t.Slug, o.OrgName AS OnboardingOrg, i.InvoiceNumber
    FROM hms.Payments p
    LEFT JOIN hms.Tenants t ON t.TenantId = p.TenantId
    LEFT JOIN hms.OnboardingRequests o ON o.OnboardingId = p.OnboardingId
    LEFT JOIN hms.Invoices i ON i.PaymentId = p.PaymentId
    WHERE (@status IS NULL OR p.Status = @status)
    ORDER BY ${lq.orderBy} OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY;
    SELECT COUNT(*) AS total FROM hms.Payments p WHERE (@status IS NULL OR p.Status = @status);`, params);
  res.json({ data: rows, meta: pageMeta(lq, total[0].total) });
}));

// ---------- Demo requests ----------
router.get('/demo-requests', asyncHandler(async (req, res) => {
  const lq = parseListQuery(req.query, { created: 'd.CreatedAt', preferred: 'd.PreferredAt' }, 'created');
  const params = { status: req.query.status || null, q: like(req.query.q), offset: lq.offset, size: lq.pageSize };
  const where = `WHERE (@status IS NULL OR d.Status = @status) AND (@q IS NULL OR d.OrgName LIKE @q OR d.ContactName LIKE @q OR d.Email LIKE @q OR d.City LIKE @q)`;
  const [rows, total] = await db.many(`
    SELECT d.*, pu.FullName AS AssignedToName FROM hms.DemoRequests d LEFT JOIN hms.PlatformUsers pu ON pu.PlatformUserId = d.AssignedTo
    ${where} ORDER BY ${lq.orderBy} OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY;
    SELECT COUNT(*) AS total FROM hms.DemoRequests d ${where};`, params);
  res.json({ data: rows.map(({ SourceIp, ...r }) => r), meta: pageMeta(lq, total[0].total) });
}));

router.get('/demo-requests/:id', asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const [rows, notes, admins] = await db.many(`
    SELECT d.*, pu.FullName AS AssignedToName FROM hms.DemoRequests d LEFT JOIN hms.PlatformUsers pu ON pu.PlatformUserId = d.AssignedTo WHERE d.DemoRequestId = @id;
    SELECT n.NoteId, n.Note, n.CreatedAt, pu.FullName AS Author FROM hms.DemoRequestNotes n JOIN hms.PlatformUsers pu ON pu.PlatformUserId = n.PlatformUserId
      WHERE n.DemoRequestId = @id ORDER BY n.CreatedAt DESC;
    SELECT PlatformUserId, FullName FROM hms.PlatformUsers WHERE Status = 'active' ORDER BY FullName;`, { id });
  if (!rows[0]) throw notFound('Demo request not found.');
  const { SourceIp, ...demo } = rows[0];
  res.json({ data: { ...demo, notes, assignees: admins } });
}));

router.patch('/demo-requests/:id',
  validate(z.object({
    status: z.enum(['new', 'contacted', 'scheduled', 'completed', 'closed']).optional(),
    assignedTo: z.coerce.number().int().positive().nullable().optional(),
    note: z.string().trim().min(1).max(2000).optional(),
  }).strict()),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    await withTransaction(async (tx) => {
      const n = await tx.exec(
        `UPDATE hms.DemoRequests SET Status = COALESCE(@status, Status),
           AssignedTo = CASE WHEN @setAssignee = 1 THEN @assignee ELSE AssignedTo END, UpdatedAt = SYSUTCDATETIME()
         WHERE DemoRequestId = @id`,
        { id, status: req.body.status ?? null, setAssignee: 'assignedTo' in req.body, assignee: req.body.assignedTo ?? null });
      if (!n) throw notFound('Demo request not found.');
      if (req.body.note) {
        await tx.exec('INSERT INTO hms.DemoRequestNotes (DemoRequestId, PlatformUserId, Note) VALUES (@id, @uid, @note)',
          { id, uid: req.admin.platformUserId, note: req.body.note });
      }
      await auditPlatform(req, 'admin.demo_request_updated', 'demo_request', id, { status: req.body.status, assignedTo: req.body.assignedTo }, null, tx);
    });
    res.json({ data: { ok: true } });
  }));

router.delete('/demo-requests/:id', requireSuperAdmin, asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const n = await db.exec('DELETE FROM hms.DemoRequests WHERE DemoRequestId = @id', { id });
  if (!n) throw notFound('Demo request not found.');
  await auditPlatform(req, 'admin.demo_request_deleted', 'demo_request', id);
  res.json({ data: { ok: true } });
}));

router.delete('/plans/:id', requireSuperAdmin, asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const used = await db.one(`/* tenant-safe: platform admin view across hospitals */ SELECT (SELECT COUNT(*) FROM hms.Subscriptions WHERE PlanId = @id) + (SELECT COUNT(*) FROM hms.Payments WHERE PlanId = @id)
                                  + (SELECT COUNT(*) FROM hms.OnboardingRequests WHERE PlanId = @id) AS n`, { id });
  if (used.n) return res.status(409).json({ error: { code: 'IN_USE', message: 'Hospitals have bought this plan. Hide it (set inactive) instead of deleting.' } });
  await withTransaction(async (tx) => {
    await tx.exec('DELETE FROM hms.PlanFeatures WHERE PlanId = @id', { id });
    const n = await tx.exec('DELETE FROM hms.Plans WHERE PlanId = @id', { id });
    if (!n) throw notFound('Plan not found.');
    await auditPlatform(req, 'admin.plan_deleted', 'plan', id, null, null, tx);
  });
  return res.json({ data: { ok: true } });
}));

router.get('/contact-messages', asyncHandler(async (req, res) => {
  const lq = parseListQuery(req.query, { created: 'CreatedAt' }, 'created');
  const [rows, total] = await db.many(`
    SELECT ContactMessageId, Name, Email, Phone, Subject, Message, Status, CreatedAt FROM hms.ContactMessages
    ORDER BY ${lq.orderBy} OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY;
    SELECT COUNT(*) AS total FROM hms.ContactMessages;`, { offset: lq.offset, size: lq.pageSize });
  res.json({ data: rows, meta: pageMeta(lq, total[0].total) });
}));

// ---------- Audit logs ----------
router.get('/audit-logs', asyncHandler(async (req, res) => {
  const lq = parseListQuery(req.query, { created: 'a.CreatedAt' }, 'created');
  const params = {
    tenantId: req.query.tenantId ? idParam(req.query.tenantId, 'tenantId') : null,
    action: like(req.query.action), actorType: req.query.actorType || null,
    from: dateParam(req.query.from, 'from'), to: dateParam(req.query.to, 'to'),
    offset: lq.offset, size: lq.pageSize,
  };
  const where = `WHERE (@tenantId IS NULL OR a.TenantId = @tenantId) AND (@action IS NULL OR a.Action LIKE @action)
                 AND (@actorType IS NULL OR a.ActorType = @actorType) AND (@from IS NULL OR a.CreatedAt >= @from) AND (@to IS NULL OR a.CreatedAt < @to)`;
  const [rows, total] = await db.many(`
    SELECT a.AuditLogId, a.TenantId, t.Name AS TenantName, a.ActorType, a.ActorId, a.Action, a.EntityType, a.EntityId, a.Metadata, a.IpAddress, a.CreatedAt
    FROM hms.AuditLogs a LEFT JOIN hms.Tenants t ON t.TenantId = a.TenantId
    ${where} ORDER BY ${lq.orderBy} OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY;
    SELECT COUNT(*) AS total FROM hms.AuditLogs a ${where};`, params);
  res.json({ data: rows, meta: pageMeta(lq, total[0].total) });
}));

// ---------- Platform settings (public website contact details, brand) ----------
const SETTING_KEYS = ['contact.email', 'contact.phone', 'contact.address', 'brand.name',
  'invoice.legal_name', 'invoice.gstin', 'invoice.state', 'invoice.sac', 'invoice.footer', 'support.email'];
router.get('/settings', asyncHandler(async (_req, res) => {
  const rows = await db.query('SELECT SettingKey, SettingValue FROM hms.PlatformSettings');
  res.json({ data: Object.fromEntries(rows.map((r) => [r.SettingKey, r.SettingValue])) });
}));
router.put('/settings', requireSuperAdmin,
  validate(z.record(z.enum(SETTING_KEYS), z.string().trim().max(500)).superRefine((v, ctx) => {
    if (v['contact.email'] && !isValidEmail(v['contact.email'].toLowerCase())) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['contact.email'], message: 'Enter a valid e-mail address.' });
    if (v['support.email'] && !isValidEmail(v['support.email'].toLowerCase())) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['support.email'], message: 'Enter a valid e-mail address.' });
    if (v['contact.phone'] && !parsePhone(v['contact.phone'])) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['contact.phone'], message: 'Enter a valid phone number with country code.' });
    if (v['invoice.gstin'] && !GSTIN_RE.test(v['invoice.gstin'].toUpperCase())) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['invoice.gstin'], message: 'Enter a valid 15-character GSTIN.' });
    const gstState = v['invoice.gstin'] ? stateFromGstin(v['invoice.gstin'].toUpperCase()) : null;
    if (gstState && v['invoice.state'] && v['invoice.state'].toLowerCase() !== gstState.toLowerCase()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['invoice.state'], message: `This GSTIN is registered in ${gstState} (code ${v['invoice.gstin'].slice(0, 2)}). Choose ${gstState} or leave it empty.` });
    }
    if (v['invoice.sac'] && !/^\d{4,8}$/.test(v['invoice.sac'])) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['invoice.sac'], message: 'SAC must be 4–8 digits.' });
  }).transform((v) => ({ ...v, ...(v['contact.phone'] ? { 'contact.phone': parsePhone(v['contact.phone']).e164 } : {}), ...(v['invoice.gstin'] ? { 'invoice.gstin': v['invoice.gstin'].toUpperCase() } : {}) }))),
  asyncHandler(async (req, res) => {
    await withTransaction(async (tx) => {
      for (const [k, v] of Object.entries(req.body)) {
        await tx.exec(`MERGE hms.PlatformSettings AS tgt USING (SELECT @k AS SettingKey) AS src ON tgt.SettingKey = src.SettingKey
                       WHEN MATCHED THEN UPDATE SET SettingValue = @v, UpdatedAt = SYSUTCDATETIME()
                       WHEN NOT MATCHED THEN INSERT (SettingKey, SettingValue) VALUES (@k, @v);`, { k, v });
      }
      await auditPlatform(req, 'admin.settings_updated', 'platform_settings', null, { keys: Object.keys(req.body).join(',') }, null, tx);
    });
    res.json({ data: { ok: true } });
  }));

// Phase 4: coupons, revenue, monitoring, sign-in history, support, hospital groups.
router.use(platformRoutes);

export default router;
