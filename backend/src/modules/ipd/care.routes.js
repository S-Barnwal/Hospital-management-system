// IPD care during the stay: vitals chart, nursing notes, service charges / daily bed charges and the structured
// discharge summary. Every query is scoped by the TenantId from the signed session; every row also carries composite
// foreign keys, so an id from another hospital simply is "not found".
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { ensureTenant, requirePermission, requireFeature } from '../../middleware/auth.js';
import { asyncHandler, badRequest, conflict, forbidden, notFound } from '../../utils/errors.js';
import { db, withTransaction, t } from '../../db/pool.js';
import { idParam } from '../../utils/params.js';
import { auditTenant } from '../../utils/audit.js';
import { vitalFlags, hasAnyVital, depositBalance } from '../clinical/phase2.logic.js';
import { addBillItem, getOrCreateDraftBill } from '../billing/billing.service.js';
import { postBedCharges } from './bedCharges.service.js';

const router = Router();
router.use(ensureTenant, requireFeature('ipd'));

const optNum = (min, max) => z.union([z.literal('').transform(() => null), z.null(), z.coerce.number().min(min).max(max)]).optional();
const optText = (max) => z.string().trim().max(max).nullable().optional().transform((v) => (v === '' || v === undefined ? null : v));

async function loadAdmission(runner, tenantId, id, lock = false) {
  const a = await runner.one(`SELECT a.AdmissionId, a.AdmissionNumber, a.PatientId, a.Status, a.AdmittedAt, a.DischargedAt, a.Reason, a.AttendingDoctorId
                              FROM hms.Admissions a ${lock ? 'WITH (UPDLOCK)' : ''} WHERE a.TenantId = @tid AND a.AdmissionId = @id`, { tid: tenantId, id });
  if (!a) throw notFound('Admission not found.');
  return a;
}
const mustBeAdmitted = (a) => { if (a.Status !== 'admitted') throw conflict('The patient is discharged; the record is closed.', 'ADMISSION_CLOSED'); };

// ---------- Vitals ----------
const vitalsSchema = z.object({
  recordedAt: z.string().datetime({ offset: true }).optional(),
  temperatureC: optNum(30, 45), pulseBpm: optNum(20, 250), bpSystolic: optNum(50, 260), bpDiastolic: optNum(30, 160),
  respiratoryRate: optNum(4, 80), spo2: optNum(50, 100), bloodSugarMgdl: optNum(20, 800), painScore: optNum(0, 10), weightKg: optNum(0.3, 400),
  notes: optText(500),
}).strict().refine(hasAnyVital, 'Enter at least one reading.')
  .refine((v) => v.bpSystolic == null || v.bpDiastolic == null || v.bpSystolic > v.bpDiastolic, { path: ['bpDiastolic'], message: 'Diastolic must be lower than systolic.' })
  .refine((v) => !v.recordedAt || (new Date(v.recordedAt) <= new Date(Date.now() + 5 * 60000) && new Date(v.recordedAt) > new Date(Date.now() - 7 * 86400000)),
    { path: ['recordedAt'], message: 'Time must be within the last 7 days and not in the future.' });

const VITAL_COLS = `v.VitalId AS id, v.RecordedAt AS recordedAt, v.TemperatureC AS temperatureC, v.PulseBpm AS pulseBpm, v.BpSystolic AS bpSystolic,
  v.BpDiastolic AS bpDiastolic, v.RespiratoryRate AS respiratoryRate, v.SpO2 AS spo2, v.BloodSugarMgdl AS bloodSugarMgdl, v.PainScore AS painScore,
  v.WeightKg AS weightKg, v.Notes AS notes, u.FullName AS recordedBy`;

router.get('/admissions/:id/vitals', requirePermission('ipd.read'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  await loadAdmission(db, req.ctx.tenantId, id);
  const rows = await db.query(`SELECT TOP 500 ${VITAL_COLS} FROM hms.PatientVitals v LEFT JOIN hms.Users u ON u.TenantId = v.TenantId AND u.UserId = v.RecordedByUserId
                               WHERE v.TenantId = @tid AND v.AdmissionId = @id ORDER BY v.RecordedAt DESC`, { tid: req.ctx.tenantId, id });
  res.json({ data: rows.map((r) => ({ ...r, flags: vitalFlags(r) })) });
}));

