import { randomUUID } from 'node:crypto';
import { db, withTransaction, t } from '../../db/pool.js';
import { getProvider } from '../../payments/index.js';
import { quote, addInterval } from '../../utils/pricing.js';
import { hashPassword, passwordProblem } from '../../utils/password.js';
import { validateSlug } from '../../utils/slug.js';
import { badRequest, conflict, notFound, HttpError } from '../../utils/errors.js';
import { audit } from '../../utils/audit.js';
import { provisionTenant } from '../tenants/provisioning.js';
import { invoiceForPayment, invoiceForFree } from '../invoices/invoice.service.js';

const ONBOARDING_TTL_MIN = 120;

export async function isSlugAvailable(slug) {
  const problem = validateSlug(slug);
  if (problem) return { available: false, reason: problem };
  const row = await db.one(
    `/* tenant-safe: runs before the hospital exists */ SELECT CASE WHEN EXISTS (SELECT 1 FROM hms.Tenants WHERE Slug = @slug)
                   OR EXISTS (SELECT 1 FROM hms.OnboardingRequests WHERE Slug = @slug
                              AND Status = 'paid')
            THEN 0 ELSE 1 END AS available`, { slug });
  return row.available ? { available: true } : { available: false, reason: 'This workspace name is already taken.' };
}

