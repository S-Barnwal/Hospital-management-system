// IPD: wards, beds, admissions, transfers and discharge. Bed double-booking is prevented by row locks
// AND by the filtered unique index UX_Admissions_ActiveBed in the database.
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requireTenant, requirePermission, requireFeature } from '../../middleware/auth.js';
import { asyncHandler, badRequest, conflict, notFound } from '../../utils/errors.js';
import { db, withTransaction, t } from '../../db/pool.js';
import { parseListQuery, pageMeta } from '../../utils/pagination.js';
import { idParam } from '../../utils/params.js';
import { auditTenant } from '../../utils/audit.js';
import { nextSequence, formatNumber } from '../tenants/sequences.js';
import { bedDays } from '../clinical/logic.js';
import { addBillItem, getOrCreateDraftBill } from '../billing/billing.service.js';

const router = Router();
router.use(requireTenant, requireFeature('ipd'));

const WARD_TYPES = ['general', 'semi_private', 'private', 'icu', 'nicu', 'emergency', 'other'];

// ---------- Wards & beds (bed board) ----------
router.get('/wards', requirePermission('ipd.read'), asyncHandler(async (req, res) => {
  const [wards, beds] = await db.many(`
    SELECT WardId AS id, Name AS name, WardType AS wardType, DailyRate AS dailyRate, IsActive AS isActive FROM hms.Wards WHERE TenantId = @tid ORDER BY Name;
    SELECT b.BedId AS id, b.WardId AS wardId, b.BedNumber AS bedNumber, b.Status AS status,
           a.AdmissionId AS admissionId, a.AdmissionNumber AS admissionNumber, a.AdmittedAt AS admittedAt,
           p.PatientId AS patientId, p.PatientNumber AS patientNumber, p.FirstName AS patientFirstName, p.LastName AS patientLastName
    FROM hms.Beds b
    LEFT JOIN hms.Admissions a ON a.TenantId = b.TenantId AND a.BedId = b.BedId AND a.Status = 'admitted'
    LEFT JOIN hms.Patients p ON p.TenantId = a.TenantId AND p.PatientId = a.PatientId
    WHERE b.TenantId = @tid ORDER BY b.WardId, LEN(b.BedNumber), b.BedNumber;`, { tid: req.ctx.tenantId });
  res.json({ data: wards.map((w) => ({ ...w, beds: beds.filter((b) => b.wardId === w.id) })) });
}));

const wardSchema = z.object({
  name: z.string().trim().min(2).max(100), wardType: z.enum(WARD_TYPES), dailyRate: z.coerce.number().min(0).max(1e7), isActive: z.boolean().optional(),
}).strict();

router.post('/wards', requirePermission('ipd.configure'), validate(wardSchema.extend({ bedCount: z.number().int().min(0).max(200).default(0) })), asyncHandler(async (req, res) => {
  const b = req.body;
  const id = await withTransaction(async (tx) => {
    const w = await tx.one('INSERT INTO hms.Wards (TenantId, Name, WardType, DailyRate) OUTPUT INSERTED.WardId VALUES (@tid, @n, @type, @rate)',
      { tid: req.ctx.tenantId, n: b.name, type: b.wardType, rate: t.money(b.dailyRate.toFixed(2)) });
    for (let i = 1; i <= b.bedCount; i += 1) {
      await tx.exec('INSERT INTO hms.Beds (TenantId, WardId, BedNumber) VALUES (@tid, @w, @num)', { tid: req.ctx.tenantId, w: w.WardId, num: String(i) });
    }
    await auditTenant(req, 'ward.created', 'ward', w.WardId, { beds: b.bedCount }, tx);
    return w.WardId;
  });
  res.status(201).json({ data: { id } });
}));

router.patch('/wards/:id', requirePermission('ipd.configure'), validate(wardSchema.partial().strict()), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const b = req.body;
  const n = await db.exec(`UPDATE hms.Wards SET Name = COALESCE(@n, Name), WardType = COALESCE(@type, WardType), DailyRate = COALESCE(@rate, DailyRate),
                             IsActive = COALESCE(@active, IsActive) WHERE TenantId = @tid AND WardId = @id`,
  { tid: req.ctx.tenantId, id, n: b.name ?? null, type: b.wardType ?? null, rate: b.dailyRate === undefined ? null : t.money(b.dailyRate.toFixed(2)), active: b.isActive ?? null });
  if (!n) throw notFound('Ward not found.');
  await auditTenant(req, 'ward.updated', 'ward', id);
  res.json({ data: { ok: true } });
}));

