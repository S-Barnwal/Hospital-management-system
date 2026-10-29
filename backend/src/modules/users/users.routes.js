// Hospital user accounts, roles and permissions (users & roles screen).
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requireTenant, requirePermission } from '../../middleware/auth.js';
import { asyncHandler, notFound, badRequest, forbidden } from '../../utils/errors.js';
import { db, withTransaction } from '../../db/pool.js';
import { idParam } from '../../utils/params.js';
import { auditTenant } from '../../utils/audit.js';
import { hashPassword, passwordProblem } from '../../utils/password.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { assignmentProblem, roleEditProblem } from '../rbac/rbac.logic.js';

const router = Router();
router.use(requireTenant);

async function loadRoles(runner, tenantId, roleIds = null) {
  const rows = await runner.query(`
    SELECT r.RoleId, r.Code, r.Name, r.Description, r.IsSystem,
           (SELECT STRING_AGG(p.Code, ',') FROM dbo.RolePermissions rp JOIN dbo.Permissions p ON p.PermissionId = rp.PermissionId WHERE rp.RoleId = r.RoleId) AS Perms
    FROM dbo.Roles r WHERE r.TenantId = @tid ${roleIds ? 'AND r.RoleId IN (SELECT CAST(value AS INT) FROM STRING_SPLIT(@ids, \',\'))' : ''}
    ORDER BY r.RoleId`, { tid: tenantId, ids: roleIds ? roleIds.join(',') : null });
  return rows.map((r) => ({ id: r.RoleId, code: r.Code, name: r.Name, description: r.Description, isSystem: Boolean(r.IsSystem),
    permissions: String(r.Perms || '').split(',').filter(Boolean) }));
}

const actorOf = (ctx) => ({ userId: ctx.userId, isOwner: ctx.isOwner, permissions: ctx.permissions, roles: ctx.roles });

router.get('/permissions', requirePermission('users.read'), (_req, res) => {
  res.json({ data: PERMISSIONS.map(([code, module, description]) => ({ code, module, description })) });
});

router.get('/roles', requirePermission('users.read'), asyncHandler(async (req, res) => {
  res.json({ data: await loadRoles(db, req.ctx.tenantId) });
}));

router.put('/roles/:id/permissions', requirePermission('roles.manage'),
  validate(z.object({ permissions: z.array(z.string().max(80)).max(200) }).strict()),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const valid = new Set(PERMISSIONS.map(([c]) => c));
    const wanted = [...new Set(req.body.permissions)];
    if (wanted.some((p) => !valid.has(p))) throw badRequest('Unknown permission code.');
    await withTransaction(async (tx) => {
      const [role] = await loadRoles(tx, req.ctx.tenantId, [id]);
      if (!role) throw notFound('Role not found.');
      const problem = roleEditProblem({ actor: actorOf(req.ctx), role, newPerms: wanted });
      if (problem) throw forbidden(problem);
      await tx.exec('DELETE FROM dbo.RolePermissions WHERE RoleId = @rid', { rid: id });
      if (wanted.length) {
        await tx.exec(`INSERT INTO dbo.RolePermissions (RoleId, PermissionId)
                       SELECT @rid, PermissionId FROM dbo.Permissions WHERE Code IN (SELECT value FROM STRING_SPLIT(@codes, ','))`,
        { rid: id, codes: wanted.join(',') });
      }
      await auditTenant(req, 'role.permissions_updated', 'role', id, { role: role.code, count: wanted.length }, tx);
    });
    res.json({ data: { ok: true } });
  }));

router.get('/', requirePermission('users.read'), asyncHandler(async (req, res) => {
  const rows = await db.query(`
    SELECT u.UserId AS id, u.Email AS email, u.FullName AS fullName, u.Phone AS phone, u.Status AS status, u.IsOwner AS isOwner,
           u.LastLoginAt AS lastLoginAt, u.CreatedAt AS createdAt,
           (SELECT STRING_AGG(CAST(r.RoleId AS NVARCHAR(10)) + ':' + r.Name, '|') FROM dbo.UserRoles ur JOIN dbo.Roles r ON r.RoleId = ur.RoleId AND r.TenantId = ur.TenantId
             WHERE ur.TenantId = u.TenantId AND ur.UserId = u.UserId) AS roles
    FROM dbo.Users u WHERE u.TenantId = @tid ORDER BY u.IsOwner DESC, u.FullName`, { tid: req.ctx.tenantId });
  res.json({
    data: rows.map((r) => ({ ...r, roles: String(r.roles || '').split('|').filter(Boolean).map((x) => {
      const i = x.indexOf(':');
      return { id: Number(x.slice(0, i)), name: x.slice(i + 1) };
    }) })),
  });
}));

const userSchema = z.object({
  fullName: z.string().trim().min(2).max(150),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z.string().trim().max(30).optional(),
  password: z.string().min(1).max(128),
  roleIds: z.array(z.number().int().positive()).min(1).max(10),
}).strict();

