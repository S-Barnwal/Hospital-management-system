// Laboratory: test catalogue, orders, sample collection, result entry, verification (results locked after verification).
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requireTenant, requirePermission, requireFeature } from '../../middleware/auth.js';
import { asyncHandler, badRequest, conflict, notFound } from '../../utils/errors.js';
import { db, withTransaction, t } from '../../db/pool.js';
import { parseListQuery, pageMeta } from '../../utils/pagination.js';
import { idParam } from '../../utils/params.js';
import { auditTenant } from '../../utils/audit.js';
import { localDayRangeUtc } from '../../utils/time.js';
import { nextSequence, formatNumber } from '../tenants/sequences.js';
import { labFlag, canMoveLab } from '../clinical/logic.js';
import { addBillItem, getOrCreateDraftBill } from '../billing/billing.service.js';

const router = Router();
router.use(requireTenant, requireFeature('laboratory'));

// ---------- Catalogue ----------
router.get('/tests', requirePermission('lab.read'), asyncHandler(async (req, res) => {
  const rows = await db.query(`SELECT LabTestId AS id, Code AS code, Name AS name, SampleType AS sampleType, Unit AS unit, RefLow AS refLow, RefHigh AS refHigh,
                                      RefText AS refText, Price AS price, IsActive AS isActive
                               FROM hms.LabTests WHERE TenantId = @tid AND (@all = 1 OR IsActive = 1) ORDER BY Name`,
  { tid: req.ctx.tenantId, all: req.query.all === 'true' });
  res.json({ data: rows });
}));

const nullableNum = z.union([z.literal('').transform(() => null), z.null(), z.coerce.number()]).optional();
const testSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,20}$/), name: z.string().trim().min(2).max(150),
  sampleType: z.string().trim().max(40).nullable().optional(), unit: z.string().trim().max(30).nullable().optional(),
  refLow: nullableNum, refHigh: nullableNum, refText: z.string().trim().max(100).nullable().optional(),
  price: z.coerce.number().min(0).max(1e7), isActive: z.boolean().optional(),
}).strict().refine((v) => v.refLow == null || v.refHigh == null || v.refHigh >= v.refLow, 'High limit must be ≥ low limit');

const testParams = (b) => ({
  code: b.code, name: b.name, st: b.sampleType ?? null, unit: b.unit ?? null,
  lo: b.refLow == null ? null : t.dec(b.refLow, 12, 4), hi: b.refHigh == null ? null : t.dec(b.refHigh, 12, 4), txt: b.refText ?? null,
  price: t.money(Number(b.price).toFixed(2)), active: b.isActive ?? true,
});

router.post('/tests', requirePermission('lab.configure'), validate(testSchema), asyncHandler(async (req, res) => {
  const r = await db.one(`INSERT INTO hms.LabTests (TenantId, Code, Name, SampleType, Unit, RefLow, RefHigh, RefText, Price, IsActive)
                          OUTPUT INSERTED.LabTestId VALUES (@tid, @code, @name, @st, @unit, @lo, @hi, @txt, @price, @active)`,
  { tid: req.ctx.tenantId, ...testParams(req.body) });
  await auditTenant(req, 'lab_test.created', 'lab_test', r.LabTestId, { code: req.body.code });
  res.status(201).json({ data: { id: r.LabTestId } });
}));

router.put('/tests/:id', requirePermission('lab.configure'), validate(testSchema), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const n = await db.exec(`UPDATE hms.LabTests SET Code = @code, Name = @name, SampleType = @st, Unit = @unit, RefLow = @lo, RefHigh = @hi, RefText = @txt,
                             Price = @price, IsActive = @active WHERE TenantId = @tid AND LabTestId = @id`, { tid: req.ctx.tenantId, id, ...testParams(req.body) });
  if (!n) throw notFound('Test not found.');
  await auditTenant(req, 'lab_test.updated', 'lab_test', id);
  res.json({ data: { ok: true } });
}));

router.delete('/tests/:id', requirePermission('lab.configure'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const used = await db.one('SELECT COUNT(*) AS n FROM hms.LabOrderItems WHERE TenantId = @tid AND LabTestId = @id', { tid: req.ctx.tenantId, id });
  if (used.n) throw conflict('This test has been ordered before. Mark it inactive instead.', 'IN_USE');
  const n = await db.exec('DELETE FROM hms.LabTests WHERE TenantId = @tid AND LabTestId = @id', { tid: req.ctx.tenantId, id });
  if (!n) throw notFound('Test not found.');
  await auditTenant(req, 'lab_test.deleted', 'lab_test', id);
  res.json({ data: { ok: true } });
}));

