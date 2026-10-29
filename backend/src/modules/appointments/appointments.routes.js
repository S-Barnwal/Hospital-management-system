import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requireTenant, requirePermission } from '../../middleware/auth.js';
import { asyncHandler, notFound, badRequest, conflict } from '../../utils/errors.js';
import { db, withTransaction, sql as sqlLib } from '../../db/pool.js';
import { parseListQuery, pageMeta } from '../../utils/pagination.js';
import { idParam } from '../../utils/params.js';
import { auditTenant } from '../../utils/audit.js';
import { localToUtc, localDayRangeUtc, localDateString, tzOffsetMinutes } from '../../utils/time.js';
import { nextSequence, formatNumber } from '../tenants/sequences.js';
import { canTransition, withinSchedule, freeSlots } from './appointments.logic.js';

const router = Router();
router.use(requireTenant);

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h)');

const LIST_COLS = `a.AppointmentId AS id, a.AppointmentNumber AS number, a.StartAt AS startAt, a.EndAt AS endAt, a.Status AS status,
  a.VisitType AS visitType, a.Reason AS reason, a.CancelReason AS cancelReason, a.CheckedInAt AS checkedInAt,
  p.PatientId AS patientId, p.PatientNumber AS patientNumber, p.FirstName AS patientFirstName, p.LastName AS patientLastName, p.Phone AS patientPhone,
  s.StaffId AS doctorId, s.FullName AS doctorName, d.DepartmentId AS departmentId, d.Name AS departmentName`;
const LIST_FROM = `FROM hms.Appointments a
  JOIN hms.Patients p ON p.TenantId = a.TenantId AND p.PatientId = a.PatientId
  JOIN hms.StaffMembers s ON s.TenantId = a.TenantId AND s.StaffId = a.DoctorId
  LEFT JOIN hms.Departments d ON d.TenantId = a.TenantId AND d.DepartmentId = a.DepartmentId`;

router.get('/', requirePermission('appointments.read'), asyncHandler(async (req, res) => {
  const lq = parseListQuery(req.query, { start: 'a.StartAt', created: 'a.CreatedAt' }, 'start');
  let from = null;
  let to = null;
  if (req.query.date) {
    const parsed = ymd.safeParse(req.query.date);
    if (!parsed.success) throw badRequest('Invalid date.');
    ({ start: from, end: to } = localDayRangeUtc(req.ctx.timezone, parsed.data));
  }
  const params = {
    tid: req.ctx.tenantId, offset: lq.offset, size: lq.pageSize, from, to,
    doctorId: req.query.doctorId ? idParam(req.query.doctorId, 'doctorId') : null,
    departmentId: req.query.departmentId ? idParam(req.query.departmentId, 'departmentId') : null,
    patientId: req.query.patientId ? idParam(req.query.patientId, 'patientId') : null,
    status: ['scheduled', 'checked_in', 'completed', 'cancelled', 'no_show'].includes(req.query.status) ? req.query.status : null,
  };
  const where = `WHERE a.TenantId = @tid AND (@from IS NULL OR a.StartAt >= @from) AND (@to IS NULL OR a.StartAt < @to)
    AND (@doctorId IS NULL OR a.DoctorId = @doctorId) AND (@departmentId IS NULL OR a.DepartmentId = @departmentId)
    AND (@patientId IS NULL OR a.PatientId = @patientId) AND (@status IS NULL OR a.Status = @status)`;
  const [rows, total] = await db.many(`
    SELECT ${LIST_COLS} ${LIST_FROM} ${where} ORDER BY ${lq.orderBy} OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY;
    SELECT COUNT(*) AS total FROM hms.Appointments a ${where};`, params);
  res.json({ data: rows, meta: pageMeta(lq, total[0].total) });
}));

/** Free slots for a doctor on a local date, from their weekly schedule minus active bookings. */
router.get('/availability', requirePermission('appointments.read'), asyncHandler(async (req, res) => {
  const doctorId = idParam(req.query.doctorId, 'doctorId');
  const parsedDate = ymd.safeParse(req.query.date);
  if (!parsedDate.success) throw badRequest('Invalid date.');
  const date = parsedDate.data;
  const tz = req.ctx.timezone;
  const { start, end } = localDayRangeUtc(tz, date);
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  const [blocks, booked] = await db.many(`
    SELECT CONVERT(CHAR(5), StartTime, 108) AS StartTime, CONVERT(CHAR(5), EndTime, 108) AS EndTime, SlotMinutes
      FROM hms.DoctorSchedules WHERE TenantId = @tid AND StaffId = @doc AND DayOfWeek = @dow ORDER BY StartTime;
    SELECT StartAt, EndAt FROM hms.Appointments
      WHERE TenantId = @tid AND DoctorId = @doc AND Status IN ('scheduled','checked_in') AND StartAt < @end AND EndAt > @start;`,
  { tid: req.ctx.tenantId, doc: doctorId, dow, start, end });
  const offset = tzOffsetMinutes(tz, start);
  const toLocalMin = (d) => Math.round((new Date(d).getTime() - start.getTime()) / 60000);
  const today = localDateString(tz);
  const nowMinutes = date === today ? Math.round((Date.now() - start.getTime()) / 60000) : (date < today ? 24 * 60 : -1);
  res.json({
    data: {
      date, timezone: tz, utcOffsetMinutes: offset, scheduleConfigured: blocks.length > 0,
      slots: freeSlots(blocks, booked.map((b) => ({ start: toLocalMin(b.StartAt), end: toLocalMin(b.EndAt) })), { nowMinutes }),
    },
  });
}));

