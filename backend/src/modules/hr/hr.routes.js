// HR: daily attendance, leave requests and monthly payroll (payslips paid as a "Salaries" expense).
// Nested inside staff.routes.js under /api/v1/hr (hospital session already checked). Salaries are visible only with
// hr.payroll — never through the normal staff list. Every query is scoped by TenantId.
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requirePermission, requireAnyPermission } from '../../middleware/auth.js';
import { asyncHandler, badRequest, conflict, notFound, unauthorized } from '../../utils/errors.js';
import { db, withTransaction, t } from '../../db/pool.js';
import { idParam } from '../../utils/params.js';
import { auditTenant } from '../../utils/audit.js';
import { localDateString } from '../../utils/time.js';
import { nextSequence, formatNumber } from '../tenants/sequences.js';
import { computePayroll, daysInMonth, inclusiveDays } from '../clinical/phase3.logic.js';

const router = Router();
router.use((req, _res, next) => (req.ctx?.tenantId ? next() : next(unauthorized())));

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const ym = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');
const hhmm = z.union([z.literal('').transform(() => null), z.null(), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')]).optional();
const ATT = ['present', 'absent', 'half_day', 'leave', 'holiday', 'week_off'];
const monthRange = (m) => ({ start: `${m}-01`, end: `${m}-${String(daysInMonth(m)).padStart(2, '0')}` });
const asDate = (s) => t.date(new Date(`${s}T00:00:00Z`));

// ---------- Attendance ----------
router.get('/attendance', requireAnyPermission('hr.attendance', 'staff.read'), asyncHandler(async (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : localDateString(req.ctx.timezone);
  const rows = await db.query(`
    SELECT s.StaffId AS staffId, s.FullName AS fullName, s.StaffType AS staffType, s.Designation AS designation,
           a.Status AS status, CONVERT(CHAR(5), a.CheckIn, 108) AS checkIn, CONVERT(CHAR(5), a.CheckOut, 108) AS checkOut, a.Notes AS notes,
           (SELECT TOP 1 l.LeaveType FROM hms.LeaveRequests l WHERE l.TenantId = s.TenantId AND l.StaffId = s.StaffId AND l.Status = 'approved'
              AND CAST(@d AS DATE) BETWEEN l.FromDate AND l.ToDate) AS approvedLeave
    FROM hms.StaffMembers s
    LEFT JOIN hms.StaffAttendance a ON a.TenantId = s.TenantId AND a.StaffId = s.StaffId AND a.WorkDate = CAST(@d AS DATE)
    WHERE s.TenantId = @tid AND s.IsActive = 1 ORDER BY s.FullName`, { tid: req.ctx.tenantId, d: date });
  res.json({ data: rows, meta: { date, today: localDateString(req.ctx.timezone) } });
}));

router.put('/attendance', requirePermission('hr.attendance'),
  validate(z.object({
    date: ymd,
    entries: z.array(z.object({ staffId: z.coerce.number().int().positive(), status: z.enum(ATT), checkIn: hhmm, checkOut: hhmm, notes: z.string().trim().max(200).nullable().optional() }).strict()).min(1).max(500),
  }).strict()),
  asyncHandler(async (req, res) => {
    const { date, entries } = req.body;
    if (date > localDateString(req.ctx.timezone)) throw badRequest('Attendance cannot be marked for a future date.');
    await withTransaction(async (tx) => {
      const ids = entries.map((e) => e.staffId).join(',');
      const ok = await tx.one(`SELECT COUNT(*) AS n FROM hms.StaffMembers WHERE TenantId = @tid AND StaffId IN (SELECT CAST(value AS BIGINT) FROM STRING_SPLIT(@ids, ','))`, { tid: req.ctx.tenantId, ids });
      if (ok.n !== new Set(entries.map((e) => e.staffId)).size) throw badRequest('One or more staff members were not found.');
      for (const e of entries) {
        await tx.exec(`MERGE hms.StaffAttendance AS tgt USING (SELECT @tid AS TenantId, @sid AS StaffId, CAST(@d AS DATE) AS WorkDate) AS src
                         ON tgt.TenantId = src.TenantId AND tgt.StaffId = src.StaffId AND tgt.WorkDate = src.WorkDate
                       WHEN MATCHED THEN UPDATE SET Status = @s, CheckIn = CAST(@in AS TIME), CheckOut = CAST(@out AS TIME), Notes = @n, MarkedByUserId = @uid, UpdatedAt = SYSUTCDATETIME()
                       WHEN NOT MATCHED THEN INSERT (TenantId, StaffId, WorkDate, Status, CheckIn, CheckOut, Notes, MarkedByUserId)
                         VALUES (@tid, @sid, CAST(@d AS DATE), @s, CAST(@in AS TIME), CAST(@out AS TIME), @n, @uid);`,
        { tid: req.ctx.tenantId, sid: e.staffId, d: date, s: e.status, in: e.checkIn ?? null, out: e.checkOut ?? null, n: e.notes ?? null, uid: req.ctx.userId });
      }
      await auditTenant(req, 'attendance.marked', 'staff', null, { date, count: entries.length }, tx);
    });
    res.json({ data: { ok: true } });
  }));

async function monthSummary(tenantId, month) {
  const { start, end } = monthRange(month);
  return db.query(`
    SELECT s.StaffId AS staffId, s.FullName AS fullName, s.StaffType AS staffType,
           SUM(CASE WHEN a.Status = 'present' THEN 1 ELSE 0 END) AS [present], SUM(CASE WHEN a.Status = 'absent' THEN 1 ELSE 0 END) AS [absent],
           SUM(CASE WHEN a.Status = 'half_day' THEN 1 ELSE 0 END) AS [half_day], SUM(CASE WHEN a.Status = 'leave' THEN 1 ELSE 0 END) AS [leave],
           SUM(CASE WHEN a.Status IN ('holiday','week_off') THEN 1 ELSE 0 END) AS [off], COUNT(a.AttendanceId) AS marked,
           ISNULL((SELECT SUM(CASE WHEN l.Days = 0.5 THEN 0.5 ELSE DATEDIFF(DAY, CASE WHEN l.FromDate > @start THEN l.FromDate ELSE CAST(@start AS DATE) END,
                                            CASE WHEN l.ToDate < @end THEN l.ToDate ELSE CAST(@end AS DATE) END) + 1 END)
                   FROM hms.LeaveRequests l WHERE l.TenantId = s.TenantId AND l.StaffId = s.StaffId AND l.Status = 'approved' AND l.LeaveType = 'unpaid'
                     AND l.FromDate <= @end AND l.ToDate >= @start), 0) AS unpaidLeave
    FROM hms.StaffMembers s
    LEFT JOIN hms.StaffAttendance a ON a.TenantId = s.TenantId AND a.StaffId = s.StaffId AND a.WorkDate BETWEEN @start AND @end
    WHERE s.TenantId = @tid AND s.IsActive = 1
    GROUP BY s.TenantId, s.StaffId, s.FullName, s.StaffType ORDER BY s.FullName`, { tid: tenantId, start: asDate(start), end: asDate(end) });
}

router.get('/attendance/summary', requireAnyPermission('hr.attendance', 'hr.payroll'), asyncHandler(async (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : localDateString(req.ctx.timezone).slice(0, 7);
  res.json({ data: await monthSummary(req.ctx.tenantId, month), meta: { month, days: daysInMonth(month) } });
}));

// ---------- Leave ----------
router.get('/leaves', requireAnyPermission('hr.attendance', 'hr.leave'), asyncHandler(async (req, res) => {
  const status = ['pending', 'approved', 'rejected', 'cancelled'].includes(req.query.status) ? req.query.status : null;
  const rows = await db.query(`
    SELECT TOP 300 l.LeaveId AS id, l.StaffId AS staffId, s.FullName AS staffName, l.LeaveType AS leaveType, CONVERT(CHAR(10), l.FromDate, 23) AS fromDate,
           CONVERT(CHAR(10), l.ToDate, 23) AS toDate, l.Days AS days, l.Reason AS reason, l.Status AS status, l.DecisionNote AS decisionNote,
           l.DecidedAt AS decidedAt, d.FullName AS decidedBy, l.CreatedAt AS createdAt
    FROM hms.LeaveRequests l JOIN hms.StaffMembers s ON s.TenantId = l.TenantId AND s.StaffId = l.StaffId
    LEFT JOIN hms.Users d ON d.TenantId = l.TenantId AND d.UserId = l.DecidedByUserId
    WHERE l.TenantId = @tid AND (@status IS NULL OR l.Status = @status)
    ORDER BY CASE l.Status WHEN 'pending' THEN 0 ELSE 1 END, l.FromDate DESC`, { tid: req.ctx.tenantId, status });
  res.json({ data: rows });
}));

router.post('/leaves', requireAnyPermission('hr.attendance', 'hr.leave'),
  validate(z.object({
    staffId: z.coerce.number().int().positive(), leaveType: z.enum(['casual', 'sick', 'earned', 'unpaid', 'other']),
    fromDate: ymd, toDate: ymd, halfDay: z.boolean().optional(), reason: z.string().trim().max(300).optional(),
  }).strict().refine((v) => v.toDate >= v.fromDate, { message: 'End date must be on or after the start date.', path: ['toDate'] })
    .refine((v) => !v.halfDay || v.fromDate === v.toDate, { message: 'A half day is a single date.', path: ['halfDay'] })),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const days = b.halfDay ? 0.5 : inclusiveDays(b.fromDate, b.toDate);
    if (days > 120) throw badRequest('A single leave request can cover at most 120 days.');
    const out = await withTransaction(async (tx) => {
      if (!(await tx.one('SELECT 1 AS ok FROM hms.StaffMembers WHERE TenantId = @tid AND StaffId = @id', { tid: req.ctx.tenantId, id: b.staffId }))) throw badRequest('Staff member not found.');
      const overlap = await tx.one(`SELECT TOP 1 LeaveId FROM hms.LeaveRequests WITH (UPDLOCK, HOLDLOCK) WHERE TenantId = @tid AND StaffId = @sid AND Status IN ('pending','approved')
                                    AND FromDate <= CAST(@to AS DATE) AND ToDate >= CAST(@from AS DATE)`, { tid: req.ctx.tenantId, sid: b.staffId, from: b.fromDate, to: b.toDate });
      if (overlap) throw conflict('This person already has leave requested or approved on these dates.', 'LEAVE_OVERLAP');
      const r = await tx.one(`INSERT INTO hms.LeaveRequests (TenantId, StaffId, LeaveType, FromDate, ToDate, Days, Reason, CreatedByUserId)
                              OUTPUT INSERTED.LeaveId VALUES (@tid, @sid, @type, CAST(@from AS DATE), CAST(@to AS DATE), @days, @reason, @uid)`,
      { tid: req.ctx.tenantId, sid: b.staffId, type: b.leaveType, from: b.fromDate, to: b.toDate, days: t.dec(days, 5, 1), reason: b.reason || null, uid: req.ctx.userId });
      await auditTenant(req, 'leave.requested', 'staff', b.staffId, { days, type: b.leaveType }, tx);
      return { id: r.LeaveId, days };
    });
    res.status(201).json({ data: out });
  }));