// ---------- Orders ----------
const ORDER_FROM = `FROM hms.LabOrders o
  JOIN hms.Patients p ON p.TenantId = o.TenantId AND p.PatientId = o.PatientId
  LEFT JOIN hms.StaffMembers s ON s.TenantId = o.TenantId AND s.StaffId = o.DoctorId`;

router.get('/orders', requirePermission('lab.read'), asyncHandler(async (req, res) => {
  const lq = parseListQuery(req.query, { ordered: 'o.OrderedAt' }, 'ordered');
  let from = null; let to = null;
  if (req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) ({ start: from, end: to } = localDayRangeUtc(req.ctx.timezone, req.query.date));
  const q = req.query.q ? `%${String(req.query.q).trim().slice(0, 100).replace(/[%_[\]]/g, (m) => `[${m}]`)}%` : null;
  const params = {
    tid: req.ctx.tenantId, offset: lq.offset, size: lq.pageSize, from, to, q,
    status: ['ordered', 'sample_collected', 'completed', 'verified', 'cancelled'].includes(req.query.status) ? req.query.status : null,
    patientId: req.query.patientId ? idParam(req.query.patientId, 'patientId') : null,
  };
  const where = `WHERE o.TenantId = @tid AND (@status IS NULL OR o.Status = @status) AND (@patientId IS NULL OR o.PatientId = @patientId)
    AND (@from IS NULL OR o.OrderedAt >= @from) AND (@to IS NULL OR o.OrderedAt < @to)
    AND (@q IS NULL OR o.OrderNumber LIKE @q OR p.PatientNumber LIKE @q OR p.FirstName LIKE @q OR p.LastName LIKE @q)`;
  const [rows, total] = await db.many(`
    SELECT o.LabOrderId AS id, o.OrderNumber AS number, o.Status AS status, o.Priority AS priority, o.OrderedAt AS orderedAt, o.VerifiedAt AS verifiedAt,
           p.PatientId AS patientId, p.PatientNumber AS patientNumber, p.FirstName AS patientFirstName, p.LastName AS patientLastName, s.FullName AS doctorName,
           (SELECT STRING_AGG(i.TestName, ', ') FROM hms.LabOrderItems i WHERE i.TenantId = o.TenantId AND i.LabOrderId = o.LabOrderId) AS tests
    ${ORDER_FROM} ${where} ORDER BY ${lq.orderBy} OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY;
    SELECT COUNT(*) AS total ${ORDER_FROM} ${where};`, params);
  res.json({ data: rows, meta: pageMeta(lq, total[0].total) });
}));

router.post('/orders', requirePermission('lab.write'),
  validate(z.object({
    patientId: z.number().int().positive(), doctorId: z.number().int().positive().nullable().optional(),
    consultationId: z.number().int().positive().nullable().optional(), testIds: z.array(z.number().int().positive()).min(1).max(30),
    priority: z.enum(['routine', 'urgent']).default('routine'), notes: z.string().trim().max(500).optional(), addToBill: z.boolean().optional(),
  }).strict()),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const out = await withTransaction(async (tx) => {
      const pat = await tx.one('SELECT PatientId FROM hms.Patients WHERE TenantId = @tid AND PatientId = @id AND IsArchived = 0', { tid: req.ctx.tenantId, id: b.patientId });
      if (!pat) throw badRequest('Patient not found.');
      if (b.doctorId && !(await tx.one(`SELECT 1 AS ok FROM hms.StaffMembers WHERE TenantId = @tid AND StaffId = @id AND StaffType = 'doctor'`, { tid: req.ctx.tenantId, id: b.doctorId }))) {
        throw badRequest('Doctor not found.');
      }
      if (b.consultationId) {
        const c = await tx.one('SELECT PatientId FROM hms.Consultations WHERE TenantId = @tid AND ConsultationId = @id', { tid: req.ctx.tenantId, id: b.consultationId });
        if (!c || Number(c.PatientId) !== b.patientId) throw badRequest('Consultation does not belong to this patient.');
      }
      const ids = [...new Set(b.testIds)];
      const tests = await tx.query(`SELECT * FROM hms.LabTests WHERE TenantId = @tid AND IsActive = 1 AND LabTestId IN (SELECT CAST(value AS INT) FROM STRING_SPLIT(@ids, ','))`,
        { tid: req.ctx.tenantId, ids: ids.join(',') });
      if (tests.length !== ids.length) throw badRequest('One or more tests are invalid or inactive.');
      const n = await nextSequence(tx, req.ctx.tenantId, 'lab_order');
      const order = await tx.one(`INSERT INTO hms.LabOrders (TenantId, OrderNumber, PatientId, DoctorId, ConsultationId, Priority, Notes, OrderedByUserId)
                                  OUTPUT INSERTED.LabOrderId, INSERTED.OrderNumber VALUES (@tid, @num, @pid, @did, @cid, @pri, @notes, @uid)`,
      { tid: req.ctx.tenantId, num: formatNumber('LAB', n), pid: b.patientId, did: b.doctorId ?? null, cid: b.consultationId ?? null, pri: b.priority, notes: b.notes ?? null, uid: req.ctx.userId });
      for (const test of tests) {
        await tx.exec(`INSERT INTO hms.LabOrderItems (TenantId, LabOrderId, LabTestId, TestName, Unit, RefLow, RefHigh, RefText, Price)
                       VALUES (@tid, @oid, @test, @name, @unit, @lo, @hi, @txt, @price)`,
        { tid: req.ctx.tenantId, oid: order.LabOrderId, test: test.LabTestId, name: test.Name, unit: test.Unit, lo: test.RefLow == null ? null : t.dec(test.RefLow, 12, 4),
          hi: test.RefHigh == null ? null : t.dec(test.RefHigh, 12, 4), txt: test.RefText, price: t.money(Number(test.Price).toFixed(2)) });
      }
      let billId = null;
      if (b.addToBill && req.ctx.features.has('billing') && req.ctx.permissions.has('billing.write')) {
        billId = await getOrCreateDraftBill(tx, req.ctx, b.patientId);
        for (const test of tests) {
          if (Number(test.Price) > 0) {
            await addBillItem(tx, req.ctx.tenantId, billId, { itemType: 'lab', description: `${test.Name} (${order.OrderNumber})`, quantity: 1,
              unitPrice: Number(test.Price).toFixed(2), taxRatePercent: 0, referenceType: 'lab_order', referenceId: order.LabOrderId });
          }
        }
      }
      await auditTenant(req, 'lab_order.created', 'lab_order', order.LabOrderId, { tests: tests.length, billed: Boolean(billId) }, tx);
      return { id: order.LabOrderId, number: order.OrderNumber, billId };
    });
    res.status(201).json({ data: out });
  }));

