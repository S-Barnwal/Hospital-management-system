// Super Admin — Phase 4: coupons, revenue (MRR), monitoring, sign-in history, support tickets and hospital groups
// (multi-branch). Nested in admin.routes.js, so every route already requires a platform session.
// Like the rest of the admin API this exposes platform metadata only — never patient or clinical data.
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requireSuperAdmin } from '../../middleware/auth.js';
import { asyncHandler, badRequest, conflict, notFound, unauthorized } from '../../utils/errors.js';
import { db, withTransaction, t } from '../../db/pool.js';
import { idParam } from '../../utils/params.js';
import { parseListQuery, pageMeta } from '../../utils/pagination.js';
import { auditPlatform } from '../../utils/audit.js';
import { snapshot } from '../../utils/metrics.js';
import { describeAgent } from '../../utils/loginEvents.js';
import { JOB_NAMES } from '../../jobs/scheduler.js';
import { config } from '../../config/env.js';
import { COUPON_CODE_RE, normaliseCouponCode, monthlyValueMinor, statusAfterReply } from '../clinical/phase4.logic.js';
import { loadTicket, notifyTicket, TICKET_COLS } from '../support/support.service.js';

const router = Router();
router.use((req, _res, next) => (req.admin ? next() : next(unauthorized())));
const like = (s) => (s ? `%${String(s).replace(/[%_[\]]/g, (m) => `[${m}]`)}%` : null);
const rupees = (minor) => (minor / 100).toFixed(2);

// ---------- Coupons ----------
const couponSchema = z.object({
  code: z.string().trim().transform(normaliseCouponCode).refine((c) => COUPON_CODE_RE.test(c), 'Code: 3–30 letters, digits, - or _'),
  description: z.string().trim().max(200).nullable().optional(),
  percentOff: z.coerce.number().gt(0).max(95).nullable().optional(),
  amountOff: z.coerce.number().gt(0).max(1e7).nullable().optional(),
  planCodes: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  interval: z.enum(['monthly', 'annual']).nullable().optional(),
  appliesTo: z.enum(['signup', 'renewal', 'both']).default('both'),
  validFrom: z.string().datetime({ offset: true }).nullable().optional(),
  validUntil: z.string().datetime({ offset: true }).nullable().optional(),
  maxRedemptions: z.coerce.number().int().positive().max(1e6).nullable().optional(),
  oncePerHospital: z.boolean().default(true),
  isActive: z.boolean().default(true),
}).strict()
  .refine((c) => (c.percentOff != null) !== (c.amountOff != null), { message: 'Give either a percentage or a fixed amount.', path: ['percentOff'] })
  .refine((c) => !c.validFrom || !c.validUntil || c.validUntil > c.validFrom, { message: 'End must be after start.', path: ['validUntil'] });

const couponParams = (b) => ({
  code: b.code, descr: b.description ?? null, pct: b.percentOff == null ? null : t.dec(b.percentOff, 5, 2), amt: b.amountOff == null ? null : t.money(Number(b.amountOff).toFixed(2)),
  plans: b.planCodes.length ? b.planCodes.map((p) => p.toLowerCase()).join(',') : null, intv: b.interval ?? null, applies: b.appliesTo,
  vf: b.validFrom ? new Date(b.validFrom) : null, vu: b.validUntil ? new Date(b.validUntil) : null, max: b.maxRedemptions ?? null,
  once: b.oncePerHospital, active: b.isActive,
});