router.post('/wards/:id/beds', requirePermission('ipd.configure'),
  validate(z.object({ bedNumber: z.string().trim().min(1).max(20) }).strict()),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const w = await db.one('SELECT WardId FROM hms.Wards WHERE TenantId = @tid AND WardId = @id', { tid: req.ctx.tenantId, id });
    if (!w) throw notFound('Ward not found.');
    const r = await db.one('INSERT INTO hms.Beds (TenantId, WardId, BedNumber) OUTPUT INSERTED.BedId VALUES (@tid, @w, @num)', { tid: req.ctx.tenantId, w: id, num: req.body.bedNumber });
    await auditTenant(req, 'bed.created', 'bed', r.BedId);
    res.status(201).json({ data: { id: r.BedId } });
  }));

router.patch('/beds/:id', requirePermission('ipd.configure'),
  validate(z.object({ status: z.enum(['available', 'maintenance']) }).strict()),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    await withTransaction(async (tx) => {
      const bed = await tx.one('SELECT Status FROM hms.Beds WITH (UPDLOCK) WHERE TenantId = @tid AND BedId = @id', { tid: req.ctx.tenantId, id });
      if (!bed) throw notFound('Bed not found.');
      if (bed.Status === 'occupied') throw conflict('Bed is occupied. Discharge or transfer the patient first.');
      await tx.exec('UPDATE hms.Beds SET Status = @s WHERE TenantId = @tid AND BedId = @id', { tid: req.ctx.tenantId, id, s: req.body.status });
      await auditTenant(req, 'bed.status_changed', 'bed', id, { status: req.body.status }, tx);
    });
    res.json({ data: { ok: true } });
  }));

router.delete('/beds/:id', requirePermission('ipd.configure'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  await withTransaction(async (tx) => {
    const used = await tx.one(`SELECT (SELECT COUNT(*) FROM hms.Admissions WHERE TenantId = @tid AND BedId = @id)
      + (SELECT COUNT(*) FROM hms.BedTransfers WHERE TenantId = @tid AND (FromBedId = @id OR ToBedId = @id)) AS n`, { tid: req.ctx.tenantId, id });
    if (used.n) throw conflict('This bed has admission history. Put it under maintenance instead.', 'IN_USE');
    const n = await tx.exec('DELETE FROM hms.Beds WHERE TenantId = @tid AND BedId = @id', { tid: req.ctx.tenantId, id });
    if (!n) throw notFound('Bed not found.');
    await auditTenant(req, 'bed.deleted', 'bed', id, null, tx);
  });
  res.json({ data: { ok: true } });
}));

router.delete('/wards/:id', requirePermission('ipd.configure'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  await withTransaction(async (tx) => {
    const used = await tx.one(`SELECT COUNT(*) AS n FROM hms.Admissions a JOIN hms.Beds b ON b.TenantId = a.TenantId AND b.BedId = a.BedId
                               WHERE a.TenantId = @tid AND b.WardId = @id`, { tid: req.ctx.tenantId, id });
    if (used.n) throw conflict('Patients have been admitted to this ward. Mark it inactive instead.', 'IN_USE');
    await tx.exec('DELETE FROM hms.Beds WHERE TenantId = @tid AND WardId = @id', { tid: req.ctx.tenantId, id });
    const n = await tx.exec('DELETE FROM hms.Wards WHERE TenantId = @tid AND WardId = @id', { tid: req.ctx.tenantId, id });
    if (!n) throw notFound('Ward not found.');
    await auditTenant(req, 'ward.deleted', 'ward', id, null, tx);
  });
  res.json({ data: { ok: true } });
}));

// ---------- Admissions ----------
const ADM_COLS = `a.AdmissionId AS id, a.AdmissionNumber AS number, a.Status AS status, a.Reason AS reason, a.AdmittedAt AS admittedAt, a.DischargedAt AS dischargedAt,
  p.PatientId AS patientId, p.PatientNumber AS patientNumber, p.FirstName AS patientFirstName, p.LastName AS patientLastName,
  b.BedId AS bedId, b.BedNumber AS bedNumber, w.WardId AS wardId, w.Name AS wardName, w.DailyRate AS dailyRate, s.FullName AS doctorName, a.AttendingDoctorId AS doctorId`;
const ADM_FROM = `FROM hms.Admissions a
  JOIN hms.Patients p ON p.TenantId = a.TenantId AND p.PatientId = a.PatientId
  JOIN hms.Beds b ON b.TenantId = a.TenantId AND b.BedId = a.BedId
  JOIN hms.Wards w ON w.TenantId = b.TenantId AND w.WardId = b.WardId
  LEFT JOIN hms.StaffMembers s ON s.TenantId = a.TenantId AND s.StaffId = a.AttendingDoctorId`;