router.post('/leaves/:id/decide', requirePermission('hr.leave'),
  validate(z.object({ status: z.enum(['approved', 'rejected']), note: z.string().trim().max(300).optional() }).strict()),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    await withTransaction(async (tx) => {
      const l = await tx.one(`SELECT StaffId, Status, CONVERT(CHAR(10), FromDate, 23) AS FromDate, CONVERT(CHAR(10), ToDate, 23) AS ToDate, Days
                              FROM hms.LeaveRequests WITH (UPDLOCK) WHERE TenantId = @tid AND LeaveId = @id`, { tid: req.ctx.tenantId, id });
      if (!l) throw notFound('Leave request not found.');
      if (l.Status !== 'pending') throw conflict(`This request is already ${l.Status}.`, 'LEAVE_STATE');
      await tx.exec(`UPDATE hms.LeaveRequests SET Status = @s, DecidedByUserId = @uid, DecidedAt = SYSUTCDATETIME(), DecisionNote = @n WHERE TenantId = @tid AND LeaveId = @id`,
        { tid: req.ctx.tenantId, id, s: req.body.status, uid: req.ctx.userId, n: req.body.note || null });
      if (req.body.status === 'approved') {
        // Mark the days as leave (never overwrite a day already marked). A half day is marked 'leave' too: pay is reduced only
        // through approved *unpaid* leave (counted from LeaveRequests, 0.5 for a half day), so paid half days never cost salary.
        const status = 'leave';
        await tx.exec(`
          WITH d AS (SELECT CAST(@from AS DATE) AS dt UNION ALL SELECT DATEADD(DAY, 1, dt) FROM d WHERE dt < CAST(@to AS DATE))
          INSERT INTO hms.StaffAttendance (TenantId, StaffId, WorkDate, Status, Notes, MarkedByUserId)
          SELECT @tid, @sid, d.dt, @s, CASE WHEN @half = 1 THEN N'Approved half-day leave' ELSE N'Approved leave' END, @uid FROM d
          WHERE NOT EXISTS (SELECT 1 FROM hms.StaffAttendance a WHERE a.TenantId = @tid AND a.StaffId = @sid AND a.WorkDate = d.dt)
          OPTION (MAXRECURSION 200);`, { tid: req.ctx.tenantId, sid: l.StaffId, from: l.FromDate, to: l.ToDate, s: status, half: Number(l.Days) === 0.5 ? 1 : 0, uid: req.ctx.userId });
      }
      await auditTenant(req, `leave.${req.body.status}`, 'staff', l.StaffId, { leaveId: id }, tx);
    });
    res.json({ data: { ok: true } });
  }));