router.get('/orders/:id', requirePermission('lab.read'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const [orders, items] = await db.many(`
    SELECT o.*, p.PatientNumber, p.FirstName, p.LastName, p.Gender, CONVERT(CHAR(10), p.DateOfBirth, 23) AS DateOfBirth, s.FullName AS DoctorName,
           v.FullName AS VerifiedByName, t.Name AS HospitalName,
           (SELECT SettingValue FROM hms.TenantSettings WHERE TenantId = o.TenantId AND SettingKey = 'hospital.address') AS HospitalAddress
    ${ORDER_FROM}
    LEFT JOIN hms.Users v ON v.TenantId = o.TenantId AND v.UserId = o.VerifiedByUserId
    JOIN hms.Tenants t ON t.TenantId = o.TenantId
    WHERE o.TenantId = @tid AND o.LabOrderId = @id;
    SELECT LabOrderItemId AS id, TestName AS testName, Unit AS unit, RefLow AS refLow, RefHigh AS refHigh, RefText AS refText, Price AS price,
           ResultValue AS resultValue, Flag AS flag, EnteredAt AS enteredAt
    FROM hms.LabOrderItems WHERE TenantId = @tid AND LabOrderId = @id ORDER BY LabOrderItemId;`, { tid: req.ctx.tenantId, id });
  const o = orders[0];
  if (!o) throw notFound('Lab order not found.');
  await auditTenant(req, 'lab_order.viewed', 'lab_order', id);
  res.json({
    data: {
      id: o.LabOrderId, number: o.OrderNumber, status: o.Status, priority: o.Priority, notes: o.Notes, cancelReason: o.CancelReason,
      orderedAt: o.OrderedAt, sampleCollectedAt: o.SampleCollectedAt, completedAt: o.CompletedAt, verifiedAt: o.VerifiedAt, verifiedBy: o.VerifiedByName,
      doctorName: o.DoctorName, consultationId: o.ConsultationId,
      patient: { id: o.PatientId, patientNumber: o.PatientNumber, firstName: o.FirstName, lastName: o.LastName, gender: o.Gender, dateOfBirth: o.DateOfBirth },
      hospital: { name: o.HospitalName, address: o.HospitalAddress },
      items,
    },
  });
}));

