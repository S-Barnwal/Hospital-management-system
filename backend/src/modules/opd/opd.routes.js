// OPD consultations: vitals, diagnosis, prescriptions. Every save keeps the previous version; finalised notes are read-only.
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
import { addBillItem, getOrCreateDraftBill } from '../billing/billing.service.js';

const router = Router();
router.use(requireTenant, requireFeature('opd'));

const LIST_COLS = `c.ConsultationId AS id, c.ConsultationNumber AS number, c.Status AS status, c.Version AS version, c.ChiefComplaint AS chiefComplaint,
  c.Diagnosis AS diagnosis, c.CreatedAt AS createdAt, c.FinalizedAt AS finalizedAt, c.AppointmentId AS appointmentId,
  p.PatientId AS patientId, p.PatientNumber AS patientNumber, p.FirstName AS patientFirstName, p.LastName AS patientLastName,
  s.StaffId AS doctorId, s.FullName AS doctorName`;
const FROM = `FROM hms.Consultations c
  JOIN hms.Patients p ON p.TenantId = c.TenantId AND p.PatientId = c.PatientId
  JOIN hms.StaffMembers s ON s.TenantId = c.TenantId AND s.StaffId = c.DoctorId`;

router.get('/consultations', requirePermission('opd.read'), asyncHandler(async (req, res) => {
  const lq = parseListQuery(req.query, { created: 'c.CreatedAt' }, 'created');
  let from = null; let to = null;
  if (req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) ({ start: from, end: to } = localDayRangeUtc(req.ctx.timezone, req.query.date));
  const q = req.query.q ? `%${String(req.query.q).trim().slice(0, 100).replace(/[%_[\]]/g, (m) => `[${m}]`)}%` : null;
  const params = {
    tid: req.ctx.tenantId, offset: lq.offset, size: lq.pageSize, from, to, q,
    status: ['draft', 'final'].includes(req.query.status) ? req.query.status : null,
    doctorId: req.query.doctorId ? idParam(req.query.doctorId, 'doctorId') : null,
    patientId: req.query.patientId ? idParam(req.query.patientId, 'patientId') : null,
  };
  const where = `WHERE c.TenantId = @tid AND (@status IS NULL OR c.Status = @status) AND (@doctorId IS NULL OR c.DoctorId = @doctorId)
    AND (@patientId IS NULL OR c.PatientId = @patientId) AND (@from IS NULL OR c.CreatedAt >= @from) AND (@to IS NULL OR c.CreatedAt < @to)
    AND (@q IS NULL OR c.ConsultationNumber LIKE @q OR p.PatientNumber LIKE @q OR p.FirstName LIKE @q OR p.LastName LIKE @q OR c.Diagnosis LIKE @q)`;
  const [rows, total] = await db.many(`
    SELECT ${LIST_COLS} ${FROM} ${where} ORDER BY ${lq.orderBy} OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY;
    SELECT COUNT(*) AS total ${FROM} ${where};`, params);
  res.json({ data: rows, meta: pageMeta(lq, total[0].total) });
}));

router.post('/consultations', requirePermission('opd.write'),
  validate(z.object({ patientId: z.number().int().positive(), doctorId: z.number().int().positive(), appointmentId: z.number().int().positive().nullable().optional() }).strict()),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const row = await withTransaction(async (tx) => {
      const doc = await tx.one(`SELECT StaffId FROM hms.StaffMembers WHERE TenantId = @tid AND StaffId = @id AND StaffType = 'doctor'`, { tid: req.ctx.tenantId, id: b.doctorId });
      if (!doc) throw badRequest('Doctor not found.');
      const pat = await tx.one('SELECT PatientId FROM hms.Patients WHERE TenantId = @tid AND PatientId = @id AND IsArchived = 0', { tid: req.ctx.tenantId, id: b.patientId });
      if (!pat) throw badRequest('Patient not found.');
      if (b.appointmentId) {
        const appt = await tx.one('SELECT PatientId, Status FROM hms.Appointments WITH (UPDLOCK) WHERE TenantId = @tid AND AppointmentId = @id', { tid: req.ctx.tenantId, id: b.appointmentId });
        if (!appt || Number(appt.PatientId) !== b.patientId) throw badRequest('Appointment does not belong to this patient.');
        const existing = await tx.one('SELECT ConsultationId FROM hms.Consultations WHERE TenantId = @tid AND AppointmentId = @id', { tid: req.ctx.tenantId, id: b.appointmentId });
        if (existing) return { ConsultationId: existing.ConsultationId, existing: true };
        if (appt.Status === 'scheduled') {
          await tx.exec(`UPDATE hms.Appointments SET Status = 'checked_in', CheckedInAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME() WHERE TenantId = @tid AND AppointmentId = @id`,
            { tid: req.ctx.tenantId, id: b.appointmentId });
        }
      }
      const n = await nextSequence(tx, req.ctx.tenantId, 'consultation');
      const r = await tx.one(`INSERT INTO hms.Consultations (TenantId, ConsultationNumber, PatientId, DoctorId, AppointmentId, CreatedByUserId)
                              OUTPUT INSERTED.ConsultationId VALUES (@tid, @num, @pid, @did, @aid, @uid)`,
      { tid: req.ctx.tenantId, num: formatNumber('OPD', n), pid: b.patientId, did: b.doctorId, aid: b.appointmentId ?? null, uid: req.ctx.userId });
      await auditTenant(req, 'consultation.created', 'consultation', r.ConsultationId, null, tx);
      return r;
    });
    res.status(row.existing ? 200 : 201).json({ data: { id: row.ConsultationId } });
  }));