router.post('/admissions/:id/vitals', requirePermission('ipd.write'), validate(vitalsSchema), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const v = req.body;
  const row = await withTransaction(async (tx) => {
    const a = await loadAdmission(tx, req.ctx.tenantId, id);
    mustBeAdmitted(a);
    const r = await tx.one(`INSERT INTO hms.PatientVitals (TenantId, PatientId, AdmissionId, RecordedAt, TemperatureC, PulseBpm, BpSystolic, BpDiastolic,
                              RespiratoryRate, SpO2, BloodSugarMgdl, PainScore, WeightKg, Notes, RecordedByUserId)
                            OUTPUT INSERTED.VitalId
                            VALUES (@tid, @pid, @aid, @at, @temp, @pulse, @sys, @dia, @rr, @spo2, @sugar, @pain, @wt, @notes, @uid)`,
    { tid: req.ctx.tenantId, pid: a.PatientId, aid: id, at: v.recordedAt ? new Date(v.recordedAt) : new Date(),
      temp: v.temperatureC == null ? null : t.dec(v.temperatureC, 4, 1), pulse: v.pulseBpm ?? null, sys: v.bpSystolic ?? null, dia: v.bpDiastolic ?? null,
      rr: v.respiratoryRate ?? null, spo2: v.spo2 ?? null, sugar: v.bloodSugarMgdl ?? null, pain: v.painScore ?? null,
      wt: v.weightKg == null ? null : t.dec(v.weightKg, 5, 1), notes: v.notes ?? null, uid: req.ctx.userId });
    await auditTenant(req, 'vitals.recorded', 'admission', id, null, tx);
    return r;
  });
  res.status(201).json({ data: { id: row.VitalId, flags: vitalFlags(v) } });
}));

// ---------- Nursing notes (append-only) ----------
const NOTE_CATEGORIES = ['note', 'medication', 'intake_output', 'procedure', 'handover'];
const noteSchema = z.object({
  category: z.enum(NOTE_CATEGORIES),
  note: z.string().trim().min(2, 'Write the note.').max(2000),
  medicineName: optText(200), dose: optText(100), route: optText(30),
  intakeMl: optNum(0, 20000), outputMl: optNum(0, 20000),
  correctsNoteId: z.coerce.number().int().positive().optional(),
}).strict()
  .refine((n) => n.category !== 'medication' || n.medicineName, { path: ['medicineName'], message: 'Which medicine was given?' })
  .refine((n) => n.category !== 'intake_output' || n.intakeMl != null || n.outputMl != null, { path: ['intakeMl'], message: 'Enter intake or output (ml).' });

router.get('/admissions/:id/notes', requirePermission('ipd.read'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  await loadAdmission(db, req.ctx.tenantId, id);
  const rows = await db.query(`
    SELECT TOP 1000 n.NoteId AS id, n.Category AS category, n.Note AS note, n.MedicineName AS medicineName, n.Dose AS dose, n.Route AS route,
           n.IntakeMl AS intakeMl, n.OutputMl AS outputMl, n.CorrectsNoteId AS correctsNoteId, n.RecordedAt AS recordedAt, u.FullName AS recordedBy,
           CASE WHEN EXISTS (SELECT 1 FROM hms.NursingNotes c WHERE c.TenantId = n.TenantId AND c.CorrectsNoteId = n.NoteId) THEN 1 ELSE 0 END AS isCorrected
    FROM hms.NursingNotes n LEFT JOIN hms.Users u ON u.TenantId = n.TenantId AND u.UserId = n.RecordedByUserId
    WHERE n.TenantId = @tid AND n.AdmissionId = @id ORDER BY n.RecordedAt DESC`, { tid: req.ctx.tenantId, id });
  const io = rows.reduce((s, r) => ({ intake: s.intake + (r.isCorrected ? 0 : r.intakeMl || 0), output: s.output + (r.isCorrected ? 0 : r.outputMl || 0) }), { intake: 0, output: 0 });
  res.json({ data: rows.map((r) => ({ ...r, isCorrected: Boolean(r.isCorrected) })), meta: { intakeOutput: io } });
}));

