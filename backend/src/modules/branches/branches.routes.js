// Multi-branch view (/api/v1/branches). Branches are separate hospital workspaces that the platform has put in one
// group; nothing is shared between their databases rows. A user sees headline numbers only for branches where the SAME
// e-mail has an active account with dashboard access — i.e. places they could already sign in to — and never any
// patient-level data. Opening a branch means signing in to that workspace (its own password / 2-step rules apply).
import { Router } from 'express';
import { requireTenant, requirePermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/errors.js';
import { db } from '../../db/pool.js';
import { localDateString, localDayRangeUtc } from '../../utils/time.js';

const router = Router();
router.use(requireTenant);

router.get('/', requirePermission('branches.view'), asyncHandler(async (req, res) => {
  const me = await db.one(`SELECT u.Email, t.GroupId, g.Name AS GroupName FROM hms.Users u JOIN hms.Tenants t ON t.TenantId = u.TenantId
                           LEFT JOIN hms.TenantGroups g ON g.GroupId = t.GroupId WHERE u.TenantId = @tid AND u.UserId = @uid`, { tid: req.ctx.tenantId, uid: req.ctx.userId });
  if (!me?.GroupId) return res.json({ data: { group: null, branches: [] } });
  const branches = await db.query(`/* tenant-safe: hospitals of the caller's own group (names only); figures below are per-branch and access-checked */
    SELECT t.TenantId, t.Name, t.BranchName, t.Slug, t.City, t.Status, t.Timezone,
      (SELECT TOP 1 1 FROM hms.Users u WHERE u.TenantId = t.TenantId AND u.Email = @email AND u.Status = 'active'
         AND EXISTS (SELECT 1 FROM hms.UserRoles ur JOIN hms.RolePermissions rp ON rp.RoleId = ur.RoleId
                     JOIN hms.Permissions p ON p.PermissionId = rp.PermissionId
                     WHERE ur.TenantId = u.TenantId AND ur.UserId = u.UserId AND p.Code = 'dashboard.view')) AS CanSee
    FROM hms.Tenants t WHERE t.GroupId = @g AND t.Status <> 'pending' ORDER BY t.Name`, { g: me.GroupId, email: me.Email });
  const out = [];
  for (const b of branches) {
    const row = { tenantId: b.TenantId, name: b.Name, branchName: b.BranchName, slug: b.Slug, city: b.City, status: b.Status,
      isCurrent: b.TenantId === req.ctx.tenantId, accessible: Boolean(b.CanSee), figures: null };
    if (b.CanSee && b.Status === 'active') {
      const today = localDateString(b.Timezone);
      const { start, end } = localDayRangeUtc(b.Timezone, today);
      const monthStart = localDayRangeUtc(b.Timezone, `${today.slice(0, 8)}01`).start;
      row.figures = await db.one(`
        SELECT (SELECT COUNT(*) FROM hms.Patients WHERE TenantId = @tid AND CreatedAt >= @start AND CreatedAt < @end) AS newPatientsToday,
               (SELECT COUNT(*) FROM hms.Appointments WHERE TenantId = @tid AND StartAt >= @start AND StartAt < @end AND Status <> 'cancelled') AS appointmentsToday,
               (SELECT COUNT(*) FROM hms.Admissions WHERE TenantId = @tid AND Status = 'admitted') AS inpatients,
               (SELECT COUNT(*) FROM hms.QueueTokens WHERE TenantId = @tid AND TokenDate = CAST(@today AS DATE) AND Status = 'waiting') AS waitingNow,
               (SELECT ISNULL(SUM(CASE WHEN Kind = 'payment' THEN Amount ELSE -Amount END), 0) FROM hms.MoneyReceived WHERE TenantId = @tid AND ReceivedAt >= @start AND ReceivedAt < @end) AS collectedToday,
               (SELECT ISNULL(SUM(CASE WHEN Kind = 'payment' THEN Amount ELSE -Amount END), 0) FROM hms.MoneyReceived WHERE TenantId = @tid AND ReceivedAt >= @mstart AND ReceivedAt < @end) AS collectedThisMonth`,
      { tid: b.TenantId, start, end, mstart: monthStart, today });
    }
    out.push(row);
  }
  const accessible = out.filter((b) => b.figures);
  const total = (k) => accessible.reduce((s, b) => s + Number(b.figures[k] || 0), 0);
  res.json({ data: { group: { name: me.GroupName }, branches: out,
    totals: { newPatientsToday: total('newPatientsToday'), appointmentsToday: total('appointmentsToday'), inpatients: total('inpatients'),
      waitingNow: total('waitingNow'), collectedToday: total('collectedToday').toFixed(2), collectedThisMonth: total('collectedThisMonth').toFixed(2), branchesCounted: accessible.length } } });
}));

export default router;