async function loadConsultation(runner, tenantId, id) {
  const [rows, items, labs, versions] = await runner.many(`
    SELECT c.*, p.PatientNumber, p.FirstName, p.LastName, p.Gender, CONVERT(CHAR(10), p.DateOfBirth, 23) AS DateOfBirth, p.Phone, p.BloodGroup,
           s.FullName AS DoctorName, s.Specialization, s.RegistrationNumber, s.ConsultationFee, CONVERT(CHAR(10), c.FollowUpDate, 23) AS FollowUp
    ${FROM} WHERE c.TenantId = @tid AND c.ConsultationId = @id;
    SELECT PrescriptionItemId AS id, MedicineName AS medicineName, Dosage AS dosage, Frequency AS frequency, DurationDays AS durationDays, Instructions AS instructions
      FROM hms.PrescriptionItems WHERE TenantId = @tid AND ConsultationId = @id ORDER BY SortOrder, PrescriptionItemId;
    SELECT LabOrderId AS id, OrderNumber AS number, Status AS status, OrderedAt AS orderedAt FROM hms.LabOrders WHERE TenantId = @tid AND ConsultationId = @id ORDER BY OrderedAt;
    SELECT Version AS version, ChangedAt AS changedAt FROM hms.ConsultationVersions WHERE TenantId = @tid AND ConsultationId = @id ORDER BY Version DESC;`,
  { tid: tenantId, id });
  return rows[0] ? { row: rows[0], items, labs, versions } : null;
}

router.get('/consultations/:id', requirePermission('opd.read'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const c = await loadConsultation(db, req.ctx.tenantId, id);
  if (!c) throw notFound('Consultation not found.');
  const r = c.row;
  await auditTenant(req, 'consultation.viewed', 'consultation', id);
  res.json({
    data: {
      id: r.ConsultationId, number: r.ConsultationNumber, status: r.Status, version: r.Version, appointmentId: r.AppointmentId,
      createdAt: r.CreatedAt, updatedAt: r.UpdatedAt, finalizedAt: r.FinalizedAt,
      patient: { id: r.PatientId, patientNumber: r.PatientNumber, firstName: r.FirstName, lastName: r.LastName, gender: r.Gender, dateOfBirth: r.DateOfBirth, phone: r.Phone, bloodGroup: r.BloodGroup },
      doctor: { id: r.DoctorId, name: r.DoctorName, specialization: r.Specialization, registrationNumber: r.RegistrationNumber, consultationFee: r.ConsultationFee },
      chiefComplaint: r.ChiefComplaint, symptoms: r.Symptoms, examination: r.Examination, diagnosis: r.Diagnosis, advice: r.Advice, followUpDate: r.FollowUp,
      vitals: { temperatureC: r.TemperatureC, pulseBpm: r.PulseBpm, bpSystolic: r.BpSystolic, bpDiastolic: r.BpDiastolic, respiratoryRate: r.RespiratoryRate, spo2: r.SpO2, weightKg: r.WeightKg, heightCm: r.HeightCm },
      prescriptions: c.items, labOrders: c.labs, versions: c.versions,
    },
  });
}));

