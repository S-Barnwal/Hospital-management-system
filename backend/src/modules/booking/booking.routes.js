// Staff side of online booking (/api/v1/booking): review requests from the public page, confirm them into a real
// appointment (linking an existing patient or registering a new one) or decline them.
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requireTenant, requirePermission } from '../../middleware/auth.js';
import { asyncHandler, badRequest, conflict, notFound } from '../../utils/errors.js';
import { db, withTransaction, sql as sqlLib } from '../../db/pool.js';
import { idParam } from '../../utils/params.js';
import { auditTenant } from '../../utils/audit.js';
import { nextSequence, formatNumber } from '../tenants/sequences.js';
import { deliver, templates } from '../../notify/index.js';
import { sendAppointmentMessage } from '../../notify/appointments.js';
import { createPatientRecord } from '../patients/patients.service.js';

const router = Router();
router.use(requireTenant);

const COLS = `r.BookingRequestId AS id, r.RefCode AS ref, r.DoctorId AS doctorId, s.FullName AS doctorName, r.StartAt AS startAt, r.DurationMinutes AS durationMinutes,
  r.PatientName AS patientName, r.Phone AS phone, r.Email AS email, r.Gender AS gender, r.AgeYears AS age, r.Reason AS reason, r.Status AS status,
  r.PatientId AS patientId, r.AppointmentId AS appointmentId, a.AppointmentNumber AS appointmentNumber, r.DecisionNote AS decisionNote, r.DecidedAt AS decidedAt,
  u.FullName AS decidedBy, r.CreatedAt AS createdAt`;
const FROM = `FROM hms.OnlineBookingRequests r JOIN hms.StaffMembers s ON s.TenantId = r.TenantId AND s.StaffId = r.DoctorId
  LEFT JOIN hms.Appointments a ON a.TenantId = r.TenantId AND a.AppointmentId = r.AppointmentId
  LEFT JOIN hms.Users u ON u.TenantId = r.TenantId AND u.UserId = r.DecidedByUserId`;

router.get('/requests', requirePermission('appointments.read'), asyncHandler(async (req, res) => {
  const status = ['pending', 'confirmed', 'rejected', 'cancelled'].includes(req.query.status) ? req.query.status : null;
  const [rows, counts] = await db.many(`
    SELECT TOP 200 ${COLS} ${FROM} WHERE r.TenantId = @tid AND (@status IS NULL OR r.Status = @status)
    ORDER BY CASE r.Status WHEN 'pending' THEN 0 ELSE 1 END, CASE WHEN r.Status = 'pending' THEN r.StartAt END, r.CreatedAt DESC;
    SELECT Status AS status, COUNT(*) AS n FROM hms.OnlineBookingRequests WHERE TenantId = @tid GROUP BY Status;`, { tid: req.ctx.tenantId, status });
  res.json({ data: rows, meta: { counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) } });
}));

/** Existing patients with the same phone number — the desk decides whether this is the same person. */
router.get('/requests/:id/matches', requirePermission('appointments.write', 'patients.read'), asyncHandler(async (req, res) => {
  const r = await db.one('SELECT Phone FROM hms.OnlineBookingRequests WHERE TenantId = @tid AND BookingRequestId = @id', { tid: req.ctx.tenantId, id: idParam(req.params.id) });
  if (!r) throw notFound('Request not found.');
  const rows = await db.query(`SELECT TOP 10 PatientId AS id, PatientNumber AS patientNumber, FirstName AS firstName, LastName AS lastName, Gender AS gender, DateOfBirth AS dateOfBirth
                               FROM hms.Patients WHERE TenantId = @tid AND Phone = @p AND IsArchived = 0 ORDER BY CreatedAt DESC`, { tid: req.ctx.tenantId, p: r.Phone });
  res.json({ data: rows });
}));

