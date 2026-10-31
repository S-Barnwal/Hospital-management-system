// Hospital messaging settings.
//  • Everyone: Reply-To address (messages are sent from the platform account in the hospital's name).
//  • Enterprise ("own_messaging"): connect the hospital's OWN SMTP server and WhatsApp number.
// Secrets are encrypted at rest (AES-256-GCM) and never returned; only "a password is saved" is reported.
import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { validate } from '../../middleware/validate.js';
import { requireTenant, requirePermission } from '../../middleware/auth.js';
import { asyncHandler, badRequest, forbidden, HttpError } from '../../utils/errors.js';
import { db } from '../../db/pool.js';
import { config } from '../../config/env.js';
import { seal } from '../../utils/secretBox.js';
import { auditTenant } from '../../utils/audit.js';
import { assertPublicHost } from '../../notify/hostGuard.js';
import { clearSenderCache, senderFor } from '../../notify/sender.js';
import { deliver } from '../../notify/index.js';
import { emailSchema, isValidEmail, parsePhone } from '../../utils/contact.js';

const router = Router();
router.use(requireTenant);

const allowed = (req) => req.ctx.features.has('own_messaging');

router.get('/', requirePermission('settings.read'), asyncHandler(async (req, res) => {
  const [cfgRows, replyRows] = await db.many(`
    SELECT EmailEnabled, SmtpHost, SmtpPort, SmtpSecure, SmtpUser, FromEmail, CASE WHEN SmtpPassEnc IS NULL THEN 0 ELSE 1 END AS HasPassword,
           WhatsAppEnabled, WaPhoneNumberId, CASE WHEN WaTokenEnc IS NULL THEN 0 ELSE 1 END AS HasToken, UpdatedAt
    FROM hms.TenantMessagingConfig WHERE TenantId = @tid;
    SELECT SettingValue FROM hms.TenantSettings WHERE TenantId = @tid AND SettingKey = 'notify.reply_to';`, { tid: req.ctx.tenantId });
  const c = cfgRows[0] || {};
  const sender = await senderFor(req.ctx.tenantId);
  res.json({
    data: {
      ownAccountAllowed: allowed(req),
      encryptionReady: Boolean(config.messagingKey),
      replyTo: replyRows[0]?.SettingValue || '',
      preview: { from: sender.from, replyTo: sender.replyTo || null, via: sender.via },
      email: { enabled: Boolean(c.EmailEnabled), host: c.SmtpHost || '', port: c.SmtpPort || 587, secure: Boolean(c.SmtpSecure), user: c.SmtpUser || '', fromEmail: c.FromEmail || '', hasPassword: Boolean(c.HasPassword) },
      whatsapp: { enabled: Boolean(c.WhatsAppEnabled), phoneNumberId: c.WaPhoneNumberId || '', hasToken: Boolean(c.HasToken) },
      updatedAt: c.UpdatedAt || null,
    },
  });
}));

const schema = z.object({
  replyTo: emailSchema.or(z.literal('')).optional(),
  email: z.object({
    enabled: z.boolean(), host: z.string().trim().toLowerCase().max(255).optional(), port: z.coerce.number().int().refine((p) => [25, 465, 587, 2525].includes(p), 'Port must be 25, 465, 587 or 2525').optional(),
    secure: z.boolean().optional(), user: z.string().trim().max(255).optional(), password: z.string().max(500).optional(),
    fromEmail: emailSchema.or(z.literal('')).optional(),
  }).strict().optional(),
  whatsapp: z.object({
    enabled: z.boolean(), phoneNumberId: z.string().trim().regex(/^\d{5,30}$/, 'Phone number ID is digits only').or(z.literal('')).optional(),
    token: z.string().trim().max(1500).optional(),
  }).strict().optional(),
}).strict();