router.post('/orders/:id/status', requirePermission('lab.write'),
  validate(z.object({ status: z.enum(['sample_collected', 'cancelled']), reason: z.string().trim().max(300).optional() }).strict()),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    await withTransaction(async (tx) => {
      const o = await tx.one('SELECT Status FROM hms.LabOrders WITH (UPDLOCK) WHERE TenantId = @tid AND LabOrderId = @id', { tid: req.ctx.tenantId, id });
      if (!o) throw notFound('Lab order not found.');
      if (!canMoveLab(o.Status, req.body.status)) throw conflict(`Cannot move an order from ${o.Status} to ${req.body.status}.`, 'INVALID_TRANSITION');
      if (req.body.status === 'cancelled' && !req.body.reason) throw badRequest('A cancellation reason is required.');
      await tx.exec(`UPDATE hms.LabOrders SET Status = @s,
                       SampleCollectedAt = CASE WHEN @s = 'sample_collected' THEN SYSUTCDATETIME() ELSE SampleCollectedAt END,
                       CancelReason = CASE WHEN @s = 'cancelled' THEN @r ELSE CancelReason END
                     WHERE TenantId = @tid AND LabOrderId = @id`, { tid: req.ctx.tenantId, id, s: req.body.status, r: req.body.reason ?? null });
      await auditTenant(req, `lab_order.${req.body.status}`, 'lab_order', id, null, tx);
    });
    res.json({ data: { ok: true } });
  }));

router.put('/orders/:id/results', requirePermission('lab.write'),
  validate(z.object({ results: z.array(z.object({ itemId: z.number().int().positive(), value: z.string().trim().max(200) }).strict()).min(1).max(30) }).strict()),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const status = await withTransaction(async (tx) => {
      const o = await tx.one('SELECT Status FROM hms.LabOrders WITH (UPDLOCK) WHERE TenantId = @tid AND LabOrderId = @id', { tid: req.ctx.tenantId, id });
      if (!o) throw notFound('Lab order not found.');
      if (!['sample_collected', 'completed'].includes(o.Status)) {
        throw conflict(o.Status === 'verified' ? 'Results are verified and locked.' : 'Collect the sample before entering results.', 'LAB_STATE');
      }
      const items = await tx.query('SELECT LabOrderItemId, RefLow, RefHigh FROM hms.LabOrderItems WHERE TenantId = @tid AND LabOrderId = @id', { tid: req.ctx.tenantId, id });
      const byId = new Map(items.map((i) => [Number(i.LabOrderItemId), i]));
      for (const r of req.body.results) {
        const item = byId.get(r.itemId);
        if (!item) throw badRequest('Result refers to a test that is not on this order.');
        const value = r.value || null;
        const numeric = value !== null && /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : null;
        await tx.exec(`UPDATE hms.LabOrderItems SET ResultValue = @v, ResultNumeric = @n, Flag = @f, EnteredByUserId = @uid, EnteredAt = SYSUTCDATETIME()
                       WHERE TenantId = @tid AND LabOrderId = @id AND LabOrderItemId = @item`,
        { tid: req.ctx.tenantId, id, item: r.itemId, v: value, n: numeric === null ? null : t.dec(numeric, 12, 4), f: labFlag(numeric, item.RefLow, item.RefHigh), uid: req.ctx.userId });
      }
      const pending = await tx.one('SELECT COUNT(*) AS n FROM hms.LabOrderItems WHERE TenantId = @tid AND LabOrderId = @id AND ResultValue IS NULL', { tid: req.ctx.tenantId, id });
      const next = pending.n === 0 ? 'completed' : 'sample_collected';
      await tx.exec(`UPDATE hms.LabOrders SET Status = @s, CompletedAt = CASE WHEN @s = 'completed' THEN SYSUTCDATETIME() ELSE NULL END WHERE TenantId = @tid AND LabOrderId = @id`,
        { tid: req.ctx.tenantId, id, s: next });
      await auditTenant(req, 'lab_order.results_entered', 'lab_order', id, { count: req.body.results.length }, tx);
      return next;
    });
    res.json({ data: { status } });
  }));

router.post('/orders/:id/verify', requirePermission('lab.verify'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  await withTransaction(async (tx) => {
    const o = await tx.one('SELECT Status FROM hms.LabOrders WITH (UPDLOCK) WHERE TenantId = @tid AND LabOrderId = @id', { tid: req.ctx.tenantId, id });
    if (!o) throw notFound('Lab order not found.');
    if (!canMoveLab(o.Status, 'verified')) throw conflict('Only completed orders (all results entered) can be verified.', 'LAB_STATE');
    await tx.exec(`UPDATE hms.LabOrders SET Status = 'verified', VerifiedAt = SYSUTCDATETIME(), VerifiedByUserId = @uid WHERE TenantId = @tid AND LabOrderId = @id`,
      { tid: req.ctx.tenantId, id, uid: req.ctx.userId });
    await auditTenant(req, 'lab_order.verified', 'lab_order', id, null, tx);
  });
  res.json({ data: { ok: true } });
}));

export default router;
