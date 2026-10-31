// Tenant-level account endpoints: who am I, hospital settings, subscription & renewal.
// tenantId ALWAYS comes from req.ctx (server-side session), never from the request.
import { Router } from 'express';
import { FACILITY_TYPES, GSTIN_RE } from '../../utils/constants.js';
import { UPI_ID_RE } from '../clinical/phase2.logic.js';
import { messagingStatus } from '../../notify/index.js';
import { clearSenderCache } from '../../notify/sender.js';
import { config } from '../../config/env.js';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requireTenant, requirePermission } from '../../middleware/auth.js';
import { asyncHandler, badRequest, notFound } from '../../utils/errors.js';
import { db, withTransaction, t } from '../../db/pool.js';
import { auditTenant } from '../../utils/audit.js';
import { isValidTimeZone } from '../../utils/time.js';
import { quote } from '../../utils/pricing.js';
import { getProvider } from '../../payments/index.js';
import { finalizePaidOrder, renewFree } from '../onboarding/onboarding.service.js';
import { serialiseInvoice, INVOICE_SQL } from '../invoices/invoices.routes.js';
import { idParam } from '../../utils/params.js';
import { optionalPhone, optionalEmail, withLocation, isValidEmail } from '../../utils/contact.js';

const router = Router();
// Scoped so this router never intercepts public /api/v1 routes.
router.use(['/tenant', '/settings', '/subscription', '/notifications', '/audit-logs', '/message-log'], requireTenant);

