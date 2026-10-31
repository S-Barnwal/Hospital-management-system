// Public online booking (/api/v1/public/booking/:slug). Only works when the hospital switched it on in Settings.
// Patients REQUEST a slot; the hospital confirms it (that is when the patient record and appointment are created), so
// nothing from the public page ever touches existing patient records, and no patient data is ever returned here.
import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, badRequest, conflict, notFound } from '../../utils/errors.js';
import { db, withTransaction } from '../../db/pool.js';
import { phoneSchema, optionalEmail } from '../../utils/contact.js';
import { sha256Hex } from '../../utils/crypto.js';
import { localDateString, localToUtc } from '../../utils/time.js';
import { config } from '../../config/env.js';
import { deliver, templates } from '../../notify/index.js';
import { bookingDateAllowed, makeRefCode } from '../clinical/phase4.logic.js';
import { bookingEnabled, slotsFor } from './booking.service.js';

const router = Router();
const readLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false });
const submitLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many booking requests from this network. Please call the hospital.' } } });
const MAX_DAYS = 30;

async function hospitalBySlug(slug) {
  if (!/^[a-z0-9-]{3,63}$/.test(String(slug || ''))) throw notFound('Hospital not found.');
  const h = await db.one(`/* tenant-safe: public lookup of the hospital by its workspace name */
    SELECT TenantId, Name, City, Phone, Timezone, Status FROM hms.Tenants WHERE Slug = @slug`, { slug });
  if (!h || h.Status !== 'active' || !(await bookingEnabled(h.TenantId))) throw notFound('Online booking is not available for this hospital.');
  return h;
}

async function bookableDoctor(tenantId, doctorId) {
  return db.one(`SELECT s.StaffId, s.FullName FROM hms.StaffMembers s
                 WHERE s.TenantId = @tid AND s.StaffId = @id AND s.StaffType = 'doctor' AND s.IsActive = 1
                   AND EXISTS (SELECT 1 FROM hms.DoctorSchedules d WHERE d.TenantId = s.TenantId AND d.StaffId = s.StaffId)`, { tid: tenantId, id: doctorId });
}

router.get('/:slug', readLimiter, asyncHandler(async (req, res) => {
  const h = await hospitalBySlug(req.params.slug);
  const [doctors, settings] = await db.many(`
    SELECT s.StaffId AS id, s.FullName AS name, s.Specialization AS specialization, d.Name AS department, s.ConsultationFee AS fee
    FROM hms.StaffMembers s LEFT JOIN hms.Departments d ON d.TenantId = s.TenantId AND d.DepartmentId = s.DepartmentId
    WHERE s.TenantId = @tid AND s.StaffType = 'doctor' AND s.IsActive = 1
      AND EXISTS (SELECT 1 FROM hms.DoctorSchedules x WHERE x.TenantId = s.TenantId AND x.StaffId = s.StaffId)
    ORDER BY d.Name, s.FullName;
    SELECT SettingKey, SettingValue FROM hms.TenantSettings WHERE TenantId = @tid AND SettingKey IN ('booking.notice', 'hospital.address');`, { tid: h.TenantId });
  const s = Object.fromEntries(settings.map((x) => [x.SettingKey, x.SettingValue]));
  res.set('Cache-Control', 'no-store');
  res.json({ data: { hospital: { name: h.Name, city: h.City, phone: h.Phone, address: s['hospital.address'] ?? null }, notice: s['booking.notice'] ?? null,
    doctors, today: localDateString(h.Timezone), maxDays: MAX_DAYS, timezone: h.Timezone } });
}));

router.get('/:slug/slots', readLimiter, asyncHandler(async (req, res) => {
  const h = await hospitalBySlug(req.params.slug);
  const doctorId = Number(req.query.doctorId);
  const date = String(req.query.date || '');
  if (!Number.isInteger(doctorId) || doctorId <= 0) throw badRequest('Choose a doctor.');
  if (!bookingDateAllowed(date, localDateString(h.Timezone), MAX_DAYS)) throw badRequest(`Choose a date within the next ${MAX_DAYS} days.`);
  if (!(await bookableDoctor(h.TenantId, doctorId))) throw notFound('Doctor not available for online booking.');
  const { slots } = await slotsFor(h.TenantId, h.Timezone, doctorId, date);
  res.json({ data: { date, slots } });
}));

