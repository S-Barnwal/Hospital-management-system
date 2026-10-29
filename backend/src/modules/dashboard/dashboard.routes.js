// Hospital dashboard. Every figure is a tenant-scoped SQL aggregate — no hard-coded numbers.
// Widgets for modules not yet built (beds, billing, pharmacy) are returned as `available: false`.
import { Router } from 'express';
import { requireTenant, requirePermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/errors.js';
import { db } from '../../db/pool.js';
import { localDateString, localDayRangeUtc, tzOffsetMinutes } from '../../utils/time.js';

const router = Router();

router.get('/summary', requireTenant, requirePermission('dashboard.view'), asyncHandler(async (req, res) => {
  const tz = req.ctx.timezone;
  const today = localDateString(tz);
  const { start, end } = localDayRangeUtc(tz, today);
  const monthStart = localDayRangeUtc(tz, `${today.slice(0, 8)}01`).start;
  const trendStart = new Date(start.getTime() - 13 * 86400000);
  const offset = tzOffsetMinutes(tz); // used to bucket UTC timestamps into local days

  const canPatients = req.ctx.permissions.has('patients.read');
  const canAppts = req.ctx.permissions.has('appointments.read');
  const canStaff = req.ctx.permissions.has('staff.read');

  const [counts, todayByStatus, trend, upcoming, activity] = await db.many(`
    SELECT
      (SELECT COUNT(*) FROM dbo.Patients WHERE TenantId = @tid AND IsArchived = 0) AS totalPatients,
      (SELECT COUNT(*) FROM dbo.Patients WHERE TenantId = @tid AND CreatedAt >= @monthStart) AS newPatientsThisMonth,
      (SELECT COUNT(*) FROM dbo.StaffMembers WHERE TenantId = @tid AND IsActive = 1 AND StaffType = 'doctor') AS doctors,
      (SELECT COUNT(*) FROM dbo.StaffMembers WHERE TenantId = @tid AND IsActive = 1 AND StaffType <> 'doctor') AS staff,
      (SELECT COUNT(*) FROM dbo.Appointments WHERE TenantId = @tid AND StartAt >= @start AND StartAt < @end AND Status = 'completed' AND VisitType IN ('opd','follow_up')) AS opdVisitsToday;
    SELECT Status, COUNT(*) AS n FROM dbo.Appointments WHERE TenantId = @tid AND StartAt >= @start AND StartAt < @end GROUP BY Status;
    SELECT CAST(DATEADD(MINUTE, @offset, StartAt) AS DATE) AS day, COUNT(*) AS n
      FROM dbo.Appointments WHERE TenantId = @tid AND StartAt >= @trendStart AND StartAt < @end AND Status <> 'cancelled'
      GROUP BY CAST(DATEADD(MINUTE, @offset, StartAt) AS DATE);
    SELECT TOP 6 a.AppointmentId, a.AppointmentNumber, a.StartAt, a.Status, p.FirstName, p.LastName, p.PatientNumber, s.FullName AS DoctorName
      FROM dbo.Appointments a
      JOIN dbo.Patients p ON p.TenantId = a.TenantId AND p.PatientId = a.PatientId
      JOIN dbo.StaffMembers s ON s.TenantId = a.TenantId AND s.StaffId = a.DoctorId
      WHERE a.TenantId = @tid AND a.StartAt >= SYSUTCDATETIME() AND a.Status IN ('scheduled','checked_in')
      ORDER BY a.StartAt;
    SELECT TOP 8 a.Action, a.EntityType, a.CreatedAt, u.FullName AS ActorName
      FROM dbo.AuditLogs a LEFT JOIN dbo.Users u ON u.UserId = a.ActorId AND u.TenantId = a.TenantId AND a.ActorType = 'tenant'
      WHERE a.TenantId = @tid AND a.Action NOT LIKE 'auth.%' ORDER BY a.CreatedAt DESC;`,
  { tid: req.ctx.tenantId, start, end, monthStart, trendStart, offset });

  // Fill missing days with zero so the chart has a continuous 14-day axis.
  const byDay = new Map(trend.map((r) => [new Date(r.day).toISOString().slice(0, 10), r.n]));
  const series = [];
  for (let i = 13; i >= 0; i -= 1) {
    const d = localDateString(tz, new Date(Date.now() - i * 86400000));
    series.push({ date: d, appointments: byDay.get(d) ?? 0 });
  }

  const c = counts[0];
  const statusCounts = Object.fromEntries(todayByStatus.map((r) => [r.Status, r.n]));
  const todayTotal = todayByStatus.reduce((a, r) => a + r.n, 0);
  const sub = req.ctx.subscription;
  const alerts = [];
  if (sub.state === 'grace') alerts.push({ level: 'warning', message: `Subscription period ended. ${sub.daysLeft} day(s) of grace left — renew to avoid read-only mode.` });
  else if (sub.state === 'expired') alerts.push({ level: 'danger', message: 'Subscription expired. Your data is safe but read-only until you renew.' });
  else if (sub.state === 'active' && sub.daysLeft <= 7) alerts.push({ level: 'info', message: `Subscription renews in ${sub.daysLeft} day(s).` });

  res.json({
    data: {
      date: today,
      timezone: tz,
      widgets: {
        totalPatients: canPatients ? c.totalPatients : null,
        newPatientsThisMonth: canPatients ? c.newPatientsThisMonth : null,
        todaysAppointments: canAppts ? { total: todayTotal, byStatus: statusCounts } : null,
        opdVisitsToday: canAppts ? c.opdVisitsToday : null,
        doctors: canStaff ? c.doctors : null,
        staff: canStaff ? c.staff : null,
        // Phase 6 modules — not implemented yet, so no number is shown.
        occupiedBeds: { available: false, module: 'ipd' },
        pendingPayments: { available: false, module: 'billing' },
        revenue: { available: false, module: 'billing' },
        lowStock: { available: false, module: 'pharmacy' },
      },
      appointmentTrend: canAppts ? series : [],
      upcomingAppointments: canAppts ? upcoming : [],
      recentActivity: activity,
      alerts,
    },
  });
}));

export default router;