router.post('/requests/:id/confirm', requirePermission('appointments.write', 'patients.write'),
  validate(z.object({ patientId: z.coerce.number().int().positive().nullable().optional() }).strict()),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const out = await withTransaction(async (tx) => {
      const r = await tx.one('SELECT * FROM hms.OnlineBookingRequests WITH (UPDLOCK) WHERE TenantId = @tid AND BookingRequestId = @id', { tid: req.ctx.tenantId, id });
      if (!r) throw notFound('Request not found.');
      if (r.Status !== 'pending') throw conflict(`This request is already ${r.Status}.`, 'BOOKING_STATE');
      if (new Date(r.StartAt).getTime() < Date.now() - 5 * 60000) throw conflict('The requested time has passed. Decline it and book a new time with the patient.', 'BOOKING_PAST');
      let patientId = req.body.patientId ?? null;
      if (patientId) {
        if (!(await tx.one('SELECT 1 AS x FROM hms.Patients WHERE TenantId = @tid AND PatientId = @p AND IsArchived = 0', { tid: req.ctx.tenantId, p: patientId }))) throw badRequest('Patient not found.');
      } else {
        const [firstName, ...rest] = r.PatientName.trim().split(/\s+/);
        const dob = r.AgeYears != null ? `${new Date().getUTCFullYear() - r.AgeYears}-01-01` : null;
        patientId = (await createPatientRecord(tx, req, { firstName, lastName: rest.join(' ') || null, phone: r.Phone, email: r.Email, gender: r.Gender || 'unknown',
          dateOfBirth: dob, dobIsEstimate: dob !== null })).id;
      }
      const end = new Date(new Date(r.StartAt).getTime() + r.DurationMinutes * 60000);
      const doc = await tx.one(`SELECT DepartmentId FROM hms.StaffMembers WHERE TenantId = @tid AND StaffId = @d AND StaffType = 'doctor' AND IsActive = 1`, { tid: req.ctx.tenantId, d: r.DoctorId });
      if (!doc) throw conflict('The doctor is no longer available.', 'DOCTOR_INACTIVE');
      const clash = await tx.one(`SELECT TOP 1 AppointmentNumber FROM hms.Appointments WITH (UPDLOCK, HOLDLOCK)
        WHERE TenantId = @tid AND (DoctorId = @doc OR PatientId = @pid) AND Status IN ('scheduled','checked_in') AND StartAt < @end AND EndAt > @start`,
      { tid: req.ctx.tenantId, doc: r.DoctorId, pid: patientId, start: r.StartAt, end });
      if (clash) throw conflict(`That time is now taken (${clash.AppointmentNumber}). Decline and offer another time.`, 'SLOT_TAKEN');
      const n = await nextSequence(tx, req.ctx.tenantId, 'appointment');
      const appt = await tx.one(`INSERT INTO hms.Appointments (TenantId, AppointmentNumber, PatientId, DoctorId, DepartmentId, StartAt, EndAt, VisitType, Reason, CreatedByUserId)
                                 OUTPUT INSERTED.AppointmentId, INSERTED.AppointmentNumber VALUES (@tid, @num, @pid, @doc, @dept, @start, @end, 'opd', @reason, @uid)`,
      { tid: req.ctx.tenantId, num: formatNumber('APT', n), pid: patientId, doc: r.DoctorId, dept: doc.DepartmentId, start: r.StartAt, end,
        reason: [`Online booking ${r.RefCode}`, r.Reason].filter(Boolean).join(' — ').slice(0, 500), uid: req.ctx.userId });
      await tx.exec(`UPDATE hms.OnlineBookingRequests SET Status = 'confirmed', PatientId = @pid, AppointmentId = @aid, DecidedByUserId = @uid, DecidedAt = SYSUTCDATETIME()
                     WHERE TenantId = @tid AND BookingRequestId = @id`, { tid: req.ctx.tenantId, id, pid: patientId, aid: appt.AppointmentId, uid: req.ctx.userId });
      await auditTenant(req, 'booking.confirmed', 'appointment', appt.AppointmentId, { ref: r.RefCode, newPatient: !req.body.patientId }, tx);
      return { appointmentId: appt.AppointmentId, appointmentNumber: appt.AppointmentNumber, patientId };
    }, sqlLib.ISOLATION_LEVEL.SERIALIZABLE);
    sendAppointmentMessage(req.ctx.tenantId, out.appointmentId, 'confirmed').catch((e) => console.error('[booking] confirmation failed:', e.message));
    res.json({ data: out });
  }));

router.post('/requests/:id/reject', requirePermission('appointments.write'),
  validate(z.object({ note: z.string().trim().min(3, 'Give a short reason.').max(300) }).strict()),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const r = await withTransaction(async (tx) => {
      const row = await tx.one('SELECT RefCode, PatientName, Email, StartAt, Status FROM hms.OnlineBookingRequests WITH (UPDLOCK) WHERE TenantId = @tid AND BookingRequestId = @id',
        { tid: req.ctx.tenantId, id });
      if (!row) throw notFound('Request not found.');
      if (row.Status !== 'pending') throw conflict(`This request is already ${row.Status}.`, 'BOOKING_STATE');
      await tx.exec(`UPDATE hms.OnlineBookingRequests SET Status = 'rejected', DecisionNote = @n, DecidedByUserId = @uid, DecidedAt = SYSUTCDATETIME()
                     WHERE TenantId = @tid AND BookingRequestId = @id`, { tid: req.ctx.tenantId, id, n: req.body.note, uid: req.ctx.userId });
      await auditTenant(req, 'booking.rejected', 'booking_request', id, { ref: row.RefCode }, tx);
      return row;
    });
    if (r.Email) {
      const when = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: req.ctx.timezone }).format(new Date(r.StartAt));
      const h = await db.one('SELECT Name FROM hms.Tenants WHERE TenantId = @tid', { tid: req.ctx.tenantId });
      deliver({ channel: 'email', to: r.Email, template: 'booking_declined', tenantId: req.ctx.tenantId,
        content: templates.email.bookingDeclined({ hospital: h.Name, patientFirst: r.PatientName.split(' ')[0], when, ref: r.RefCode, note: req.body.note }) })
        .catch((e) => console.error('[booking] e-mail failed:', e.message));
    }
    res.json({ data: { ok: true } });
  }));

export default router;
