// Laboratory: test catalogue, packages, price history, referral doctors, orders (with own invoice and
// payment status), sample tracking, result entry and verification (results locked after verification).
// Every query is scoped by req.ctx.tenantId — ids from another hospital simply return 404.
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requireTenant, requirePermission, requireFeature } from '../../middleware/auth.js';
import { asyncHandler, badRequest, conflict, notFound, HttpError } from '../../utils/errors.js';
import { db, withTransaction, t } from '../../db/pool.js';
import { parseListQuery, pageMeta } from '../../utils/pagination.js';
import { idParam } from '../../utils/params.js';
import { auditTenant } from '../../utils/audit.js';
import { localDayRangeUtc } from '../../utils/time.js';
import { toMinor as strictMinor, fromMinor } from '../../utils/pricing.js';

const toMinor = (v) => strictMinor(Number(v || 0).toFixed(2));
import { nextSequence, formatNumber } from '../tenants/sequences.js';
import { labFlag, canMoveLab, allocatePackagePrice, labPaymentStatus, canMoveSample, balanceDue } from '../clinical/logic.js';
import { panelFlag } from '../clinical/phase3.logic.js';
import { PARAMS_SQL, attachParameters, itemsSql } from './lab.shared.js';
import labExtrasRoutes from './labExtras.routes.js';
import labMasterRoutes from './labMaster.routes.js';
import { recordPrice, testSchema, insertLabTest, updateLabTest } from './labTests.service.js';
import { checkResult, panelComplete } from '../clinical/labMaster.logic.js';
import { config } from '../../config/env.js';
import { randomToken, sha256Hex } from '../../utils/crypto.js';
import { deliver, templates } from '../../notify/index.js';
import { addBillItem, getOrCreateDraftBill, createDraftBill, recalcBill, finalizeBill, recordBillPayment } from '../billing/billing.service.js';
import { optionalPhone, optionalEmail } from '../../utils/contact.js';

const router = Router();
router.use(requireTenant, requireFeature('laboratory'));

const like = (v) => (v ? `%${String(v).trim().slice(0, 100).replace(/[%_[\]]/g, (m) => `[${m}]`)}%` : null);
const nullableNum = z.union([z.literal('').transform(() => null), z.null(), z.coerce.number()]).optional();
const optText = (max) => z.string().trim().max(max).nullable().optional();
const price = z.coerce.number().min(0).max(1e7);

// ---------- Test catalogue ----------
router.get('/tests', requirePermission('lab.read'), asyncHandler(async (req, res) => {
  const deptId = /^\d{1,9}$/.test(String(req.query.departmentId || '')) ? Number(req.query.departmentId) : null;
  const rows = await db.query(`SELECT lt.LabTestId AS id, lt.Code AS code, lt.Name AS name, ISNULL(d.Name, lt.Department) AS department, lt.DepartmentId AS departmentId,
                                      lt.Description AS description, lt.SampleType AS sampleType, lt.Unit AS unit, lt.RefLow AS refLow, lt.RefHigh AS refHigh,
                                      lt.RefText AS refText, lt.Price AS price, lt.IsActive AS isActive, lt.Method AS method, lt.Instrument AS instrument,
                                      lt.Interpretation AS interpretation, lt.InputType AS inputType, lt.Options AS options, lt.Decimals AS decimals,
                                      lt.TatHours AS tatHours, lt.SortOrder AS sortOrder,
                                      (SELECT COUNT(*) FROM hms.LabTestParameters lp WHERE lp.TenantId = lt.TenantId AND lp.LabTestId = lt.LabTestId AND lp.IsActive = 1) AS parameterCount
                               FROM hms.LabTests lt LEFT JOIN hms.LabDepartments d ON d.TenantId = lt.TenantId AND d.LabDepartmentId = lt.DepartmentId
                               WHERE lt.TenantId = @tid AND (@all = 1 OR lt.IsActive = 1)
                                 AND (@q IS NULL OR lt.Name LIKE @q OR lt.Code LIKE @q)
                                 AND (@dept IS NULL OR ISNULL(d.Name, lt.Department) = @dept) AND (@deptId IS NULL OR lt.DepartmentId = @deptId)
                               ORDER BY ISNULL(d.SortOrder, 9999), ISNULL(lt.SortOrder, 9999), lt.Name`,
  { tid: req.ctx.tenantId, all: req.query.all === 'true', q: like(req.query.q), dept: req.query.department ? String(req.query.department).slice(0, 60) : null, deptId });
  res.json({ data: rows.map((r) => ({ ...r, options: r.options ? r.options.split('|') : [] })) });
}));

router.post('/tests', requirePermission('lab.configure'), validate(testSchema), asyncHandler(async (req, res) => {
  const id = await withTransaction(async (tx) => {
    const newId = await insertLabTest(tx, req.ctx, req.body);
    await auditTenant(req, 'lab_test.created', 'lab_test', newId, { code: req.body.code }, tx);
    return newId;
  });
  res.status(201).json({ data: { id } });
}));

router.put('/tests/:id', requirePermission('lab.configure'), validate(testSchema), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  await withTransaction(async (tx) => {
    await updateLabTest(tx, req.ctx, id, req.body);
    await auditTenant(req, 'lab_test.updated', 'lab_test', id, null, tx);
  });
  res.json({ data: { ok: true } });
}));

router.delete('/tests/:id', requirePermission('lab.configure'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  await withTransaction(async (tx) => {
    const used = await tx.one(`SELECT (SELECT COUNT(*) FROM hms.LabOrderItems WHERE TenantId = @tid AND LabTestId = @id) AS orders,
                                      (SELECT COUNT(*) FROM hms.LabPackageTests WHERE TenantId = @tid AND LabTestId = @id) AS packages`, { tid: req.ctx.tenantId, id });
    if (used.orders) throw conflict('This test has been ordered before. Mark it inactive instead.', 'IN_USE');
    if (used.packages) throw conflict('This test is part of a package. Remove it from the package first.', 'IN_USE');
    await tx.exec(`DELETE FROM hms.LabPriceHistory WHERE TenantId = @tid AND ItemType = 'test' AND ItemId = @id`, { tid: req.ctx.tenantId, id });
    const n = await tx.exec('DELETE FROM hms.LabTests WHERE TenantId = @tid AND LabTestId = @id', { tid: req.ctx.tenantId, id });
    if (!n) throw notFound('Test not found.');
    await auditTenant(req, 'lab_test.deleted', 'lab_test', id, null, tx);
  });
  res.json({ data: { ok: true } });
}));

// ---------- Price history (tests & packages) ----------
const PRICE_TABLE = {
  test: { table: 'hms.LabTests', idCol: 'LabTestId', label: 'Test' },
  package: { table: 'hms.LabPackages', idCol: 'LabPackageId', label: 'Package' },
};