router.put('/', requirePermission('settings.manage'), validate(schema), asyncHandler(async (req, res) => {
  const b = req.body;
  const tid = req.ctx.tenantId;

  if (b.replyTo !== undefined) {
    await db.exec(`MERGE hms.TenantSettings AS tgt USING (SELECT @tid AS TenantId, 'notify.reply_to' AS SettingKey) AS src
                     ON tgt.TenantId = src.TenantId AND tgt.SettingKey = src.SettingKey
                   WHEN MATCHED THEN UPDATE SET SettingValue = @v, UpdatedAt = SYSUTCDATETIME()
                   WHEN NOT MATCHED THEN INSERT (TenantId, SettingKey, SettingValue) VALUES (@tid, 'notify.reply_to', @v);`, { tid, v: b.replyTo || null });
  }

  if (b.email || b.whatsapp) {
    if (!allowed(req)) throw forbidden('Using your own e-mail or WhatsApp account is available on the Enterprise plan.', 'FEATURE_NOT_IN_PLAN');
    if (!config.messagingKey) throw new HttpError(503, 'NOT_CONFIGURED', 'The server administrator must set MESSAGING_ENCRYPTION_KEY before hospitals can save their own account details.');
    const cur = (await db.one('SELECT * FROM hms.TenantMessagingConfig WHERE TenantId = @tid', { tid })) || {};
    const e = b.email; const w = b.whatsapp;

    if (e?.enabled) {
      if (!e.host || !e.fromEmail) throw badRequest('SMTP server and From e-mail are required to turn on your own e-mail.');
      try { await assertPublicHost(e.host); } catch (err) { throw badRequest(err.message); }
      if (!e.password && !cur.SmtpPassEnc && e.user) throw badRequest('Enter the SMTP password.');
    }
    if (w?.enabled && (!w.phoneNumberId || (!w.token && !cur.WaTokenEnc))) throw badRequest('Phone number ID and access token are required to turn on your own WhatsApp.');

    const p = {
      tid, uid: req.ctx.userId,
      eOn: e ? e.enabled : Boolean(cur.EmailEnabled),
      host: e ? (e.host || null) : cur.SmtpHost ?? null, port: e ? (e.port || 587) : cur.SmtpPort ?? null,
      secure: e ? Boolean(e.secure) : Boolean(cur.SmtpSecure), user: e ? (e.user || null) : cur.SmtpUser ?? null,
      pass: e?.password ? seal(e.password, config.messagingKey) : cur.SmtpPassEnc ?? null,
      fromEmail: e ? (e.fromEmail || null) : cur.FromEmail ?? null,
      wOn: w ? w.enabled : Boolean(cur.WhatsAppEnabled),
      wid: w ? (w.phoneNumberId || null) : cur.WaPhoneNumberId ?? null,
      wtok: w?.token ? seal(w.token, config.messagingKey) : cur.WaTokenEnc ?? null,
    };
    await db.exec(`
      MERGE hms.TenantMessagingConfig AS tgt USING (SELECT @tid AS TenantId) AS src ON tgt.TenantId = src.TenantId
      WHEN MATCHED THEN UPDATE SET EmailEnabled = @eOn, SmtpHost = @host, SmtpPort = @port, SmtpSecure = @secure, SmtpUser = @user, SmtpPassEnc = @pass,
           FromEmail = @fromEmail, WhatsAppEnabled = @wOn, WaPhoneNumberId = @wid, WaTokenEnc = @wtok, UpdatedByUserId = @uid, UpdatedAt = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (TenantId, EmailEnabled, SmtpHost, SmtpPort, SmtpSecure, SmtpUser, SmtpPassEnc, FromEmail, WhatsAppEnabled, WaPhoneNumberId, WaTokenEnc, UpdatedByUserId)
           VALUES (@tid, @eOn, @host, @port, @secure, @user, @pass, @fromEmail, @wOn, @wid, @wtok, @uid);`, p);
  }

  clearSenderCache(tid);
  // Audit WHAT changed, never the secrets themselves.
  await auditTenant(req, 'messaging.settings_updated', 'tenant', tid, {
    replyTo: b.replyTo !== undefined, email: b.email ? { enabled: b.email.enabled, host: b.email.host, passwordChanged: Boolean(b.email.password) } : undefined,
    whatsapp: b.whatsapp ? { enabled: b.whatsapp.enabled, tokenChanged: Boolean(b.whatsapp.token) } : undefined,
  });
  res.json({ data: { ok: true } });
}));

const testLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, limit: 5, standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: (req) => `msgtest:${req.ctx?.tenantId ?? req.ip}`,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many test messages. Please wait a few minutes.' } },
});

router.post('/test', requirePermission('settings.manage'), testLimiter,
  validate(z.object({ channel: z.enum(['email', 'whatsapp']), to: z.string().trim().min(5).max(254) }).strict()
    .superRefine((v, ctx) => {
      if (v.channel === 'email' ? !isValidEmail(v.to.toLowerCase()) : !parsePhone(v.to)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: v.channel === 'email' ? 'Enter a valid e-mail address.' : 'Enter a valid WhatsApp number with country code.' });
      }
    })),
  asyncHandler(async (req, res) => {
    const { channel, to } = req.body;
    const content = channel === 'email'
      ? { subject: `Test message from ${req.ctx.tenantName}`, text: `This is a test e-mail from ${req.ctx.tenantName} via MediCore HMS. If you received it, e-mail sending works.`,
        html: `<p>This is a test e-mail from <strong>${req.ctx.tenantName.replace(/[<>&"]/g, '')}</strong> via MediCore HMS.</p><p>If you received it, e-mail sending works.</p>` }
      // Meta's built-in sample template, available on every WhatsApp Business account.
      : { template: 'hello_world', params: [], language: 'en_US', previewText: 'Hello World (WhatsApp test template)' };
    const r = await deliver({ channel, to, template: 'test_message', content, tenantId: req.ctx.tenantId, related: { type: 'test', id: req.ctx.userId } });
    await auditTenant(req, 'messaging.test_sent', 'tenant', req.ctx.tenantId, { channel, status: r.status, to: r.masked });
    res.json({ data: r });
  }));

export default router;
