// Laboratory, Phase 3: test parameters (panels such as CBC), patient result trends and home sample collection.
// Nested inside lab.routes.js (so the hospital session and plan check run once); every query is scoped by req.ctx.tenantId.
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/auth.js';
import { asyncHandler, badRequest, conflict, notFound, unauthorized } from '../../utils/errors.js';
import { db, withTransaction, t } from '../../db/pool.js';
import { idParam } from '../../utils/params.js';
import { auditTenant } from '../../utils/audit.js';
import { localDayRangeUtc, localDateString } from '../../utils/time.js';
import { buildTrends, canMoveHome } from '../clinical/phase3.logic.js';
import { packOptions, unpackOptions } from '../clinical/labMaster.logic.js';

const router = Router();
// Defence in depth: refuse to run without the hospital context set by lab.routes.js.
router.use((req, _res, next) => (req.ctx?.tenantId ? next() : next(unauthorized())));

const num = z.union([z.literal('').transform(() => null), z.null(), z.coerce.number().min(-1e6).max(1e6)]).optional();

// ---------- Parameters of a test ----------
router.get('/tests/:id/parameters', requirePermission('lab.read'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const test = await db.one('SELECT LabTestId FROM hms.LabTests WHERE TenantId = @tid AND LabTestId = @id', { tid: req.ctx.tenantId, id });
  if (!test) throw notFound('Test not found.');
  const rows = await db.query(`SELECT ParameterId AS id, Name AS name, Unit AS unit, RefLow AS refLow, RefHigh AS refHigh, RefText AS refText, SortOrder AS sortOrder,
                                      InputType AS inputType, Options AS options, Decimals AS decimals, IsHeading AS isHeading
                               FROM hms.LabTestParameters WHERE TenantId = @tid AND LabTestId = @id AND IsActive = 1 ORDER BY SortOrder, ParameterId`,
  { tid: req.ctx.tenantId, id });
  res.json({ data: rows.map((r) => ({ ...r, options: unpackOptions(r.options), isHeading: Boolean(r.isHeading) })) });
}));

/**
 * Replaces the parameter list of a test. Removed parameters are switched off (kept for old orders, whose results are
 * snapshots anyway); an empty list turns the panel back into a single-result test.
 */
router.put('/tests/:id/parameters', requirePermission('lab.configure'),
  validate(z.object({
    parameters: z.array(z.object({
      id: z.coerce.number().int().positive().optional(), name: z.string().trim().min(1).max(100), unit: z.string().trim().max(30).nullable().optional(),
      refLow: num, refHigh: num, refText: z.string().trim().max(100).nullable().optional(),
      inputType: z.enum(['numeric', 'text', 'option']).default('numeric'), options: z.array(z.string().max(60)).max(30).nullable().optional(),
      decimals: z.union([z.literal('').transform(() => null), z.null(), z.coerce.number().int().min(0).max(6)]).optional(), isHeading: z.boolean().default(false),
    }).strict().refine((p) => p.refLow == null || p.refHigh == null || p.refHigh >= p.refLow, { message: 'High limit must be ≥ low limit', path: ['refHigh'] })
      .transform((p, ctx) => {
        let options = null;
        try { options = packOptions(p.options ?? []); } catch (e) { ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: e.message }); return z.NEVER; }
        if (!p.isHeading && p.inputType === 'option' && !options) { ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: `${p.name}: add the dropdown choices.` }); return z.NEVER; }
        // A heading row only prints its name; it carries no unit, range or result settings.
        return p.isHeading ? { ...p, unit: null, refLow: null, refHigh: null, refText: null, inputType: 'text', options: null, decimals: null }
          : { ...p, options: p.inputType === 'option' ? options : null };
      }))
      .max(60),
  }).strict().refine((v) => new Set(v.parameters.map((p) => p.name.toLowerCase())).size === v.parameters.length, 'Each parameter needs a different name.')),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    await withTransaction(async (tx) => {
      const test = await tx.one('SELECT LabTestId FROM hms.LabTests WITH (UPDLOCK) WHERE TenantId = @tid AND LabTestId = @id', { tid: req.ctx.tenantId, id });
      if (!test) throw notFound('Test not found.');
      const existing = await tx.query('SELECT ParameterId FROM hms.LabTestParameters WHERE TenantId = @tid AND LabTestId = @id AND IsActive = 1', { tid: req.ctx.tenantId, id });
      const known = new Set(existing.map((r) => Number(r.ParameterId)));
      const keep = new Set();
      let order = 0;
      for (const p of req.body.parameters) {
        order += 1;
        const params = { tid: req.ctx.tenantId, test: id, name: p.name, unit: p.unit || null, lo: p.refLow == null ? null : t.dec(p.refLow, 12, 4),
          hi: p.refHigh == null ? null : t.dec(p.refHigh, 12, 4), txt: p.refText || null, sort: order,
          itype: p.inputType, opts: p.options, dec: p.decimals ?? null, head: p.isHeading };
        if (p.id) {
          if (!known.has(p.id)) throw badRequest('A parameter does not belong to this test.');
          keep.add(p.id);
          await tx.exec(`UPDATE hms.LabTestParameters SET Name = @name, Unit = @unit, RefLow = @lo, RefHigh = @hi, RefText = @txt, SortOrder = @sort,
                           InputType = @itype, Options = @opts, Decimals = @dec, IsHeading = @head
                         WHERE TenantId = @tid AND LabTestId = @test AND ParameterId = @pid`, { ...params, pid: p.id });
        } else {
          await tx.exec(`INSERT INTO hms.LabTestParameters (TenantId, LabTestId, Name, Unit, RefLow, RefHigh, RefText, SortOrder, InputType, Options, Decimals, IsHeading)
                         VALUES (@tid, @test, @name, @unit, @lo, @hi, @txt, @sort, @itype, @opts, @dec, @head)`, params);
        }
      }
      for (const pid of known) {
        if (!keep.has(pid)) await tx.exec('UPDATE hms.LabTestParameters SET IsActive = 0 WHERE TenantId = @tid AND ParameterId = @pid', { tid: req.ctx.tenantId, pid });
      }
      await auditTenant(req, 'lab_test.parameters_updated', 'lab_test', id, { count: req.body.parameters.length }, tx);
    });
    res.json({ data: { ok: true } });
  }));