router.get('/coupons', asyncHandler(async (_req, res) => {
  const rows = await db.query(`SELECT c.CouponId AS id, c.Code AS code, c.Description AS description, c.PercentOff AS percentOff, c.AmountOff AS amountOff,
      c.PlanCodes AS planCodes, c.Intervals AS interval, c.AppliesTo AS appliesTo, c.ValidFrom AS validFrom, c.ValidUntil AS validUntil,
      c.MaxRedemptions AS maxRedemptions, c.Redeemed AS redeemed, c.OncePerHospital AS oncePerHospital, c.IsActive AS isActive, c.CreatedAt AS createdAt,
      /* tenant-safe: platform totals across hospitals */ (SELECT ISNULL(SUM(r.Discount), 0) FROM hms.CouponRedemptions r WHERE r.CouponId = c.CouponId) AS totalDiscount
    FROM hms.Coupons c ORDER BY c.IsActive DESC, c.CreatedAt DESC`);
  res.json({ data: rows.map((r) => ({ ...r, planCodes: r.planCodes ? r.planCodes.split(',') : [], isActive: Boolean(r.isActive), oncePerHospital: Boolean(r.oncePerHospital) })) });
}));

router.post('/coupons', requireSuperAdmin, validate(couponSchema), asyncHandler(async (req, res) => {
  const p = couponParams(req.body);
  if (await db.one('SELECT 1 AS x FROM hms.Coupons WHERE Code = @code', { code: p.code })) throw conflict('A coupon with this code already exists.', 'DUPLICATE');
  const row = await db.one(`INSERT INTO hms.Coupons (Code, Description, PercentOff, AmountOff, PlanCodes, Intervals, AppliesTo, ValidFrom, ValidUntil, MaxRedemptions, OncePerHospital, IsActive)
    OUTPUT INSERTED.CouponId VALUES (@code, @descr, @pct, @amt, @plans, @intv, @applies, @vf, @vu, @max, @once, @active)`, p);
  await auditPlatform(req, 'admin.coupon_created', 'coupon', row.CouponId, { code: p.code });
  res.status(201).json({ data: { id: row.CouponId } });
}));

router.put('/coupons/:id', requireSuperAdmin, validate(couponSchema), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const p = couponParams(req.body);
  await withTransaction(async (tx) => {
    const cur = await tx.one('SELECT Code, Redeemed FROM hms.Coupons WITH (UPDLOCK) WHERE CouponId = @id', { id });
    if (!cur) throw notFound('Coupon not found.');
    // A used code keeps its name and value (old invoices refer to it); only limits, dates and on/off can change.
    if (cur.Redeemed > 0 && cur.Code !== p.code) throw conflict('This coupon has been used, so its code cannot be changed. Create a new coupon instead.', 'COUPON_USED');
    if (await tx.one('SELECT 1 AS x FROM hms.Coupons WHERE Code = @code AND CouponId <> @id', { code: p.code, id })) throw conflict('A coupon with this code already exists.', 'DUPLICATE');
    await tx.exec(`UPDATE hms.Coupons SET Code = @code, Description = @descr, PercentOff = @pct, AmountOff = @amt, PlanCodes = @plans, Intervals = @intv, AppliesTo = @applies,
                     ValidFrom = @vf, ValidUntil = @vu, MaxRedemptions = @max, OncePerHospital = @once, IsActive = @active, UpdatedAt = SYSUTCDATETIME() WHERE CouponId = @id`, { ...p, id });
    await auditPlatform(req, 'admin.coupon_updated', 'coupon', id, { code: p.code, active: p.active }, null, tx);
  });
  res.json({ data: { ok: true } });
}));

router.delete('/coupons/:id', requireSuperAdmin, asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const used = await db.one('SELECT Redeemed FROM hms.Coupons WHERE CouponId = @id', { id });
  if (!used) throw notFound('Coupon not found.');
  if (used.Redeemed > 0) throw conflict('This coupon has been used; switch it off instead of deleting it.', 'IN_USE');
  await db.exec('DELETE FROM hms.Coupons WHERE CouponId = @id', { id });
  await auditPlatform(req, 'admin.coupon_deleted', 'coupon', id);
  res.json({ data: { ok: true } });
}));

