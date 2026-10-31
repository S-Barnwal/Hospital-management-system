import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, badRequest, notFound, forbidden } from '../../utils/errors.js';
import { db, t } from '../../db/pool.js';
import { config } from '../../config/env.js';
import { getProvider } from '../../payments/index.js';
import { normaliseSlug } from '../../utils/slug.js';
import { audit } from '../../utils/audit.js';
import { createSession, setAuthCookies } from '../auth/auth.service.js';
import {
  isSlugAvailable, startCheckout, finalizePaidOrder, markOrderFailed, getOnboardingStatus, previewCoupon,
  recordWebhookEvent, completeWebhookEvent,
} from './onboarding.service.js';

const router = Router();
const checkoutLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: 'draft-7', legacyHeaders: false });

import { FACILITY_TYPES } from '../../utils/constants.js';
import { phoneSchema, emailSchema, withLocation } from '../../utils/contact.js';

const checkoutSchema = withLocation(z.object({
  planCode: z.string().trim().min(1).max(50),
  interval: z.enum(['monthly', 'annual']),
  orgName: z.string().trim().min(2).max(200),
  slug: z.string().trim().transform(normaliseSlug),
  facilityType: z.enum(FACILITY_TYPES).optional(),
  phone: phoneSchema,
  ownerName: z.string().trim().min(2).max(150),
  ownerEmail: emailSchema,
  password: z.string().min(1, 'Choose a password (10+ characters with letters and numbers).').max(128),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'You must accept the terms.' }) }),
  couponCode: z.string().trim().max(30).optional(),
  trial: z.boolean().optional(),   // start the plan's free trial instead of paying now
}).strict(), { required: true });

router.get('/slug-availability', asyncHandler(async (req, res) => {
  const slug = normaliseSlug(req.query.slug);
  res.json({ data: { slug, ...(await isSlugAvailable(slug)) } });
}));

/** Price preview for a coupon on the sign-up page (no side effects). */
router.post('/coupon-preview', checkoutLimiter,
  validate(z.object({ planCode: z.string().trim().min(1).max(50), interval: z.enum(['monthly', 'annual']), couponCode: z.string().trim().min(1).max(30) }).strict()),
  asyncHandler(async (req, res) => {
    res.json({ data: await previewCoupon(req.body) });
  }));

router.post('/checkout', checkoutLimiter, validate(checkoutSchema), asyncHandler(async (req, res) => {
  const result = await startCheckout(req.body, { ip: req.ip });
  if (result.free || result.trial) {
    // Free plan / free trial: the workspace already exists — sign the new owner straight in, exactly like after a paid sign-up.
    const { tenantId, ownerUserId, ...publicResult } = result;
    const session = await createSession({ subjectType: 'tenant', subjectId: ownerUserId, tenantId, userAgent: req.get('user-agent'), ip: req.ip });
    setAuthCookies(res, 'tenant', session);
    return res.status(201).json({ data: publicResult });
  }
  return res.status(201).json({ data: result });
}));

const verifySchema = z.object({
  onboardingId: z.string().uuid(),
  orderId: z.string().min(5).max(100),
  paymentId: z.string().min(5).max(100),
  signature: z.string().min(16).max(200),
}).strict();

/**
 * Called by the browser after the gateway's checkout succeeds. The signature is verified on the server;
 * a frontend "success" alone never activates anything.
 */
