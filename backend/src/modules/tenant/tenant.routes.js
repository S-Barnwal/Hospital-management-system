// Tenant-level account endpoints: who am I, hospital settings, subscription & renewal.
// tenantId ALWAYS comes from req.ctx (server-side session), never from the request.
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requireTenant, requirePermission } from '../../middleware/auth.js';
import { asyncHandler, badRequest, notFound } from '../../utils/errors.js';
import { db, withTransaction, t } from '../../db/pool.js';
import { auditTenant } from '../../utils/audit.js';
import { isValidTimeZone } from '../../utils/time.js';
import { quote } from '../../utils/pricing.js';
import { getProvider } from '../../payments/index.js';
import { finalizePaidOrder } from '../onboarding/onboarding.service.js';

const router = Router();
// Scoped so this router never intercepts public /api/v1 routes.
router.use(['/tenant', '/settings', '/subscription', '/notifications', '/audit-logs'], requireTenant);

router.get('/tenant/me', asyncHandler(async (req, res) => {
  const user = await db.one('SELECT UserId, Email, FullName, Phone FROM hms.Users WHERE UserId = @uid AND TenantId = @tid',
    { uid: req.ctx.userId, tid: req.ctx.tenantId });
  const unread = await db.one('SELECT COUNT(*) AS n FROM hms.Notifications WHERE TenantId = @tid AND (UserId IS NULL OR UserId = @uid) AND IsRead = 0',
    { tid: req.ctx.tenantId, uid: req.ctx.userId });
  res.json({
    data: {
      user: { id: user.UserId, email: user.Email, name: user.FullName, phone: user.Phone, isOwner: req.ctx.isOwner, roles: req.ctx.roles },
      tenant: { slug: req.ctx.tenantSlug, name: req.ctx.tenantName, timezone: req.ctx.timezone, currency: req.ctx.currency },
      permissions: [...req.ctx.permissions].sort(),
      features: [...req.ctx.features].sort(),
      subscription: req.ctx.subscription,
      unreadNotifications: unread.n,
    },
  });
}));

// ---------- Settings ----------
router.get('/settings', requirePermission('settings.read'), asyncHandler(async (req, res) => {
  const [tenant, settings] = await db.many(`
    SELECT Name, Email, Phone, City, State, FacilityType, Timezone, Currency FROM hms.Tenants WHERE TenantId = @tid;
    SELECT SettingKey, SettingValue FROM hms.TenantSettings WHERE TenantId = @tid;`, { tid: req.ctx.tenantId });
  res.json({ data: { ...tenant[0], settings: Object.fromEntries(settings.map((s) => [s.SettingKey, s.SettingValue])) } });
}));

const ALLOWED_SETTINGS = ['patient.number_prefix', 'appointment.default_minutes', 'hospital.address'];
router.put('/settings', requirePermission('settings.manage'),
  validate(z.object({
    name: z.string().trim().min(2).max(200),
    email: z.string().trim().email().max(254).nullable().optional(),
    phone: z.string().trim().max(30).nullable().optional(),
    city: z.string().trim().max(100).nullable().optional(),
    state: z.string().trim().max(100).nullable().optional(),
    timezone: z.string().refine(isValidTimeZone, 'Unknown timezone'),
    settings: z.record(z.enum(ALLOWED_SETTINGS), z.string().trim().max(300).nullable()).optional(),
  }).strict()),
  asyncHandler(async (req, res) => {
    const b = req.body;
    if (b.settings?.['patient.number_prefix'] && !/^[A-Z0-9]{1,6}$/.test(b.settings['patient.number_prefix'])) {
      throw badRequest('Patient number prefix must be 1–6 capital letters or digits.');
    }
    await withTransaction(async (tx) => {
      await tx.exec(`UPDATE hms.Tenants SET Name = @name, Email = @email, Phone = @phone, City = @city, State = @state, Timezone = @tz, UpdatedAt = SYSUTCDATETIME()
                     WHERE TenantId = @tid`,
      { tid: req.ctx.tenantId, name: b.name, email: b.email ?? null, phone: b.phone ?? null, city: b.city ?? null, state: b.state ?? null, tz: b.timezone });
      for (const [k, v] of Object.entries(b.settings || {})) {
        await tx.exec(`MERGE hms.TenantSettings AS tgt USING (SELECT @tid AS TenantId, @k AS SettingKey) AS src
                         ON tgt.TenantId = src.TenantId AND tgt.SettingKey = src.SettingKey
                       WHEN MATCHED THEN UPDATE SET SettingValue = @v, UpdatedAt = SYSUTCDATETIME()
                       WHEN NOT MATCHED THEN INSERT (TenantId, SettingKey, SettingValue) VALUES (@tid, @k, @v);`,
        { tid: req.ctx.tenantId, k, v });
      }
      await auditTenant(req, 'settings.updated', 'tenant', req.ctx.tenantId, { keys: Object.keys(b.settings || {}).join(',') }, tx);
    });
    res.json({ data: { ok: true } });
  }));