for (const [type, cfg] of Object.entries(PRICE_TABLE)) {
  const path = type === 'test' ? '/tests/:id/prices' : '/packages/:id/prices';

  router.get(path, requirePermission('lab.read'), asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const [items, history] = await db.many(`
      SELECT ${cfg.idCol} AS id, Code AS code, Name AS name, Price AS price FROM ${cfg.table} WHERE TenantId = @tid AND ${cfg.idCol} = @id;
      SELECT h.LabPriceHistoryId AS id, h.Price AS price, h.Reason AS reason, h.EffectiveAt AS effectiveAt, u.FullName AS changedBy
      FROM hms.LabPriceHistory h LEFT JOIN hms.Users u ON u.TenantId = h.TenantId AND u.UserId = h.ChangedByUserId
      WHERE h.TenantId = @tid AND h.ItemType = @type AND h.ItemId = @id ORDER BY h.EffectiveAt DESC, h.LabPriceHistoryId DESC;`,
    { tid: req.ctx.tenantId, id, type });
    const item = items[0];
    if (!item) throw notFound(`${cfg.label} not found.`);
    let individualTotal = null; let testCount = null;
    if (type === 'package') {
      const r = await db.one(`SELECT COUNT(*) AS n, ISNULL(SUM(lt.Price), 0) AS total FROM hms.LabPackageTests pt
                              JOIN hms.LabTests lt ON lt.TenantId = pt.TenantId AND lt.LabTestId = pt.LabTestId
                              WHERE pt.TenantId = @tid AND pt.LabPackageId = @id`, { tid: req.ctx.tenantId, id });
      individualTotal = r.total; testCount = r.n;
    }
    res.json({ data: { item: { ...item, type, individualTotal, testCount }, history } });
  }));

  router.post(path, requirePermission('lab.configure'),
    validate(z.object({ price, reason: z.string().trim().min(3, 'Give a reason (min 3 characters)').max(200) }).strict()),
    asyncHandler(async (req, res) => {
      const id = idParam(req.params.id);
      await withTransaction(async (tx) => {
        const row = await tx.one(`SELECT Price FROM ${cfg.table} WITH (UPDLOCK) WHERE TenantId = @tid AND ${cfg.idCol} = @id`, { tid: req.ctx.tenantId, id });
        if (!row) throw notFound(`${cfg.label} not found.`);
        if (Number(row.Price).toFixed(2) === Number(req.body.price).toFixed(2)) throw badRequest('The new price is the same as the current price.');
        await tx.exec(`UPDATE ${cfg.table} SET Price = @price${type === 'package' ? ', UpdatedAt = SYSUTCDATETIME()' : ''} WHERE TenantId = @tid AND ${cfg.idCol} = @id`,
          { tid: req.ctx.tenantId, id, price: t.money(Number(req.body.price).toFixed(2)) });
        await recordPrice(tx, req.ctx, type, id, req.body.price, req.body.reason);
        await auditTenant(req, `lab_${type}.price_changed`, `lab_${type}`, id, { from: row.Price, to: req.body.price }, tx);
      });
      res.status(201).json({ data: { ok: true } });
    }));
}

// ---------- Packages ----------
const PACKAGE_SUMMARY = `
  SELECT pk.LabPackageId AS id, pk.Code AS code, pk.Name AS name, pk.Department AS department, pk.Description AS description,
         pk.Price AS price, pk.IsActive AS isActive, pk.CreatedAt AS createdAt,
         (SELECT COUNT(*) FROM hms.LabPackageTests pt WHERE pt.TenantId = pk.TenantId AND pt.LabPackageId = pk.LabPackageId) AS testCount,
         (SELECT ISNULL(SUM(lt.Price), 0) FROM hms.LabPackageTests pt JOIN hms.LabTests lt ON lt.TenantId = pt.TenantId AND lt.LabTestId = pt.LabTestId
           WHERE pt.TenantId = pk.TenantId AND pt.LabPackageId = pk.LabPackageId) AS individualTotal
  FROM hms.LabPackages pk`;

router.get('/packages', requirePermission('lab.read'), asyncHandler(async (req, res) => {
  const rows = await db.query(`${PACKAGE_SUMMARY}
    WHERE pk.TenantId = @tid AND (@all = 1 OR pk.IsActive = 1) AND (@q IS NULL OR pk.Name LIKE @q OR pk.Code LIKE @q OR pk.Department LIKE @q)
    ORDER BY pk.Name`, { tid: req.ctx.tenantId, all: req.query.all === 'true', q: like(req.query.q) });
  res.json({ data: rows.map((r) => ({ ...r, savings: (Number(r.individualTotal) - Number(r.price)).toFixed(2) })) });
}));

router.get('/packages/:id', requirePermission('lab.read'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const [rows, tests] = await db.many(`${PACKAGE_SUMMARY} WHERE pk.TenantId = @tid AND pk.LabPackageId = @id;
    SELECT lt.LabTestId AS id, lt.Code AS code, lt.Name AS name, lt.Price AS price, lt.SampleType AS sampleType
    FROM hms.LabPackageTests pt JOIN hms.LabTests lt ON lt.TenantId = pt.TenantId AND lt.LabTestId = pt.LabTestId
    WHERE pt.TenantId = @tid AND pt.LabPackageId = @id ORDER BY lt.Name;`, { tid: req.ctx.tenantId, id });
  if (!rows[0]) throw notFound('Package not found.');
  res.json({ data: { ...rows[0], tests, testIds: tests.map((x) => x.id) } });
}));

const packageBase = {
  name: z.string().trim().min(2).max(150), department: optText(60), description: optText(500), isActive: z.boolean().optional(),
  testIds: z.array(z.coerce.number().int().positive()).min(1, 'Select at least one test').max(60),
};

async function setPackageTests(tx, tenantId, packageId, testIds) {
  const ids = [...new Set(testIds)];
  const found = await tx.one(`SELECT COUNT(*) AS n FROM hms.LabTests WHERE TenantId = @tid AND LabTestId IN (SELECT CAST(value AS INT) FROM STRING_SPLIT(@ids, ','))`,
    { tid: tenantId, ids: ids.join(',') });
  if (found.n !== ids.length) throw badRequest('One or more selected tests do not exist.');
  await tx.exec('DELETE FROM hms.LabPackageTests WHERE TenantId = @tid AND LabPackageId = @id', { tid: tenantId, id: packageId });
  await tx.exec(`INSERT INTO hms.LabPackageTests (TenantId, LabPackageId, LabTestId)
                 SELECT @tid, @id, CAST(value AS INT) FROM STRING_SPLIT(@ids, ',')`, { tid: tenantId, id: packageId, ids: ids.join(',') });
}

router.post('/packages', requirePermission('lab.configure'), validate(z.object({ ...packageBase, price }).strict()), asyncHandler(async (req, res) => {
  const b = req.body;
  const out = await withTransaction(async (tx) => {
    const code = formatNumber('PKG', await nextSequence(tx, req.ctx.tenantId, 'lab_package'));
    const r = await tx.one(`INSERT INTO hms.LabPackages (TenantId, Code, Name, Department, Description, Price, IsActive)
                            OUTPUT INSERTED.LabPackageId VALUES (@tid, @code, @name, @dept, @descr, @price, @active)`,
    { tid: req.ctx.tenantId, code, name: b.name, dept: b.department || null, descr: b.description || null, price: t.money(Number(b.price).toFixed(2)), active: b.isActive ?? true });
    await setPackageTests(tx, req.ctx.tenantId, r.LabPackageId, b.testIds);
    await recordPrice(tx, req.ctx, 'package', r.LabPackageId, b.price, 'Initial setup');
    await auditTenant(req, 'lab_package.created', 'lab_package', r.LabPackageId, { code, tests: b.testIds.length }, tx);
    return { id: r.LabPackageId, code };
  });
  res.status(201).json({ data: out });
}));

// Price is not edited here — it changes only through the price history endpoint, so every change has a reason.
router.put('/packages/:id', requirePermission('lab.configure'), validate(z.object(packageBase).strict()), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const b = req.body;
  await withTransaction(async (tx) => {
    const n = await tx.exec(`UPDATE hms.LabPackages SET Name = @name, Department = @dept, Description = @descr, IsActive = @active, UpdatedAt = SYSUTCDATETIME()
                             WHERE TenantId = @tid AND LabPackageId = @id`,
    { tid: req.ctx.tenantId, id, name: b.name, dept: b.department || null, descr: b.description || null, active: b.isActive ?? true });
    if (!n) throw notFound('Package not found.');
    await setPackageTests(tx, req.ctx.tenantId, id, b.testIds);
    await auditTenant(req, 'lab_package.updated', 'lab_package', id, { tests: b.testIds.length }, tx);
  });
  res.json({ data: { ok: true } });
}));