router.post('/leaves/:id/cancel', requireAnyPermission('hr.attendance', 'hr.leave'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const n = await db.exec(`UPDATE hms.LeaveRequests SET Status = 'cancelled' WHERE TenantId = @tid AND LeaveId = @id AND Status = 'pending'`, { tid: req.ctx.tenantId, id });
  if (!n) throw conflict('Only a pending request can be cancelled.', 'LEAVE_STATE');
  await auditTenant(req, 'leave.cancelled', 'leave', id);
  res.json({ data: { ok: true } });
}));

// ---------- Payroll ----------
router.put('/staff/:id/salary', requirePermission('hr.payroll'),
  validate(z.object({ monthlySalary: z.union([z.null(), z.coerce.number().min(0).max(1e8)]) }).strict()),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const n = await db.exec('UPDATE hms.StaffMembers SET MonthlySalary = @s, UpdatedAt = SYSUTCDATETIME() WHERE TenantId = @tid AND StaffId = @id',
      { tid: req.ctx.tenantId, id, s: req.body.monthlySalary === null ? null : t.money(req.body.monthlySalary.toFixed(2)) });
    if (!n) throw notFound('Staff member not found.');
    await auditTenant(req, 'staff.salary_set', 'staff', id); // amount deliberately not written to the audit log
    res.json({ data: { ok: true } });
  }));