router.get('/admissions', requirePermission('ipd.read'), asyncHandler(async (req, res) => {
  const lq = parseListQuery(req.query, { admitted: 'a.AdmittedAt' }, 'admitted');
  const q = req.query.q ? `%${String(req.query.q).trim().slice(0, 100).replace(/[%_[\]]/g, (m) => `[${m}]`)}%` : null;
  const params = { tid: req.ctx.tenantId, offset: lq.offset, size: lq.pageSize, q, status: ['admitted', 'discharged'].includes(req.query.status) ? req.query.status : null };
  const where = `WHERE a.TenantId = @tid AND (@status IS NULL OR a.Status = @status)
    AND (@q IS NULL OR a.AdmissionNumber LIKE @q OR p.PatientNumber LIKE @q OR p.FirstName LIKE @q OR p.LastName LIKE @q)`;
  const [rows, total] = await db.many(`
    SELECT ${ADM_COLS} ${ADM_FROM} ${where} ORDER BY ${lq.orderBy} OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY;
    SELECT COUNT(*) AS total ${ADM_FROM} ${where};`, params);
  res.json({ data: rows, meta: pageMeta(lq, total[0].total) });
}));

router.get('/admissions/:id', requirePermission('ipd.read'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const [rows, transfers] = await db.many(`
    SELECT ${ADM_COLS}, a.DischargeSummary AS dischargeSummary ${ADM_FROM} WHERE a.TenantId = @tid AND a.AdmissionId = @id;
    SELECT bt.TransferredAt AS at, fb.BedNumber AS fromBed, fw.Name AS fromWard, tb.BedNumber AS toBed, tw.Name AS toWard
    FROM hms.BedTransfers bt
    JOIN hms.Beds fb ON fb.TenantId = bt.TenantId AND fb.BedId = bt.FromBedId JOIN hms.Wards fw ON fw.TenantId = fb.TenantId AND fw.WardId = fb.WardId
    JOIN hms.Beds tb ON tb.TenantId = bt.TenantId AND tb.BedId = bt.ToBedId JOIN hms.Wards tw ON tw.TenantId = tb.TenantId AND tw.WardId = tb.WardId
    WHERE bt.TenantId = @tid AND bt.AdmissionId = @id ORDER BY bt.TransferredAt;`, { tid: req.ctx.tenantId, id });
  if (!rows[0]) throw notFound('Admission not found.');
  res.json({ data: { ...rows[0], transfers } });
}));

/** Locks a bed of this tenant and ensures it can take a patient. */
async function lockFreeBed(tx, tenantId, bedId) {
  const bed = await tx.one(`SELECT b.BedId, b.Status, w.IsActive FROM hms.Beds b WITH (UPDLOCK, HOLDLOCK)
                            JOIN hms.Wards w ON w.TenantId = b.TenantId AND w.WardId = b.WardId
                            WHERE b.TenantId = @tid AND b.BedId = @id`, { tid: tenantId, id: bedId });
  if (!bed) throw badRequest('Bed not found.');
  if (!bed.IsActive) throw conflict('This ward is inactive.');
  if (bed.Status !== 'available') throw conflict(`Bed is ${bed.Status}. Choose another bed.`, 'BED_UNAVAILABLE');
  return bed;
}

router.post('/admissions', requirePermission('ipd.write'),
  validate(z.object({
    patientId: z.number().int().positive(), bedId: z.number().int().positive(),
    attendingDoctorId: z.number().int().positive().nullable().optional(), reason: z.string().trim().max(500).optional(),
  }).strict()),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const row = await withTransaction(async (tx) => {
      const pat = await tx.one('SELECT PatientId FROM hms.Patients WHERE TenantId = @tid AND PatientId = @id AND IsArchived = 0', { tid: req.ctx.tenantId, id: b.patientId });
      if (!pat) throw badRequest('Patient not found.');
      const active = await tx.one(`SELECT AdmissionNumber FROM hms.Admissions WITH (UPDLOCK, HOLDLOCK) WHERE TenantId = @tid AND PatientId = @id AND Status = 'admitted'`,
        { tid: req.ctx.tenantId, id: b.patientId });
      if (active) throw conflict(`Patient is already admitted (${active.AdmissionNumber}).`, 'ALREADY_ADMITTED');
      if (b.attendingDoctorId) {
        const d = await tx.one(`SELECT StaffId FROM hms.StaffMembers WHERE TenantId = @tid AND StaffId = @id AND StaffType = 'doctor'`, { tid: req.ctx.tenantId, id: b.attendingDoctorId });
        if (!d) throw badRequest('Doctor not found.');
      }
      await lockFreeBed(tx, req.ctx.tenantId, b.bedId);
      const n = await nextSequence(tx, req.ctx.tenantId, 'admission');
      const r = await tx.one(`INSERT INTO hms.Admissions (TenantId, AdmissionNumber, PatientId, BedId, AttendingDoctorId, Reason, CreatedByUserId)
                              OUTPUT INSERTED.AdmissionId, INSERTED.AdmissionNumber VALUES (@tid, @num, @pid, @bed, @doc, @reason, @uid)`,
      { tid: req.ctx.tenantId, num: formatNumber('IPD', n), pid: b.patientId, bed: b.bedId, doc: b.attendingDoctorId ?? null, reason: b.reason ?? null, uid: req.ctx.userId });
      await tx.exec(`UPDATE hms.Beds SET Status = 'occupied' WHERE TenantId = @tid AND BedId = @bed`, { tid: req.ctx.tenantId, bed: b.bedId });
      await auditTenant(req, 'admission.created', 'admission', r.AdmissionId, { number: r.AdmissionNumber }, tx);
      return r;
    });
    res.status(201).json({ data: { id: row.AdmissionId, number: row.AdmissionNumber } });
  }));