router.delete('/packages/:id', requirePermission('lab.configure'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  await withTransaction(async (tx) => {
    const used = await tx.one('SELECT COUNT(*) AS n FROM hms.LabOrderItems WHERE TenantId = @tid AND LabPackageId = @id', { tid: req.ctx.tenantId, id });
    if (used.n) throw conflict('This package has been ordered before. Mark it inactive instead.', 'IN_USE');
    await tx.exec('DELETE FROM hms.LabPackageTests WHERE TenantId = @tid AND LabPackageId = @id', { tid: req.ctx.tenantId, id });
    await tx.exec(`DELETE FROM hms.LabPriceHistory WHERE TenantId = @tid AND ItemType = 'package' AND ItemId = @id`, { tid: req.ctx.tenantId, id });
    const n = await tx.exec('DELETE FROM hms.LabPackages WHERE TenantId = @tid AND LabPackageId = @id', { tid: req.ctx.tenantId, id });
    if (!n) throw notFound('Package not found.');
    await auditTenant(req, 'lab_package.deleted', 'lab_package', id, null, tx);
  });
  res.json({ data: { ok: true } });
}));

// ---------- Referral doctors ----------
router.get('/referrals', requirePermission('lab.read'), asyncHandler(async (req, res) => {
  const rows = await db.query(`
    SELECT r.ReferralDoctorId AS id, r.Name AS name, r.Qualification AS qualification, r.Clinic AS clinic, r.Phone AS phone, r.Email AS email,
           r.CommissionPercent AS commissionPercent, r.IsActive AS isActive,
           (SELECT COUNT(*) FROM hms.LabOrders o WHERE o.TenantId = r.TenantId AND o.ReferralDoctorId = r.ReferralDoctorId AND o.Status <> 'cancelled') AS orders,
           (SELECT ISNULL(SUM(o.NetAmount), 0) FROM hms.LabOrders o WHERE o.TenantId = r.TenantId AND o.ReferralDoctorId = r.ReferralDoctorId AND o.Status <> 'cancelled') AS business
    FROM hms.ReferralDoctors r WHERE r.TenantId = @tid AND (@all = 1 OR r.IsActive = 1)
      AND (@q IS NULL OR r.Name LIKE @q OR r.Clinic LIKE @q OR r.Phone LIKE @q) ORDER BY r.Name`,
  { tid: req.ctx.tenantId, all: req.query.all === 'true', q: like(req.query.q) });
  res.json({ data: rows });
}));

const referralSchema = z.object({
  name: z.string().trim().min(2).max(150), qualification: optText(100), clinic: optText(150),
  phone: optionalPhone,
  email: optionalEmail,
  commissionPercent: z.coerce.number().min(0).max(100).default(0), isActive: z.boolean().optional(),
}).strict();
const referralParams = (b) => ({ name: b.name, q: b.qualification || null, clinic: b.clinic || null, phone: b.phone || null, email: b.email || null,
  comm: t.dec(Number(b.commissionPercent || 0), 5, 2), active: b.isActive ?? true });

router.post('/referrals', requirePermission('lab.configure'), validate(referralSchema), asyncHandler(async (req, res) => {
  const r = await db.one(`INSERT INTO hms.ReferralDoctors (TenantId, Name, Qualification, Clinic, Phone, Email, CommissionPercent, IsActive)
                          OUTPUT INSERTED.ReferralDoctorId VALUES (@tid, @name, @q, @clinic, @phone, @email, @comm, @active)`, { tid: req.ctx.tenantId, ...referralParams(req.body) });
  await auditTenant(req, 'referral_doctor.created', 'referral_doctor', r.ReferralDoctorId);
  res.status(201).json({ data: { id: r.ReferralDoctorId } });
}));

router.put('/referrals/:id', requirePermission('lab.configure'), validate(referralSchema), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const n = await db.exec(`UPDATE hms.ReferralDoctors SET Name = @name, Qualification = @q, Clinic = @clinic, Phone = @phone, Email = @email,
                             CommissionPercent = @comm, IsActive = @active WHERE TenantId = @tid AND ReferralDoctorId = @id`, { tid: req.ctx.tenantId, id, ...referralParams(req.body) });
  if (!n) throw notFound('Referral doctor not found.');
  await auditTenant(req, 'referral_doctor.updated', 'referral_doctor', id);
  res.json({ data: { ok: true } });
}));

router.delete('/referrals/:id', requirePermission('lab.configure'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const used = await db.one('SELECT COUNT(*) AS n FROM hms.LabOrders WHERE TenantId = @tid AND ReferralDoctorId = @id', { tid: req.ctx.tenantId, id });
  if (used.n) throw conflict('This doctor has referred orders. Mark them inactive instead.', 'IN_USE');
  const n = await db.exec('DELETE FROM hms.ReferralDoctors WHERE TenantId = @tid AND ReferralDoctorId = @id', { tid: req.ctx.tenantId, id });
  if (!n) throw notFound('Referral doctor not found.');
  await auditTenant(req, 'referral_doctor.deleted', 'referral_doctor', id);
  res.json({ data: { ok: true } });
}));

// ---------- Orders ----------
const ORDER_FROM = `FROM hms.LabOrders o
  JOIN hms.Patients p ON p.TenantId = o.TenantId AND p.PatientId = o.PatientId
  LEFT JOIN hms.StaffMembers s ON s.TenantId = o.TenantId AND s.StaffId = o.DoctorId
  LEFT JOIN hms.ReferralDoctors rd ON rd.TenantId = o.TenantId AND rd.ReferralDoctorId = o.ReferralDoctorId
  LEFT JOIN hms.Bills b ON b.TenantId = o.TenantId AND b.BillId = o.BillId`;

const PAY_STATUS_SQL = `CASE WHEN o.BillId IS NULL THEN 'unbilled' WHEN b.Status = 'cancelled' THEN 'cancelled' WHEN b.Status = 'draft' THEN 'on_bill'
  WHEN b.PaidAmount >= b.Total THEN 'paid' WHEN b.PaidAmount > 0 THEN 'partial' ELSE 'unpaid' END`;
const ORDER_STATUSES = ['ordered', 'sample_collected', 'completed', 'verified', 'cancelled'];
const PAY_STATUSES = ['unbilled', 'on_bill', 'unpaid', 'partial', 'paid', 'cancelled'];

/** Paid / balance of a lab order. For an order on a shared (OPD) bill these refer to the whole bill. */
function orderMoney(r) {
  const bill = r.billId == null ? null : { billId: r.billId, status: r.billStatus, total: r.billTotal, paid: r.billPaid };
  const paymentStatus = labPaymentStatus(bill);
  const own = Boolean(r.ownBill);
  return {
    paymentStatus,
    paid: bill && own ? Number(r.billPaid).toFixed(2) : null,
    balance: bill && own && r.billStatus === 'finalized' ? balanceDue(r.billTotal, r.billPaid) : null,
  };
}

