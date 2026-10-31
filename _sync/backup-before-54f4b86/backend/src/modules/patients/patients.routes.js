import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requireTenant, requirePermission } from '../../middleware/auth.js';
import { asyncHandler, notFound } from '../../utils/errors.js';
import { db, withTransaction, t } from '../../db/pool.js';
import { parseListQuery, pageMeta } from '../../utils/pagination.js';
import { idParam } from '../../utils/params.js';
import { auditTenant } from '../../utils/audit.js';
import { nextSequence, formatNumber } from '../tenants/sequences.js';
import { optionalPhone, optionalEmail, withLocation } from '../../utils/contact.js';

const router = Router();
router.use(requireTenant);

const opt = (schema) => schema.nullable().optional().or(z.literal('').transform(() => null));
const patientBase = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: opt(z.string().trim().max(100)),
  gender: opt(z.enum(['male', 'female', 'other', 'unknown'])),
  dateOfBirth: opt(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => new Date(d) <= new Date() && new Date(d) > new Date('1900-01-01'), 'Invalid date of birth')),
  phone: optionalPhone,
  email: optionalEmail,
  addressLine: opt(z.string().trim().max(300)),
  bloodGroup: opt(z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'])),
  emergencyContactName: opt(z.string().trim().max(150)),
  emergencyContactPhone: optionalPhone,
}).strict();
export const patientSchema = withLocation(patientBase);

const toParams = (b) => ({
  first: b.firstName, last: b.lastName ?? null, gender: b.gender ?? null, dob: b.dateOfBirth ? t.date(new Date(`${b.dateOfBirth}T00:00:00Z`)) : null,
  phone: b.phone ?? null, email: b.email ?? null, addr: b.addressLine ?? null, city: b.city ?? null, state: b.state ?? null, country: b.country ?? null, blood: b.bloodGroup ?? null,
  ecName: b.emergencyContactName ?? null, ecPhone: b.emergencyContactPhone ?? null,
});

const SELECT_COLS = `PatientId AS id, PatientNumber AS patientNumber, FirstName AS firstName, LastName AS lastName, Gender AS gender,
  CONVERT(CHAR(10), DateOfBirth, 23) AS dateOfBirth, Phone AS phone, Email AS email, AddressLine AS addressLine, City AS city, State AS state, Country AS country,
  BloodGroup AS bloodGroup, EmergencyContactName AS emergencyContactName, EmergencyContactPhone AS emergencyContactPhone,
  IsArchived AS isArchived, CreatedAt AS createdAt, UpdatedAt AS updatedAt`;

router.get('/', requirePermission('patients.read'), asyncHandler(async (req, res) => {
  const lq = parseListQuery(req.query, { created: 'CreatedAt', name: 'FirstName', number: 'PatientNumber' }, 'created');
  const q = req.query.q ? String(req.query.q).trim().slice(0, 100) : null;
  const params = {
    tid: req.ctx.tenantId, offset: lq.offset, size: lq.pageSize,
    q: q ? `%${q.replace(/[%_[\]]/g, (m) => `[${m}]`)}%` : null,
    archived: req.query.archived === 'true',
  };
  const where = `WHERE TenantId = @tid AND IsArchived = @archived
    AND (@q IS NULL OR PatientNumber LIKE @q OR Phone LIKE @q OR FirstName LIKE @q OR LastName LIKE @q OR (FirstName + ' ' + ISNULL(LastName, '')) LIKE @q)`;
  const [rows, total] = await db.many(`/* tenant-safe: TenantId filter is inside ${where} */ 
    SELECT ${SELECT_COLS} FROM hms.Patients ${where} ORDER BY ${lq.orderBy} OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY;
    SELECT COUNT(*) AS total FROM hms.Patients ${where};`, params);
  res.json({ data: rows, meta: pageMeta(lq, total[0].total) });
}));

/** Last 10 digits of a phone number, so "+91 98765-43210" and "9876543210" match. */
const phoneKey = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 8 ? d.slice(-10) : null; };

/** Duplicate detection: same mobile number (any formatting), or same name + date of birth, within this hospital only. */
router.post('/check-duplicates', requirePermission('patients.write'),
  validate(z.object({ firstName: z.string().trim().max(100).optional(), lastName: z.string().trim().max(100).optional(),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), phone: z.string().trim().max(30).optional() }).strict()),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const rows = await db.query(`
      SELECT TOP 5 ${SELECT_COLS} FROM hms.Patients
      WHERE TenantId = @tid AND IsArchived = 0 AND (
        (@phone10 IS NOT NULL AND RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(Phone, ' ', ''), '-', ''), '+', ''), '(', ''), 10) = @phone10) OR
        (@dob IS NOT NULL AND DateOfBirth = @dob AND FirstName = @first AND ISNULL(LastName, '') = ISNULL(@last, '')))`,
    { tid: req.ctx.tenantId, phone10: phoneKey(b.phone), dob: b.dateOfBirth ? t.date(new Date(`${b.dateOfBirth}T00:00:00Z`)) : null, first: b.firstName ?? '', last: b.lastName ?? null });
    res.json({ data: rows });
  }));