const bookingSchema = z.object({
  patientId: z.number().int().positive(),
  doctorId: z.number().int().positive(),
  date: ymd,
  time: hhmm,
  durationMinutes: z.number().int().min(5).max(240).default(15),
  visitType: z.enum(['opd', 'follow_up', 'teleconsult']).default('opd'),
  reason: z.string().trim().max(500).optional(),
}).strict();

/**
 * Validates doctor/patient ownership and guarantees no overlap for the doctor or the patient.
 * UPDLOCK + HOLDLOCK takes key-range locks on the doctor's time window, so two concurrent bookings
 * for the same slot serialise and the second one sees the first.
 */
async function assertBookable(tx, ctx, { doctorId, patientId, startAt, endAt, localDate, localTime, durationMinutes, excludeId = null }) {
  const doctor = await tx.one(`SELECT StaffId, DepartmentId FROM hms.StaffMembers WHERE TenantId = @tid AND StaffId = @doc AND StaffType = 'doctor' AND IsActive = 1`,
    { tid: ctx.tenantId, doc: doctorId });
  if (!doctor) throw badRequest('Doctor not found or inactive.');
  const patient = await tx.one('SELECT PatientId FROM hms.Patients WHERE TenantId = @tid AND PatientId = @pid AND IsArchived = 0', { tid: ctx.tenantId, pid: patientId });
  if (!patient) throw badRequest('Patient not found.');
  if (startAt.getTime() < Date.now() - 5 * 60000) throw badRequest('Appointments cannot be booked in the past.');

  const dow = new Date(`${localDate}T00:00:00Z`).getUTCDay();
  const blocks = await tx.query(`SELECT CONVERT(CHAR(5), StartTime, 108) AS StartTime, CONVERT(CHAR(5), EndTime, 108) AS EndTime
                                 FROM hms.DoctorSchedules WHERE TenantId = @tid AND StaffId = @doc AND DayOfWeek = @dow`,
  { tid: ctx.tenantId, doc: doctorId, dow });
  if (!withinSchedule(blocks, localTime, durationMinutes)) throw conflict('The doctor is not available at that time.', 'OUTSIDE_SCHEDULE');

  const clash = await tx.one(`
    SELECT TOP 1 AppointmentNumber, CASE WHEN DoctorId = @doc THEN 'doctor' ELSE 'patient' END AS who
    FROM hms.Appointments WITH (UPDLOCK, HOLDLOCK)
    WHERE TenantId = @tid AND (DoctorId = @doc OR PatientId = @pid) AND Status IN ('scheduled','checked_in')
      AND StartAt < @end AND EndAt > @start AND (@exclude IS NULL OR AppointmentId <> @exclude)`,
  { tid: ctx.tenantId, doc: doctorId, pid: patientId, start: startAt, end: endAt, exclude: excludeId });
  if (clash) {
    throw conflict(clash.who === 'doctor' ? `The doctor already has appointment ${clash.AppointmentNumber} at that time.`
      : `The patient already has appointment ${clash.AppointmentNumber} at that time.`, 'SLOT_TAKEN');
  }
  return doctor;
}