router.get('/orders', requirePermission('lab.read'), asyncHandler(async (req, res) => {
  const lq = parseListQuery(req.query, { ordered: 'o.OrderedAt', net: 'o.NetAmount' }, 'ordered');
  let from = null; let to = null;
  if (req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) ({ start: from, end: to } = localDayRangeUtc(req.ctx.timezone, req.query.date));
  const statuses = String(req.query.status || '').split(',').filter((s) => ORDER_STATUSES.includes(s));
  const params = {
    tid: req.ctx.tenantId, offset: lq.offset, size: lq.pageSize, from, to, q: like(req.query.q),
    statuses: statuses.length ? statuses.join(',') : null,
    pay: PAY_STATUSES.includes(req.query.paymentStatus) ? req.query.paymentStatus : null,
    patientId: req.query.patientId ? idParam(req.query.patientId, 'patientId') : null,
    referralId: req.query.referralDoctorId ? idParam(req.query.referralDoctorId, 'referralDoctorId') : null,
  };
  const where = `WHERE o.TenantId = @tid AND (@statuses IS NULL OR o.Status IN (SELECT value FROM STRING_SPLIT(@statuses, ',')))
    AND (@patientId IS NULL OR o.PatientId = @patientId) AND (@referralId IS NULL OR o.ReferralDoctorId = @referralId)
    AND (@from IS NULL OR o.OrderedAt >= @from) AND (@to IS NULL OR o.OrderedAt < @to)
    AND (@pay IS NULL OR ${PAY_STATUS_SQL} = @pay)
    AND (@q IS NULL OR o.OrderNumber LIKE @q OR p.PatientNumber LIKE @q OR p.FirstName LIKE @q OR p.LastName LIKE @q OR p.Phone LIKE @q)`;
  const [rows, total] = await db.many(`
    SELECT o.LabOrderId AS id, o.OrderNumber AS number, o.Status AS status, o.Priority AS priority, o.OrderedAt AS orderedAt, o.VerifiedAt AS verifiedAt,
           o.GrossAmount AS gross, o.DiscountAmount AS discount, o.NetAmount AS net, o.OwnBill AS ownBill,
           o.BillId AS billId, b.Status AS billStatus, b.Total AS billTotal, b.PaidAmount AS billPaid, b.BillNumber AS billNumber,
           p.PatientId AS patientId, p.PatientNumber AS patientNumber, p.FirstName AS patientFirstName, p.LastName AS patientLastName, p.Phone AS patientPhone,
           s.FullName AS doctorName, rd.Name AS referralName,
           (SELECT STRING_AGG(i.TestName, ', ') FROM hms.LabOrderItems i WHERE i.TenantId = o.TenantId AND i.LabOrderId = o.LabOrderId) AS tests
    ${ORDER_FROM} ${where} ORDER BY ${lq.orderBy} OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY;
    SELECT COUNT(*) AS total ${ORDER_FROM} ${where};`, params);
  res.json({ data: rows.map((r) => ({ ...r, ...orderMoney(r) })), meta: pageMeta(lq, total[0].total) });
}));

const orderSchema = z.object({
  patientId: z.coerce.number().int().positive(), doctorId: z.coerce.number().int().positive().nullable().optional(),
  referralDoctorId: z.coerce.number().int().positive().nullable().optional(),
  consultationId: z.coerce.number().int().positive().nullable().optional(),
  testIds: z.array(z.coerce.number().int().positive()).max(40).default([]),
  packageIds: z.array(z.coerce.number().int().positive()).max(10).default([]),
  priority: z.enum(['routine', 'urgent']).default('routine'), notes: z.string().trim().max(500).optional(),
  discount: z.coerce.number().min(0).max(1e7).default(0),
  addToBill: z.boolean().optional(),
  payment: z.object({
    amount: z.coerce.number().min(0).max(1e9), method: z.enum(['cash', 'card', 'upi', 'bank', 'other']), reference: z.string().trim().max(100).optional(),
  }).strict().optional(),
  // Sample collected at the patient's home (Phase 3). The charge is added to the order and its invoice.
  homeCollection: z.object({
    address: z.string().trim().min(5, 'Enter the full address.').max(400), landmark: z.string().trim().max(150).optional(),
    contactPhone: optionalPhone, scheduledAt: z.string().datetime({ offset: true }),
    charge: z.coerce.number().min(0).max(1e6).default(0), notes: z.string().trim().max(300).optional(),
  }).strict().optional(),
}).strict().refine((v) => v.testIds.length + v.packageIds.length > 0, { message: 'Select at least one test or package.', path: ['testIds'] });