// ---------- Patient trends (verified numeric results over time) ----------
router.get('/patients/:id/trends', requirePermission('lab.read'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const pat = await db.one('SELECT PatientId FROM hms.Patients WHERE TenantId = @tid AND PatientId = @id', { tid: req.ctx.tenantId, id });
  if (!pat) throw notFound('Patient not found.');
  const rows = await db.query(`
    SELECT TOP 2000 * FROM (
      SELECT CONCAT('t:', i.LabTestId) AS [key], i.TestName AS name, i.Unit AS unit, i.RefLow AS refLow, i.RefHigh AS refHigh,
             o.VerifiedAt AS at, i.ResultNumeric AS value, i.Flag AS flag, o.OrderNumber AS orderNumber
      FROM hms.LabOrderItems i JOIN hms.LabOrders o ON o.TenantId = i.TenantId AND o.LabOrderId = i.LabOrderId
      WHERE i.TenantId = @tid AND o.PatientId = @id AND o.Status = 'verified' AND i.ResultNumeric IS NOT NULL
      UNION ALL
      SELECT CONCAT('p:', i.LabTestId, ':', LOWER(v.Name)), CONCAT(i.TestName, ' — ', v.Name), v.Unit, v.RefLow, v.RefHigh,
             o.VerifiedAt, v.ResultNumeric, v.Flag, o.OrderNumber
      FROM hms.LabResultValues v
      JOIN hms.LabOrderItems i ON i.TenantId = v.TenantId AND i.LabOrderItemId = v.LabOrderItemId
      JOIN hms.LabOrders o ON o.TenantId = i.TenantId AND o.LabOrderId = i.LabOrderId
      WHERE v.TenantId = @tid AND o.PatientId = @id AND o.Status = 'verified' AND v.ResultNumeric IS NOT NULL) x
    ORDER BY at DESC`, { tid: req.ctx.tenantId, id });
  res.json({ data: buildTrends(rows) });
}));

// ---------- Home sample collection ----------
router.get('/home-collections', requirePermission('lab.read'), asyncHandler(async (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : localDateString(req.ctx.timezone);
  const { start, end } = localDayRangeUtc(req.ctx.timezone, date);
  const status = ['scheduled', 'assigned', 'on_the_way', 'collected', 'cancelled'].includes(req.query.status) ? req.query.status : null;
  const rows = await db.query(`
    SELECT h.HomeCollectionId AS id, h.LabOrderId AS orderId, o.OrderNumber AS orderNumber, o.Status AS orderStatus, o.Priority AS priority,
           h.Address AS address, h.Landmark AS landmark, h.ContactPhone AS contactPhone, h.ScheduledAt AS scheduledAt, h.Status AS status,
           h.Charge AS charge, h.Notes AS notes, h.CollectedAt AS collectedAt, h.CollectorStaffId AS collectorStaffId, s.FullName AS collectorName,
           p.PatientId AS patientId, p.PatientNumber AS patientNumber, p.FirstName AS patientFirstName, p.LastName AS patientLastName, p.Phone AS patientPhone,
           (SELECT STRING_AGG(i.TestName, ', ') FROM hms.LabOrderItems i WHERE i.TenantId = h.TenantId AND i.LabOrderId = h.LabOrderId) AS tests
    FROM hms.LabHomeCollections h
    JOIN hms.LabOrders o ON o.TenantId = h.TenantId AND o.LabOrderId = h.LabOrderId
    JOIN hms.Patients p ON p.TenantId = o.TenantId AND p.PatientId = o.PatientId
    LEFT JOIN hms.StaffMembers s ON s.TenantId = h.TenantId AND s.StaffId = h.CollectorStaffId
    WHERE h.TenantId = @tid AND ((h.ScheduledAt >= @start AND h.ScheduledAt < @end) OR (@all = 1 AND h.Status IN ('scheduled','assigned','on_the_way')))
      AND (@status IS NULL OR h.Status = @status)
    ORDER BY h.ScheduledAt`, { tid: req.ctx.tenantId, start, end, status, all: req.query.open === 'true' });
  res.json({ data: rows, meta: { date } });
}));

