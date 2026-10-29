import { randomUUID } from 'node:crypto';
import { db, withTransaction, t } from '../../db/pool.js';
import { getProvider } from '../../payments/index.js';
import { quote, addInterval } from '../../utils/pricing.js';
import { hashPassword, passwordProblem } from '../../utils/password.js';
import { validateSlug } from '../../utils/slug.js';
import { badRequest, conflict, notFound, HttpError } from '../../utils/errors.js';
import { audit } from '../../utils/audit.js';
import { provisionTenant, issueInvoice } from '../tenants/provisioning.js';

const ONBOARDING_TTL_MIN = 120;

export async function isSlugAvailable(slug) {
  const problem = validateSlug(slug);
  if (problem) return { available: false, reason: problem };
  const row = await db.one(
    `SELECT CASE WHEN EXISTS (SELECT 1 FROM dbo.Tenants WHERE Slug = @slug)
                   OR EXISTS (SELECT 1 FROM dbo.OnboardingRequests WHERE Slug = @slug
                              AND Status = 'paid')
            THEN 0 ELSE 1 END AS available`, { slug });
  return row.available ? { available: true } : { available: false, reason: 'This workspace name is already taken.' };
}

async function loadPurchasablePlan(planCode) {
  const plan = await db.one('SELECT * FROM dbo.Plans WHERE Code = @code AND IsActive = 1', { code: planCode });
  if (!plan) throw badRequest('Selected plan is not available.');
  if (plan.IsContactSales) throw badRequest('This plan is sold through our sales team. Please book a demo.');
  return plan;
}

/**
 * Step 1–5 of the purchase flow: validate, store a pending onboarding record, create a provider order.
 * Nothing is provisioned until the payment is verified server-side.
 */
export async function startCheckout(input, { ip }) {
  const pwProblem = passwordProblem(input.password);
  if (pwProblem) throw badRequest(pwProblem);
  // Unpaid checkouts do not reserve a name (so a failed/cancelled payment can be retried);
  // a race between two paid checkouts for the same name is caught at provisioning.
  const slugState = await isSlugAvailable(input.slug);
  if (!slugState.available) throw conflict(slugState.reason, 'SLUG_TAKEN');

  const plan = await loadPurchasablePlan(input.planCode);
  const q = quote(plan, input.interval);
  const provider = getProvider();
  const onboardingId = randomUUID();
  const ownerPasswordHash = await hashPassword(input.password);

  // Create the gateway order first; if it fails nothing is written.
  const order = await provider.createOrder({
    amountMinor: q.totalMinor,
    currency: q.currency,
    receipt: `onb_${onboardingId.slice(0, 30)}`,
    notes: { onboardingId, slug: input.slug, plan: plan.Code, interval: input.interval },
  });

  await withTransaction(async (tx) => {
    await tx.exec(
      `INSERT INTO dbo.OnboardingRequests (OnboardingId, PlanId, BillingInterval, OrgName, Slug, FacilityType, City, Phone,
         OwnerName, OwnerEmail, OwnerPasswordHash, Subtotal, TaxAmount, TotalAmount, Currency, ExpiresAt)
       VALUES (@id, @pid, @interval, @org, @slug, @ftype, @city, @phone, @owner, @email, @hash, @sub, @tax, @total, @cur,
         DATEADD(MINUTE, ${ONBOARDING_TTL_MIN}, SYSUTCDATETIME()))`,
      { id: t.uuid(onboardingId), pid: plan.PlanId, interval: input.interval, org: input.orgName, slug: input.slug,
        ftype: input.facilityType ?? null, city: input.city ?? null, phone: input.phone ?? null, owner: input.ownerName,
        email: input.ownerEmail, hash: ownerPasswordHash, sub: t.money(q.subtotal), tax: t.money(q.tax), total: t.money(q.total), cur: q.currency });
    await tx.exec(
      `INSERT INTO dbo.Payments (OnboardingId, Purpose, PlanId, BillingInterval, Provider, IsSandbox, ProviderOrderId, Subtotal, TaxAmount, Amount, Currency)
       VALUES (@oid, 'onboarding', @pid, @interval, @provider, @sbx, @order, @sub, @tax, @total, @cur)`,
      { oid: t.uuid(onboardingId), pid: plan.PlanId, interval: input.interval, provider: provider.name, sbx: provider.isSandbox,
        order: order.orderId, sub: t.money(q.subtotal), tax: t.money(q.tax), total: t.money(q.total), cur: q.currency });
    await audit({ actorType: 'public', action: 'onboarding.checkout_started', entityType: 'onboarding', entityId: onboardingId,
      metadata: { slug: input.slug, plan: plan.Code, interval: input.interval, provider: provider.name }, ip }, tx);
  });

  return {
    onboardingId,
    plan: { code: plan.Code, name: plan.Name },
    amount: q,
    payment: { ...order.checkout, isSandbox: provider.isSandbox, prefill: { name: input.ownerName, email: input.ownerEmail, contact: input.phone } },
  };
}

