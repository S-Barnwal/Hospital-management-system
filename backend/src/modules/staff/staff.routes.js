// Doctors, staff, departments and doctor schedules.
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requireTenant, requirePermission } from '../../middleware/auth.js';
import { asyncHandler, notFound, badRequest } from '../../utils/errors.js';
import { db, withTransaction, t } from '../../db/pool.js';
import { parseListQuery, pageMeta } from '../../utils/pagination.js';
import { idParam } from '../../utils/params.js';
import { auditTenant } from '../../utils/audit.js';
import { STAFF_TYPES } from '../../utils/constants.js';

const router = Router();
router.use(requireTenant);

const opt = (schema) => schema.nullable().optional().or(z.literal('').transform(() => null));

// ---------- Departments ----------
router.get('/departments', requirePermission('staff.read'), asyncHandler(async (req, res) => {
  const rows = await db.query(`
    SELECT d.DepartmentId AS id, d.Name AS name, d.Description AS description, d.IsActive AS isActive,
           (SELECT COUNT(*) FROM dbo.StaffMembers s WHERE s.TenantId = d.TenantId AND s.DepartmentId = d.DepartmentId AND s.IsActive = 1) AS staffCount
    FROM dbo.Departments d WHERE d.TenantId = @tid ORDER BY d.Name`, { tid: req.ctx.tenantId });
  res.json({ data: rows });
}));

const deptSchema = z.object({ name: z.string().trim().min(2).max(120), description: opt(z.string().trim().max(300)), isActive: z.boolean().optional() }).strict();

router.post('/departments', requirePermission('departments.manage'), validate(deptSchema), asyncHandler(async (req, res) => {
  const row = await db.one('INSERT INTO dbo.Departments (TenantId, Name, Description) OUTPUT INSERTED.DepartmentId VALUES (@tid, @name, @desc)',
    { tid: req.ctx.tenantId, name: req.body.name, desc: req.body.description ?? null });
  await auditTenant(req, 'department.created', 'department', row.DepartmentId, { name: req.body.name });
  res.status(201).json({ data: { id: row.DepartmentId } });
}));

router.patch('/departments/:id', requirePermission('departments.manage'), validate(deptSchema.partial().strict()), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const n = await db.exec(`UPDATE dbo.Departments SET Name = COALESCE(@name, Name), Description = CASE WHEN @setDesc = 1 THEN @desc ELSE Description END,
                             IsActive = COALESCE(@active, IsActive) WHERE TenantId = @tid AND DepartmentId = @id`,
  { tid: req.ctx.tenantId, id, name: req.body.name ?? null, setDesc: 'description' in req.body, desc: req.body.description ?? null, active: req.body.isActive ?? null });
  if (!n) throw notFound('Department not found.');
  await auditTenant(req, 'department.updated', 'department', id);
  res.json({ data: { ok: true } });
}));

// ---------- Staff & doctors ----------
const STAFF_COLS = `s.StaffId AS id, s.StaffType AS staffType, s.FullName AS fullName, s.Designation AS designation, s.Specialization AS specialization,
  s.RegistrationNumber AS registrationNumber, s.Phone AS phone, s.Email AS email, s.ConsultationFee AS consultationFee, s.IsActive AS isActive,
  s.DepartmentId AS departmentId, d.Name AS departmentName, s.UserId AS userId, s.CreatedAt AS createdAt`;