router.post('/orders', requirePermission('lab.write'), validate(orderSchema), asyncHandler(async (req, res) => {
  const b = req.body;
  const ctx = req.ctx;
  const out = await withTransaction(async (tx) => {
    const pat = await tx.one('SELECT PatientId FROM hms.Patients WHERE TenantId = @tid AND PatientId = @id AND IsArchived = 0', { tid: ctx.tenantId, id: b.patientId });
    if (!pat) throw badRequest('Patient not found.');
    if (b.doctorId && !(await tx.one(`SELECT 1 AS ok FROM hms.StaffMembers WHERE TenantId = @tid AND StaffId = @id AND StaffType = 'doctor'`, { tid: ctx.tenantId, id: b.doctorId }))) {
      throw badRequest('Doctor not found.');
    }
    if (b.referralDoctorId && !(await tx.one('SELECT 1 AS ok FROM hms.ReferralDoctors WHERE TenantId = @tid AND ReferralDoctorId = @id AND IsActive = 1', { tid: ctx.tenantId, id: b.referralDoctorId }))) {
      throw badRequest('Referral doctor not found.');
    }
    if (b.consultationId) {
      const c = await tx.one('SELECT PatientId FROM hms.Consultations WHERE TenantId = @tid AND ConsultationId = @id', { tid: ctx.tenantId, id: b.consultationId });
      if (!c || Number(c.PatientId) !== b.patientId) throw badRequest('Consultation does not belong to this patient.');
    }

    // Individual tests
    const testIds = [...new Set(b.testIds)];
    const tests = testIds.length ? await tx.query(`SELECT lt.*, d.Name AS DeptName, d.SortOrder AS DeptSort FROM hms.LabTests lt
        LEFT JOIN hms.LabDepartments d ON d.TenantId = lt.TenantId AND d.LabDepartmentId = lt.DepartmentId
        WHERE lt.TenantId = @tid AND lt.IsActive = 1 AND lt.LabTestId IN (SELECT CAST(value AS INT) FROM STRING_SPLIT(@ids, ','))`,
      { tid: ctx.tenantId, ids: testIds.join(',') }) : [];
    if (tests.length !== testIds.length) throw badRequest('One or more tests are invalid or inactive.');

    // Packages and their tests
    const packageIds = [...new Set(b.packageIds)];
    const packages = packageIds.length ? await tx.query(`SELECT * FROM hms.LabPackages WHERE TenantId = @tid AND IsActive = 1 AND LabPackageId IN (SELECT CAST(value AS INT) FROM STRING_SPLIT(@ids, ','))`,
      { tid: ctx.tenantId, ids: packageIds.join(',') }) : [];
    if (packages.length !== packageIds.length) throw badRequest('One or more packages are invalid or inactive.');
    const packageTests = packageIds.length ? await tx.query(`SELECT pt.LabPackageId, lt.*, d.Name AS DeptName, d.SortOrder AS DeptSort FROM hms.LabPackageTests pt
        JOIN hms.LabTests lt ON lt.TenantId = pt.TenantId AND lt.LabTestId = pt.LabTestId
        LEFT JOIN hms.LabDepartments d ON d.TenantId = lt.TenantId AND d.LabDepartmentId = lt.DepartmentId
        WHERE pt.TenantId = @tid AND pt.LabPackageId IN (SELECT CAST(value AS INT) FROM STRING_SPLIT(@ids, ',')) ORDER BY lt.LabTestId`,
    { tid: ctx.tenantId, ids: packageIds.join(',') }) : [];

    // Build order lines (a test may appear only once per order)
    const seen = new Map();
    const lines = [];
    const addLine = (test, priceMinor, pkg) => {
      if (seen.has(test.LabTestId)) throw badRequest(`“${test.Name}” is included twice (${seen.get(test.LabTestId)} and ${pkg ? pkg.Name : 'individual tests'}). Remove the duplicate.`);
      seen.set(test.LabTestId, pkg ? pkg.Name : 'individual tests');
      lines.push({ test, priceMinor, pkg });
    };
    for (const pkg of packages) {
      const its = packageTests.filter((x) => x.LabPackageId === pkg.LabPackageId);
      if (!its.length) throw badRequest(`Package “${pkg.Name}” has no tests.`);
      const alloc = allocatePackagePrice(toMinor(pkg.Price), its.map((x) => toMinor(x.Price)));
      its.forEach((x, i) => addLine(x, alloc[i], pkg));
    }
    for (const test of tests) addLine(test, toMinor(test.Price), null);

    const homeChargeMinor = b.homeCollection ? toMinor(b.homeCollection.charge || 0) : 0;
    const grossMinor = lines.reduce((a, l) => a + l.priceMinor, 0) + homeChargeMinor;
    const discountMinor = toMinor(b.discount || 0);
    if (discountMinor > grossMinor) throw badRequest('Discount cannot be more than the order total.');

    const n = await nextSequence(tx, ctx.tenantId, 'lab_order');
    const order = await tx.one(`INSERT INTO hms.LabOrders (TenantId, OrderNumber, PatientId, DoctorId, ReferralDoctorId, ConsultationId, Priority, Notes, OrderedByUserId,
                                  GrossAmount, DiscountAmount, NetAmount)
                                OUTPUT INSERTED.LabOrderId, INSERTED.OrderNumber
                                VALUES (@tid, @num, @pid, @did, @rid, @cid, @pri, @notes, @uid, @gross, @disc, @net)`,
    { tid: ctx.tenantId, num: formatNumber('LAB', n), pid: b.patientId, did: b.doctorId ?? null, rid: b.referralDoctorId ?? null, cid: b.consultationId ?? null,
      pri: b.priority, notes: b.notes ?? null, uid: ctx.userId,
      gross: t.money(fromMinor(grossMinor)), disc: t.money(fromMinor(discountMinor)), net: t.money(fromMinor(grossMinor - discountMinor)) });

    for (const { test, priceMinor, pkg } of lines) {
      // Snapshot of everything the report prints, so later catalogue edits never change this order.
      const item = await tx.one(`INSERT INTO hms.LabOrderItems (TenantId, LabOrderId, LabTestId, TestName, Unit, RefLow, RefHigh, RefText, Price, LabPackageId, PackageName,
                       DepartmentName, DepartmentSort, Method, Instrument, Interpretation, InputType, Options, Decimals)
                     OUTPUT INSERTED.LabOrderItemId
                     VALUES (@tid, @oid, @test, @name, @unit, @lo, @hi, @txt, @price, @pkg, @pkgName, @dept, @deptSort, @method, @instr, @interp, @itype, @opts, @dec)`,
      { tid: ctx.tenantId, oid: order.LabOrderId, test: test.LabTestId, name: test.Name, unit: test.Unit, lo: test.RefLow == null ? null : t.dec(test.RefLow, 12, 4),
        hi: test.RefHigh == null ? null : t.dec(test.RefHigh, 12, 4), txt: test.RefText, price: t.money(fromMinor(priceMinor)),
        pkg: pkg ? pkg.LabPackageId : null, pkgName: pkg ? pkg.Name : null, dept: test.DeptName ?? test.Department ?? null, deptSort: test.DeptSort ?? null,
        method: test.Method ?? null, instr: test.Instrument ?? null, interp: test.Interpretation ?? null, itype: test.InputType ?? 'numeric',
        opts: test.Options ?? null, dec: test.Decimals ?? null });
      // Panel tests (e.g. CBC): snapshot every active parameter as well.
      await tx.exec(`INSERT INTO hms.LabResultValues (TenantId, LabOrderItemId, ParameterId, Name, Unit, RefLow, RefHigh, RefText, SortOrder, InputType, Options, Decimals, IsHeading)
                     SELECT TenantId, @item, ParameterId, Name, Unit, RefLow, RefHigh, RefText, SortOrder, InputType, Options, Decimals, IsHeading
                     FROM hms.LabTestParameters WHERE TenantId = @tid AND LabTestId = @test AND IsActive = 1`,
      { tid: ctx.tenantId, item: item.LabOrderItemId, test: test.LabTestId });
    }

    if (b.homeCollection) {
      const h = b.homeCollection;
      if (new Date(h.scheduledAt) < new Date(Date.now() - 60 * 60 * 1000)) throw badRequest('The collection time is in the past.');
      await tx.exec(`INSERT INTO hms.LabHomeCollections (TenantId, LabOrderId, Address, Landmark, ContactPhone, ScheduledAt, Charge, Notes)
                     VALUES (@tid, @oid, @addr, @lm, @ph, @at, @charge, @notes)`,
      { tid: ctx.tenantId, oid: order.LabOrderId, addr: h.address, lm: h.landmark || null, ph: h.contactPhone || null, at: new Date(h.scheduledAt),
        charge: t.money(fromMinor(homeChargeMinor)), notes: h.notes || null });
    }

    // One sample per sample type
    const sampleTypes = [...new Set(lines.map((l) => (l.test.SampleType || '').trim() || 'Other'))].sort();
    for (const st of sampleTypes) {
      const sn = await nextSequence(tx, ctx.tenantId, 'lab_sample');
      await tx.exec('INSERT INTO hms.LabSamples (TenantId, SampleNumber, LabOrderId, SampleType) VALUES (@tid, @num, @oid, @st)',
        { tid: ctx.tenantId, num: formatNumber('SMP', sn), oid: order.LabOrderId, st: st.slice(0, 40) });
    }

    // Billing: OPD-linked orders go on the patient's open draft bill; walk-in orders get their own invoice.
    let billId = null; let receipt = null; let ownBill = false;
    const canBill = ctx.features.has('billing') && ctx.permissions.has('billing.write');
    if (b.payment && b.payment.amount > 0 && !(b.addToBill && canBill)) throw badRequest('Payments can only be taken when the order is billed.');
    if (b.addToBill && canBill) {
      if (b.consultationId) {
        if (discountMinor > 0) throw badRequest('For orders from a consultation, give the discount on the patient’s bill instead.');
        billId = await getOrCreateDraftBill(tx, ctx, b.patientId);
      } else {
        billId = await createDraftBill(tx, ctx, b.patientId, `Lab order ${order.OrderNumber}`);
        ownBill = true;
      }
      for (const pkg of packages) {
        await addBillItem(tx, ctx.tenantId, billId, { itemType: 'lab', description: `Package: ${pkg.Name} (${order.OrderNumber})`, quantity: 1,
          unitPrice: Number(pkg.Price).toFixed(2), taxRatePercent: 0, referenceType: 'lab_order', referenceId: order.LabOrderId });
      }
      for (const test of tests) {
        await addBillItem(tx, ctx.tenantId, billId, { itemType: 'lab', description: `${test.Name} (${order.OrderNumber})`, quantity: 1,
          unitPrice: Number(test.Price).toFixed(2), taxRatePercent: 0, referenceType: 'lab_order', referenceId: order.LabOrderId });
      }
      if (homeChargeMinor > 0) {
        await addBillItem(tx, ctx.tenantId, billId, { itemType: 'lab', description: `Home sample collection (${order.OrderNumber})`, quantity: 1,
          unitPrice: fromMinor(homeChargeMinor), taxRatePercent: 0, referenceType: 'lab_order', referenceId: order.LabOrderId });
      }
      if (ownBill) {
        if (discountMinor > 0) await recalcBill(tx, ctx.tenantId, billId, fromMinor(discountMinor));
        await finalizeBill(tx, ctx.tenantId, billId);
        if (b.payment && b.payment.amount > 0) {
          ({ receipt } = await recordBillPayment(tx, ctx, billId, 'payment', b.payment));
        }
      }
      await tx.exec('UPDATE hms.LabOrders SET BillId = @bid, OwnBill = @own WHERE TenantId = @tid AND LabOrderId = @id',
        { tid: ctx.tenantId, id: order.LabOrderId, bid: billId, own: ownBill });
    }
    await auditTenant(req, 'lab_order.created', 'lab_order', order.LabOrderId,
      { tests: lines.length, packages: packages.length, net: fromMinor(grossMinor - discountMinor), billed: Boolean(billId), receipt }, tx);
    return { id: order.LabOrderId, number: order.OrderNumber, billId, receipt };
  });
  res.status(201).json({ data: out });
}));

