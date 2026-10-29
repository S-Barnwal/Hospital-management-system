import { config } from '../config/env.js';
import { db } from '../db/pool.js';
import { verifyJwt } from '../utils/jwt.js';
import { forbidden, unauthorized } from '../utils/errors.js';
import { slugFromHost } from '../utils/slug.js';
import { evaluateTenantAccess, hasAll, requireFeature } from './tenantAccess.js';

export { requireFeature };

export const COOKIES = {
  tenantAccess: 'hms_at',
  tenantRefresh: 'hms_rt',
  adminAccess: 'hms_admin_at',
  adminRefresh: 'hms_admin_rt',
};

/** Reads the tenant slug from the Host header (subdomain routing). Never from body/query. */
export function resolveHostTenant(req, _res, next) {
  req.hostSlug = slugFromHost(req.hostname, config.appBaseDomain);
  next();
}

// One round trip: user + tenant + live session + latest subscription + roles + permissions.
// Every predicate is bound to BOTH the token's tenant id and user id.
const CONTEXT_SQL = `
SELECT u.UserId, u.Status AS UserStatus, u.IsOwner,
       t.TenantId, t.Slug, t.Name AS TenantName, t.Status AS TenantStatus, t.Timezone, t.Currency,
       CASE WHEN EXISTS (SELECT 1 FROM hms.UserSessions s
                         WHERE s.SessionId = @sid AND s.SubjectType = 'tenant' AND s.SubjectId = u.UserId
                           AND s.TenantId = t.TenantId AND s.RevokedAt IS NULL AND s.ExpiresAt > SYSUTCDATETIME())
            THEN 1 ELSE 0 END AS SessionValid,
       sub.Status AS SubStatus, sub.CurrentPeriodEnd AS SubPeriodEnd, sub.GraceDays AS SubGraceDays,
       (SELECT STRING_AGG(r.Code, ',') FROM hms.UserRoles ur JOIN hms.Roles r ON r.RoleId = ur.RoleId AND r.TenantId = ur.TenantId
         WHERE ur.TenantId = t.TenantId AND ur.UserId = u.UserId) AS Roles,
       (SELECT STRING_AGG(x.Code, ',') FROM (
          SELECT DISTINCT p.Code FROM hms.UserRoles ur
          JOIN hms.RolePermissions rp ON rp.RoleId = ur.RoleId
          JOIN hms.Permissions p ON p.PermissionId = rp.PermissionId
          WHERE ur.TenantId = t.TenantId AND ur.UserId = u.UserId) x) AS Permissions,
       (SELECT STRING_AGG(pf.FeatureKey, ',') FROM hms.PlanFeatures pf
         WHERE pf.PlanId = sub.PlanId AND pf.IsIncluded = 1) AS Features
FROM hms.Users u
JOIN hms.Tenants t ON t.TenantId = u.TenantId
OUTER APPLY (SELECT TOP 1 s.Status, s.CurrentPeriodEnd, s.GraceDays, s.PlanId FROM hms.Subscriptions s
             WHERE s.TenantId = t.TenantId ORDER BY s.CurrentPeriodEnd DESC) sub
WHERE u.UserId = @uid AND u.TenantId = @tid;`;

/** Authenticates a hospital user and builds req.ctx (tenantId, userId, permissions...). */
export async function requireTenant(req, _res, next) {
  try {
    const payload = verifyJwt(req.cookies?.[COOKIES.tenantAccess], config.jwtSecret);
    if (!payload || payload.typ !== 'tenant') throw unauthorized();
    const row = await db.one(CONTEXT_SQL, { uid: Number(payload.sub), tid: Number(payload.tid), sid: payload.sid });
    req.ctx = evaluateTenantAccess({ payload, row, hostSlug: req.hostSlug, method: req.method, path: req.originalUrl.split('?')[0] });
    next();
  } catch (err) {
    next(err);
  }
}

/** Backend-enforced permission check. Use after requireTenant. */
export const requirePermission = (...codes) => (req, _res, next) => {
  if (!req.ctx) return next(unauthorized());
  if (!hasAll(req.ctx, codes)) return next(forbidden());
  return next();
};

/** Authenticates a platform Super Admin (separate cookie, separate table, separate token type). */
export async function requirePlatformAdmin(req, _res, next) {
  try {
    const payload = verifyJwt(req.cookies?.[COOKIES.adminAccess], config.jwtSecret);
    if (!payload || payload.typ !== 'platform') throw unauthorized();
    const row = await db.one(`
      SELECT pu.PlatformUserId, pu.Email, pu.FullName, pu.Role, pu.Status
      FROM hms.PlatformUsers pu
      WHERE pu.PlatformUserId = @id AND pu.Status = 'active'
        AND EXISTS (SELECT 1 FROM hms.UserSessions s WHERE s.SessionId = @sid AND s.SubjectType = 'platform'
                    AND s.SubjectId = pu.PlatformUserId AND s.RevokedAt IS NULL AND s.ExpiresAt > SYSUTCDATETIME())`,
    { id: Number(payload.sub), sid: payload.sid });
    if (!row) throw unauthorized('Your session has ended. Please sign in again.');
    req.admin = { platformUserId: row.PlatformUserId, email: row.Email, name: row.FullName, role: row.Role, sessionId: payload.sid };
    next();
  } catch (err) {
    next(err);
  }
}

/** Restricts an admin route to the super_admin role (support staff are read-only). */
export const requireSuperAdmin = (req, _res, next) =>
  (req.admin?.role === 'super_admin' ? next() : next(forbidden('Super Admin role required.')));