router.post('/admissions/:id/notes', requirePermission('ipd.write'), validate(noteSchema), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const b = req.body;
  const row = await withTransaction(async (tx) => {
    const a = await loadAdmission(tx, req.ctx.tenantId, id);
    mustBeAdmitted(a);
    if (b.correctsNoteId) {
      const orig = await tx.one('SELECT NoteId FROM hms.NursingNotes WHERE TenantId = @tid AND AdmissionId = @aid AND NoteId = @nid', { tid: req.ctx.tenantId, aid: id, nid: b.correctsNoteId });
      if (!orig) throw badRequest('The note being corrected was not found in this admission.');
    }
    const r = await tx.one(`INSERT INTO hms.NursingNotes (TenantId, AdmissionId, Category, Note, MedicineName, Dose, Route, IntakeMl, OutputMl, CorrectsNoteId, RecordedByUserId)
                            OUTPUT INSERTED.NoteId VALUES (@tid, @aid, @cat, @note, @med, @dose, @route, @in, @out, @corr, @uid)`,
    { tid: req.ctx.tenantId, aid: id, cat: b.category, note: b.note, med: b.medicineName ?? null, dose: b.dose ?? null, route: b.route ?? null,
      in: b.intakeMl ?? null, out: b.outputMl ?? null, corr: b.correctsNoteId ?? null, uid: req.ctx.userId });
    await auditTenant(req, b.correctsNoteId ? 'nursing_note.corrected' : 'nursing_note.added', 'admission', id, { category: b.category }, tx);
    return r;
  });
  res.status(201).json({ data: { id: row.NoteId } });
}));

// ---------- Service-charge catalogue ----------
const CHARGE_CATEGORIES = ['procedure', 'doctor_visit', 'nursing', 'consumable', 'other'];
const chargeSchema = z.object({
  name: z.string().trim().min(2).max(150), category: z.enum(CHARGE_CATEGORIES),
  price: z.coerce.number().min(0).max(1e7), taxRatePercent: z.coerce.number().min(0).max(28).default(0), isActive: z.boolean().optional(),
}).strict();

router.get('/service-charges', requirePermission('ipd.read'), asyncHandler(async (req, res) => {
  const rows = await db.query(`SELECT ChargeId AS id, Name AS name, Category AS category, Price AS price, TaxRatePercent AS taxRatePercent, IsActive AS isActive
                               FROM hms.ServiceCharges WHERE TenantId = @tid AND (@all = 1 OR IsActive = 1) ORDER BY Category, Name`,
  { tid: req.ctx.tenantId, all: req.query.all === 'true' });
  res.json({ data: rows });
}));

router.post('/service-charges', requirePermission('ipd.configure'), validate(chargeSchema), asyncHandler(async (req, res) => {
  const b = req.body;
  const dup = await db.one('SELECT ChargeId FROM hms.ServiceCharges WHERE TenantId = @tid AND Name = @n', { tid: req.ctx.tenantId, n: b.name });
  if (dup) throw conflict('A charge with this name already exists.', 'DUPLICATE');
  const r = await db.one(`INSERT INTO hms.ServiceCharges (TenantId, Name, Category, Price, TaxRatePercent) OUTPUT INSERTED.ChargeId VALUES (@tid, @n, @c, @p, @tax)`,
    { tid: req.ctx.tenantId, n: b.name, c: b.category, p: t.money(b.price.toFixed(2)), tax: t.dec(b.taxRatePercent, 5, 2) });
  await auditTenant(req, 'service_charge.created', 'service_charge', r.ChargeId, { name: b.name, price: b.price });
  res.status(201).json({ data: { id: r.ChargeId } });
}));

router.put('/service-charges/:id', requirePermission('ipd.configure'), validate(chargeSchema), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const b = req.body;
  const n = await db.exec(`UPDATE hms.ServiceCharges SET Name = @n, Category = @c, Price = @p, TaxRatePercent = @tax, IsActive = COALESCE(@active, IsActive)
                           WHERE TenantId = @tid AND ChargeId = @id`,
  { tid: req.ctx.tenantId, id, n: b.name, c: b.category, p: t.money(b.price.toFixed(2)), tax: t.dec(b.taxRatePercent, 5, 2), active: b.isActive ?? null });
  if (!n) throw notFound('Charge not found.');
  await auditTenant(req, 'service_charge.updated', 'service_charge', id, { price: b.price });
  res.json({ data: { ok: true } });
}));