router.post('/home-collections/:id/status', requirePermission('lab.write'),
  validate(z.object({
    status: z.enum(['scheduled', 'assigned', 'on_the_way', 'collected', 'cancelled']),
    collectorStaffId: z.coerce.number().int().positive().nullable().optional(),
    scheduledAt: z.string().datetime({ offset: true }).optional(),
    reason: z.string().trim().max(300).optional(),
  }).strict()),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const b = req.body;
    await withTransaction(async (tx) => {
      const h = await tx.one(`SELECT h.Status, h.LabOrderId, h.CollectorStaffId, o.Status AS OrderStatus FROM hms.LabHomeCollections h WITH (UPDLOCK)
                              JOIN hms.LabOrders o ON o.TenantId = h.TenantId AND o.LabOrderId = h.LabOrderId
                              WHERE h.TenantId = @tid AND h.HomeCollectionId = @id`, { tid: req.ctx.tenantId, id });
      if (!h) throw notFound('Home collection not found.');
      if (h.OrderStatus === 'cancelled' && b.status !== 'cancelled') throw conflict('The lab order is cancelled.', 'LAB_STATE');
      const same = h.Status === b.status;
      if (!same && !canMoveHome(h.Status, b.status)) throw conflict(`Cannot change a ${h.Status.replace('_', ' ')} visit to ${b.status.replace('_', ' ')}.`, 'INVALID_TRANSITION');
      const collector = b.collectorStaffId === undefined ? h.CollectorStaffId : b.collectorStaffId;
      if (b.status === 'assigned' && !collector) throw badRequest('Choose who will collect the sample.');
      if (collector && !(await tx.one('SELECT 1 AS ok FROM hms.StaffMembers WHERE TenantId = @tid AND StaffId = @sid AND IsActive = 1', { tid: req.ctx.tenantId, sid: collector }))) {
        throw badRequest('Staff member not found.');
      }
      if (b.status === 'cancelled' && (!b.reason || b.reason.length < 3)) throw badRequest('Give a reason for cancelling the visit.');
      await tx.exec(`UPDATE hms.LabHomeCollections SET Status = @s, CollectorStaffId = @c, ScheduledAt = ISNULL(@at, ScheduledAt),
                       CollectedAt = CASE WHEN @s = 'collected' THEN SYSUTCDATETIME() ELSE CollectedAt END,
                       CancelReason = CASE WHEN @s = 'cancelled' THEN @r ELSE CancelReason END, UpdatedAt = SYSUTCDATETIME()
                     WHERE TenantId = @tid AND HomeCollectionId = @id`,
      { tid: req.ctx.tenantId, id, s: b.status, c: collector ?? null, at: b.scheduledAt ? new Date(b.scheduledAt) : null, r: b.reason ?? null });
      if (b.status === 'collected') {
        // Same effect as "Collect all samples" on the order.
        await tx.exec(`UPDATE hms.LabSamples SET Status = 'collected', CollectedAt = SYSUTCDATETIME(), CollectedByUserId = @uid, RejectReason = NULL
                       WHERE TenantId = @tid AND LabOrderId = @oid AND Status IN ('pending','rejected')`, { tid: req.ctx.tenantId, oid: h.LabOrderId, uid: req.ctx.userId });
        await tx.exec(`UPDATE hms.LabOrders SET Status = 'sample_collected', SampleCollectedAt = SYSUTCDATETIME()
                       WHERE TenantId = @tid AND LabOrderId = @oid AND Status = 'ordered'`, { tid: req.ctx.tenantId, oid: h.LabOrderId });
      }
      await auditTenant(req, `lab_home_collection.${b.status}`, 'lab_order', h.LabOrderId, { collector, reason: b.reason }, tx);
    });
    res.json({ data: { ok: true } });
  }));

export default router;