router.post('/', requirePermission('patients.write'), validate(patientSchema), asyncHandler(async (req, res) => {
  const created = await withTransaction(async (tx) => {
    const prefix = (await tx.one(`SELECT SettingValue FROM hms.TenantSettings WHERE TenantId = @tid AND SettingKey = 'patient.number_prefix'`,
      { tid: req.ctx.tenantId }))?.SettingValue || 'PT';
    const n = await nextSequence(tx, req.ctx.tenantId, 'patient');
    const row = await tx.one(`
      INSERT INTO hms.Patients (TenantId, PatientNumber, FirstName, LastName, Gender, DateOfBirth, Phone, Email, AddressLine, City, State, Country, BloodGroup,
        EmergencyContactName, EmergencyContactPhone, CreatedByUserId)
      OUTPUT INSERTED.PatientId, INSERTED.PatientNumber
      VALUES (@tid, @num, @first, @last, @gender, @dob, @phone, @email, @addr, @city, @state, @country, @blood, @ecName, @ecPhone, @uid)`,
    { tid: req.ctx.tenantId, uid: req.ctx.userId, num: formatNumber(prefix, n), ...toParams(req.body) });
    await auditTenant(req, 'patient.created', 'patient', row.PatientId, { patientNumber: row.PatientNumber }, tx);
    return row;
  });
  res.status(201).json({ data: { id: created.PatientId, patientNumber: created.PatientNumber } });
}));

router.get('/:id', requirePermission('patients.read'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const [rows, appts] = await db.many(`
    SELECT ${SELECT_COLS} FROM hms.Patients WHERE TenantId = @tid AND PatientId = @id;
    SELECT TOP 50 a.AppointmentId AS id, a.AppointmentNumber AS number, a.StartAt AS startAt, a.Status AS status, a.VisitType AS visitType,
           a.Reason AS reason, s.FullName AS doctorName, d.Name AS departmentName
    FROM hms.Appointments a
    JOIN hms.StaffMembers s ON s.TenantId = a.TenantId AND s.StaffId = a.DoctorId
    LEFT JOIN hms.Departments d ON d.TenantId = a.TenantId AND d.DepartmentId = a.DepartmentId
    WHERE a.TenantId = @tid AND a.PatientId = @id ORDER BY a.StartAt DESC;`, { tid: req.ctx.tenantId, id });
  // Same 404 whether the record is missing or belongs to another hospital (no existence leak).
  if (!rows[0]) throw notFound('Patient not found.');
  await auditTenant(req, 'patient.viewed', 'patient', id);
  res.json({ data: { ...rows[0], appointments: appts } });
}));

router.patch('/:id', requirePermission('patients.write'), validate(withLocation(patientBase.partial())), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  await withTransaction(async (tx) => {
    const cur = await tx.one(`SELECT ${SELECT_COLS} FROM hms.Patients WITH (UPDLOCK) WHERE TenantId = @tid AND PatientId = @id`, { tid: req.ctx.tenantId, id });
    if (!cur) throw notFound('Patient not found.');
    const merged = { ...cur, ...req.body };
    await tx.exec(`
      UPDATE hms.Patients SET FirstName = @first, LastName = @last, Gender = @gender, DateOfBirth = @dob, Phone = @phone, Email = @email,
        AddressLine = @addr, City = @city, State = @state, Country = @country, BloodGroup = @blood, EmergencyContactName = @ecName, EmergencyContactPhone = @ecPhone, UpdatedAt = SYSUTCDATETIME()
      WHERE TenantId = @tid AND PatientId = @id`, { tid: req.ctx.tenantId, id, ...toParams(merged) });
    await auditTenant(req, 'patient.updated', 'patient', id, { fields: Object.keys(req.body).join(',') }, tx);
  });
  res.json({ data: { ok: true } });
}));

router.post('/:id/archive', requirePermission('patients.archive'),
  validate(z.object({ archived: z.boolean() }).strict()),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const n = await db.exec(`UPDATE hms.Patients SET IsArchived = @a, ArchivedAt = CASE WHEN @a = 1 THEN SYSUTCDATETIME() ELSE NULL END, UpdatedAt = SYSUTCDATETIME()
                             WHERE TenantId = @tid AND PatientId = @id`, { tid: req.ctx.tenantId, id, a: req.body.archived });
    if (!n) throw notFound('Patient not found.');
    await auditTenant(req, req.body.archived ? 'patient.archived' : 'patient.restored', 'patient', id);
    res.json({ data: { ok: true } });
  }));

export default router;