router.get('/orders/:id', requirePermission('lab.read'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const [orders, rawItems, samples, params, home] = await db.many(`
    SELECT o.*, p.PatientNumber, p.FirstName, p.LastName, p.Gender, p.Phone AS PatientPhone, CONVERT(CHAR(10), p.DateOfBirth, 23) AS DateOfBirth, s.FullName AS DoctorName,
           rd.Name AS ReferralName, rd.Clinic AS ReferralClinic, b.BillNumber, b.Status AS BillStatus, b.Total AS BillTotal, b.PaidAmount AS BillPaid,
           v.FullName AS VerifiedByName, t.Name AS HospitalName, t.Phone AS HospitalPhone,
           (SELECT SettingValue FROM hms.TenantSettings WHERE TenantId = o.TenantId AND SettingKey = 'hospital.address') AS HospitalAddress
    ${ORDER_FROM}
    LEFT JOIN hms.Users v ON v.TenantId = o.TenantId AND v.UserId = o.VerifiedByUserId
    JOIN hms.Tenants t ON t.TenantId = o.TenantId
    WHERE o.TenantId = @tid AND o.LabOrderId = @id;
    ${itemsSql()}
    SELECT LabSampleId AS id, SampleNumber AS number, SampleType AS sampleType, Status AS status, CollectedAt AS collectedAt, ReceivedAt AS receivedAt, RejectReason AS rejectReason
    FROM hms.LabSamples WHERE TenantId = @tid AND LabOrderId = @id ORDER BY SampleType;
    ${PARAMS_SQL}
    SELECT h.HomeCollectionId AS id, h.Address AS address, h.Landmark AS landmark, h.ContactPhone AS contactPhone, h.ScheduledAt AS scheduledAt, h.Status AS status,
           h.Charge AS charge, h.Notes AS notes, h.CollectedAt AS collectedAt, h.CollectorStaffId AS collectorStaffId, s.FullName AS collectorName
    FROM hms.LabHomeCollections h LEFT JOIN hms.StaffMembers s ON s.TenantId = h.TenantId AND s.StaffId = h.CollectorStaffId
    WHERE h.TenantId = @tid AND h.LabOrderId = @id;`, { tid: req.ctx.tenantId, id });
  const o = orders[0];
  if (!o) throw notFound('Lab order not found.');
  await auditTenant(req, 'lab_order.viewed', 'lab_order', id);
  const m = orderMoney({ billId: o.BillId, billStatus: o.BillStatus, billTotal: o.BillTotal, billPaid: o.BillPaid, ownBill: o.OwnBill });
  res.json({
    data: {
      id: o.LabOrderId, number: o.OrderNumber, status: o.Status, priority: o.Priority, notes: o.Notes, cancelReason: o.CancelReason,
      orderedAt: o.OrderedAt, sampleCollectedAt: o.SampleCollectedAt, completedAt: o.CompletedAt, verifiedAt: o.VerifiedAt, verifiedBy: o.VerifiedByName,
      doctorName: o.DoctorName, referral: o.ReferralDoctorId ? { id: o.ReferralDoctorId, name: o.ReferralName, clinic: o.ReferralClinic } : null,
      consultationId: o.ConsultationId,
      amounts: { gross: o.GrossAmount, discount: o.DiscountAmount, net: o.NetAmount, ...m },
      bill: o.BillId ? { id: o.BillId, number: o.BillNumber, status: o.BillStatus, total: o.BillTotal, paid: o.BillPaid, own: Boolean(o.OwnBill) } : null,
      patient: { id: o.PatientId, patientNumber: o.PatientNumber, firstName: o.FirstName, lastName: o.LastName, gender: o.Gender, dateOfBirth: o.DateOfBirth, phone: o.PatientPhone },
      hospital: { name: o.HospitalName, address: o.HospitalAddress, phone: o.HospitalPhone },
      items: attachParameters(rawItems, params), samples,
      homeCollection: home[0] ?? null,
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
      if (req.body.status === 'sample_collected') {
        await tx.exec(`UPDATE hms.LabSamples SET Status = 'collected', CollectedAt = SYSUTCDATETIME(), CollectedByUserId = @uid, RejectReason = NULL
                       WHERE TenantId = @tid AND LabOrderId = @id AND Status IN ('pending','rejected')`, { tid: req.ctx.tenantId, id, uid: req.ctx.userId });
      }
      await auditTenant(req, `lab_order.${req.body.status}`, 'lab_order', id, null, tx);
    });
    res.json({ data: { ok: true } });
  }));

