// Pure decision logic for tenant access (no DB, no Express) — unit-tested in tests/unit.
import { forbidden, unauthorized, HttpError } from '../utils/errors.js';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Derives the effective subscription state.
 *  active   – inside the paid period
 *  grace    – period ended but within GraceDays: full access + renewal warnings
 *  expired  – after grace: read-only access, data is NEVER deleted automatically
 *  none     – no subscription row
 */
export function subscriptionState(sub, now = new Date()) {
  if (!sub) return { state: 'none', daysLeft: null };
  if (sub.Status === 'cancelled') return { state: 'expired', daysLeft: 0 };
  // On a free subscription of a plan that is STILL free, the hospital never lapses (the period is rolled forward).
  if (sub.FreeNow) return { state: 'active', daysLeft: null, free: true, periodEnd: new Date(sub.CurrentPeriodEnd) };
  const end = new Date(sub.CurrentPeriodEnd).getTime();
  const graceEnd = end + (sub.GraceDays ?? 7) * DAY;
  const t = now.getTime();
  if (t < end) return { state: 'active', daysLeft: Math.ceil((end - t) / DAY), periodEnd: new Date(end) };
  if (t < graceEnd) return { state: 'grace', daysLeft: Math.ceil((graceEnd - t) / DAY), periodEnd: new Date(end) };
  return { state: 'expired', daysLeft: 0, periodEnd: new Date(end) };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// Routes that must keep working even when the subscription has lapsed or the tenant is suspended.
const ALWAYS_ALLOWED_PREFIXES = ['/api/v1/auth/', '/api/v1/tenant/me', '/api/v1/subscription', '/api/v1/support/'];
// A suspended or lapsed hospital must still be able to write to support (that is how it gets help).
const WRITABLE_WHEN_BLOCKED = ['/api/v1/support/'];

/**
 * Validates a tenant request. `row` is the DB result for (token user, token tenant, token session).
 * Returns the request context or throws an HttpError.
 */
export function evaluateTenantAccess({ payload, row, hostSlug, method, path, now = new Date() }) {
  if (!payload || payload.typ !== 'tenant') throw unauthorized();
  if (!row || !row.SessionValid) throw unauthorized('Your session has ended. Please sign in again.');
  if (row.UserStatus !== 'active') throw unauthorized('This account is disabled.');

  // Tenant derived ONLY from the server-side session. A subdomain may narrow it but never change it.
  if (hostSlug && hostSlug !== row.Slug) {
    throw forbidden('This account does not belong to this hospital workspace.', 'TENANT_MISMATCH');
  }

  const alwaysAllowed = ALWAYS_ALLOWED_PREFIXES.some((p) => path.startsWith(p));
  const writableWhenBlocked = WRITABLE_WHEN_BLOCKED.some((p) => path.startsWith(p));
  if (row.TenantStatus === 'suspended' || row.TenantStatus === 'deactivated') {
    if (!alwaysAllowed || (!SAFE_METHODS.has(method) && !writableWhenBlocked)) {
      throw forbidden('This hospital workspace is suspended. Please contact support.', 'TENANT_SUSPENDED');
    }
  } else if (row.TenantStatus !== 'active') {
    throw forbidden('This hospital workspace is not active yet.', 'TENANT_INACTIVE');
  }

  const sub = subscriptionState(row.SubPeriodEnd ? {
    Status: row.SubStatus, CurrentPeriodEnd: row.SubPeriodEnd, GraceDays: row.SubGraceDays, FreeNow: Boolean(row.SubFreeNow),
  } : null, now);
  if ((sub.state === 'expired' || sub.state === 'none') && !SAFE_METHODS.has(method) && !alwaysAllowed) {
    throw new HttpError(402, 'SUBSCRIPTION_EXPIRED', 'Your subscription has expired. Data is safe and read-only until you renew.');
  }

  const permissions = new Set(String(row.Permissions || '').split(',').filter(Boolean));
  const features = new Set(String(row.Features || '').split(',').filter(Boolean));
  return {
    tenantId: row.TenantId,
    tenantSlug: row.Slug,
    tenantName: row.TenantName,
    timezone: row.Timezone,
    currency: row.Currency,
    userId: row.UserId,
    sessionId: payload.sid,
    isOwner: Boolean(row.IsOwner),
    roles: String(row.Roles || '').split(',').filter(Boolean),
    permissions,
    features,
    subscription: sub,
  };
}

/** True when ctx holds every listed permission. */
export const hasAll = (ctx, codes) => codes.every((c) => ctx?.permissions?.has(c));

/**
 * Plan gate: the hospital's current plan must include the module (hms.PlanFeatures).
 * Returns 403 FEATURE_NOT_IN_PLAN so the UI can show an upgrade prompt.
 */
export const requireFeature = (key) => (req, _res, next) => {
  if (!req.ctx) return next(unauthorized());
  if (!req.ctx.features.has(key)) {
    return next(forbidden('This module is not included in your plan. Upgrade your subscription to use it.', 'FEATURE_NOT_IN_PLAN'));
  }
  return next();
};