router.delete('/service-charges/:id', requirePermission('ipd.configure'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const used = await db.one(`SELECT COUNT(*) AS n FROM hms.BillItems WHERE TenantId = @tid AND ReferenceType = 'service_charge' AND ReferenceId = @id`, { tid: req.ctx.tenantId, id });
  if (used.n) throw conflict('This charge is on patients’ bills. Make it inactive instead.', 'IN_USE');
  const n = await db.exec('DELETE FROM hms.ServiceCharges WHERE TenantId = @tid AND ChargeId = @id', { tid: req.ctx.tenantId, id });
  if (!n) throw notFound('Charge not found.');
  await auditTenant(req, 'service_charge.deleted', 'service_charge', id);
  res.json({ data: { ok: true } });
}));

// ---------- Charges on an admission ----------
const needsBilling = (req) => {
  if (!req.ctx.features.has('billing')) throw forbidden('Billing is not included in your plan.', 'FEATURE_NOT_IN_PLAN');
  if (!req.ctx.permissions.has('billing.write')) throw forbidden('Posting charges needs the "Create bills and post payments" permission.');
};

router.get('/admissions/:id/charges', requirePermission('ipd.read'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const a = await loadAdmission(db, req.ctx.tenantId, id);
  const [bills, items, deposits] = await db.many(`
    SELECT BillId AS id, BillNumber AS number, Status AS status, Total AS total, PaidAmount AS paid FROM hms.Bills
      WHERE TenantId = @tid AND AdmissionId = @id AND Status <> 'cancelled' ORDER BY CreatedAt;
    SELECT i.BillItemId AS id, i.BillId AS billId, i.ItemType AS itemType, i.Description AS description, i.Quantity AS quantity, i.UnitPrice AS unitPrice,
           i.LineSubtotal + i.LineTax AS amount, CONVERT(CHAR(10), i.ChargeDate, 23) AS chargeDate, i.CreatedAt AS createdAt
      FROM hms.BillItems i JOIN hms.Bills b ON b.TenantId = i.TenantId AND b.BillId = i.BillId
      WHERE i.TenantId = @tid AND b.AdmissionId = @id AND b.Status <> 'cancelled' ORDER BY ISNULL(CAST(i.ChargeDate AS DATETIME2), i.CreatedAt), i.BillItemId;
    SELECT Kind, Amount FROM hms.PatientDeposits WHERE TenantId = @tid AND PatientId = @pid;`, { tid: req.ctx.tenantId, id, pid: a.PatientId });
  const total = bills.reduce((s, b) => s + Number(b.total), 0);
  const paid = bills.reduce((s, b) => s + Number(b.paid), 0);
  res.json({ data: { bills, items, totals: { charged: total.toFixed(2), paid: paid.toFixed(2), due: (total - paid).toFixed(2), depositBalance: depositBalance(deposits) } } });
}));

router.post('/admissions/:id/charges', requirePermission('ipd.write'),
  validate(z.object({ chargeId: z.coerce.number().int().positive(), quantity: z.coerce.number().min(0.5).max(1000).default(1), note: optText(80) }).strict()),
  asyncHandler(async (req, res) => {
    needsBilling(req);
    const id = idParam(req.params.id);
    const b = req.body;
    const billId = await withTransaction(async (tx) => {
      const a = await loadAdmission(tx, req.ctx.tenantId, id, true);
      mustBeAdmitted(a);
      const c = await tx.one('SELECT ChargeId, Name, Category, Price, TaxRatePercent, IsActive FROM hms.ServiceCharges WHERE TenantId = @tid AND ChargeId = @cid',
        { tid: req.ctx.tenantId, cid: b.chargeId });
      if (!c || !c.IsActive) throw badRequest('Charge not found or inactive.');
      const bid = await getOrCreateDraftBill(tx, req.ctx, a.PatientId, id);
      await addBillItem(tx, req.ctx.tenantId, bid, {
        itemType: c.Category === 'procedure' ? 'procedure' : 'other', description: `${c.Name}${b.note ? ` — ${b.note}` : ''} (${a.AdmissionNumber})`,
        quantity: b.quantity, unitPrice: Number(c.Price).toFixed(2), taxRatePercent: Number(c.TaxRatePercent), referenceType: 'service_charge', referenceId: c.ChargeId,
      });
      await auditTenant(req, 'admission.charge_added', 'admission', id, { charge: c.Name, quantity: b.quantity }, tx);
      return bid;
    });
    res.status(201).json({ data: { billId } });
  }));