// ---------- Revenue: MRR / ARR ----------
router.get('/revenue', asyncHandler(async (_req, res) => {
  const [subs, monthly, churn] = await db.many(`
    /* tenant-safe: platform revenue across hospitals — plan & amounts only */
    SELECT s.TenantId, s.BillingInterval, s.IsFree, s.IsTrial, s.Status, s.CurrentPeriodEnd, p.Code AS planCode, p.Name AS planName, p.MonthlyPrice, p.AnnualPrice
    FROM hms.Subscriptions s JOIN hms.Plans p ON p.PlanId = s.PlanId JOIN hms.Tenants t ON t.TenantId = s.TenantId AND t.Status = 'active'
    WHERE s.Status IN ('active','past_due') AND s.CurrentPeriodEnd > SYSUTCDATETIME()
      AND s.SubscriptionId = (SELECT TOP 1 x.SubscriptionId FROM hms.Subscriptions x WHERE x.TenantId = s.TenantId ORDER BY x.CurrentPeriodEnd DESC);
    /* tenant-safe: platform revenue across hospitals */
    SELECT FORMAT(PaidAt, 'yyyy-MM') AS month, SUM(Amount) AS collected, SUM(TaxAmount) AS tax, SUM(DiscountAmount) AS discount, COUNT(*) AS payments,
           SUM(CASE WHEN Purpose = 'onboarding' THEN 1 ELSE 0 END) AS newHospitals
    FROM hms.Payments WHERE Status = 'paid' AND IsSandbox = 0 AND PaidAt >= DATEADD(MONTH, -11, DATEFROMPARTS(YEAR(SYSUTCDATETIME()), MONTH(SYSUTCDATETIME()), 1))
    GROUP BY FORMAT(PaidAt, 'yyyy-MM') ORDER BY month;
    /* tenant-safe: platform counts across hospitals */
    SELECT (SELECT COUNT(*) FROM hms.Tenants WHERE CreatedAt >= DATEFROMPARTS(YEAR(SYSUTCDATETIME()), MONTH(SYSUTCDATETIME()), 1) AND Status <> 'pending') AS newThisMonth,
           (SELECT COUNT(DISTINCT s.TenantId) FROM hms.Subscriptions s WHERE s.CurrentPeriodEnd >= DATEADD(DAY, -30, SYSUTCDATETIME()) AND s.CurrentPeriodEnd < SYSUTCDATETIME()
              AND NOT EXISTS (SELECT 1 FROM hms.Subscriptions y WHERE y.TenantId = s.TenantId AND y.CurrentPeriodEnd >= SYSUTCDATETIME())) AS lapsedLast30,
           (SELECT COUNT(*) FROM hms.Subscriptions s WHERE s.IsTrial = 1 AND s.CurrentPeriodEnd > SYSUTCDATETIME()) AS activeTrials;`);
  const byPlan = new Map();
  let mrr = 0; let paying = 0; let free = 0; let trial = 0;
  for (const s of subs) {
    const v = monthlyValueMinor({ interval: s.BillingInterval, monthlyPrice: s.MonthlyPrice, annualPrice: s.AnnualPrice, isFree: s.IsFree, isTrial: s.IsTrial });
    mrr += v;
    if (s.IsTrial) trial += 1; else if (s.IsFree) free += 1; else paying += 1;
    const p = byPlan.get(s.planCode) ?? { plan: s.planName, code: s.planCode, hospitals: 0, paying: 0, mrr: 0 };
    p.hospitals += 1; if (v > 0) p.paying += 1; p.mrr += v;
    byPlan.set(s.planCode, p);
  }
  res.json({ data: {
    mrr: rupees(mrr), arr: rupees(mrr * 12), arpa: paying ? rupees(Math.round(mrr / paying)) : '0.00',
    hospitals: { paying, free, trial, total: subs.length }, ...churn[0],
    byPlan: [...byPlan.values()].map((p) => ({ ...p, mrr: rupees(p.mrr) })).sort((a, b) => Number(b.mrr) - Number(a.mrr)),
    monthly, note: 'MRR counts active paid subscriptions (annual ÷ 12, before GST). Free and trial hospitals count as 0. Sandbox payments are excluded.',
  } });
}));