/**
 * Idempotently marks an order as paid and performs its side effects (provisioning or renewal).
 * Called from the verified checkout callback AND from signed webhooks — whichever arrives first wins,
 * the other becomes a no-op thanks to the row lock + status check.
 */
export async function finalizePaidOrder({ providerName, orderId, paymentId, source, ip = null }) {
  return withTransaction(async (tx) => {
    const pay = await tx.one(
      `SELECT * FROM dbo.Payments WITH (UPDLOCK, ROWLOCK) WHERE Provider = @provider AND ProviderOrderId = @order`,
      { provider: providerName, order: orderId });
    if (!pay) throw notFound('Payment order not found.');

    if (pay.Status === 'paid') {
      return { alreadyProcessed: true, tenantId: pay.TenantId, purpose: pay.Purpose, onboardingId: pay.OnboardingId };
    }
    if (!['created', 'failed'].includes(pay.Status)) {
      throw conflict(`Payment is ${pay.Status} and cannot be completed.`, 'PAYMENT_STATE');
    }

    await tx.exec(
      `UPDATE dbo.Payments SET Status = 'paid', ProviderPaymentId = @pp, PaidAt = SYSUTCDATETIME(), FailureReason = NULL, UpdatedAt = SYSUTCDATETIME()
       WHERE PaymentId = @id`, { pp: paymentId, id: pay.PaymentId });

    const paymentInfo = { paymentId: pay.PaymentId, subtotal: pay.Subtotal, tax: pay.TaxAmount, total: pay.Amount, currency: pay.Currency, isSandbox: pay.IsSandbox };

    if (pay.Purpose === 'onboarding') {
      const o = await tx.one('SELECT o.*, p.Name AS PlanName FROM dbo.OnboardingRequests o WITH (UPDLOCK) JOIN dbo.Plans p ON p.PlanId = o.PlanId WHERE o.OnboardingId = @id',
        { id: t.uuid(pay.OnboardingId) });
      if (o.Status === 'provisioned') return { alreadyProcessed: true, tenantId: o.TenantId, purpose: 'onboarding', onboardingId: o.OnboardingId };

      const slugTaken = await tx.one('SELECT TenantId FROM dbo.Tenants WITH (UPDLOCK, HOLDLOCK) WHERE Slug = @slug', { slug: o.Slug });
      if (slugTaken) {
        // Extremely rare race. Money was received: flag for manual follow-up/refund rather than losing it.
        await tx.exec(`UPDATE dbo.OnboardingRequests SET Status = 'paid', FailureReason = 'Slug taken at provisioning; needs manual action', UpdatedAt = SYSUTCDATETIME() WHERE OnboardingId = @id`,
          { id: t.uuid(o.OnboardingId) });
        await audit({ actorType: 'system', action: 'onboarding.provision_blocked', entityType: 'onboarding', entityId: o.OnboardingId, metadata: { slug: o.Slug, source }, ip }, tx);
        return { alreadyProcessed: false, tenantId: null, needsAttention: true, purpose: 'onboarding', onboardingId: o.OnboardingId };
      }

      const result = await provisionTenant(tx, {
        orgName: o.OrgName, slug: o.Slug, facilityType: o.FacilityType, city: o.City, phone: o.Phone,
        ownerName: o.OwnerName, ownerEmail: o.OwnerEmail, ownerPasswordHash: o.OwnerPasswordHash, planName: o.PlanName,
      }, { planId: o.PlanId, interval: o.BillingInterval }, paymentInfo, { type: 'system', id: null, ip });

      await tx.exec(`UPDATE dbo.OnboardingRequests SET Status = 'provisioned', TenantId = @tid, OwnerPasswordHash = N'(moved to Users)', UpdatedAt = SYSUTCDATETIME() WHERE OnboardingId = @id`,
        { tid: result.tenantId, id: t.uuid(o.OnboardingId) });
      return { alreadyProcessed: false, purpose: 'onboarding', onboardingId: o.OnboardingId, ...result };
    }

    if (pay.Purpose === 'renewal') {
      const sub = await tx.one('SELECT * FROM dbo.Subscriptions WITH (UPDLOCK) WHERE SubscriptionId = @sid AND TenantId = @tid',
        { sid: pay.SubscriptionId, tid: pay.TenantId });
      const now = new Date();
      const currentEnd = new Date(sub.CurrentPeriodEnd);
      const start = currentEnd > now ? currentEnd : now; // early renewal stacks; late renewal starts today
      const end = addInterval(start, pay.BillingInterval);
      await tx.exec(
        `UPDATE dbo.Subscriptions SET Status = 'active', PlanId = @pid, BillingInterval = @interval,
           CurrentPeriodStart = @start, CurrentPeriodEnd = @end, CancelAtPeriodEnd = 0, UpdatedAt = SYSUTCDATETIME()
         WHERE SubscriptionId = @sid AND TenantId = @tid`,
        { pid: pay.PlanId, interval: pay.BillingInterval, start, end, sid: sub.SubscriptionId, tid: pay.TenantId });
      const plan = await tx.one('SELECT Name FROM dbo.Plans WHERE PlanId = @id', { id: pay.PlanId });
      const invoiceNumber = await issueInvoice(tx, { tenantId: pay.TenantId, payment: paymentInfo, description: `${plan?.Name ?? 'Subscription'} renewal — ${pay.BillingInterval}` });
      await audit({ tenantId: pay.TenantId, actorType: 'system', action: 'subscription.renewed', entityType: 'subscription', entityId: sub.SubscriptionId,
        metadata: { periodEnd: end.toISOString(), source }, ip }, tx);
      return { alreadyProcessed: false, purpose: 'renewal', tenantId: pay.TenantId, invoiceNumber };
    }
    throw new HttpError(500, 'UNKNOWN_PURPOSE', 'Unknown payment purpose.');
  });
}