router.post('/admissions/:id/bed-charges', requirePermission('ipd.write'), asyncHandler(async (req, res) => {
  needsBilling(req);
  const id = idParam(req.params.id);
  const added = await withTransaction(async (tx) => {
    const a = await loadAdmission(tx, req.ctx.tenantId, id, true);
    mustBeAdmitted(a);
    const n = await postBedCharges(tx, req.ctx, id);
    if (n) await auditTenant(req, 'admission.bed_charges_posted', 'admission', id, { days: n }, tx);
    return n;
  });
  res.json({ data: { daysAdded: added } });
}));

// ---------- Discharge summary ----------
const rxItem = z.object({
  medicineName: z.string().trim().min(1).max(200), dosage: optText(100), frequency: optText(100), durationDays: optNum(1, 3650), instructions: optText(300),
}).strict();
const summarySchema = z.object({
  provisionalDiagnosis: optText(1000), finalDiagnosis: optText(1000), presentingComplaints: optText(2000), courseInHospital: optText(4000),
  proceduresDone: optText(2000), investigations: optText(2000), conditionAtDischarge: optText(500), advice: optText(2000),
  followUpDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('').transform(() => null), z.null()]).optional(),
  dischargeType: z.enum(['regular', 'lama', 'referred', 'death', 'absconded']).default('regular'),
  medications: z.array(rxItem).max(40).default([]),
}).strict();

function serialiseSummary(s) {
  if (!s) return null;
  let meds = [];
  try { meds = JSON.parse(s.DischargeMedications || '[]'); } catch { meds = []; }
  return {
    status: s.Status, version: s.Version, provisionalDiagnosis: s.ProvisionalDiagnosis, finalDiagnosis: s.FinalDiagnosis, presentingComplaints: s.PresentingComplaints,
    courseInHospital: s.CourseInHospital, proceduresDone: s.ProceduresDone, investigations: s.Investigations, conditionAtDischarge: s.ConditionAtDischarge,
    advice: s.Advice, followUpDate: s.FollowUp, dischargeType: s.DischargeType, medications: meds,
    updatedAt: s.UpdatedAt, updatedBy: s.UpdatedByName, finalizedAt: s.FinalizedAt, finalizedBy: s.FinalizedByName,
  };
}

router.get('/admissions/:id/discharge-summary', requirePermission('ipd.read'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const a = await loadAdmission(db, req.ctx.tenantId, id);
  const [sum, labs] = await db.many(`
    SELECT d.*, CONVERT(CHAR(10), d.FollowUpDate, 23) AS FollowUp, uu.FullName AS UpdatedByName, fu.FullName AS FinalizedByName
    FROM hms.DischargeSummaries d
    LEFT JOIN hms.Users uu ON uu.TenantId = d.TenantId AND uu.UserId = d.UpdatedByUserId
    LEFT JOIN hms.Users fu ON fu.TenantId = d.TenantId AND fu.UserId = d.FinalizedByUserId
    WHERE d.TenantId = @tid AND d.AdmissionId = @id;
    SELECT o.OrderNumber AS number, o.Status AS status, i.TestName AS testName, i.ResultValue AS result, i.Unit AS unit, i.Flag AS flag
    FROM hms.LabOrders o JOIN hms.LabOrderItems i ON i.TenantId = o.TenantId AND i.LabOrderId = o.LabOrderId
    WHERE o.TenantId = @tid AND o.PatientId = @pid AND o.OrderedAt >= @from AND (@to IS NULL OR o.OrderedAt <= @to) AND o.Status <> 'cancelled'
    ORDER BY o.OrderedAt, i.TestName;`, { tid: req.ctx.tenantId, id, pid: a.PatientId, from: a.AdmittedAt, to: a.DischargedAt });
  // Suggested text for "Investigations" from this stay's lab results (the doctor edits it).
  const suggestion = labs.filter((l) => l.result).map((l) => `${l.testName}: ${l.result}${l.unit ? ` ${l.unit}` : ''}${l.flag && l.flag !== 'normal' ? ` (${l.flag})` : ''}`).join('; ');
  res.json({ data: serialiseSummary(sum[0]) ?? { status: 'new', provisionalDiagnosis: a.Reason, medications: [], dischargeType: 'regular' }, meta: { investigationsSuggestion: suggestion || null, labCount: labs.length } });
}));