// ---------- Subscription ----------
router.get('/subscription', requirePermission('subscription.read'), asyncHandler(async (req, res) => {
  const [subs, invoices, plans] = await db.many(`
    SELECT TOP 1 s.SubscriptionId, s.Status, s.BillingInterval, s.CurrentPeriodStart, s.CurrentPeriodEnd, s.GraceDays, p.Code AS PlanCode, p.Name AS PlanName,
           p.MaxStaffUsers, (SELECT COUNT(*) FROM hms.Users WHERE TenantId = @tid AND Status = 'active') AS ActiveUsers
    FROM hms.Subscriptions s JOIN hms.Plans p ON p.PlanId = s.PlanId WHERE s.TenantId = @tid ORDER BY s.CurrentPeriodEnd DESC;
    SELECT i.InvoiceNumber, i.Description, i.Subtotal, i.TaxAmount, i.Total, i.Currency, i.IsSandbox, i.IssuedAt
    FROM hms.Invoices i WHERE i.TenantId = @tid ORDER BY i.IssuedAt DESC;
    SELECT * FROM hms.Plans WHERE IsActive = 1 AND IsContactSales = 0 ORDER BY SortOrder;`, { tid: req.ctx.tenantId });
  res.json({
    data: {
      subscription: subs[0] ?? null,
      state: req.ctx.subscription,
      invoices,
      renewalOptions: plans.map((p) => ({ code: p.Code, name: p.Name, monthly: quote(p, 'monthly'), annual: quote(p, 'annual') })),
    },
  });
}));