async function loadPurchasablePlan(planCode) {
  const plan = await db.one('/* tenant-safe: platform plan catalogue */ SELECT * FROM hms.Plans WHERE Code = @code AND IsActive = 1', { code: planCode });
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
  if (plan.IsFree) return registerFree(plan, input, { ip });
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
      `/* tenant-safe: runs before the hospital exists */ INSERT INTO hms.OnboardingRequests (OnboardingId, PlanId, BillingInterval, OrgName, Slug, FacilityType, City, State, Country, Phone,
         OwnerName, OwnerEmail, OwnerPasswordHash, Subtotal, TaxAmount, TotalAmount, Currency, ExpiresAt)
       VALUES (@id, @pid, @interval, @org, @slug, @ftype, @city, @state, @country, @phone, @owner, @email, @hash, @sub, @tax, @total, @cur,
         DATEADD(MINUTE, ${ONBOARDING_TTL_MIN}, SYSUTCDATETIME()))`,
      { id: t.uuid(onboardingId), pid: plan.PlanId, interval: input.interval, org: input.orgName, slug: input.slug,
        ftype: input.facilityType ?? null, city: input.city ?? null, state: input.state ?? null, country: input.country ?? null, phone: input.phone ?? null, owner: input.ownerName,
        email: input.ownerEmail, hash: ownerPasswordHash, sub: t.money(q.subtotal), tax: t.money(q.tax), total: t.money(q.total), cur: q.currency });
    await tx.exec(
      `/* tenant-safe: runs before the hospital exists */ INSERT INTO hms.Payments (OnboardingId, Purpose, PlanId, BillingInterval, Provider, IsSandbox, ProviderOrderId, Subtotal, TaxAmount, Amount, Currency)
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
 * "Free for now" sign-up: the plan is free, so the workspace is created immediately — through the SAME
 * provisionTenant() as a paid sign-up (own tenant row, roles, owner, defaults, numbering), only without a payment.
 * The subscription is marked IsFree so it can be moved to paid later (see setPlansFree).
 */
async function registerFree(plan, input, { ip }) {
  // One free workspace per owner e-mail, so the free offer can't be farmed.
  const dup = await db.one(
    `/* tenant-safe: platform-level check across hospitals before sign-up */ SELECT TOP 1 1 AS x FROM hms.Users u
       JOIN hms.Subscriptions s ON s.TenantId = u.TenantId AND s.IsFree = 1
     WHERE u.IsOwner = 1 AND u.Email = @email`, { email: input.ownerEmail.toLowerCase() });
  if (dup) throw conflict('This e-mail already has a free workspace. Please sign in to it instead.', 'FREE_LIMIT');

  const onboardingId = randomUUID();
  const ownerPasswordHash = await hashPassword(input.password);
  const result = await withTransaction(async (tx) => {
    const taken = await tx.one('/* tenant-safe: slug lock before the hospital exists */ SELECT TenantId FROM hms.Tenants WITH (UPDLOCK, HOLDLOCK) WHERE Slug = @slug', { slug: input.slug });
    if (taken) throw conflict('This workspace name is already taken.', 'SLUG_TAKEN');
    const r = await provisionTenant(tx, {
      orgName: input.orgName, slug: input.slug, facilityType: input.facilityType, city: input.city, state: input.state, country: input.country, phone: input.phone,
      ownerName: input.ownerName, ownerEmail: input.ownerEmail, ownerPasswordHash, planName: plan.Name,
    }, { planId: plan.PlanId, interval: input.interval, isFree: true }, null, { type: 'public', id: null, ip });
    // Keep the same paper trail as a paid sign-up (amount 0, already provisioned).
    await tx.exec(
      `/* tenant-safe: onboarding record */ INSERT INTO hms.OnboardingRequests (OnboardingId, PlanId, BillingInterval, OrgName, Slug, FacilityType, City, State, Country, Phone,
         OwnerName, OwnerEmail, OwnerPasswordHash, Subtotal, TaxAmount, TotalAmount, Currency, Status, TenantId, ExpiresAt)
       VALUES (@id, @pid, @interval, @org, @slug, @ftype, @city, @state, @country, @phone, @owner, @email, N'(moved to Users)', 0, 0, 0, @cur, 'provisioned', @tid, SYSUTCDATETIME())`,
      { id: t.uuid(onboardingId), pid: plan.PlanId, interval: input.interval, org: input.orgName, slug: input.slug,
        ftype: input.facilityType ?? null, city: input.city ?? null, state: input.state ?? null, country: input.country ?? null, phone: input.phone ?? null, owner: input.ownerName,
        email: input.ownerEmail, cur: plan.Currency || 'INR', tid: r.tenantId });
    // ₹0 invoice so the hospital (and the platform) has an official record of the free subscription.
    await invoiceForFree(tx, { tenantId: r.tenantId, plan, interval: input.interval, subscriptionId: r.subscriptionId, periodStart: r.periodStart, periodEnd: r.periodEnd });
    await audit({ tenantId: r.tenantId, actorType: 'public', action: 'onboarding.free_signup', entityType: 'onboarding', entityId: onboardingId,
      metadata: { slug: input.slug, plan: plan.Code, interval: input.interval }, ip }, tx);
    return r;
  });
  return {
    onboardingId, free: true, provisioned: true, slug: input.slug,
    plan: { code: plan.Code, name: plan.Name },
    tenantId: result.tenantId, ownerUserId: result.ownerUserId,
  };
}

/**
 * Super Admin switch. free=true: the plan(s) become free for new sign-ups and free renewals.
 * free=false: charging starts again; every hospital on a FREE subscription of those plans keeps access for
 * `noticeDays` more (or until its current end, if sooner) and is then asked to pay through the normal renewal
 * (reminder e-mails, grace period, read-only — nothing is deleted).
 */
export async function setPlansFree(tx, { planIds, free, noticeDays }) {
  const changed = [];
  let movedToPaid = 0;
  for (const planId of planIds) {
    const plan = await tx.one('/* tenant-safe: platform plan catalogue */ SELECT PlanId, Code, IsFree, IsContactSales FROM hms.Plans WITH (UPDLOCK) WHERE PlanId = @id', { id: planId });
    if (!plan) throw notFound('Plan not found.');
    if (plan.IsContactSales) {
      if (free) throw badRequest('A contact-sales plan cannot be made free. Give it prices first.');
      continue;
    }
    if (Boolean(plan.IsFree) === free) continue;
    await tx.exec(`/* tenant-safe: platform plan catalogue */ UPDATE hms.Plans SET IsFree = @free, FreeSince = CASE WHEN @free = 1 THEN SYSUTCDATETIME() ELSE NULL END,
                     UpdatedAt = SYSUTCDATETIME() WHERE PlanId = @id`, { id: planId, free });
    if (!free) {
      const noticeEnd = new Date(Date.now() + noticeDays * 86400000);
      movedToPaid += await tx.exec(
        `/* tenant-safe: platform-wide switch from free to paid, one plan at a time */ UPDATE hms.Subscriptions
           SET CurrentPeriodEnd = CASE WHEN CurrentPeriodEnd < @end THEN CurrentPeriodEnd ELSE @end END,
               IsFree = 0, UpdatedAt = SYSUTCDATETIME()
         WHERE PlanId = @id AND IsFree = 1 AND Status IN ('active', 'past_due')`, { id: planId, end: noticeEnd });
    }
    changed.push(plan.Code);
  }
  return { changed, movedToPaid };
}

/** Free renewal from the hospital's Subscription page while its chosen plan is free. */
export async function renewFree(tenantId, plan, interval) {
  return withTransaction(async (tx) => {
    const sub = await tx.one('SELECT TOP 1 * FROM hms.Subscriptions WITH (UPDLOCK) WHERE TenantId = @tid ORDER BY CurrentPeriodEnd DESC', { tid: tenantId });
    if (!sub) throw notFound('No subscription found.');
    const now = new Date();
    const currentEnd = new Date(sub.CurrentPeriodEnd);
    // A paid period that is still running is kept: the free period starts after it.
    const start = currentEnd > now ? currentEnd : now;
    // Never stack more than one free period ahead (stops "renew 50 times" while it's free).
    if (sub.IsFree && currentEnd > addInterval(now, 'monthly')) throw badRequest('Your free plan is already active. You can extend it closer to the end date.');
    const end = addInterval(start, interval);
    await tx.exec(
      `UPDATE hms.Subscriptions SET Status = 'active', PlanId = @pid, BillingInterval = @interval, CurrentPeriodStart = @start,
         CurrentPeriodEnd = @end, CancelAtPeriodEnd = 0, IsFree = 1, UpdatedAt = SYSUTCDATETIME()
       WHERE SubscriptionId = @sid AND TenantId = @tid`,
      { pid: plan.PlanId, interval, start, end, sid: sub.SubscriptionId, tid: tenantId });
    const { invoiceNumber } = await invoiceForFree(tx, { tenantId, plan, interval, subscriptionId: sub.SubscriptionId, periodStart: start, periodEnd: end, renewal: true });
    return { periodEnd: end, invoiceNumber }; // audited by the route (with the user who clicked)
  });
}

/**
 * Idempotently marks an order as paid and performs its side effects (provisioning or renewal).
 * Called from the verified checkout callback AND from signed webhooks — whichever arrives first wins,
 * the other becomes a no-op thanks to the row lock + status check.
 */
export async function finalizePaidOrder({ providerName, orderId, paymentId, source, ip = null }) {
  return withTransaction(async (tx) => {
    const pay = await tx.one(
      `/* tenant-safe: runs before the hospital exists */ SELECT * FROM hms.Payments WITH (UPDLOCK, ROWLOCK) WHERE Provider = @provider AND ProviderOrderId = @order`,
      { provider: providerName, order: orderId });
    if (!pay) throw notFound('Payment order not found.');

    if (pay.Status === 'paid') {
      return { alreadyProcessed: true, tenantId: pay.TenantId, purpose: pay.Purpose, onboardingId: pay.OnboardingId };
    }
    if (!['created', 'failed'].includes(pay.Status)) {
      throw conflict(`Payment is ${pay.Status} and cannot be completed.`, 'PAYMENT_STATE');
    }

    await tx.exec(
      `/* tenant-safe: runs before the hospital exists */ UPDATE hms.Payments SET Status = 'paid', ProviderPaymentId = @pp, PaidAt = SYSUTCDATETIME(), FailureReason = NULL, UpdatedAt = SYSUTCDATETIME()
       WHERE PaymentId = @id`, { pp: paymentId, id: pay.PaymentId });

    const paymentInfo = { paymentId: pay.PaymentId, subtotal: pay.Subtotal, tax: pay.TaxAmount, total: pay.Amount, currency: pay.Currency, isSandbox: pay.IsSandbox, providerPaymentId: paymentId };

    if (pay.Purpose === 'onboarding') {
      const o = await tx.one('SELECT o.*, p.Name AS PlanName FROM hms.OnboardingRequests o WITH (UPDLOCK) JOIN hms.Plans p ON p.PlanId = o.PlanId WHERE o.OnboardingId = @id',
        { id: t.uuid(pay.OnboardingId) });
      if (o.Status === 'provisioned') return { alreadyProcessed: true, tenantId: o.TenantId, purpose: 'onboarding', onboardingId: o.OnboardingId };

      const slugTaken = await tx.one('SELECT TenantId FROM hms.Tenants WITH (UPDLOCK, HOLDLOCK) WHERE Slug = @slug', { slug: o.Slug });
      if (slugTaken) {
        // Extremely rare race. Money was received: flag for manual follow-up/refund rather than losing it.
        await tx.exec(`/* tenant-safe: runs before the hospital exists */ UPDATE hms.OnboardingRequests SET Status = 'paid', FailureReason = 'Slug taken at provisioning; needs manual action', UpdatedAt = SYSUTCDATETIME() WHERE OnboardingId = @id`,
          { id: t.uuid(o.OnboardingId) });
        await audit({ actorType: 'system', action: 'onboarding.provision_blocked', entityType: 'onboarding', entityId: o.OnboardingId, metadata: { slug: o.Slug, source }, ip }, tx);
        return { alreadyProcessed: false, tenantId: null, needsAttention: true, purpose: 'onboarding', onboardingId: o.OnboardingId };
      }

      const result = await provisionTenant(tx, {
        orgName: o.OrgName, slug: o.Slug, facilityType: o.FacilityType, city: o.City, state: o.State, country: o.Country, phone: o.Phone,
        ownerName: o.OwnerName, ownerEmail: o.OwnerEmail, ownerPasswordHash: o.OwnerPasswordHash, planName: o.PlanName,
      }, { planId: o.PlanId, interval: o.BillingInterval }, paymentInfo, { type: 'system', id: null, ip });

      await tx.exec(`UPDATE hms.OnboardingRequests SET Status = 'provisioned', TenantId = @tid, OwnerPasswordHash = N'(moved to Users)', UpdatedAt = SYSUTCDATETIME() WHERE OnboardingId = @id`,
        { tid: result.tenantId, id: t.uuid(o.OnboardingId) });
      return { alreadyProcessed: false, purpose: 'onboarding', onboardingId: o.OnboardingId, ...result };
    }

    if (pay.Purpose === 'renewal') {
      const sub = await tx.one('SELECT * FROM hms.Subscriptions WITH (UPDLOCK) WHERE SubscriptionId = @sid AND TenantId = @tid',
        { sid: pay.SubscriptionId, tid: pay.TenantId });
      const now = new Date();
      const currentEnd = new Date(sub.CurrentPeriodEnd);
      const start = currentEnd > now ? currentEnd : now; // early renewal stacks; late renewal starts today
      const end = addInterval(start, pay.BillingInterval);
      await tx.exec(
        `UPDATE hms.Subscriptions SET Status = 'active', PlanId = @pid, BillingInterval = @interval,
           CurrentPeriodStart = @start, CurrentPeriodEnd = @end, CancelAtPeriodEnd = 0, IsFree = 0, UpdatedAt = SYSUTCDATETIME()
         WHERE SubscriptionId = @sid AND TenantId = @tid`,
        { pid: pay.PlanId, interval: pay.BillingInterval, start, end, sid: sub.SubscriptionId, tid: pay.TenantId });
      const plan = await tx.one('SELECT Name FROM hms.Plans WHERE PlanId = @id', { id: pay.PlanId });
      const { invoiceNumber } = await invoiceForPayment(tx, { tenantId: pay.TenantId, payment: paymentInfo, description: `${plan?.Name ?? 'Subscription'} renewal — ${pay.BillingInterval}`,
        subscriptionId: sub.SubscriptionId, planId: pay.PlanId, interval: pay.BillingInterval, periodStart: start, periodEnd: end });
      await audit({ tenantId: pay.TenantId, actorType: 'system', action: 'subscription.renewed', entityType: 'subscription', entityId: sub.SubscriptionId,
        metadata: { periodEnd: end.toISOString(), source }, ip }, tx);
      return { alreadyProcessed: false, purpose: 'renewal', tenantId: pay.TenantId, invoiceNumber };
    }
    throw new HttpError(500, 'UNKNOWN_PURPOSE', 'Unknown payment purpose.');
  });
}

export async function markOrderFailed({ providerName, orderId, reason }) {
  await db.exec(
    `/* tenant-safe: runs before the hospital exists */ UPDATE hms.Payments SET Status = 'failed', FailureReason = @reason, UpdatedAt = SYSUTCDATETIME()
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
      `INSERT INTO hms.PaymentEvents (Provider, ProviderEventId, EventType, ProviderOrderId) VALUES (@p, @e, @type, @order)`,
      { p: providerName, e: evt.eventId, type: evt.type, order: evt.orderId });
    return true;
  } catch (err) {
    if (err?.number !== 2627 && err?.number !== 2601) throw err;
    const row = await db.one('SELECT ProcessedAt FROM hms.PaymentEvents WHERE Provider = @p AND ProviderEventId = @e',
      { p: providerName, e: evt.eventId });
    return !row?.ProcessedAt;
  }
}

export async function completeWebhookEvent(providerName, eventId, outcome) {
  await db.exec('UPDATE hms.PaymentEvents SET ProcessedAt = SYSUTCDATETIME(), Outcome = @o WHERE Provider = @p AND ProviderEventId = @e',
    { p: providerName, e: eventId, o: outcome?.slice(0, 200) ?? null });
}

export async function getOnboardingStatus(onboardingId) {
  const row = await db.one(
    `SELECT o.Status, o.Slug, o.OrgName, o.TenantId, o.FailureReason, p.Status AS PaymentStatus
     FROM hms.OnboardingRequests o
     LEFT JOIN hms.Payments p ON p.OnboardingId = o.OnboardingId
     WHERE o.OnboardingId = @id`, { id: t.uuid(onboardingId) });
  if (!row) throw notFound('Onboarding request not found.');
  return { status: row.Status, paymentStatus: row.PaymentStatus, slug: row.Slug, orgName: row.OrgName, needsAttention: Boolean(row.FailureReason) };
}