router.put('/admissions/:id/discharge-summary', requirePermission('ipd.write'), validate(summarySchema), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const b = req.body;
  await withTransaction(async (tx) => {
    await loadAdmission(tx, req.ctx.tenantId, id, true);
    const cur = await tx.one('SELECT Status FROM hms.DischargeSummaries WITH (UPDLOCK, HOLDLOCK) WHERE TenantId = @tid AND AdmissionId = @id', { tid: req.ctx.tenantId, id });
    if (cur?.Status === 'final') throw conflict('The discharge summary is signed and locked.', 'RECORD_LOCKED');
    const p = {
      tid: req.ctx.tenantId, id, pd: b.provisionalDiagnosis ?? null, fd: b.finalDiagnosis ?? null, pc: b.presentingComplaints ?? null, course: b.courseInHospital ?? null,
      proc: b.proceduresDone ?? null, inv: b.investigations ?? null, cond: b.conditionAtDischarge ?? null, adv: b.advice ?? null,
      fu: b.followUpDate ? t.date(new Date(`${b.followUpDate}T00:00:00Z`)) : null, type: b.dischargeType, meds: JSON.stringify(b.medications), uid: req.ctx.userId,
    };
    if (cur) {
      await tx.exec(`UPDATE hms.DischargeSummaries SET ProvisionalDiagnosis = @pd, FinalDiagnosis = @fd, PresentingComplaints = @pc, CourseInHospital = @course,
                       ProceduresDone = @proc, Investigations = @inv, ConditionAtDischarge = @cond, Advice = @adv, FollowUpDate = @fu, DischargeType = @type,
                       DischargeMedications = @meds, UpdatedByUserId = @uid, UpdatedAt = SYSUTCDATETIME(), Version = Version + 1
                     WHERE TenantId = @tid AND AdmissionId = @id`, p);
    } else {
      await tx.exec(`INSERT INTO hms.DischargeSummaries (TenantId, AdmissionId, ProvisionalDiagnosis, FinalDiagnosis, PresentingComplaints, CourseInHospital, ProceduresDone,
                       Investigations, ConditionAtDischarge, Advice, FollowUpDate, DischargeType, DischargeMedications, UpdatedByUserId)
                     VALUES (@tid, @id, @pd, @fd, @pc, @course, @proc, @inv, @cond, @adv, @fu, @type, @meds, @uid)`, p);
    }
    await auditTenant(req, 'discharge_summary.saved', 'admission', id, null, tx);
  });
  res.json({ data: { ok: true } });
}));

router.post('/admissions/:id/discharge-summary/finalize', requirePermission('ipd.discharge_summary'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  await withTransaction(async (tx) => {
    await loadAdmission(tx, req.ctx.tenantId, id, true);
    const cur = await tx.one('SELECT * FROM hms.DischargeSummaries WITH (UPDLOCK) WHERE TenantId = @tid AND AdmissionId = @id', { tid: req.ctx.tenantId, id });
    if (!cur) throw badRequest('Save the discharge summary first.');
    if (cur.Status === 'final') throw conflict('Already signed.');
    if (!cur.FinalDiagnosis || !cur.ConditionAtDischarge) throw badRequest('Final diagnosis and condition at discharge are required before signing.');
    await tx.exec(`UPDATE hms.DischargeSummaries SET Status = 'final', FinalizedByUserId = @uid, FinalizedAt = SYSUTCDATETIME() WHERE TenantId = @tid AND AdmissionId = @id`,
      { tid: req.ctx.tenantId, id, uid: req.ctx.userId });
    await auditTenant(req, 'discharge_summary.signed', 'admission', id, null, tx);
  });
  res.json({ data: { ok: true } });
}));

export default router;