router.post('/subscription/renew', requirePermission('subscription.manage'),
  validate(z.object({ planCode: z.string().min(1).max(50), interval: z.enum(['monthly', 'annual']) }).strict()),
  asyncHandler(async (req, res) => {
    const plan = await db.one('SELECT * FROM hms.Plans WHERE Code = @code AND IsActive = 1 AND IsContactSales = 0', { code: req.body.planCode });
    if (!plan) throw badRequest('Plan not available.');
    const sub = await db.one('SELECT TOP 1 SubscriptionId FROM hms.Subscriptions WHERE TenantId = @tid ORDER BY CurrentPeriodEnd DESC', { tid: req.ctx.tenantId });
    if (!sub) throw notFound('No subscription found.');
    if (plan.MaxStaffUsers) {
      const users = await db.one(`SELECT COUNT(*) AS n FROM hms.Users WHERE TenantId = @tid AND Status = 'active'`, { tid: req.ctx.tenantId });
      if (users.n > plan.MaxStaffUsers) throw badRequest(`This plan allows ${plan.MaxStaffUsers} users; you have ${users.n} active. Disable some users or choose a larger plan.`);
    }
    const q = quote(plan, req.body.interval);
    const provider = getProvider();
    const order = await provider.createOrder({ amountMinor: q.totalMinor, currency: q.currency, receipt: `ren_${req.ctx.tenantId}_${Date.now()}`,
      notes: { tenant: req.ctx.tenantSlug, plan: plan.Code, interval: req.body.interval } });
    await db.exec(
      `INSERT INTO hms.Payments (TenantId, SubscriptionId, Purpose, PlanId, BillingInterval, Provider, IsSandbox, ProviderOrderId, Subtotal, TaxAmount, Amount, Currency)
       VALUES (@tid, @sid, 'renewal', @pid, @interval, @provider, @sbx, @order, @sub, @tax, @total, @cur)`,
      { tid: req.ctx.tenantId, sid: sub.SubscriptionId, pid: plan.PlanId, interval: req.body.interval, provider: provider.name, sbx: provider.isSandbox,
        order: order.orderId, sub: t.money(q.subtotal), tax: t.money(q.tax), total: t.money(q.total), cur: q.currency });
    await auditTenant(req, 'subscription.renewal_started', 'subscription', sub.SubscriptionId, { plan: plan.Code, interval: req.body.interval });
    res.status(201).json({ data: { amount: q, payment: { ...order.checkout, isSandbox: provider.isSandbox } } });
  }));

router.post('/subscription/verify', requirePermission('subscription.manage'),
  validate(z.object({ orderId: z.string().min(5).max(100), paymentId: z.string().min(5).max(100), signature: z.string().min(16).max(200) }).strict()),
  asyncHandler(async (req, res) => {
    const pay = await db.one(`SELECT Provider FROM hms.Payments WHERE ProviderOrderId = @order AND TenantId = @tid AND Purpose = 'renewal'`,
      { order: req.body.orderId, tid: req.ctx.tenantId });
    if (!pay) throw notFound('Order not found.');
    const provider = getProvider(pay.Provider);
    if (!provider.verifyCheckout(req.body)) throw badRequest('Payment verification failed.');
    const result = await finalizePaidOrder({ providerName: provider.name, orderId: req.body.orderId, paymentId: req.body.paymentId, source: 'checkout', ip: req.ip });
    res.json({ data: { ok: true, alreadyProcessed: result.alreadyProcessed, invoiceNumber: result.invoiceNumber ?? null } });
  }));

// ---------- Notifications ----------
router.get('/notifications', asyncHandler(async (req, res) => {
  const rows = await db.query(`SELECT TOP 30 NotificationId, Type, Title, Body, IsRead, CreatedAt FROM hms.Notifications
                               WHERE TenantId = @tid AND (UserId IS NULL OR UserId = @uid) ORDER BY CreatedAt DESC`,
  { tid: req.ctx.tenantId, uid: req.ctx.userId });
  res.json({ data: rows });
}));

router.post('/notifications/read-all', asyncHandler(async (req, res) => {
  await db.exec('UPDATE hms.Notifications SET IsRead = 1 WHERE TenantId = @tid AND (UserId IS NULL OR UserId = @uid) AND IsRead = 0',
    { tid: req.ctx.tenantId, uid: req.ctx.userId });
  res.json({ data: { ok: true } });
}));

// ---------- Hospital audit log ----------
router.get('/audit-logs', requirePermission('audit.read'), asyncHandler(async (req, res) => {
  const rows = await db.query(`
    SELECT TOP 200 a.AuditLogId, a.ActorType, a.Action, a.EntityType, a.EntityId, a.CreatedAt, u.FullName AS ActorName
    FROM hms.AuditLogs a LEFT JOIN hms.Users u ON u.UserId = a.ActorId AND u.TenantId = a.TenantId AND a.ActorType = 'tenant'
    WHERE a.TenantId = @tid ORDER BY a.CreatedAt DESC`, { tid: req.ctx.tenantId });
  res.json({ data: rows });
}));

export default router;