router.get('/staff', requirePermission('staff.read'), asyncHandler(async (req, res) => {
  const lq = parseListQuery(req.query, { name: 's.FullName', created: 's.CreatedAt' }, 'name');
  const q = req.query.q ? `%${String(req.query.q).trim().slice(0, 100).replace(/[%_[\]]/g, (m) => `[${m}]`)}%` : null;
  const params = {
    tid: req.ctx.tenantId, q, offset: lq.offset, size: lq.pageSize,
    type: STAFF_TYPES.includes(req.query.type) ? req.query.type : null,
    nonDoctor: req.query.type === 'non_doctor',
    dept: req.query.departmentId ? idParam(req.query.departmentId, 'departmentId') : null,
    active: req.query.includeInactive === 'true' ? null : true,
  };
  const where = `WHERE s.TenantId = @tid AND (@type IS NULL OR s.StaffType = @type) AND (@nonDoctor = 0 OR s.StaffType <> 'doctor') AND (@dept IS NULL OR s.DepartmentId = @dept)
    AND (@active IS NULL OR s.IsActive = @active) AND (@q IS NULL OR s.FullName LIKE @q OR s.Specialization LIKE @q OR s.Phone LIKE @q)`;
  const [rows, total] = await db.many(`
    SELECT ${STAFF_COLS} FROM dbo.StaffMembers s LEFT JOIN dbo.Departments d ON d.TenantId = s.TenantId AND d.DepartmentId = s.DepartmentId
    ${where} ORDER BY ${lq.orderBy} OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY;
    SELECT COUNT(*) AS total FROM dbo.StaffMembers s ${where};`, params);
  res.json({ data: rows, meta: pageMeta(lq, total[0].total) });
}));

const staffSchema = z.object({
  staffType: z.enum(STAFF_TYPES),
  fullName: z.string().trim().min(2).max(150),
  departmentId: z.number().int().positive().nullable().optional(),
  designation: opt(z.string().trim().max(100)),
  specialization: opt(z.string().trim().max(150)),
  registrationNumber: opt(z.string().trim().max(60)),
  phone: opt(z.string().trim().regex(/^[+\d][\d\s-]{6,19}$/, 'Enter a valid phone number')),
  email: opt(z.string().trim().toLowerCase().email().max(254)),
  consultationFee: z.number().min(0).max(1e7).nullable().optional(),
  isActive: z.boolean().optional(),
}).strict();

async function assertDepartment(runner, tenantId, departmentId) {
  if (!departmentId) return;
  const d = await runner.one('SELECT 1 AS ok FROM dbo.Departments WHERE TenantId = @tid AND DepartmentId = @id', { tid: tenantId, id: departmentId });
  if (!d) throw badRequest('Department not found.');
}

router.post('/staff', requirePermission('staff.write'), validate(staffSchema), asyncHandler(async (req, res) => {
  const b = req.body;
  await assertDepartment(db, req.ctx.tenantId, b.departmentId);
  const row = await db.one(`
    INSERT INTO dbo.StaffMembers (TenantId, StaffType, FullName, DepartmentId, Designation, Specialization, RegistrationNumber, Phone, Email, ConsultationFee)
    OUTPUT INSERTED.StaffId VALUES (@tid, @type, @name, @dept, @desig, @spec, @reg, @phone, @email, @fee)`,
  { tid: req.ctx.tenantId, type: b.staffType, name: b.fullName, dept: b.departmentId ?? null, desig: b.designation ?? null, spec: b.specialization ?? null,
    reg: b.registrationNumber ?? null, phone: b.phone ?? null, email: b.email ?? null, fee: b.consultationFee == null ? null : t.money(b.consultationFee) });
  await auditTenant(req, 'staff.created', 'staff', row.StaffId, { staffType: b.staffType });
  res.status(201).json({ data: { id: row.StaffId } });
}));

router.get('/staff/:id', requirePermission('staff.read'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const [rows, schedule] = await db.many(`
    SELECT ${STAFF_COLS} FROM dbo.StaffMembers s LEFT JOIN dbo.Departments d ON d.TenantId = s.TenantId AND d.DepartmentId = s.DepartmentId
      WHERE s.TenantId = @tid AND s.StaffId = @id;
    SELECT ScheduleId AS id, DayOfWeek AS dayOfWeek, CONVERT(CHAR(5), StartTime, 108) AS startTime, CONVERT(CHAR(5), EndTime, 108) AS endTime, SlotMinutes AS slotMinutes
      FROM dbo.DoctorSchedules WHERE TenantId = @tid AND StaffId = @id ORDER BY DayOfWeek, StartTime;`, { tid: req.ctx.tenantId, id });
  if (!rows[0]) throw notFound('Staff member not found.');
  res.json({ data: { ...rows[0], schedule } });
}));

