// Laboratory, chunk 3: reference ranges by age & gender (editor + CSV import) and critical results (list + acknowledge).
// Nested inside lab.routes.js (hospital session + plan check run there). Every query is scoped by req.ctx.tenantId;
// test / parameter / order ids from another hospital behave exactly like ids that do not exist.
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/auth.js';
import { asyncHandler, badRequest, conflict, notFound, unauthorized } from '../../utils/errors.js';
import { db, withTransaction, t } from '../../db/pool.js';
import { idParam } from '../../utils/params.js';
import { auditTenant } from '../../utils/audit.js';
import { checkRanges, MAX_RANGES_PER_TEST } from '../clinical/labRanges.logic.js';
import { loadRanges } from './labRanges.service.js';

const router = Router();
router.use((req, _res, next) => (req.ctx?.tenantId ? next() : next(unauthorized())));

const dec = (v) => (v == null ? null : t.dec(v, 12, 4));

async function replaceRanges(tx, tenantId, testId, ranges) {
  await tx.exec('DELETE FROM hms.LabReferenceRanges WHERE TenantId = @tid AND LabTestId = @test', { tid: tenantId, test: testId });
  for (const r of ranges) {
    await tx.exec(`INSERT INTO hms.LabReferenceRanges (TenantId, LabTestId, ParameterId, Gender, AgeFrom, AgeFromUnit, AgeTo, AgeToUnit,
                     RefLow, RefHigh, RefText, CriticalLow, CriticalHigh, SortOrder)
                   VALUES (@tid, @test, @pid, @g, @af, @afu, @at, @atu, @lo, @hi, @txt, @cl, @ch, @sort)`,
    { tid: tenantId, test: testId, pid: r.parameterId, g: r.gender, af: r.ageFrom, afu: r.ageFromUnit, at: r.ageTo, atu: r.ageToUnit,
      lo: dec(r.refLow), hi: dec(r.refHigh), txt: r.refText, cl: dec(r.criticalLow), ch: dec(r.criticalHigh), sort: r.sortOrder });
  }
}

// ---------- Ranges of one test ----------
router.get('/tests/:id/ranges', requirePermission('lab.read'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const test = await db.one(`SELECT LabTestId, Name, Unit, RefLow, RefHigh, RefText, CriticalLow, CriticalHigh FROM hms.LabTests
                             WHERE TenantId = @tid AND LabTestId = @id`, { tid: req.ctx.tenantId, id });
  if (!test) throw notFound('Test not found.');
  const parameters = await db.query(`SELECT ParameterId AS id, Name AS name, Unit AS unit, RefLow AS refLow, RefHigh AS refHigh, RefText AS refText,
                                            CriticalLow AS criticalLow, CriticalHigh AS criticalHigh
                                     FROM hms.LabTestParameters WHERE TenantId = @tid AND LabTestId = @id AND IsActive = 1 AND IsHeading = 0
                                     ORDER BY SortOrder, ParameterId`, { tid: req.ctx.tenantId, id });
  const ranges = await loadRanges(db, req.ctx.tenantId, [id]);
  res.json({ data: {
    test: { id, name: test.Name, unit: test.Unit, refLow: test.RefLow, refHigh: test.RefHigh, refText: test.RefText, criticalLow: test.CriticalLow, criticalHigh: test.CriticalHigh },
    // Ranges of parameters that were removed from the panel are not shown (they are dropped on the next save).
    parameters, ranges: ranges.filter((r) => r.parameterId == null || parameters.some((p) => p.id === r.parameterId)).map(({ testId: _t, ...r }) => r),
  } });
}));

const numOrNull = z.union([z.literal('').transform(() => null), z.null(), z.coerce.number().min(-1e6).max(1e6)]).optional();
const intOrNull = z.union([z.literal('').transform(() => null), z.null(), z.coerce.number().int().min(0).max(1200)]).optional();
const rangeRow = z.object({
  parameterId: z.union([z.literal('').transform(() => null), z.null(), z.coerce.number().int().positive()]).optional(),
  gender: z.enum(['any', 'male', 'female']).default('any'),
  ageFrom: intOrNull, ageFromUnit: z.enum(['d', 'm', 'y']).default('y'), ageTo: intOrNull, ageToUnit: z.enum(['d', 'm', 'y']).default('y'),
  refLow: numOrNull, refHigh: numOrNull, refText: z.string().trim().max(100).nullable().optional(), criticalLow: numOrNull, criticalHigh: numOrNull,
}).strict();

