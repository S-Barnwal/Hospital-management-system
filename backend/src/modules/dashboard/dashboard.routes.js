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
      (SELECT COUNT(*) FROM hms.Patients WHERE TenantId = @tid AND IsArchived = 0) AS totalPatients,
      (SELECT COUNT(*) FROM hms.Patients WHERE TenantId = @tid AND CreatedAt >= @monthStart) AS newPatientsThisMonth,
      (SELECT COUNT(*) FROM hms.StaffMembers WHERE TenantId = @tid AND IsActive = 1 AND StaffType = 'doctor') AS doctors,
      (SELECT COUNT(*) FROM hms.StaffMembers WHERE TenantId = @tid AND IsActive = 1 AND StaffType <> 'doctor') AS staff,
      (SELECT COUNT(*) FROM hms.Appointments WHERE TenantId = @tid AND StartAt >= @start AND StartAt < @end AND Status = 'completed' AND VisitType IN ('opd','follow_up')) AS opdVisitsToday,
      (SELECT COUNT(*) FROM hms.Consultations WHERE TenantId = @tid AND FinalizedAt >= @start AND FinalizedAt < @end) AS consultationsToday,
      (SELECT COUNT(*) FROM hms.Beds b JOIN hms.Wards w ON w.TenantId = b.TenantId AND w.WardId = b.WardId WHERE b.TenantId = @tid AND w.IsActive = 1) AS totalBeds,
      (SELECT COUNT(*) FROM hms.Beds WHERE TenantId = @tid AND Status = 'occupied') AS occupiedBeds,
      (SELECT COUNT(*) FROM hms.Bills WHERE TenantId = @tid AND Status = 'finalized' AND PaidAmount < Total) AS pendingBills,
      (SELECT ISNULL(SUM(Total - PaidAmount), 0) FROM hms.Bills WHERE TenantId = @tid AND Status = 'finalized' AND PaidAmount < Total) AS pendingAmount,
      (SELECT ISNULL(SUM(CASE WHEN Kind = 'payment' THEN Amount ELSE -Amount END), 0) FROM hms.BillPayments WHERE TenantId = @tid AND ReceivedAt >= @start AND ReceivedAt < @end) AS collectedToday,
      (SELECT ISNULL(SUM(CASE WHEN Kind = 'payment' THEN Amount ELSE -Amount END), 0) FROM hms.BillPayments WHERE TenantId = @tid AND ReceivedAt >= @monthStart) AS collectedThisMonth,
      (SELECT COUNT(*) FROM (SELECT m.MedicineId, m.ReorderLevel,
          ISNULL((SELECT SUM(QuantityOnHand) FROM hms.StockBatches sb WHERE sb.TenantId = m.TenantId AND sb.MedicineId = m.MedicineId AND sb.ExpiryDate >= CAST(@start AS DATE)), 0) AS stock
        FROM hms.Medicines m WHERE m.TenantId = @tid AND m.IsActive = 1) x WHERE x.stock <= x.ReorderLevel) AS lowStock,
      (SELECT COUNT(*) FROM hms.LabOrders WHERE TenantId = @tid AND Status IN ('ordered','sample_collected','completed')) AS pendingLab,
      (SELECT COUNT(*) FROM hms.LabSamples s JOIN hms.LabOrders o ON o.TenantId = s.TenantId AND o.LabOrderId = s.LabOrderId
        WHERE s.TenantId = @tid AND s.Status IN ('pending','rejected') AND o.Status <> 'cancelled') AS pendingSamples,
      (SELECT ISNULL(SUM(Amount), 0) FROM hms.Expenses WHERE TenantId = @tid AND ExpenseDate >= CAST(DATEADD(MINUTE, @offset, @monthStart) AS DATE)) AS expensesThisMonth;
    SELECT Status, COUNT(*) AS n FROM hms.Appointments WHERE TenantId = @tid AND StartAt >= @start AND StartAt < @end GROUP BY Status;
    SELECT CAST(DATEADD(MINUTE, @offset, StartAt) AS DATE) AS day, COUNT(*) AS n
      FROM hms.Appointments WHERE TenantId = @tid AND StartAt >= @trendStart AND StartAt < @end AND Status <> 'cancelled'
      GROUP BY CAST(DATEADD(MINUTE, @offset, StartAt) AS DATE);
    SELECT TOP 6 a.AppointmentId, a.AppointmentNumber, a.StartAt, a.Status, p.FirstName, p.LastName, p.PatientNumber, s.FullName AS DoctorName
      FROM hms.Appointments a
      JOIN hms.Patients p ON p.TenantId = a.TenantId AND p.PatientId = a.PatientId
      JOIN hms.StaffMembers s ON s.TenantId = a.TenantId AND s.StaffId = a.DoctorId
      WHERE a.TenantId = @tid AND a.StartAt >= SYSUTCDATETIME() AND a.Status IN ('scheduled','checked_in')
      ORDER BY a.StartAt;
    SELECT TOP 8 a.Action, a.EntityType, a.CreatedAt, u.FullName AS ActorName
      FROM hms.AuditLogs a LEFT JOIN hms.Users u ON u.UserId = a.ActorId AND u.TenantId = a.TenantId AND a.ActorType = 'tenant'
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
  if (req.ctx.permissions.has('pharmacy.read') && req.ctx.features.has('pharmacy') && c.lowStock > 0) {
    alerts.push({ level: 'warning', message: `${c.lowStock} medicine(s) at or below reorder level.` });
  }

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
        consultationsToday: req.ctx.permissions.has('opd.read') && req.ctx.features.has('opd') ? c.consultationsToday : null,
        // null = module not in plan or no permission (UI shows nothing rather than a made-up number)
        beds: req.ctx.permissions.has('ipd.read') && req.ctx.features.has('ipd') ? { total: c.totalBeds, occupied: c.occupiedBeds } : null,
        pendingPayments: req.ctx.permissions.has('billing.read') && req.ctx.features.has('billing') ? { bills: c.pendingBills, amount: c.pendingAmount } : null,
        collections: req.ctx.permissions.has('billing.read') && req.ctx.features.has('billing') ? { today: c.collectedToday, month: c.collectedThisMonth } : null,
        lowStock: req.ctx.permissions.has('pharmacy.read') && req.ctx.features.has('pharmacy') ? c.lowStock : null,
        pendingLab: req.ctx.permissions.has('lab.read') && req.ctx.features.has('laboratory') ? { orders: c.pendingLab, samples: c.pendingSamples } : null,
        expensesThisMonth: req.ctx.permissions.has('expenses.read') && req.ctx.features.has('billing') ? c.expensesThisMonth : null,
      },
      appointmentTrend: canAppts ? series : [],
      upcomingAppointments: canAppts ? upcoming : [],
      recentActivity: activity,
      alerts,
    },
  });
}));

export default router;