const optNum = (min, max) => z.union([z.literal('').transform(() => null), z.null(), z.coerce.number().min(min).max(max)]).optional();
const optText = (max) => z.string().trim().max(max).nullable().optional().transform((v) => (v === '' ? null : v));
const consultationSchema = z.object({
  chiefComplaint: optText(500), symptoms: optText(2000), examination: optText(2000), diagnosis: optText(1000), advice: optText(2000),
  followUpDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('').transform(() => null), z.null()]).optional(),
  vitals: z.object({
    temperatureC: optNum(30, 45), pulseBpm: optNum(20, 250), bpSystolic: optNum(50, 260), bpDiastolic: optNum(30, 160),
    respiratoryRate: optNum(4, 80), spo2: optNum(50, 100), weightKg: optNum(0.3, 400), heightCm: optNum(20, 250),
  }).strict().optional(),
  prescriptions: z.array(z.object({
    medicineName: z.string().trim().min(1).max(200), dosage: optText(100), frequency: optText(100),
    durationDays: optNum(1, 3650), instructions: optText(300),
  }).strip()).max(50).optional(),
}).strict();

router.put('/consultations/:id', requirePermission('opd.write'), validate(consultationSchema), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const b = req.body;
  const v = b.vitals || {};
  await withTransaction(async (tx) => {
    const cur = await tx.one('SELECT * FROM hms.Consultations WITH (UPDLOCK) WHERE TenantId = @tid AND ConsultationId = @id', { tid: req.ctx.tenantId, id });
    if (!cur) throw notFound('Consultation not found.');
    if (cur.Status === 'final') throw conflict('This consultation is finalised and can no longer be edited.', 'RECORD_LOCKED');
    const prevItems = await tx.query('SELECT MedicineName, Dosage, Frequency, DurationDays, Instructions FROM hms.PrescriptionItems WHERE TenantId = @tid AND ConsultationId = @id', { tid: req.ctx.tenantId, id });
    // Keep the previous version before overwriting.
    await tx.exec(`INSERT INTO hms.ConsultationVersions (TenantId, ConsultationId, Version, Snapshot, ChangedByUserId) VALUES (@tid, @id, @ver, @snap, @uid)`,
      { tid: req.ctx.tenantId, id, ver: cur.Version, snap: JSON.stringify({ ...cur, prescriptions: prevItems }), uid: req.ctx.userId });
    await tx.exec(`
      UPDATE hms.Consultations SET ChiefComplaint = @cc, Symptoms = @sym, Examination = @exam, Diagnosis = @dx, Advice = @adv, FollowUpDate = @fu,
        TemperatureC = @temp, PulseBpm = @pulse, BpSystolic = @sys, BpDiastolic = @dia, RespiratoryRate = @rr, SpO2 = @spo2, WeightKg = @wt, HeightCm = @ht,
        Version = Version + 1, UpdatedAt = SYSUTCDATETIME()
      WHERE TenantId = @tid AND ConsultationId = @id`,
    { tid: req.ctx.tenantId, id, cc: b.chiefComplaint ?? null, sym: b.symptoms ?? null, exam: b.examination ?? null, dx: b.diagnosis ?? null, adv: b.advice ?? null,
      fu: b.followUpDate ? t.date(new Date(`${b.followUpDate}T00:00:00Z`)) : null,
      temp: v.temperatureC == null ? null : t.dec(v.temperatureC, 4, 1), pulse: v.pulseBpm ?? null, sys: v.bpSystolic ?? null, dia: v.bpDiastolic ?? null,
      rr: v.respiratoryRate ?? null, spo2: v.spo2 ?? null, wt: v.weightKg == null ? null : t.dec(v.weightKg, 5, 1), ht: v.heightCm == null ? null : t.dec(v.heightCm, 5, 1) });
    if (b.prescriptions) {
      await tx.exec('DELETE FROM hms.PrescriptionItems WHERE TenantId = @tid AND ConsultationId = @id', { tid: req.ctx.tenantId, id });
      let i = 0;
      for (const p of b.prescriptions) {
        await tx.exec(`INSERT INTO hms.PrescriptionItems (TenantId, ConsultationId, MedicineName, Dosage, Frequency, DurationDays, Instructions, SortOrder)
                       VALUES (@tid, @id, @m, @d, @f, @dur, @ins, @s)`,
        { tid: req.ctx.tenantId, id, m: p.medicineName, d: p.dosage ?? null, f: p.frequency ?? null, dur: p.durationDays ?? null, ins: p.instructions ?? null, s: (i += 1) });
      }
    }
    await auditTenant(req, 'consultation.updated', 'consultation', id, { version: cur.Version + 1 }, tx);
  });
  res.json({ data: { ok: true } });
}));