router.put('/tests/:id/ranges', requirePermission('lab.configure'),
  validate(z.object({ ranges: z.array(rangeRow).max(MAX_RANGES_PER_TEST) }).strict()),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const count = await withTransaction(async (tx) => {
      const test = await tx.one('SELECT LabTestId FROM hms.LabTests WITH (UPDLOCK) WHERE TenantId = @tid AND LabTestId = @id', { tid: req.ctx.tenantId, id });
      if (!test) throw notFound('Test not found.');
      const params = await tx.query('SELECT ParameterId FROM hms.LabTestParameters WHERE TenantId = @tid AND LabTestId = @id AND IsActive = 1 AND IsHeading = 0',
        { tid: req.ctx.tenantId, id });
      const { ranges, errors } = checkRanges(req.body.ranges, { parameterIds: params.map((p) => p.ParameterId) });
      if (errors.length) throw badRequest('Please correct the ranges.', errors.map((e) => ({ path: `ranges.${e.index}`, message: `Row ${e.index + 1}: ${e.message}` })));
      await replaceRanges(tx, req.ctx.tenantId, id, ranges);
      await auditTenant(req, 'lab_test.ranges_updated', 'lab_test', id, { count: ranges.length }, tx);
      return ranges.length;
    });
    res.json({ data: { ok: true, count } });
  }));

// ---------- CSV import of ranges (replaces the ranges of every test named in the file) ----------
const cell = z.union([z.string().max(200), z.number(), z.null()]).optional();
router.post('/ranges/import', requirePermission('lab.configure'),
  validate(z.object({
    rows: z.array(z.record(z.string().max(30), cell)).min(1, 'The file has no rows.').max(2000, 'At most 2000 rows per import.'),
    dryRun: z.boolean().default(false),
  }).strict()),
  asyncHandler(async (req, res) => {
    const tid = req.ctx.tenantId;
    const rows = req.body.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim().toLowerCase().replace(/[^a-z]/g, ''), v == null ? '' : String(v).trim()])));
    const result = await withTransaction(async (tx) => {
      const codes = [...new Set(rows.map((r) => r.testcode.toUpperCase()).filter(Boolean))];
      const tests = codes.length ? await tx.query(`SELECT LabTestId, Code FROM hms.LabTests WITH (UPDLOCK)
                                                   WHERE TenantId = @tid AND Code IN (SELECT value FROM STRING_SPLIT(@codes, ','))`,
      { tid, codes: codes.filter((c) => /^[A-Z0-9_-]{1,20}$/.test(c)).join(',') }) : [];
      const testByCode = new Map(tests.map((x) => [x.Code.toUpperCase(), x.LabTestId]));
      const params = tests.length ? await tx.query(`SELECT ParameterId, LabTestId, Name FROM hms.LabTestParameters
                                                    WHERE TenantId = @tid AND IsActive = 1 AND IsHeading = 0
                                                      AND LabTestId IN (SELECT CAST(value AS INT) FROM STRING_SPLIT(@ids, ','))`,
      { tid, ids: tests.map((x) => x.LabTestId).join(',') }) : [];
      const errors = [];
      const groups = new Map(); // testId → [{ line, row }]
      rows.forEach((r, i) => {
        const line = i + 2;
        const testId = testByCode.get((r.testcode || '').toUpperCase());
        if (!testId) { errors.push({ line, message: `test code “${r.testcode || ''}” is not in your catalogue` }); return; }
        let parameterId = null;
        if (r.parameter) {
          const p = params.find((x) => x.LabTestId === testId && x.Name.toLowerCase() === r.parameter.toLowerCase());
          if (!p) { errors.push({ line, message: `parameter “${r.parameter}” is not on test ${r.testcode}` }); return; }
          parameterId = p.ParameterId;
        }
        if (!groups.has(testId)) groups.set(testId, []);
        groups.get(testId).push({ line, row: { parameterId, gender: r.gender || 'any', ageFrom: r.agefrom, ageFromUnit: r.agefromunit || 'y', ageTo: r.ageto,
          ageToUnit: r.agetounit || 'y', refLow: r.low, refHigh: r.high, refText: r.text || null, criticalLow: r.criticallow, criticalHigh: r.criticalhigh } });
      });
      const checked = [];
      for (const [testId, list] of groups) {
        const { ranges, errors: errs } = checkRanges(list.map((x) => x.row), { parameterIds: params.filter((p) => p.LabTestId === testId).map((p) => p.ParameterId) });
        errs.forEach((e) => errors.push({ line: e.index >= 0 ? list[e.index].line : list[0].line, message: e.message }));
        checked.push([testId, ranges]);
      }
      errors.sort((a, b) => a.line - b.line);
      const summary = { tests: groups.size, ranges: rows.length - errors.length, errors };
      if (req.body.dryRun || errors.length) return summary;
      for (const [testId, ranges] of checked) await replaceRanges(tx, tid, testId, ranges);
      await auditTenant(req, 'lab_test.ranges_imported', 'lab_test', null, { tests: groups.size, ranges: rows.length }, tx);
      return { ...summary, imported: true };
    });
    if (!req.body.dryRun && result.errors.length) {
      throw badRequest('Fix the rows listed below and import again. Nothing was saved.', result.errors.map((e) => ({ path: `line ${e.line}`, message: e.message })));
    }
    res.status(req.body.dryRun ? 200 : 201).json({ data: result });
  }));