router.patch('/staff/:id', requirePermission('staff.write'), validate(staffSchema.partial().strict()), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  await withTransaction(async (tx) => {
    const cur = await tx.one(`SELECT ${STAFF_COLS} FROM dbo.StaffMembers s WITH (UPDLOCK) LEFT JOIN dbo.Departments d ON d.TenantId = s.TenantId AND d.DepartmentId = s.DepartmentId
                              WHERE s.TenantId = @tid AND s.StaffId = @id`, { tid: req.ctx.tenantId, id });
    if (!cur) throw notFound('Staff member not found.');
    const m = { ...cur, ...req.body };
    await assertDepartment(tx, req.ctx.tenantId, m.departmentId);
    await tx.exec(`
      UPDATE dbo.StaffMembers SET StaffType = @type, FullName = @name, DepartmentId = @dept, Designation = @desig, Specialization = @spec,
        RegistrationNumber = @reg, Phone = @phone, Email = @email, ConsultationFee = @fee, IsActive = @active, UpdatedAt = SYSUTCDATETIME()
      WHERE TenantId = @tid AND StaffId = @id`,
    { tid: req.ctx.tenantId, id, type: m.staffType, name: m.fullName, dept: m.departmentId ?? null, desig: m.designation ?? null, spec: m.specialization ?? null,
      reg: m.registrationNumber ?? null, phone: m.phone ?? null, email: m.email ?? null, fee: m.consultationFee == null ? null : t.money(m.consultationFee), active: Boolean(m.isActive) });
    await auditTenant(req, 'staff.updated', 'staff', id, { fields: Object.keys(req.body).join(',') }, tx);
  });
  res.json({ data: { ok: true } });
}));

/** Replaces a doctor's weekly schedule in one transaction. */
router.put('/staff/:id/schedule', requirePermission('staff.write'),
  validate(z.object({
    blocks: z.array(z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      slotMinutes: z.number().int().min(5).max(240).default(15),
    }).strict().refine((b) => b.endTime > b.startTime, 'End time must be after start time')).max(50),
  }).strict()),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const blocks = req.body.blocks;
    for (const a of blocks) {
      for (const b of blocks) {
        if (a !== b && a.dayOfWeek === b.dayOfWeek && a.startTime < b.endTime && b.startTime < a.endTime) throw badRequest('Schedule blocks overlap on the same day.');
      }
    }
    await withTransaction(async (tx) => {
      const doc = await tx.one(`SELECT StaffId FROM dbo.StaffMembers WHERE TenantId = @tid AND StaffId = @id AND StaffType = 'doctor'`, { tid: req.ctx.tenantId, id });
      if (!doc) throw notFound('Doctor not found.');
      await tx.exec('DELETE FROM dbo.DoctorSchedules WHERE TenantId = @tid AND StaffId = @id', { tid: req.ctx.tenantId, id });
      for (const b of blocks) {
        await tx.exec(`INSERT INTO dbo.DoctorSchedules (TenantId, StaffId, DayOfWeek, StartTime, EndTime, SlotMinutes)
                       VALUES (@tid, @id, @dow, CAST(@st AS TIME), CAST(@et AS TIME), @slot)`,
        { tid: req.ctx.tenantId, id, dow: b.dayOfWeek, st: `${b.startTime}:00`, et: `${b.endTime}:00`, slot: b.slotMinutes });
      }
      await auditTenant(req, 'staff.schedule_updated', 'staff', id, { blocks: blocks.length }, tx);
    });
    res.json({ data: { ok: true } });
  }));

export default router;