router.post('/verify', checkoutLimiter, validate(verifySchema), asyncHandler(async (req, res) => {
  const { onboardingId, orderId, paymentId, signature } = req.body;
  const pay = await db.one('SELECT Provider FROM hms.Payments WHERE ProviderOrderId = @order AND OnboardingId = @oid',
    { order: orderId, oid: t.uuid(onboardingId) });
  if (!pay) throw notFound('Order not found for this onboarding request.');
  const provider = getProvider(pay.Provider);
  if (!provider.verifyCheckout({ orderId, paymentId, signature })) {
    await audit({ actorType: 'public', action: 'onboarding.signature_invalid', entityType: 'onboarding', entityId: onboardingId, ip: req.ip });
    throw badRequest('Payment verification failed.');
  }
  const result = await finalizePaidOrder({ providerName: provider.name, orderId, paymentId, source: 'checkout', ip: req.ip });

  const status = await getOnboardingStatus(onboardingId);
  if (status.status === 'provisioned') {
    // Sign the new owner straight in.
    const owner = await db.one(
      `SELECT u.UserId, u.TenantId FROM hms.Users u JOIN hms.OnboardingRequests o ON o.TenantId = u.TenantId
       WHERE o.OnboardingId = @oid AND u.IsOwner = 1 AND u.Email = o.OwnerEmail`, { oid: t.uuid(onboardingId) });
    if (owner) {
      const session = await createSession({ subjectType: 'tenant', subjectId: owner.UserId, tenantId: owner.TenantId, userAgent: req.get('user-agent'), ip: req.ip });
      setAuthCookies(res, 'tenant', session);
    }
  }
  res.json({ data: { ...status, alreadyProcessed: result.alreadyProcessed, invoiceNumber: result.invoiceNumber ?? null } });
}));

router.get('/:id/status', asyncHandler(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) throw badRequest('Invalid id.');
  res.json({ data: await getOnboardingStatus(id.data) });
}));

/**
 * SANDBOX GATEWAY — development only. Simulates the hosted payment page:
 * outcome=success returns a signed (paymentId, signature) pair; outcome=failure marks the order failed.
 */
router.post('/sandbox/pay', validate(z.object({ orderId: z.string().startsWith('sandbox_order_'), outcome: z.enum(['success', 'failure']) }).strict()),
  asyncHandler(async (req, res) => {
    if (config.isProd || config.payments.provider !== 'sandbox') throw forbidden('Sandbox payments are disabled.');
    const provider = getProvider('sandbox');
    if (req.body.outcome === 'failure') {
      await markOrderFailed({ providerName: 'sandbox', orderId: req.body.orderId, reason: 'Sandbox: simulated failure' });
      return res.json({ data: { status: 'failed' } });
    }
    const paymentId = `sandbox_pay_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    return res.json({ data: { status: 'authorised', orderId: req.body.orderId, paymentId, signature: provider.sign(req.body.orderId, paymentId) } });
  }));

export default router;

/**
 * Provider webhooks. Mounted with express.raw() so the signature is computed over the exact bytes received.
 * Idempotent: each provider event id is processed at most once (hms.PaymentEvents), and finalisation itself
 * is idempotent per order.
 */
export const webhookHandler = asyncHandler(async (req, res) => {
  const providerName = String(req.params.provider || '').toLowerCase();
  if (providerName !== 'razorpay') return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown provider.' } });
  const provider = getProvider('razorpay');
  const evt = provider.parseWebhook(req.body, req.headers);
  if (!evt) return res.status(400).json({ error: { code: 'BAD_SIGNATURE', message: 'Invalid webhook signature.' } });

  const fresh = await recordWebhookEvent(providerName, evt);
  if (!fresh) return res.json({ data: { duplicate: true } });

  let outcome = 'ignored';
  if (evt.status === 'paid' && evt.orderId && evt.paymentId) {
    const r = await finalizePaidOrder({ providerName, orderId: evt.orderId, paymentId: evt.paymentId, source: 'webhook' });
    outcome = r.alreadyProcessed ? 'already_processed' : `processed:${r.purpose}`;
  } else if (evt.status === 'failed' && evt.orderId) {
    await markOrderFailed({ providerName, orderId: evt.orderId, reason: evt.failureReason });
    outcome = 'marked_failed';
  }
  await completeWebhookEvent(providerName, evt.eventId, outcome);
  return res.json({ data: { ok: true } });
});