/** Draft consultations without lab orders can be discarded; finalised records are permanent. */
router.delete('/consultations/:id', requirePermission('opd.write'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  await withTransaction(async (tx) => {
    const cur = await tx.one('SELECT Status FROM hms.Consultations WITH (UPDLOCK) WHERE TenantId = @tid AND ConsultationId = @id', { tid: req.ctx.tenantId, id });
    if (!cur) throw notFound('Consultation not found.');
    if (cur.Status === 'final') throw conflict('Finalised consultations are permanent medical records and cannot be deleted.', 'RECORD_LOCKED');
    const labs = await tx.one('SELECT COUNT(*) AS n FROM hms.LabOrders WHERE TenantId = @tid AND ConsultationId = @id', { tid: req.ctx.tenantId, id });
    if (labs.n) throw conflict('Lab tests were ordered from this consultation, so it cannot be discarded.', 'IN_USE');
    await tx.exec('DELETE FROM hms.ConsultationVersions WHERE TenantId = @tid AND ConsultationId = @id', { tid: req.ctx.tenantId, id });
    await tx.exec('DELETE FROM hms.PrescriptionItems WHERE TenantId = @tid AND ConsultationId = @id', { tid: req.ctx.tenantId, id });
    await tx.exec('DELETE FROM hms.Consultations WHERE TenantId = @tid AND ConsultationId = @id', { tid: req.ctx.tenantId, id });
    await auditTenant(req, 'consultation.discarded', 'consultation', id, null, tx);
  });
  res.json({ data: { ok: true } });
}));

router.post('/consultations/:id/finalize', requirePermission('opd.write'),
  validate(z.object({ chargeConsultation: z.boolean().optional() }).strict()),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const result = await withTransaction(async (tx) => {
      const cur = await tx.one(`SELECT c.*, s.ConsultationFee, s.FullName AS DoctorName FROM hms.Consultations c WITH (UPDLOCK)
                                JOIN hms.StaffMembers s ON s.TenantId = c.TenantId AND s.StaffId = c.DoctorId
                                WHERE c.TenantId = @tid AND c.ConsultationId = @id`, { tid: req.ctx.tenantId, id });
      if (!cur) throw notFound('Consultation not found.');
      if (cur.Status === 'final') throw conflict('Already finalised.');
      if (!cur.Diagnosis && !cur.ChiefComplaint) throw badRequest('Record at least a chief complaint or diagnosis before finalising.');
      await tx.exec(`UPDATE hms.Consultations SET Status = 'final', FinalizedAt = SYSUTCDATETIME() WHERE TenantId = @tid AND ConsultationId = @id`, { tid: req.ctx.tenantId, id });
      if (cur.AppointmentId) {
        await tx.exec(`UPDATE hms.Appointments SET Status = 'completed', UpdatedAt = SYSUTCDATETIME()
                       WHERE TenantId = @tid AND AppointmentId = @aid AND Status IN ('scheduled','checked_in')`, { tid: req.ctx.tenantId, aid: cur.AppointmentId });
      }
      let billId = null;
      if (req.body.chargeConsultation && Number(cur.ConsultationFee) > 0 && req.ctx.features.has('billing') && req.ctx.permissions.has('billing.write')) {
        billId = await getOrCreateDraftBill(tx, req.ctx, cur.PatientId);
        await addBillItem(tx, req.ctx.tenantId, billId, {
          itemType: 'consultation', description: `Consultation — ${cur.DoctorName} (${cur.ConsultationNumber})`, quantity: 1,
          unitPrice: Number(cur.ConsultationFee).toFixed(2), taxRatePercent: 0, referenceType: 'consultation', referenceId: id,
        });
      }
      await auditTenant(req, 'consultation.finalized', 'consultation', id, { billed: Boolean(billId) }, tx);
      return { billId };
    });
    res.json({ data: { ok: true, billId: result.billId } });
  }));

export default router;