router.get('/tenant/me', asyncHandler(async (req, res) => {
  const user = await db.one('SELECT UserId, Email, FullName, Phone FROM hms.Users WHERE UserId = @uid AND TenantId = @tid',
    { uid: req.ctx.userId, tid: req.ctx.tenantId });
  const facility = await db.one('SELECT FacilityType, Country, CASE WHEN Latitude IS NULL THEN 0 ELSE 1 END AS HasLocation FROM hms.Tenants WHERE TenantId = @tid', { tid: req.ctx.tenantId });
  const unread = await db.one('SELECT COUNT(*) AS n FROM hms.Notifications WHERE TenantId = @tid AND (UserId IS NULL OR UserId = @uid) AND IsRead = 0',
    { tid: req.ctx.tenantId, uid: req.ctx.userId });
  res.json({
    data: {
      user: { id: user.UserId, email: user.Email, name: user.FullName, phone: user.Phone, isOwner: req.ctx.isOwner, roles: req.ctx.roles },
      tenant: { slug: req.ctx.tenantSlug, name: req.ctx.tenantName, timezone: req.ctx.timezone, currency: req.ctx.currency, facilityType: facility?.FacilityType || null, country: facility?.Country || 'IN', hasLocation: Boolean(facility?.HasLocation) },
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
    SELECT Name, Email, Phone, City, State, Country, PostalCode, Latitude, Longitude, LocationUpdatedAt, FacilityType, Timezone, Currency FROM hms.Tenants WHERE TenantId = @tid;
    SELECT SettingKey, SettingValue FROM hms.TenantSettings WHERE TenantId = @tid;`, { tid: req.ctx.tenantId });
  res.json({ data: { ...tenant[0], settings: Object.fromEntries(settings.map((s) => [s.SettingKey, s.SettingValue])), messaging: await messagingStatus(req.ctx.tenantId) } });
}));

const ALLOWED_SETTINGS = [
  'patient.number_prefix', 'appointment.default_minutes', 'hospital.address',
  'security.mfa_admins', 'notify.whatsapp', 'notify.daily_summary', 'gst.gstin', 'gst.sac_default', 'notify.reply_to',
  'payment.upi_id', 'payment.upi_name', 'ipd.auto_bed_charges', 'notify.follow_up',
];
const ON_OFF = ['security.mfa_admins', 'notify.whatsapp', 'notify.daily_summary', 'ipd.auto_bed_charges', 'notify.follow_up'];

router.put('/settings', requirePermission('settings.manage'),
  validate(withLocation(z.object({
    name: z.string().trim().min(2).max(200),
    email: optionalEmail,
    phone: optionalPhone,
    timezone: z.string().refine(isValidTimeZone, 'Unknown timezone'),
    facilityType: z.enum(FACILITY_TYPES).nullable().optional(),
    settings: z.record(z.enum(ALLOWED_SETTINGS), z.string().trim().max(300).nullable()).optional(),
  }).strict())),
  asyncHandler(async (req, res) => {
    const b = req.body;
    if (b.settings?.['patient.number_prefix'] && !/^[A-Z0-9]{1,6}$/.test(b.settings['patient.number_prefix'])) {
      throw badRequest('Patient number prefix must be 1–6 capital letters or digits.');
    }
    for (const k of ON_OFF) {
      if (b.settings?.[k] != null && !['on', 'off'].includes(b.settings[k])) throw badRequest(`${k} must be "on" or "off".`);
    }
    if (b.settings?.['gst.gstin'] && !GSTIN_RE.test(b.settings['gst.gstin'])) throw badRequest('Enter a valid 15-character GSTIN, e.g. 27ABCDE1234F1Z5.');
    if (b.settings?.['notify.reply_to'] && !isValidEmail(b.settings['notify.reply_to'].toLowerCase())) throw badRequest('Reply-to must be a valid e-mail address.');
    if (b.settings?.['payment.upi_id'] && !UPI_ID_RE.test(b.settings['payment.upi_id'])) throw badRequest('Enter a valid UPI ID, e.g. hospitalname@okhdfcbank.');
    if (b.settings?.['payment.upi_name'] && b.settings['payment.upi_name'].length > 50) throw badRequest('UPI payee name must be 50 characters or less.');
    if (b.settings?.['gst.sac_default'] && !/^\d{4,8}$/.test(b.settings['gst.sac_default'])) throw badRequest('SAC code must be 4–8 digits.');
    if (b.settings?.['security.mfa_admins'] === 'on' && !(await messagingStatus(req.ctx.tenantId)).email && config.isProd) {
      throw badRequest('2-step sign-in needs e-mail sending to be set up on the server first.');
    }
    await withTransaction(async (tx) => {
      await tx.exec(`UPDATE hms.Tenants SET Name = @name, Email = @email, Phone = @phone, City = @city, State = @state, Country = ISNULL(@country, Country), Timezone = @tz, FacilityType = CASE WHEN @setFt = 1 THEN @ft ELSE FacilityType END, UpdatedAt = SYSUTCDATETIME()
                     WHERE TenantId = @tid`,
      { tid: req.ctx.tenantId, name: b.name, email: b.email ?? null, phone: b.phone ?? null, city: b.city ?? null, state: b.state ?? null, country: b.country ?? null, tz: b.timezone, setFt: b.facilityType !== undefined, ft: b.facilityType ?? null });
      for (const [k, v] of Object.entries(b.settings || {})) {
        await tx.exec(`MERGE hms.TenantSettings AS tgt USING (SELECT @tid AS TenantId, @k AS SettingKey) AS src
                         ON tgt.TenantId = src.TenantId AND tgt.SettingKey = src.SettingKey
                       WHEN MATCHED THEN UPDATE SET SettingValue = @v, UpdatedAt = SYSUTCDATETIME()
                       WHEN NOT MATCHED THEN INSERT (TenantId, SettingKey, SettingValue) VALUES (@tid, @k, @v);`,
        { tid: req.ctx.tenantId, k, v });
      }
      clearSenderCache(req.ctx.tenantId);
      await auditTenant(req, 'settings.updated', 'tenant', req.ctx.tenantId, { keys: Object.keys(b.settings || {}).join(','), facilityType: b.facilityType }, tx);
    });
    res.json({ data: { ok: true } });
  }));

// ---------- Location (map pin) ----------
const POSTAL = { IN: /^[1-9]\d{5}$/, US: /^\d{5}(-\d{4})?$/, GB: /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i, AE: /^\d{0,6}$/ };
router.put('/settings/location', requirePermission('settings.manage'),
  validate(z.object({
    latitude: z.coerce.number().min(-90).max(90).nullable(),
    longitude: z.coerce.number().min(-180).max(180).nullable(),
    postalCode: z.string().trim().toUpperCase().max(12).regex(/^[A-Z0-9 -]*$/, 'Postal code can contain letters, digits, spaces and dashes only.').optional(),
  }).strict().refine((v) => (v.latitude === null) === (v.longitude === null), 'Set both latitude and longitude, or clear both.')
    .refine((v) => !(v.latitude === 0 && v.longitude === 0), 'Place the pin on your hospital (0, 0 is in the ocean).')),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const tenant = await db.one('SELECT Country FROM hms.Tenants WHERE TenantId = @tid', { tid: req.ctx.tenantId });
    const rule = POSTAL[tenant?.Country];
    if (b.postalCode && rule && !rule.test(b.postalCode)) throw badRequest(tenant.Country === 'IN' ? 'Enter a valid 6-digit PIN code.' : 'Enter a valid postal code.', [{ path: 'postalCode', message: 'Invalid postal code for your country.' }]);
    await db.exec(`UPDATE hms.Tenants SET Latitude = @lat, Longitude = @lng, PostalCode = CASE WHEN @setPc = 1 THEN @pc ELSE PostalCode END,
                     LocationUpdatedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME() WHERE TenantId = @tid`,
    { tid: req.ctx.tenantId, lat: b.latitude === null ? null : t.dec(Number(b.latitude.toFixed(6)), 9, 6), lng: b.longitude === null ? null : t.dec(Number(b.longitude.toFixed(6)), 9, 6),
      setPc: b.postalCode !== undefined, pc: b.postalCode || null });
    await auditTenant(req, 'settings.location_updated', 'tenant', req.ctx.tenantId, { pinned: b.latitude !== null });
    res.json({ data: { ok: true } });
  }));

// ---------- Subscription ----------
router.get('/subscription', requirePermission('subscription.read'), asyncHandler(async (req, res) => {
  const [subs, invoices, plans] = await db.many(`
    SELECT TOP 1 s.SubscriptionId, s.Status, s.IsFree, p.IsFree AS PlanIsFree, s.BillingInterval, s.CurrentPeriodStart, s.CurrentPeriodEnd, s.GraceDays, p.Code AS PlanCode, p.Name AS PlanName,
           p.MaxStaffUsers, (SELECT COUNT(*) FROM hms.Users WHERE TenantId = @tid AND Status = 'active') AS ActiveUsers
    FROM hms.Subscriptions s JOIN hms.Plans p ON p.PlanId = s.PlanId WHERE s.TenantId = @tid ORDER BY s.CurrentPeriodEnd DESC;
    SELECT i.InvoiceId, i.InvoiceNumber, i.Description, i.Subtotal, i.DiscountAmount, i.TaxAmount, i.Total, i.Currency, i.IsSandbox, i.IssuedAt, i.Status, i.Kind
    FROM hms.Invoices i WHERE i.TenantId = @tid AND i.Status <> 'draft' ORDER BY i.IssuedAt DESC;
    SELECT * FROM hms.Plans WHERE IsActive = 1 AND IsContactSales = 0 ORDER BY SortOrder;`, { tid: req.ctx.tenantId });
  res.json({
    data: {
      subscription: subs[0] ?? null,
      state: req.ctx.subscription,
      invoices,
      renewalOptions: plans.map((p) => ({ code: p.Code, name: p.Name, isFree: Boolean(p.IsFree), monthly: quote(p, 'monthly'), annual: quote(p, 'annual') })),
    },
  });
}));

/** One invoice of THIS hospital (drafts are internal to the platform and never shown). */
router.get('/subscription/invoices/:id', requirePermission('subscription.read'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const r = await db.one(`${INVOICE_SQL} WHERE i.InvoiceId = @id AND i.TenantId = @tid AND i.Status <> 'draft'`, { id, tid: req.ctx.tenantId });
  if (!r) throw notFound('Invoice not found.');
  res.json({ data: serialiseInvoice(r) });
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
    if (plan.IsFree) {
      const r = await renewFree(req.ctx.tenantId, plan, req.body.interval);
      await auditTenant(req, 'subscription.renewed_free', 'subscription', sub.SubscriptionId, { plan: plan.Code, interval: req.body.interval });
      return res.json({ data: { free: true, periodEnd: r.periodEnd, invoiceNumber: r.invoiceNumber } });
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
    return res.status(201).json({ data: { amount: q, payment: { ...order.checkout, isSandbox: provider.isSandbox } } });
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
// ---------- Outgoing message log (recipients are masked) ----------
router.get('/message-log', requirePermission('audit.read'), asyncHandler(async (req, res) => {
  const rows = await db.query(`SELECT TOP 200 MessageId AS id, Channel AS channel, RecipientMasked AS recipient, Template AS template, Subject AS subject,
                                      Status AS status, Error AS error, RelatedType AS relatedType, RelatedId AS relatedId, CreatedAt AS createdAt, SentAt AS sentAt
                               FROM hms.MessageLog WHERE TenantId = @tid AND (@ch IS NULL OR Channel = @ch) ORDER BY CreatedAt DESC`,
  { tid: req.ctx.tenantId, ch: ['email', 'whatsapp'].includes(req.query.channel) ? req.query.channel : null });
  res.json({ data: rows, meta: await messagingStatus(req.ctx.tenantId) });
}));

router.get('/audit-logs', requirePermission('audit.read'), asyncHandler(async (req, res) => {
  const rows = await db.query(`
    SELECT TOP 200 a.AuditLogId, a.ActorType, a.Action, a.EntityType, a.EntityId, a.CreatedAt, u.FullName AS ActorName
    FROM hms.AuditLogs a LEFT JOIN hms.Users u ON u.UserId = a.ActorId AND u.TenantId = a.TenantId AND a.ActorType = 'tenant'
    WHERE a.TenantId = @tid ORDER BY a.CreatedAt DESC`, { tid: req.ctx.tenantId });
  res.json({ data: rows });
}));

export default router;