// ---------- Monitoring ----------
router.get('/monitoring', asyncHandler(async (_req, res) => {
  const t0 = Date.now();
  await db.one('SELECT 1 AS ok');
  const dbMs = Date.now() - t0;
  const [jobs, logins, messages, stats] = await db.many(`
    SELECT JobName AS name, LastStartedAt AS lastStartedAt, LastFinishedAt AS lastFinishedAt, LastOk AS lastOk, LastError AS lastError,
           LastDurationMs AS lastDurationMs, RunCount AS runs, FailCount AS failures FROM hms.JobRuns;
    /* tenant-safe: platform sign-in counts across hospitals */
    SELECT SUM(CASE WHEN Success = 1 THEN 1 ELSE 0 END) AS ok, SUM(CASE WHEN Success = 0 THEN 1 ELSE 0 END) AS failed,
           SUM(CASE WHEN Reason = 'locked' THEN 1 ELSE 0 END) AS locked FROM hms.LoginEvents WHERE CreatedAt >= DATEADD(HOUR, -24, SYSUTCDATETIME());
    /* tenant-safe: platform message delivery counts across hospitals */
    SELECT Status AS status, COUNT(*) AS n FROM hms.MessageLog WHERE CreatedAt >= DATEADD(HOUR, -24, SYSUTCDATETIME()) GROUP BY Status;
    /* tenant-safe: platform counts across hospitals */
    SELECT (SELECT COUNT(*) FROM hms.UserSessions WHERE RevokedAt IS NULL AND ExpiresAt > SYSUTCDATETIME()) AS activeSessions,
           (SELECT COUNT(*) FROM hms.Tenants WHERE Status = 'active') AS activeHospitals,
           (SELECT COUNT(*) FROM hms.SupportTickets WHERE Status IN ('open','awaiting_support')) AS ticketsWaiting,
           (SELECT COUNT(*) FROM hms.Payments WHERE Status = 'created' AND CreatedAt < DATEADD(HOUR, -2, SYSUTCDATETIME()) AND CreatedAt >= DATEADD(DAY, -7, SYSUTCDATETIME())) AS abandonedCheckouts,
           (SELECT COUNT(*) FROM hms.OnboardingRequests WHERE Status = 'paid' AND TenantId IS NULL) AS paidNotProvisioned;`);
  const byName = new Map(jobs.map((j) => [j.name, j]));
  const intervalMs = config.jobs.intervalSec * 1000;
  res.json({ data: {
    server: snapshot(), database: { ok: true, latencyMs: dbMs },
    jobs: { enabled: config.jobs.enabled, intervalSec: config.jobs.intervalSec, list: JOB_NAMES.map((name) => {
      const j = byName.get(name);
      const stale = config.jobs.enabled && (!j?.lastFinishedAt || Date.now() - new Date(j.lastFinishedAt).getTime() > intervalMs * 3);
      return { name, ...(j ?? {}), lastOk: j ? Boolean(j.lastOk) : null, stale };
    }) },
    logins24h: logins[0], messages24h: Object.fromEntries(messages.map((m) => [m.status, m.n])), ...stats[0],
  } });
}));

// ---------- Sign-in history ----------
router.get('/login-history', asyncHandler(async (req, res) => {
  const lq = parseListQuery(req.query, { created: 'e.CreatedAt' }, 'created');
  const params = { q: like(req.query.q), type: ['tenant', 'platform'].includes(req.query.type) ? req.query.type : null,
    ok: req.query.result === 'failed' ? 0 : req.query.result === 'ok' ? 1 : null, tid: req.query.tenantId ? idParam(req.query.tenantId, 'tenantId') : null,
    offset: lq.offset, size: lq.pageSize };
  const where = `WHERE (@type IS NULL OR e.SubjectType = @type) AND (@ok IS NULL OR e.Success = @ok) AND (@tid IS NULL OR e.TenantId = @tid)
    AND (@q IS NULL OR e.Email LIKE @q OR e.Ip LIKE @q OR t.Name LIKE @q)`;
  const [rows, total] = await db.many(`/* tenant-safe: platform security log across hospitals (no patient data) */
    SELECT e.LoginEventId AS id, e.SubjectType AS subjectType, e.TenantId AS tenantId, t.Name AS hospital, e.Email AS email, e.Success AS success, e.Reason AS reason,
           e.Ip AS ip, e.UserAgent AS userAgent, e.CreatedAt AS createdAt
    FROM hms.LoginEvents e LEFT JOIN hms.Tenants t ON t.TenantId = e.TenantId ${where}
    ORDER BY ${lq.orderBy} OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY;
    /* tenant-safe: count for the same log */
    SELECT COUNT(*) AS total FROM hms.LoginEvents e LEFT JOIN hms.Tenants t ON t.TenantId = e.TenantId ${where};`, params);
  res.json({ data: rows.map(({ userAgent, ...r }) => ({ ...r, success: Boolean(r.success), device: describeAgent(userAgent) })), meta: pageMeta(lq, total[0].total) });
}));