router.put('/orders/:id/results', requirePermission('lab.write'),
  validate(z.object({
    results: z.array(z.object({ itemId: z.coerce.number().int().positive(), value: z.string().trim().max(200) }).strict()).max(60).default([]),
    parameters: z.array(z.object({ id: z.coerce.number().int().positive(), value: z.string().trim().max(200) }).strict()).max(300).default([]),
  }).strict().refine((v) => v.results.length + v.parameters.length > 0, 'Enter at least one result.')),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const status = await withTransaction(async (tx) => {
      const o = await tx.one('SELECT Status FROM hms.LabOrders WITH (UPDLOCK) WHERE TenantId = @tid AND LabOrderId = @id', { tid: req.ctx.tenantId, id });
      if (!o) throw notFound('Lab order not found.');
      if (!['sample_collected', 'completed'].includes(o.Status)) {
        throw conflict(o.Status === 'verified' ? 'Results are verified and locked.' : 'Collect the sample before entering results.', 'LAB_STATE');
      }
      const items = await tx.query('SELECT LabOrderItemId, RefLow, RefHigh, InputType, Options FROM hms.LabOrderItems WHERE TenantId = @tid AND LabOrderId = @id', { tid: req.ctx.tenantId, id });
      const byId = new Map(items.map((i) => [Number(i.LabOrderItemId), i]));
      const panelRows = await tx.query(`SELECT v.ResultValueId, v.LabOrderItemId, v.RefLow, v.RefHigh, v.InputType, v.Options, v.IsHeading, v.Name FROM hms.LabResultValues v
          JOIN hms.LabOrderItems i ON i.TenantId = v.TenantId AND i.LabOrderItemId = v.LabOrderItemId WHERE v.TenantId = @tid AND i.LabOrderId = @id`,
      { tid: req.ctx.tenantId, id });
      const panelItems = new Set(panelRows.map((r) => Number(r.LabOrderItemId)));
      const paramById = new Map(panelRows.map((r) => [Number(r.ResultValueId), r]));
      const touchedPanels = new Set();
      for (const r of req.body.parameters) {
        const row = paramById.get(r.id);
        if (!row) throw badRequest('Result refers to a parameter that is not on this order.');
        const checked = checkResult({ inputType: row.InputType, options: row.Options, isHeading: row.IsHeading }, r.value);
        if (checked.error) throw badRequest(`${row.Name}: ${checked.error}`);
        const { value, numeric } = checked;
        await tx.exec(`UPDATE hms.LabResultValues SET ResultValue = @v, ResultNumeric = @n, Flag = @f, EnteredByUserId = @uid, EnteredAt = SYSUTCDATETIME()
                       WHERE TenantId = @tid AND ResultValueId = @rid`,
        { tid: req.ctx.tenantId, rid: r.id, v: value, n: numeric === null ? null : t.dec(numeric, 12, 4), f: labFlag(numeric, row.RefLow, row.RefHigh), uid: req.ctx.userId });
        touchedPanels.add(Number(row.LabOrderItemId));
      }
      // A panel line is "done" when every parameter has a value; its flag summarises the parameters.
      for (const itemId of touchedPanels) {
        const ps = await tx.query('SELECT ResultValue, Flag, IsHeading FROM hms.LabResultValues WHERE TenantId = @tid AND LabOrderItemId = @item', { tid: req.ctx.tenantId, item: itemId });
        const done = panelComplete(ps.map((x) => ({ value: x.ResultValue, isHeading: Boolean(x.IsHeading) })));
        const valueRows = ps.filter((x) => !x.IsHeading);
        await tx.exec(`UPDATE hms.LabOrderItems SET ResultValue = @v, ResultNumeric = NULL, Flag = @f, EnteredByUserId = @uid, EnteredAt = SYSUTCDATETIME()
                       WHERE TenantId = @tid AND LabOrderId = @id AND LabOrderItemId = @item`,
        { tid: req.ctx.tenantId, id, item: itemId, v: done ? `${valueRows.length} parameters` : null, f: done ? panelFlag(valueRows.map((x) => x.Flag)) : null, uid: req.ctx.userId });
      }
      for (const r of req.body.results) {
        const item = byId.get(r.itemId);
        if (!item) throw badRequest('Result refers to a test that is not on this order.');
        if (panelItems.has(r.itemId)) throw badRequest('Enter this test’s result parameter by parameter.');
        const checked = checkResult({ inputType: item.InputType, options: item.Options }, r.value);
        if (checked.error) throw badRequest(checked.error);
        const { value, numeric } = checked;
        await tx.exec(`UPDATE hms.LabOrderItems SET ResultValue = @v, ResultNumeric = @n, Flag = @f, EnteredByUserId = @uid, EnteredAt = SYSUTCDATETIME()
                       WHERE TenantId = @tid AND LabOrderId = @id AND LabOrderItemId = @item`,
        { tid: req.ctx.tenantId, id, item: r.itemId, v: value, n: numeric === null ? null : t.dec(numeric, 12, 4), f: labFlag(numeric, item.RefLow, item.RefHigh), uid: req.ctx.userId });
      }
      const pending = await tx.one('SELECT COUNT(*) AS n FROM hms.LabOrderItems WHERE TenantId = @tid AND LabOrderId = @id AND ResultValue IS NULL', { tid: req.ctx.tenantId, id });
      const next = pending.n === 0 ? 'completed' : 'sample_collected';
      await tx.exec(`UPDATE hms.LabOrders SET Status = @s, CompletedAt = CASE WHEN @s = 'completed' THEN SYSUTCDATETIME() ELSE NULL END WHERE TenantId = @tid AND LabOrderId = @id`,
        { tid: req.ctx.tenantId, id, s: next });
      await auditTenant(req, 'lab_order.results_entered', 'lab_order', id, { count: req.body.results.length + req.body.parameters.length }, tx);
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

// ---------- Share a verified report with the patient (secure link + OTP) ----------
const SHARE_DAYS = 7;

router.post('/orders/:id/share', requirePermission('lab.write'),
  validate(z.object({ channel: z.enum(['whatsapp', 'email']) }).strict()),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const o = await db.one(`SELECT o.Status, p.FirstName, p.Phone, p.Email, t.Name AS HospitalName
                            FROM hms.LabOrders o JOIN hms.Patients p ON p.TenantId = o.TenantId AND p.PatientId = o.PatientId
                            JOIN hms.Tenants t ON t.TenantId = o.TenantId WHERE o.TenantId = @tid AND o.LabOrderId = @id`, { tid: req.ctx.tenantId, id });
    if (!o) throw notFound('Lab order not found.');
    if (o.Status !== 'verified') throw conflict('Only verified reports can be sent to the patient.', 'LAB_STATE');
    const { channel } = req.body;
    if (channel === 'whatsapp' && !o.Phone) throw badRequest('This patient has no mobile number. Add it on the patient’s page first.');
    if (channel === 'email' && !o.Email) throw badRequest('This patient has no e-mail address. Add it on the patient’s page first.');

    const token = randomToken(32);
    const share = await db.one(`INSERT INTO hms.ReportShares (TenantId, LabOrderId, TokenHash, Channel, ExpiresAt, CreatedByUserId)
                                OUTPUT INSERTED.ShareId, INSERTED.ExpiresAt
                                VALUES (@tid, @id, @h, @ch, DATEADD(DAY, ${SHARE_DAYS}, SYSUTCDATETIME()), @uid)`,
    { tid: req.ctx.tenantId, id, h: sha256Hex(token), ch: channel, uid: req.ctx.userId });
    const link = `${config.publicAppUrl}/report/${token}`;
    const args = { hospital: o.HospitalName, patientFirst: o.FirstName, link, days: SHARE_DAYS };
    const r = await deliver({ channel, to: channel === 'email' ? o.Email : o.Phone, template: 'report_link', tenantId: req.ctx.tenantId,
      related: { type: 'lab_order', id }, content: channel === 'email' ? templates.email.reportLink(args) : templates.whatsapp.reportLink(args) });
    if (r.status === 'failed' || r.status === 'skipped') {
      await db.exec('UPDATE hms.ReportShares SET RevokedAt = SYSUTCDATETIME() WHERE ShareId = @sid AND TenantId = @tid', { sid: share.ShareId, tid: req.ctx.tenantId });
      throw new HttpError(502, 'NOT_SENT', `The report link could not be sent: ${r.error || 'unknown error'}`);
    }
    await auditTenant(req, 'lab_report.shared', 'lab_order', id, { channel, to: r.masked });
    res.status(201).json({ data: { sentTo: r.masked, status: r.status, expiresAt: share.ExpiresAt } });
  }));

router.get('/orders/:id/shares', requirePermission('lab.read'), asyncHandler(async (req, res) => {
  const rows = await db.query(`SELECT rs.ShareId AS id, rs.Channel AS channel, rs.CreatedAt AS createdAt, rs.ExpiresAt AS expiresAt, rs.AccessCount AS accessCount,
                                      rs.LastAccessAt AS lastAccessAt, rs.RevokedAt AS revokedAt, u.FullName AS createdBy
                               FROM hms.ReportShares rs LEFT JOIN hms.Users u ON u.TenantId = rs.TenantId AND u.UserId = rs.CreatedByUserId
                               WHERE rs.TenantId = @tid AND rs.LabOrderId = @id ORDER BY rs.CreatedAt DESC`, { tid: req.ctx.tenantId, id: idParam(req.params.id) });
  res.json({ data: rows });
}));

router.post('/orders/:id/shares/:shareId/revoke', requirePermission('lab.write'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const n = await db.exec(`UPDATE hms.ReportShares SET RevokedAt = SYSUTCDATETIME() WHERE TenantId = @tid AND LabOrderId = @id AND ShareId = @sid AND RevokedAt IS NULL`,
    { tid: req.ctx.tenantId, id, sid: idParam(req.params.shareId, 'shareId') });
  if (!n) throw notFound('Link not found or already revoked.');
  await auditTenant(req, 'lab_report.share_revoked', 'lab_order', id);
  res.json({ data: { ok: true } });
}));