router.post('/:slug', submitLimiter,
  validate(z.object({
    doctorId: z.coerce.number().int().positive(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    name: z.string().trim().min(2, 'Enter the patient\'s name.').max(150), phone: phoneSchema, email: optionalEmail,
    gender: z.enum(['female', 'male', 'other']).optional(), age: z.coerce.number().int().min(0).max(120).optional(),
    reason: z.string().trim().max(300).optional(), website: z.string().max(0, 'Spam detected').optional(), consent: z.literal(true, { errorMap: () => ({ message: 'Please agree to be contacted about this appointment.' }) }),
  }).strict()),
  asyncHandler(async (req, res) => {
    const h = await hospitalBySlug(req.params.slug);
    const b = req.body;
    if (!bookingDateAllowed(b.date, localDateString(h.Timezone), MAX_DAYS)) throw badRequest(`Choose a date within the next ${MAX_DAYS} days.`);
    const doctor = await bookableDoctor(h.TenantId, b.doctorId);
    if (!doctor) throw notFound('Doctor not available for online booking.');
    const out = await withTransaction(async (tx) => {
      const open = await tx.one(`SELECT COUNT(*) AS n FROM hms.OnlineBookingRequests WITH (UPDLOCK, HOLDLOCK) WHERE TenantId = @tid AND Phone = @p AND Status = 'pending'`,
        { tid: h.TenantId, p: b.phone });
      if (open.n >= 3) throw conflict('This phone number already has 3 requests waiting. The hospital will contact you.', 'TOO_MANY_PENDING');
      const { slots, slotMinutes } = await slotsFor(h.TenantId, h.Timezone, b.doctorId, b.date);
      if (!slots.includes(b.time)) throw conflict('Sorry, that time was just taken. Please choose another slot.', 'SLOT_TAKEN');
      const startAt = localToUtc(h.Timezone, b.date, b.time);
      let ref = makeRefCode();
      for (let i = 0; i < 3 && (await tx.one('SELECT 1 AS x FROM hms.OnlineBookingRequests WHERE TenantId = @tid AND RefCode = @r', { tid: h.TenantId, r: ref })); i += 1) ref = makeRefCode();
      await tx.exec(`INSERT INTO hms.OnlineBookingRequests (TenantId, RefCode, DoctorId, StartAt, DurationMinutes, PatientName, Phone, Email, Gender, AgeYears, Reason, IpHash)
                     VALUES (@tid, @ref, @doc, @start, @dur, @name, @phone, @email, @g, @age, @reason, @ip)`,
      { tid: h.TenantId, ref, doc: b.doctorId, start: startAt, dur: slotMinutes, name: b.name, phone: b.phone, email: b.email ?? null, g: b.gender ?? null,
        age: b.age ?? null, reason: b.reason ?? null, ip: sha256Hex(`${config.jwtSecret}:${req.ip}`) });
      await tx.exec(`INSERT INTO hms.Notifications (TenantId, UserId, Type, Title, Body) VALUES (@tid, NULL, 'online_booking', @t, @body)`,
        { tid: h.TenantId, t: `New online booking request ${ref}`, body: `${doctor.FullName} · ${b.date} ${b.time}. Confirm it under Appointments → Online requests.` });
      return { ref, startAt };
    });
    const when = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: h.Timezone }).format(out.startAt);
    if (b.email) {
      deliver({ channel: 'email', to: b.email, template: 'booking_received', tenantId: h.TenantId,
        content: templates.email.bookingReceived({ hospital: h.Name, patientFirst: b.name.split(' ')[0], doctor: doctor.FullName, when, ref: out.ref }) })
        .catch((e) => console.error('[booking] e-mail failed:', e.message));
    }
    res.status(201).json({ data: { ref: out.ref, when, doctor: doctor.FullName, hospital: h.Name, status: 'pending' } });
  }));

export default router;