router.post('/', requirePermission('appointments.write'), validate(bookingSchema), asyncHandler(async (req, res) => {
  const b = req.body;
  const startAt = localToUtc(req.ctx.timezone, b.date, b.time);
  const endAt = new Date(startAt.getTime() + b.durationMinutes * 60000);
  const created = await withTransaction(async (tx) => {
    const doctor = await assertBookable(tx, req.ctx, { ...b, startAt, endAt, localDate: b.date, localTime: b.time });
    const n = await nextSequence(tx, req.ctx.tenantId, 'appointment');
    const row = await tx.one(`
      INSERT INTO hms.Appointments (TenantId, AppointmentNumber, PatientId, DoctorId, DepartmentId, StartAt, EndAt, VisitType, Reason, CreatedByUserId)
      OUTPUT INSERTED.AppointmentId, INSERTED.AppointmentNumber
      VALUES (@tid, @num, @pid, @doc, @dept, @start, @end, @vt, @reason, @uid)`,
    { tid: req.ctx.tenantId, num: formatNumber('APT', n), pid: b.patientId, doc: b.doctorId, dept: doctor.DepartmentId, start: startAt, end: endAt,
      vt: b.visitType, reason: b.reason ?? null, uid: req.ctx.userId });
    await auditTenant(req, 'appointment.created', 'appointment', row.AppointmentId, { number: row.AppointmentNumber }, tx);
    return row;
  }, sqlLib.ISOLATION_LEVEL.SERIALIZABLE);
  res.status(201).json({ data: { id: created.AppointmentId, number: created.AppointmentNumber } });
}));

router.get('/:id', requirePermission('appointments.read'), asyncHandler(async (req, res) => {
  const row = await db.one(`SELECT ${LIST_COLS} ${LIST_FROM} WHERE a.TenantId = @tid AND a.AppointmentId = @id`,
    { tid: req.ctx.tenantId, id: idParam(req.params.id) });
  if (!row) throw notFound('Appointment not found.');
  res.json({ data: row });
}));

router.post('/:id/reschedule', requirePermission('appointments.write'),
  validate(z.object({ date: ymd, time: hhmm, durationMinutes: z.number().int().min(5).max(240).optional(), doctorId: z.number().int().positive().optional() }).strict()),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    await withTransaction(async (tx) => {
      const cur = await tx.one('SELECT * FROM hms.Appointments WITH (UPDLOCK) WHERE TenantId = @tid AND AppointmentId = @id', { tid: req.ctx.tenantId, id });
      if (!cur) throw notFound('Appointment not found.');
      if (cur.Status !== 'scheduled') throw conflict('Only scheduled appointments can be rescheduled.');
      const duration = req.body.durationMinutes ?? Math.round((new Date(cur.EndAt) - new Date(cur.StartAt)) / 60000);
      const doctorId = req.body.doctorId ?? cur.DoctorId;
      const startAt = localToUtc(req.ctx.timezone, req.body.date, req.body.time);
      const endAt = new Date(startAt.getTime() + duration * 60000);
      const doctor = await assertBookable(tx, req.ctx, { doctorId, patientId: cur.PatientId, startAt, endAt, localDate: req.body.date,
        localTime: req.body.time, durationMinutes: duration, excludeId: id });
      await tx.exec(`UPDATE hms.Appointments SET StartAt = @start, EndAt = @end, DoctorId = @doc, DepartmentId = @dept, UpdatedAt = SYSUTCDATETIME()
                     WHERE TenantId = @tid AND AppointmentId = @id`,
      { tid: req.ctx.tenantId, id, start: startAt, end: endAt, doc: doctorId, dept: doctor.DepartmentId });
      await auditTenant(req, 'appointment.rescheduled', 'appointment', id, { from: new Date(cur.StartAt).toISOString(), to: startAt.toISOString() }, tx);
    }, sqlLib.ISOLATION_LEVEL.SERIALIZABLE);
    res.json({ data: { ok: true } });
  }));

router.post('/:id/status', requirePermission('appointments.write'),
  validate(z.object({ status: z.enum(['checked_in', 'completed', 'cancelled', 'no_show']), cancelReason: z.string().trim().max(300).optional() }).strict()),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const { status, cancelReason } = req.body;
    if (status === 'cancelled' && !cancelReason) throw badRequest('A cancellation reason is required.');
    await withTransaction(async (tx) => {
      const cur = await tx.one('SELECT Status FROM hms.Appointments WITH (UPDLOCK) WHERE TenantId = @tid AND AppointmentId = @id', { tid: req.ctx.tenantId, id });
      if (!cur) throw notFound('Appointment not found.');
      if (!canTransition(cur.Status, status)) throw conflict(`Cannot change an appointment from ${cur.Status} to ${status}.`, 'INVALID_TRANSITION');
      await tx.exec(`UPDATE hms.Appointments SET Status = @status, CancelReason = CASE WHEN @status = 'cancelled' THEN @reason ELSE CancelReason END,
                       CheckedInAt = CASE WHEN @status = 'checked_in' THEN SYSUTCDATETIME() ELSE CheckedInAt END, UpdatedAt = SYSUTCDATETIME()
                     WHERE TenantId = @tid AND AppointmentId = @id`, { tid: req.ctx.tenantId, id, status, reason: cancelReason ?? null });
      await auditTenant(req, `appointment.${status}`, 'appointment', id, null, tx);
    });
    res.json({ data: { ok: true } });
  }));

export default router;