// ---------- Samples ----------
router.get('/samples', requirePermission('lab.read'), asyncHandler(async (req, res) => {
  const lq = parseListQuery(req.query, { created: 's.CreatedAt' }, 'created');
  const params = {
    tid: req.ctx.tenantId, offset: lq.offset, size: lq.pageSize, q: like(req.query.q),
    status: ['pending', 'collected', 'received', 'rejected'].includes(req.query.status) ? req.query.status : null,
  };
  const from = `FROM hms.LabSamples s
    JOIN hms.LabOrders o ON o.TenantId = s.TenantId AND o.LabOrderId = s.LabOrderId
    JOIN hms.Patients p ON p.TenantId = o.TenantId AND p.PatientId = o.PatientId`;
  const where = `WHERE s.TenantId = @tid AND o.Status <> 'cancelled' AND (@status IS NULL OR s.Status = @status)
    AND (@q IS NULL OR s.SampleNumber LIKE @q OR o.OrderNumber LIKE @q OR p.PatientNumber LIKE @q OR p.FirstName LIKE @q OR p.LastName LIKE @q)`;
  const [rows, total] = await db.many(`
    SELECT s.LabSampleId AS id, s.SampleNumber AS number, s.SampleType AS sampleType, s.Status AS status, s.CollectedAt AS collectedAt, s.ReceivedAt AS receivedAt,
           s.RejectReason AS rejectReason, s.CreatedAt AS createdAt, o.LabOrderId AS orderId, o.OrderNumber AS orderNumber, o.Status AS orderStatus, o.Priority AS priority,
           p.PatientNumber AS patientNumber, p.FirstName AS patientFirstName, p.LastName AS patientLastName,
           (SELECT STRING_AGG(i.TestName, ', ') FROM hms.LabOrderItems i JOIN hms.LabTests lt ON lt.TenantId = i.TenantId AND lt.LabTestId = i.LabTestId
             WHERE i.TenantId = s.TenantId AND i.LabOrderId = s.LabOrderId AND ISNULL(NULLIF(LTRIM(RTRIM(lt.SampleType)), ''), 'Other') = s.SampleType) AS tests
    ${from} ${where} ORDER BY ${lq.orderBy} OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY;
    SELECT COUNT(*) AS total ${from} ${where};`, params);
  res.json({ data: rows, meta: pageMeta(lq, total[0].total) });
}));

/** Keeps the order status in step with its samples. */
async function syncOrderWithSamples(tx, tenantId, orderId) {
  const r = await tx.one(`SELECT o.Status, (SELECT COUNT(*) FROM hms.LabSamples s WHERE s.TenantId = o.TenantId AND s.LabOrderId = o.LabOrderId
                                              AND s.Status NOT IN ('collected','received')) AS waiting
                          FROM hms.LabOrders o WITH (UPDLOCK) WHERE o.TenantId = @tid AND o.LabOrderId = @id`, { tid: tenantId, id: orderId });
  if (r.Status === 'ordered' && r.waiting === 0) {
    await tx.exec(`UPDATE hms.LabOrders SET Status = 'sample_collected', SampleCollectedAt = SYSUTCDATETIME() WHERE TenantId = @tid AND LabOrderId = @id`, { tid: tenantId, id: orderId });
  } else if (r.Status === 'sample_collected' && r.waiting > 0) {
    await tx.exec(`UPDATE hms.LabOrders SET Status = 'ordered', SampleCollectedAt = NULL WHERE TenantId = @tid AND LabOrderId = @id`, { tid: tenantId, id: orderId });
  }
}

const SAMPLE_ACTIONS = { collect: 'collected', receive: 'received', reject: 'rejected' };
router.post('/samples/:id/:action', requirePermission('lab.write'),
  validate(z.object({ reason: z.string().trim().max(300).optional() }).strict()),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const to = SAMPLE_ACTIONS[req.params.action];
    if (!to) throw notFound('Unknown sample action.');
    await withTransaction(async (tx) => {
      const s = await tx.one(`SELECT s.Status, s.LabOrderId, o.Status AS OrderStatus,
                                     (SELECT COUNT(*) FROM hms.LabOrderItems i WHERE i.TenantId = o.TenantId AND i.LabOrderId = o.LabOrderId AND i.ResultValue IS NOT NULL) AS results
                              FROM hms.LabSamples s WITH (UPDLOCK) JOIN hms.LabOrders o ON o.TenantId = s.TenantId AND o.LabOrderId = s.LabOrderId
                              WHERE s.TenantId = @tid AND s.LabSampleId = @id`, { tid: req.ctx.tenantId, id });
      if (!s) throw notFound('Sample not found.');
      if (s.OrderStatus === 'cancelled') throw conflict('This order is cancelled.', 'LAB_STATE');
      if (!canMoveSample(s.Status, to)) throw conflict(`Cannot mark a ${s.Status} sample as ${to}.`, 'INVALID_TRANSITION');
      if (to === 'rejected') {
        if (!req.body.reason || req.body.reason.length < 3) throw badRequest('Give a reason for rejecting the sample.');
        if (s.results > 0 || ['completed', 'verified'].includes(s.OrderStatus)) throw conflict('Results have already been entered for this order; the sample can no longer be rejected.', 'LAB_STATE');
      }
      await tx.exec(`UPDATE hms.LabSamples SET Status = @to,
                       CollectedAt = CASE WHEN @to = 'collected' THEN SYSUTCDATETIME() ELSE CollectedAt END,
                       CollectedByUserId = CASE WHEN @to = 'collected' THEN @uid ELSE CollectedByUserId END,
                       ReceivedAt = CASE WHEN @to = 'received' THEN SYSUTCDATETIME() WHEN @to = 'collected' THEN NULL ELSE ReceivedAt END,
                       ReceivedByUserId = CASE WHEN @to = 'received' THEN @uid ELSE ReceivedByUserId END,
                       RejectedAt = CASE WHEN @to = 'rejected' THEN SYSUTCDATETIME() ELSE RejectedAt END,
                       RejectReason = CASE WHEN @to = 'rejected' THEN @reason WHEN @to = 'collected' THEN NULL ELSE RejectReason END
                     WHERE TenantId = @tid AND LabSampleId = @id`, { tid: req.ctx.tenantId, id, to, uid: req.ctx.userId, reason: req.body.reason ?? null });
      await syncOrderWithSamples(tx, req.ctx.tenantId, s.LabOrderId);
      await auditTenant(req, `lab_sample.${to}`, 'lab_sample', id, to === 'rejected' ? { reason: req.body.reason } : null, tx);
    });
    res.json({ data: { ok: true } });
  }));

// Phase 3: test parameters, patient trends, home collection.
router.use(labExtrasRoutes);
router.use(labMasterRoutes);

export default router;