router.post('/', requirePermission('users.manage'), validate(userSchema), asyncHandler(async (req, res) => {
  const b = req.body;
  const pw = passwordProblem(b.password);
  if (pw) throw badRequest(pw);
  const hash = await hashPassword(b.password);
  const id = await withTransaction(async (tx) => {
    const limit = await tx.one(`
      SELECT TOP 1 p.MaxStaffUsers, (SELECT COUNT(*) FROM dbo.Users WITH (UPDLOCK) WHERE TenantId = @tid AND Status = 'active') AS active
      FROM dbo.Subscriptions s JOIN dbo.Plans p ON p.PlanId = s.PlanId WHERE s.TenantId = @tid ORDER BY s.CurrentPeriodEnd DESC`, { tid: req.ctx.tenantId });
    if (limit?.MaxStaffUsers && limit.active >= limit.MaxStaffUsers) {
      throw forbidden(`Your plan allows ${limit.MaxStaffUsers} active users. Upgrade your plan to add more.`, 'PLAN_LIMIT');
    }
    const roles = await loadRoles(tx, req.ctx.tenantId, b.roleIds);
    if (roles.length !== new Set(b.roleIds).size) throw badRequest('One or more roles are invalid.');
    const problem = assignmentProblem({ actor: actorOf(req.ctx), targetUserId: -1, targetIsOwner: false, roles });
    if (problem) throw forbidden(problem);
    const row = await tx.one(`INSERT INTO dbo.Users (TenantId, Email, PasswordHash, FullName, Phone) OUTPUT INSERTED.UserId
                              VALUES (@tid, @email, @hash, @name, @phone)`,
    { tid: req.ctx.tenantId, email: b.email, hash, name: b.fullName, phone: b.phone ?? null });
    for (const r of roles) {
      await tx.exec('INSERT INTO dbo.UserRoles (TenantId, UserId, RoleId) VALUES (@tid, @uid, @rid)', { tid: req.ctx.tenantId, uid: row.UserId, rid: r.id });
    }
    await auditTenant(req, 'user.created', 'user', row.UserId, { roles: roles.map((r) => r.code).join(',') }, tx);
    return row.UserId;
  });
  res.status(201).json({ data: { id } });
}));

router.patch('/:id', requirePermission('users.manage'),
  validate(z.object({
    fullName: z.string().trim().min(2).max(150).optional(),
    status: z.enum(['active', 'disabled']).optional(),
    roleIds: z.array(z.number().int().positive()).min(1).max(10).optional(),
  }).strict()),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const b = req.body;
    await withTransaction(async (tx) => {
      const target = await tx.one('SELECT UserId, IsOwner FROM dbo.Users WITH (UPDLOCK) WHERE TenantId = @tid AND UserId = @id', { tid: req.ctx.tenantId, id });
      if (!target) throw notFound('User not found.');
      if ((b.status || b.roleIds) && id === req.ctx.userId) throw forbidden('You cannot change your own status or roles.');
      if (target.IsOwner && b.status === 'disabled') throw forbidden('The owner account cannot be disabled.');
      if (b.roleIds) {
        const roles = await loadRoles(tx, req.ctx.tenantId, b.roleIds);
        if (roles.length !== new Set(b.roleIds).size) throw badRequest('One or more roles are invalid.');
        const problem = assignmentProblem({ actor: actorOf(req.ctx), targetUserId: id, targetIsOwner: Boolean(target.IsOwner), roles });
        if (problem) throw forbidden(problem);
        if (target.IsOwner && !roles.some((r) => r.code === 'owner')) throw forbidden('The owner must keep the Owner role.');
        await tx.exec('DELETE FROM dbo.UserRoles WHERE TenantId = @tid AND UserId = @id', { tid: req.ctx.tenantId, id });
        for (const r of roles) await tx.exec('INSERT INTO dbo.UserRoles (TenantId, UserId, RoleId) VALUES (@tid, @id, @rid)', { tid: req.ctx.tenantId, id, rid: r.id });
      }
      await tx.exec(`UPDATE dbo.Users SET FullName = COALESCE(@name, FullName), Status = COALESCE(@status, Status), UpdatedAt = SYSUTCDATETIME()
                     WHERE TenantId = @tid AND UserId = @id`, { tid: req.ctx.tenantId, id, name: b.fullName ?? null, status: b.status ?? null });
      if (b.status === 'disabled') {
        await tx.exec(`UPDATE dbo.UserSessions SET RevokedAt = SYSUTCDATETIME() WHERE SubjectType = 'tenant' AND SubjectId = @id AND TenantId = @tid AND RevokedAt IS NULL`,
          { tid: req.ctx.tenantId, id });
      }
      await auditTenant(req, 'user.updated', 'user', id, { status: b.status, roles: b.roleIds?.join(',') }, tx);
    });
    res.json({ data: { ok: true } });
  }));

export default router;