router.get('/payroll', requirePermission('hr.payroll'), asyncHandler(async (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : localDateString(req.ctx.timezone).slice(0, 7);
  const [summary, staff, runs] = await Promise.all([
    monthSummary(req.ctx.tenantId, month),
    db.query('SELECT StaffId AS staffId, MonthlySalary AS monthlySalary, Designation AS designation FROM hms.StaffMembers WHERE TenantId = @tid AND IsActive = 1', { tid: req.ctx.tenantId }),
    db.query(`SELECT PayrollId AS id, StaffId AS staffId, PaidDays AS paidDays, Gross AS gross, Allowances AS allowances, Deductions AS deductions, NetPay AS net,
                     Status AS status, PaidAt AS paidAt, PaymentMethod AS paymentMethod, Notes AS notes
              FROM hms.PayrollRuns WHERE TenantId = @tid AND PayMonth = @m`, { tid: req.ctx.tenantId, m: month }),
  ]);
  const sal = new Map(staff.map((s) => [Number(s.staffId), s]));
  const run = new Map(runs.map((r) => [Number(r.staffId), r]));
  const rows = summary.map((s) => {
    const salary = sal.get(Number(s.staffId))?.monthlySalary;
    const preview = salary == null ? null : computePayroll({ monthlySalary: salary, month, attendance: s, unpaidLeaveDays: s.unpaidLeave });
    return { ...s, designation: sal.get(Number(s.staffId))?.designation ?? null, monthlySalary: salary, preview, run: run.get(Number(s.staffId)) ?? null };
  });
  res.json({ data: rows, meta: { month, days: daysInMonth(month) } });
}));