// ---------- Critical results ----------
/** Open (unacknowledged) critical results of this hospital, newest first. Patient name is shown to lab staff only. */
router.get('/critical', requirePermission('lab.read'), asyncHandler(async (req, res) => {
  const rows = await db.query(`
    SELECT TOP 100 * FROM (
      SELECT o.LabOrderId AS orderId, o.OrderNumber AS orderNumber, p.FirstName AS firstName, p.LastName AS lastName, p.PatientNumber AS patientNumber,
             i.TestName AS name, i.ResultValue AS value, i.Unit AS unit, i.Flag AS flag, i.CriticalAt AS criticalAt
      FROM hms.LabOrderItems i JOIN hms.LabOrders o ON o.TenantId = i.TenantId AND o.LabOrderId = i.LabOrderId
      JOIN hms.Patients p ON p.TenantId = o.TenantId AND p.PatientId = o.PatientId
      WHERE i.TenantId = @tid AND i.CriticalAt IS NOT NULL AND i.CriticalAckAt IS NULL AND o.Status <> 'cancelled'
      UNION ALL
      SELECT o.LabOrderId, o.OrderNumber, p.FirstName, p.LastName, p.PatientNumber, CONCAT(i.TestName, ' — ', v.Name), v.ResultValue, v.Unit, v.Flag, v.CriticalAt
      FROM hms.LabResultValues v JOIN hms.LabOrderItems i ON i.TenantId = v.TenantId AND i.LabOrderItemId = v.LabOrderItemId
      JOIN hms.LabOrders o ON o.TenantId = i.TenantId AND o.LabOrderId = i.LabOrderId
      JOIN hms.Patients p ON p.TenantId = o.TenantId AND p.PatientId = o.PatientId
      WHERE v.TenantId = @tid AND v.CriticalAt IS NOT NULL AND v.CriticalAckAt IS NULL AND o.Status <> 'cancelled'
    ) x ORDER BY criticalAt DESC`, { tid: req.ctx.tenantId });
  res.json({ data: rows });
}));

/** Number of open critical results on one order (@tid, @id). */
export const OPEN_CRITICAL_SQL = `SELECT
  (SELECT COUNT(*) FROM hms.LabOrderItems WHERE TenantId = @tid AND LabOrderId = @id AND CriticalAt IS NOT NULL AND CriticalAckAt IS NULL)
  + (SELECT COUNT(*) FROM hms.LabResultValues v JOIN hms.LabOrderItems i ON i.TenantId = v.TenantId AND i.LabOrderItemId = v.LabOrderItemId
     WHERE v.TenantId = @tid AND i.LabOrderId = @id AND v.CriticalAt IS NOT NULL AND v.CriticalAckAt IS NULL) AS n`;

router.post('/orders/:id/critical-ack', requirePermission('lab.write'),
  validate(z.object({ note: z.string().trim().min(3, 'Write who was informed (min 3 characters).').max(300) }).strict()),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const count = await withTransaction(async (tx) => {
      const o = await tx.one('SELECT LabOrderId FROM hms.LabOrders WITH (UPDLOCK) WHERE TenantId = @tid AND LabOrderId = @id', { tid: req.ctx.tenantId, id });
      if (!o) throw notFound('Lab order not found.');
      const open = (await tx.one(OPEN_CRITICAL_SQL, { tid: req.ctx.tenantId, id })).n;
      if (!open) throw conflict('There is no critical result waiting for acknowledgement on this order.', 'NO_OPEN_CRITICAL');
      const p = { tid: req.ctx.tenantId, id, uid: req.ctx.userId, note: req.body.note };
      await tx.exec(`UPDATE hms.LabOrderItems SET CriticalAckAt = SYSUTCDATETIME(), CriticalAckByUserId = @uid
                     WHERE TenantId = @tid AND LabOrderId = @id AND CriticalAt IS NOT NULL AND CriticalAckAt IS NULL`, p);
      await tx.exec(`UPDATE v SET CriticalAckAt = SYSUTCDATETIME(), CriticalAckByUserId = @uid
                     FROM hms.LabResultValues v JOIN hms.LabOrderItems i ON i.TenantId = v.TenantId AND i.LabOrderItemId = v.LabOrderItemId
                     WHERE v.TenantId = @tid AND i.LabOrderId = @id AND v.CriticalAt IS NOT NULL AND v.CriticalAckAt IS NULL`, p);
      await tx.exec('UPDATE hms.LabOrders SET CriticalAckNote = @note WHERE TenantId = @tid AND LabOrderId = @id', p);
      await auditTenant(req, 'lab_order.critical_acknowledged', 'lab_order', id, { results: open, note: req.body.note }, tx);
      return open;
    });
    res.json({ data: { acknowledged: count } });
  }));

export default router;