export async function markOrderFailed({ providerName, orderId, reason }) {
  await db.exec(
    `UPDATE dbo.Payments SET Status = 'failed', FailureReason = @reason, UpdatedAt = SYSUTCDATETIME()
     WHERE Provider = @provider AND ProviderOrderId = @order AND Status = 'created'`,
    { provider: providerName, order: orderId, reason: reason?.slice(0, 500) ?? 'Payment failed' });
}

/**
 * Records a webhook event. Returns false only if the same event was already PROCESSED, so a delivery
 * that failed midway is retried safely (finalisation itself is idempotent per order).
 */
export async function recordWebhookEvent(providerName, evt) {
  try {
    await db.exec(
      `INSERT INTO dbo.PaymentEvents (Provider, ProviderEventId, EventType, ProviderOrderId) VALUES (@p, @e, @type, @order)`,
      { p: providerName, e: evt.eventId, type: evt.type, order: evt.orderId });
    return true;
  } catch (err) {
    if (err?.number !== 2627 && err?.number !== 2601) throw err;
    const row = await db.one('SELECT ProcessedAt FROM dbo.PaymentEvents WHERE Provider = @p AND ProviderEventId = @e',
      { p: providerName, e: evt.eventId });
    return !row?.ProcessedAt;
  }
}

export async function completeWebhookEvent(providerName, eventId, outcome) {
  await db.exec('UPDATE dbo.PaymentEvents SET ProcessedAt = SYSUTCDATETIME(), Outcome = @o WHERE Provider = @p AND ProviderEventId = @e',
    { p: providerName, e: eventId, o: outcome?.slice(0, 200) ?? null });
}

export async function getOnboardingStatus(onboardingId) {
  const row = await db.one(
    `SELECT o.Status, o.Slug, o.OrgName, o.TenantId, o.FailureReason, p.Status AS PaymentStatus
     FROM dbo.OnboardingRequests o
     LEFT JOIN dbo.Payments p ON p.OnboardingId = o.OnboardingId
     WHERE o.OnboardingId = @id`, { id: t.uuid(onboardingId) });
  if (!row) throw notFound('Onboarding request not found.');
  return { status: row.Status, paymentStatus: row.PaymentStatus, slug: row.Slug, orgName: row.OrgName, needsAttention: Boolean(row.FailureReason) };
}