router.post('/payroll/generate', requirePermission('hr.payroll'), validate(z.object({ month: ym }).strict()), asyncHandler(async (req, res) => {
  const { month } = req.body;
  if (month > localDateString(req.ctx.timezone).slice(0, 7)) throw badRequest('Payroll cannot be prepared for a future month.');
  const summary = await monthSummary(req.ctx.tenantId, month);
  const created = await withTransaction(async (tx) => {
    let n = 0;
    for (const s of summary) {
      const staff = await tx.one('SELECT MonthlySalary FROM hms.StaffMembers WHERE TenantId = @tid AND StaffId = @sid', { tid: req.ctx.tenantId, sid: s.staffId });
      if (staff?.MonthlySalary == null) continue;
      const existing = await tx.one('SELECT PayrollId, Status, Allowances, Deductions FROM hms.PayrollRuns WITH (UPDLOCK, HOLDLOCK) WHERE TenantId = @tid AND StaffId = @sid AND PayMonth = @m',
        { tid: req.ctx.tenantId, sid: s.staffId, m: month });
      if (existing?.Status === 'paid') continue; // paid payslips are final
      const p = computePayroll({ monthlySalary: staff.MonthlySalary, month, attendance: s, unpaidLeaveDays: s.unpaidLeave,
        allowances: existing?.Allowances ?? 0, deductions: existing?.Deductions ?? 0 });
      const params = { tid: req.ctx.tenantId, sid: s.staffId, m: month, days: p.daysInMonth, paid: t.dec(p.paidDays, 5, 1), sal: t.money(Number(staff.MonthlySalary).toFixed(2)),
        gross: t.money(p.gross), net: t.money(p.net), uid: req.ctx.userId };
      if (existing) {
        await tx.exec(`UPDATE hms.PayrollRuns SET DaysInMonth = @days, PaidDays = @paid, MonthlySalary = @sal, Gross = @gross, NetPay = @net
                       WHERE TenantId = @tid AND PayrollId = @id`, { ...params, id: existing.PayrollId });
      } else {
        await tx.exec(`INSERT INTO hms.PayrollRuns (TenantId, StaffId, PayMonth, DaysInMonth, PaidDays, MonthlySalary, Gross, NetPay, CreatedByUserId)
                       VALUES (@tid, @sid, @m, @days, @paid, @sal, @gross, @net, @uid)`, params);
      }
      n += 1;
    }
    await auditTenant(req, 'payroll.generated', 'payroll', null, { month, payslips: n }, tx);
    return n;
  });
  res.json({ data: { payslips: created } });
}));

router.put('/payroll/:id', requirePermission('hr.payroll'),
  validate(z.object({ allowances: z.coerce.number().min(0).max(1e8), deductions: z.coerce.number().min(0).max(1e8), notes: z.string().trim().max(300).nullable().optional() }).strict()),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    await withTransaction(async (tx) => {
      const r = await tx.one('SELECT Gross, Status FROM hms.PayrollRuns WITH (UPDLOCK) WHERE TenantId = @tid AND PayrollId = @id', { tid: req.ctx.tenantId, id });
      if (!r) throw notFound('Payslip not found.');
      if (r.Status === 'paid') throw conflict('This payslip is already paid.', 'PAYROLL_STATE');
      const net = Math.max(0, Math.round(Number(r.Gross) * 100) + Math.round(req.body.allowances * 100) - Math.round(req.body.deductions * 100)) / 100;
      await tx.exec(`UPDATE hms.PayrollRuns SET Allowances = @a, Deductions = @d, NetPay = @net, Notes = @n WHERE TenantId = @tid AND PayrollId = @id`,
        { tid: req.ctx.tenantId, id, a: t.money(req.body.allowances.toFixed(2)), d: t.money(req.body.deductions.toFixed(2)), net: t.money(net.toFixed(2)), n: req.body.notes ?? null });
    });
    res.json({ data: { ok: true } });
  }));

