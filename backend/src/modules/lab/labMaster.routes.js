// Laboratory master data (lab upgrade, chunk 2): the department master and the CSV import of the test catalogue.
// Nested inside lab.routes.js (hospital session + plan check run there); every query is scoped by req.ctx.tenantId,
// and ids from another hospital behave exactly like ids that do not exist (404 / refused).
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/auth.js';
import { asyncHandler, badRequest, conflict, notFound, unauthorized } from '../../utils/errors.js';
import { db, withTransaction } from '../../db/pool.js';
import { idParam } from '../../utils/params.js';
import { auditTenant } from '../../utils/audit.js';
import { checkImportRows } from '../clinical/labMaster.logic.js';
import { insertLabTest, updateLabTest } from './labTests.service.js';

const router = Router();
// Defence in depth: refuse to run without the hospital context set by lab.routes.js.
router.use((req, _res, next) => (req.ctx?.tenantId ? next() : next(unauthorized())));

export const MAX_IMPORT_ROWS = 500;

// ---------- Departments ----------
router.get('/departments', requirePermission('lab.read'), asyncHandler(async (req, res) => {
  const rows = await db.query(`SELECT d.LabDepartmentId AS id, d.Name AS name, d.SortOrder AS sortOrder, d.IsActive AS isActive,
                                      (SELECT COUNT(*) FROM hms.LabTests lt WHERE lt.TenantId = d.TenantId AND lt.DepartmentId = d.LabDepartmentId AND lt.IsActive = 1) AS testCount
                               FROM hms.LabDepartments d WHERE d.TenantId = @tid AND (@all = 1 OR d.IsActive = 1)
                               ORDER BY d.SortOrder, d.Name`, { tid: req.ctx.tenantId, all: req.query.all === 'true' });
  res.json({ data: rows.map((r) => ({ ...r, isActive: Boolean(r.isActive) })) });
}));

const deptSchema = z.object({
  name: z.string().trim().min(2).max(60).regex(/^[^<>|]+$/, 'Name cannot contain < > or |'),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(100),
  isActive: z.boolean().default(true),
}).strict();

async function assertNameFree(runner, tenantId, name, exceptId = null) {
  const dup = await runner.one(`SELECT LabDepartmentId FROM hms.LabDepartments WITH (UPDLOCK, HOLDLOCK)
                                WHERE TenantId = @tid AND Name = @n AND (@except IS NULL OR LabDepartmentId <> @except)`,
  { tid: tenantId, n: name, except: exceptId });
  if (dup) throw conflict(`A department called “${name}” already exists.`, 'DUPLICATE');
}

router.post('/departments', requirePermission('lab.configure'), validate(deptSchema), asyncHandler(async (req, res) => {
  const id = await withTransaction(async (tx) => {
    await assertNameFree(tx, req.ctx.tenantId, req.body.name);
    const r = await tx.one(`INSERT INTO hms.LabDepartments (TenantId, Name, SortOrder, IsActive) OUTPUT INSERTED.LabDepartmentId
                            VALUES (@tid, @n, @s, @a)`, { tid: req.ctx.tenantId, n: req.body.name, s: req.body.sortOrder, a: req.body.isActive });
    await auditTenant(req, 'lab_department.created', 'lab_department', r.LabDepartmentId, { name: req.body.name }, tx);
    return r.LabDepartmentId;
  });
  res.status(201).json({ data: { id } });
}));

router.put('/departments/:id', requirePermission('lab.configure'), validate(deptSchema), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  await withTransaction(async (tx) => {
    const old = await tx.one('SELECT Name FROM hms.LabDepartments WITH (UPDLOCK) WHERE TenantId = @tid AND LabDepartmentId = @id', { tid: req.ctx.tenantId, id });
    if (!old) throw notFound('Department not found.');
    await assertNameFree(tx, req.ctx.tenantId, req.body.name, id);
    await tx.exec('UPDATE hms.LabDepartments SET Name = @n, SortOrder = @s, IsActive = @a WHERE TenantId = @tid AND LabDepartmentId = @id',
      { tid: req.ctx.tenantId, id, n: req.body.name, s: req.body.sortOrder, a: req.body.isActive });
    // Keep the older text column in step so lists and filters that still read it show the new name.
    if (old.Name !== req.body.name) {
      await tx.exec('UPDATE hms.LabTests SET Department = @n WHERE TenantId = @tid AND DepartmentId = @id', { tid: req.ctx.tenantId, id, n: req.body.name });
    }
    await auditTenant(req, 'lab_department.updated', 'lab_department', id, { from: old.Name, to: req.body.name, active: req.body.isActive }, tx);
  });
  res.json({ data: { ok: true } });
}));