// ---------- Support tickets ----------
router.get('/support/tickets', asyncHandler(async (req, res) => {
  const lq = parseListQuery(req.query, { updated: 'k.UpdatedAt', created: 'k.CreatedAt' }, 'updated');
  const params = { q: like(req.query.q), offset: lq.offset, size: lq.pageSize,
    status: req.query.status === 'waiting' ? null : ['open', 'awaiting_support', 'awaiting_hospital', 'resolved', 'closed'].includes(req.query.status) ? req.query.status : null,
    waiting: req.query.status === 'waiting' ? 1 : 0 };
  const where = `WHERE (@status IS NULL OR k.Status = @status) AND (@waiting = 0 OR k.Status IN ('open','awaiting_support'))
    AND (@q IS NULL OR k.Subject LIKE @q OR k.TicketNumber LIKE @q OR t.Name LIKE @q)`;
  const [rows, total, counts] = await db.many(`/* tenant-safe: platform support queue across hospitals */
    SELECT ${TICKET_COLS}, k.TenantId AS tenantId, t.Name AS hospitalName, a.FullName AS assignedTo
    FROM hms.SupportTickets k JOIN hms.Tenants t ON t.TenantId = k.TenantId LEFT JOIN hms.PlatformUsers a ON a.PlatformUserId = k.AssignedToId ${where}
    ORDER BY CASE k.Priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, ${lq.orderBy} OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY;
    /* tenant-safe: count for the same queue */
    SELECT COUNT(*) AS total FROM hms.SupportTickets k JOIN hms.Tenants t ON t.TenantId = k.TenantId ${where};
    /* tenant-safe: status counts across hospitals */
    SELECT Status AS status, COUNT(*) AS n FROM hms.SupportTickets GROUP BY Status;`, params);
  res.json({ data: rows, meta: { ...pageMeta(lq, total[0].total), counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) } });
}));

router.get('/support/tickets/:id', asyncHandler(async (req, res) => {
  res.json({ data: await loadTicket({ ticketId: idParam(req.params.id), forHospital: false }) });
}));

router.post('/support/tickets/:id/messages',
  validate(z.object({ body: z.string().trim().min(2).max(4000), internal: z.boolean().default(false), resolve: z.boolean().default(false) }).strict()),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const tenantId = await withTransaction(async (tx) => {
      const k = await tx.one('/* tenant-safe: platform support by ticket id */ SELECT TenantId, Status FROM hms.SupportTickets WITH (UPDLOCK) WHERE TicketId = @id', { id });
      if (!k) throw notFound('Ticket not found.');
      await tx.exec(`INSERT INTO hms.SupportTicketMessages (TenantId, TicketId, AuthorType, AuthorPlatformId, AuthorName, Body, IsInternal)
                     VALUES (@tid, @id, 'support', @pid, @name, @body, @internal)`,
      { tid: k.TenantId, id, pid: req.admin.platformUserId, name: req.body.internal ? req.admin.name : `${req.admin.name} (Support)`, body: req.body.body, internal: req.body.internal });
      if (!req.body.internal) {
        const status = req.body.resolve ? 'resolved' : statusAfterReply('support');
        await tx.exec(`UPDATE hms.SupportTickets SET Status = @s, LastReplyBy = 'support', LastReplyAt = SYSUTCDATETIME(),
                         ResolvedAt = CASE WHEN @s = 'resolved' THEN SYSUTCDATETIME() ELSE NULL END, AssignedToId = ISNULL(AssignedToId, @pid), UpdatedAt = SYSUTCDATETIME()
                       WHERE TenantId = @tid AND TicketId = @id`, { tid: k.TenantId, id, s: status, pid: req.admin.platformUserId });
      }
      await auditPlatform(req, req.body.internal ? 'admin.support_note' : 'admin.support_replied', 'support_ticket', id, null, k.TenantId, tx);
      return k.TenantId;
    });
    if (!req.body.internal) notifyTicket({ ticketId: id, tenantId, toSupport: false, by: 'Support', body: req.body.body });
    res.status(201).json({ data: { ok: true } });
  }));