router.post('/payroll/:id/pay', requirePermission('hr.payroll'),
  validate(z.object({ method: z.enum(['cash', 'card', 'upi', 'bank', 'other']), reference: z.string().trim().max(100).optional() }).strict()),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const out = await withTransaction(async (tx) => {
      const r = await tx.one(`SELECT p.*, s.FullName FROM hms.PayrollRuns p WITH (UPDLOCK) JOIN hms.StaffMembers s ON s.TenantId = p.TenantId AND s.StaffId = p.StaffId
                              WHERE p.TenantId = @tid AND p.PayrollId = @id`, { tid: req.ctx.tenantId, id });
      if (!r) throw notFound('Payslip not found.');
      if (r.Status === 'paid') throw conflict('This payslip is already paid.', 'PAYROLL_STATE');
      let expenseNumber = null;
      if (Number(r.NetPay) > 0) {
        const cat = await tx.one(`SELECT ExpenseCategoryId FROM hms.ExpenseCategories WHERE TenantId = @tid AND Name = N'Salaries'`, { tid: req.ctx.tenantId })
          ?? await tx.one(`INSERT INTO hms.ExpenseCategories (TenantId, Name) OUTPUT INSERTED.ExpenseCategoryId VALUES (@tid, N'Salaries')`, { tid: req.ctx.tenantId });
        expenseNumber = formatNumber('EXP', await nextSequence(tx, req.ctx.tenantId, 'expense'));
        await tx.exec(`INSERT INTO hms.Expenses (TenantId, ExpenseNumber, ExpenseDate, ExpenseCategoryId, Amount, Method, PaidTo, Reference, Notes, CreatedByUserId, PayrollId)
                       VALUES (@tid, @num, CAST(@date AS DATE), @cat, @amt, @m, @to, @ref, @notes, @uid, @pid)`,
        { tid: req.ctx.tenantId, num: expenseNumber, date: localDateString(req.ctx.timezone), cat: cat.ExpenseCategoryId, amt: t.money(Number(r.NetPay).toFixed(2)),
          m: req.body.method, to: r.FullName, ref: req.body.reference || null, notes: `Salary ${r.PayMonth}`, uid: req.ctx.userId, pid: id });
      }
      await tx.exec(`UPDATE hms.PayrollRuns SET Status = 'paid', PaidAt = SYSUTCDATETIME(), PaymentMethod = @m WHERE TenantId = @tid AND PayrollId = @id`,
        { tid: req.ctx.tenantId, id, m: req.body.method });
      await auditTenant(req, 'payroll.paid', 'payroll', id, { month: r.PayMonth, expense: expenseNumber }, tx);
      return { expenseNumber };
    });
    res.json({ data: out });
  }));

/** Printable payslip. */
router.get('/payroll/:id', requirePermission('hr.payroll'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const r = await db.one(`
    SELECT p.PayrollId AS id, p.PayMonth AS month, p.DaysInMonth AS daysInMonth, p.PaidDays AS paidDays, p.MonthlySalary AS monthlySalary, p.Gross AS gross,
           p.Allowances AS allowances, p.Deductions AS deductions, p.NetPay AS net, p.Status AS status, p.PaidAt AS paidAt, p.PaymentMethod AS paymentMethod, p.Notes AS notes,
           s.FullName AS staffName, s.Designation AS designation, s.StaffType AS staffType, d.Name AS department,
           t.Name AS hospitalName, t.Phone AS hospitalPhone,
           (SELECT SettingValue FROM hms.TenantSettings x WHERE x.TenantId = p.TenantId AND x.SettingKey = 'hospital.address') AS hospitalAddress
    FROM hms.PayrollRuns p JOIN hms.StaffMembers s ON s.TenantId = p.TenantId AND s.StaffId = p.StaffId
    LEFT JOIN hms.Departments d ON d.TenantId = s.TenantId AND d.DepartmentId = s.DepartmentId
    JOIN hms.Tenants t ON t.TenantId = p.TenantId
    WHERE p.TenantId = @tid AND p.PayrollId = @id`, { tid: req.ctx.tenantId, id });
  if (!r) throw notFound('Payslip not found.');
  res.json({ data: r });
}));

export default router;