router.delete('/departments/:id', requirePermission('lab.configure'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  await withTransaction(async (tx) => {
    const d = await tx.one('SELECT Name FROM hms.LabDepartments WITH (UPDLOCK) WHERE TenantId = @tid AND LabDepartmentId = @id', { tid: req.ctx.tenantId, id });
    if (!d) throw notFound('Department not found.');
    const used = await tx.one('SELECT COUNT(*) AS n FROM hms.LabTests WHERE TenantId = @tid AND DepartmentId = @id', { tid: req.ctx.tenantId, id });
    if (used.n > 0) throw conflict(`${used.n} test(s) use this department. Move them or switch the department off instead.`, 'IN_USE');
    await tx.exec('DELETE FROM hms.LabDepartments WHERE TenantId = @tid AND LabDepartmentId = @id', { tid: req.ctx.tenantId, id });
    await auditTenant(req, 'lab_department.deleted', 'lab_department', id, { name: d.Name }, tx);
  });
  res.json({ data: { ok: true } });
}));

// ---------- CSV import of the test catalogue ----------
// The browser parses the CSV and sends rows as objects (lower-case column names). Nothing is written unless every
// row is valid; `dryRun` returns the same check (new / existing / errors) so the user can preview first.
const cell = z.union([z.string().max(2000), z.number(), z.null()]).optional();
const importSchema = z.object({
  rows: z.array(z.record(z.string().max(30), cell)).min(1, 'The file has no rows.').max(MAX_IMPORT_ROWS, `At most ${MAX_IMPORT_ROWS} rows per import.`),
  mode: z.enum(['skip', 'update']).default('skip'),
  dryRun: z.boolean().default(false),
}).strict();

router.post('/tests/import', requirePermission('lab.configure'), validate(importSchema), asyncHandler(async (req, res) => {
  const { rows, errors } = checkImportRows(req.body.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim().toLowerCase(), v]))));
  const tid = req.ctx.tenantId;

  const result = await withTransaction(async (tx) => {
    const existing = await tx.query('SELECT LabTestId, Code FROM hms.LabTests WITH (UPDLOCK, HOLDLOCK) WHERE TenantId = @tid', { tid });
    const byCode = new Map(existing.map((e) => [e.Code.toUpperCase(), e.LabTestId]));
    const depts = await tx.query('SELECT LabDepartmentId, Name, IsActive FROM hms.LabDepartments WITH (UPDLOCK, HOLDLOCK) WHERE TenantId = @tid', { tid });
    const deptByName = new Map(depts.map((d) => [d.Name.toLowerCase(), d]));
    const newDepartments = [...new Set(rows.map((r) => r.department).filter((n) => n && !deptByName.has(n.toLowerCase())))];
    const plan = rows.map((r) => ({ code: r.code, name: r.name, action: byCode.has(r.code) ? (req.body.mode === 'update' ? 'update' : 'skip') : 'create' }));
    const summary = {
      create: plan.filter((p) => p.action === 'create').length, update: plan.filter((p) => p.action === 'update').length,
      skip: plan.filter((p) => p.action === 'skip').length, newDepartments, errors, rows: plan,
    };
    if (req.body.dryRun || errors.length) return summary;

    // Missing departments are added (switched on, placed after the standard ones).
    for (const name of newDepartments) {
      if (name.length < 2 || /[<>|]/.test(name)) throw badRequest(`Department “${name}” is not a valid name.`);
      const d = await tx.one(`INSERT INTO hms.LabDepartments (TenantId, Name, SortOrder) OUTPUT INSERTED.LabDepartmentId, INSERTED.Name, INSERTED.IsActive
                              VALUES (@tid, @n, 100)`, { tid, n: name });
      deptByName.set(name.toLowerCase(), d);
    }
    for (const r of rows) {
      const d = r.department ? deptByName.get(r.department.toLowerCase()) : null;
      if (d && !d.IsActive) throw badRequest(`Department “${d.Name}” is switched off. Switch it on or change the file.`);
      const body = { ...r, department: null, departmentId: d ? d.LabDepartmentId : null, isActive: true, priceReason: 'CSV import' };
      const id = byCode.get(r.code);
      if (!id) await insertLabTest(tx, req.ctx, body);
      else if (req.body.mode === 'update') await updateLabTest(tx, req.ctx, id, body);
    }
    await auditTenant(req, 'lab_test.imported', 'lab_test', null,
      { created: summary.create, updated: summary.update, skipped: summary.skip, departmentsAdded: newDepartments.length }, tx);
    return { ...summary, imported: true };
  });

  if (!req.body.dryRun && errors.length) throw badRequest('Fix the rows listed below and import again. Nothing was saved.', errors.map((e) => ({ path: `line ${e.line}`, message: e.message })));
  res.status(req.body.dryRun ? 200 : 201).json({ data: result });
}));

export default router;