router.patch('/support/tickets/:id',
  validate(z.object({
    status: z.enum(['open', 'awaiting_support', 'awaiting_hospital', 'resolved', 'closed']).optional(),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
    assignedToId: z.coerce.number().int().positive().nullable().optional(),
  }).strict().refine((v) => Object.keys(v).length > 0, 'Nothing to change.')),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const b = req.body;
    if (b.assignedToId && !(await db.one(`SELECT 1 AS x FROM hms.PlatformUsers WHERE PlatformUserId = @id AND Status = 'active'`, { id: b.assignedToId }))) throw badRequest('Team member not found.');
    const k = await db.one('/* tenant-safe: platform support by ticket id */ SELECT TenantId FROM hms.SupportTickets WHERE TicketId = @id', { id });
    if (!k) throw notFound('Ticket not found.');
    await db.exec(`UPDATE hms.SupportTickets SET Status = ISNULL(@s, Status), Priority = ISNULL(@p, Priority),
                     AssignedToId = CASE WHEN @setA = 1 THEN @a ELSE AssignedToId END,
                     ResolvedAt = CASE WHEN @s IN ('resolved','closed') THEN ISNULL(ResolvedAt, SYSUTCDATETIME()) WHEN @s IS NULL THEN ResolvedAt ELSE NULL END,
                     UpdatedAt = SYSUTCDATETIME() WHERE TenantId = @tid AND TicketId = @id`,
    { tid: k.TenantId, id, s: b.status ?? null, p: b.priority ?? null, setA: b.assignedToId !== undefined ? 1 : 0, a: b.assignedToId ?? null });
    await auditPlatform(req, 'admin.support_updated', 'support_ticket', id, b, k.TenantId);
    res.json({ data: { ok: true } });
  }));

router.get('/team', asyncHandler(async (_req, res) => {
  res.json({ data: await db.query(`SELECT PlatformUserId AS id, FullName AS name, Role AS role FROM hms.PlatformUsers WHERE Status = 'active' ORDER BY FullName`) });
}));

// ---------- Hospital groups (multi-branch) ----------
router.get('/groups', asyncHandler(async (_req, res) => {
  const [groups, members] = await db.many(`
    SELECT g.GroupId AS id, g.Name AS name, g.Notes AS notes, g.CreatedAt AS createdAt FROM hms.TenantGroups g ORDER BY g.Name;
    /* tenant-safe: platform list of hospitals in groups (name/plan only) */
    SELECT t.TenantId AS tenantId, t.GroupId AS groupId, t.Name AS name, t.Slug AS slug, t.BranchName AS branchName, t.City AS city, t.Status AS status, sub.PlanName AS planName, sub.MaxBranches AS maxBranches
    FROM hms.Tenants t OUTER APPLY (SELECT TOP 1 p.Name AS PlanName, p.MaxBranches FROM hms.Subscriptions s JOIN hms.Plans p ON p.PlanId = s.PlanId
                                    WHERE s.TenantId = t.TenantId ORDER BY s.CurrentPeriodEnd DESC) sub
    WHERE t.GroupId IS NOT NULL ORDER BY t.Name;`);
  res.json({ data: groups.map((g) => ({ ...g, hospitals: members.filter((m) => m.groupId === g.id) })) });
}));