router.post('/admissions/:id/transfer', requirePermission('ipd.write'),
  validate(z.object({ toBedId: z.number().int().positive() }).strict()),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    await withTransaction(async (tx) => {
      const adm = await tx.one('SELECT BedId, Status FROM hms.Admissions WITH (UPDLOCK) WHERE TenantId = @tid AND AdmissionId = @id', { tid: req.ctx.tenantId, id });
      if (!adm) throw notFound('Admission not found.');
      if (adm.Status !== 'admitted') throw conflict('Patient is already discharged.');
      if (adm.BedId === req.body.toBedId) throw badRequest('Patient is already in this bed.');
      await lockFreeBed(tx, req.ctx.tenantId, req.body.toBedId);
      await tx.exec(`UPDATE hms.Beds SET Status = 'available' WHERE TenantId = @tid AND BedId = @old`, { tid: req.ctx.tenantId, old: adm.BedId });
      await tx.exec(`UPDATE hms.Admissions SET BedId = @new WHERE TenantId = @tid AND AdmissionId = @id`, { tid: req.ctx.tenantId, id, new: req.body.toBedId });
      await tx.exec(`UPDATE hms.Beds SET Status = 'occupied' WHERE TenantId = @tid AND BedId = @new`, { tid: req.ctx.tenantId, new: req.body.toBedId });
      await tx.exec(`INSERT INTO hms.BedTransfers (TenantId, AdmissionId, FromBedId, ToBedId, TransferredByUserId) VALUES (@tid, @id, @old, @new, @uid)`,
        { tid: req.ctx.tenantId, id, old: adm.BedId, new: req.body.toBedId, uid: req.ctx.userId });
      await auditTenant(req, 'admission.transferred', 'admission', id, null, tx);
    });
    res.json({ data: { ok: true } });
  }));

router.post('/admissions/:id/discharge', requirePermission('ipd.write'),
  validate(z.object({ dischargeSummary: z.string().trim().min(3).max(4000), chargeBedDays: z.boolean().optional() }).strict()),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const result = await withTransaction(async (tx) => {
      const adm = await tx.one(`SELECT a.*, w.Name AS WardName, w.DailyRate FROM hms.Admissions a WITH (UPDLOCK)
                                JOIN hms.Beds b ON b.TenantId = a.TenantId AND b.BedId = a.BedId
                                JOIN hms.Wards w ON w.TenantId = b.TenantId AND w.WardId = b.WardId
                                WHERE a.TenantId = @tid AND a.AdmissionId = @id`, { tid: req.ctx.tenantId, id });
      if (!adm) throw notFound('Admission not found.');
      if (adm.Status !== 'admitted') throw conflict('Patient is already discharged.');
      const now = new Date();
      await tx.exec(`UPDATE hms.Admissions SET Status = 'discharged', DischargedAt = @now, DischargeSummary = @sum WHERE TenantId = @tid AND AdmissionId = @id`,
        { tid: req.ctx.tenantId, id, now, sum: req.body.dischargeSummary });
      await tx.exec(`UPDATE hms.Beds SET Status = 'available' WHERE TenantId = @tid AND BedId = @bed`, { tid: req.ctx.tenantId, bed: adm.BedId });
      let billId = null;
      if (req.body.chargeBedDays && Number(adm.DailyRate) > 0 && req.ctx.features.has('billing') && req.ctx.permissions.has('billing.write')) {
        const days = bedDays(adm.AdmittedAt, now);
        billId = await getOrCreateDraftBill(tx, req.ctx, adm.PatientId, id);
        await addBillItem(tx, req.ctx.tenantId, billId, {
          itemType: 'bed', description: `Bed charges — ${adm.WardName} (${adm.AdmissionNumber})`, quantity: days,
          unitPrice: Number(adm.DailyRate).toFixed(2), taxRatePercent: 0, referenceType: 'admission', referenceId: id,
        });
      }
      await auditTenant(req, 'admission.discharged', 'admission', id, { billed: Boolean(billId) }, tx);
      return { billId };
    });
    res.json({ data: { ok: true, billId: result.billId } });
  }));

export default router;