const groupSchema = z.object({ name: z.string().trim().min(2).max(150), notes: z.string().trim().max(500).nullable().optional() }).strict();
router.post('/groups', requireSuperAdmin, validate(groupSchema), asyncHandler(async (req, res) => {
  const row = await db.one('INSERT INTO hms.TenantGroups (Name, Notes) OUTPUT INSERTED.GroupId VALUES (@n, @notes)', { n: req.body.name, notes: req.body.notes ?? null });
  await auditPlatform(req, 'admin.group_created', 'tenant_group', row.GroupId, { name: req.body.name });
  res.status(201).json({ data: { id: row.GroupId } });
}));
router.put('/groups/:id', requireSuperAdmin, validate(groupSchema), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const n = await db.exec('UPDATE hms.TenantGroups SET Name = @n, Notes = @notes WHERE GroupId = @id', { id, n: req.body.name, notes: req.body.notes ?? null });
  if (!n) throw notFound('Group not found.');
  await auditPlatform(req, 'admin.group_updated', 'tenant_group', id, { name: req.body.name });
  res.json({ data: { ok: true } });
}));
router.delete('/groups/:id', requireSuperAdmin, asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const used = await db.one('/* tenant-safe: platform group membership count */ SELECT COUNT(*) AS n FROM hms.Tenants WHERE GroupId = @id', { id });
  if (used.n) throw conflict('Remove the hospitals from this group first.', 'IN_USE');
  const n = await db.exec('DELETE FROM hms.TenantGroups WHERE GroupId = @id', { id });
  if (!n) throw notFound('Group not found.');
  await auditPlatform(req, 'admin.group_deleted', 'tenant_group', id);
  res.json({ data: { ok: true } });
}));

/** Puts a hospital into a group (or takes it out with groupId = null). Branch limit = the plan's MaxBranches of the group's hospitals. */
router.put('/tenants/:id/group', requireSuperAdmin,
  validate(z.object({ groupId: z.coerce.number().int().positive().nullable(), branchName: z.string().trim().max(100).nullable().optional() }).strict()),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    await withTransaction(async (tx) => {
      const tenant = await tx.one('/* tenant-safe: platform admin by primary key */ SELECT TenantId, GroupId FROM hms.Tenants WITH (UPDLOCK) WHERE TenantId = @id', { id });
      if (!tenant) throw notFound('Hospital not found.');
      if (req.body.groupId) {
        if (!(await tx.one('SELECT 1 AS x FROM hms.TenantGroups WHERE GroupId = @g', { g: req.body.groupId }))) throw badRequest('Group not found.');
        const lim = await tx.one(`/* tenant-safe: platform branch limit across the group */
          SELECT COUNT(*) AS n, MAX(sub.MaxBranches) AS maxBranches FROM hms.Tenants t
          OUTER APPLY (SELECT TOP 1 p.MaxBranches FROM hms.Subscriptions s JOIN hms.Plans p ON p.PlanId = s.PlanId WHERE s.TenantId = t.TenantId ORDER BY s.CurrentPeriodEnd DESC) sub
          WHERE t.GroupId = @g AND t.TenantId <> @id`, { g: req.body.groupId, id });
        if (lim.maxBranches != null && lim.n + 1 > lim.maxBranches) {
          throw conflict(`This group's plan allows ${lim.maxBranches} branch(es). Upgrade the plan or raise "Max branches" first.`, 'BRANCH_LIMIT');
        }
      }
      await tx.exec('/* tenant-safe: platform admin by primary key */ UPDATE hms.Tenants SET GroupId = @g, BranchName = @b, UpdatedAt = SYSUTCDATETIME() WHERE TenantId = @id',
        { id, g: req.body.groupId, b: req.body.branchName ?? null });
      await auditPlatform(req, 'admin.tenant_group_set', 'tenant', id, { groupId: req.body.groupId, from: tenant.GroupId }, id, tx);
    });
    res.json({ data: { ok: true } });
  }));

export default router;
