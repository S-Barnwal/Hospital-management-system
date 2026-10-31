// Reports: tenant-scoped aggregates over a date range (hospital-local dates) + CSV export (reports.export).
// Figures come only from recorded transactions — nothing is estimated.
import { Router } from 'express';
import { requireTenant, requirePermission, requireFeature } from '../../middleware/auth.js';
import { asyncHandler, badRequest, notFound } from '../../utils/errors.js';
import { db } from '../../db/pool.js';
import { auditTenant } from '../../utils/audit.js';
import { localDateString, localDayRangeUtc, tzOffsetMinutes } from '../../utils/time.js';
import { toCsv } from '../clinical/logic.js';

const router = Router();
router.use(requireTenant, requireFeature('reports'));

export function range(req) {
  const tz = req.ctx.timezone;
  const today = localDateString(tz);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : today;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : localDateString(tz, new Date(Date.now() - 29 * 86400000));
  if (from > to) throw badRequest('“From” date must be on or before “To” date.');
  const days = (new Date(to) - new Date(from)) / 86400000;
  if (days > 366) throw badRequest('Choose a range of one year or less.');
  return { from, to, start: localDayRangeUtc(tz, from).start, end: localDayRangeUtc(tz, to).end, offset: tzOffsetMinutes(tz) };
}

export const day = (col) => `CONVERT(CHAR(10), CAST(DATEADD(MINUTE, @offset, ${col}) AS DATE), 23)`;

// Each report: SQL (scoped by @tid, @start, @end) + CSV columns.
const REPORTS = {
  registrations: {
    title: 'Patient registrations by day',
    sql: `SELECT ${day('CreatedAt')} AS date, COUNT(*) AS registrations FROM hms.Patients
          WHERE TenantId = @tid AND CreatedAt >= @start AND CreatedAt < @end GROUP BY ${day('CreatedAt')} ORDER BY date`,
    columns: [{ key: 'date', label: 'Date' }, { key: 'registrations', label: 'Registrations' }],
  },
  appointments: {
    title: 'Appointments by doctor and status',
    sql: `SELECT s.FullName AS doctor, a.Status AS status, COUNT(*) AS appointments FROM hms.Appointments a
          JOIN hms.StaffMembers s ON s.TenantId = a.TenantId AND s.StaffId = a.DoctorId
          WHERE a.TenantId = @tid AND a.StartAt >= @start AND a.StartAt < @end GROUP BY s.FullName, a.Status ORDER BY s.FullName, a.Status`,
    columns: [{ key: 'doctor', label: 'Doctor' }, { key: 'status', label: 'Status' }, { key: 'appointments', label: 'Appointments' }],
  },
  admissions: {
    title: 'Admissions',
    sql: `SELECT a.AdmissionNumber AS admission, p.PatientNumber AS patientNumber, p.FirstName + ' ' + ISNULL(p.LastName, '') AS patient, w.Name AS ward, b.BedNumber AS bed,
                 a.AdmittedAt AS admittedAt, a.DischargedAt AS dischargedAt, a.Status AS status
          FROM hms.Admissions a JOIN hms.Patients p ON p.TenantId = a.TenantId AND p.PatientId = a.PatientId
          JOIN hms.Beds b ON b.TenantId = a.TenantId AND b.BedId = a.BedId JOIN hms.Wards w ON w.TenantId = b.TenantId AND w.WardId = b.WardId
          WHERE a.TenantId = @tid AND a.AdmittedAt >= @start AND a.AdmittedAt < @end ORDER BY a.AdmittedAt`,
    columns: [{ key: 'admission', label: 'Admission' }, { key: 'patientNumber', label: 'Patient no.' }, { key: 'patient', label: 'Patient' }, { key: 'ward', label: 'Ward' },
      { key: 'bed', label: 'Bed' }, { key: 'admittedAt', label: 'Admitted (UTC)' }, { key: 'dischargedAt', label: 'Discharged (UTC)' }, { key: 'status', label: 'Status' }],
  },
  collections: {
    title: 'Collections by day and method (payments minus refunds)',
    sql: `SELECT ${day('ReceivedAt')} AS date, Method AS method,
                 SUM(CASE WHEN Kind = 'payment' THEN Amount ELSE 0 END) AS payments,
                 SUM(CASE WHEN Kind = 'refund' THEN Amount ELSE 0 END) AS refunds,
                 SUM(CASE WHEN Kind = 'payment' THEN Amount ELSE -Amount END) AS net
          FROM hms.MoneyReceived WHERE TenantId = @tid AND ReceivedAt >= @start AND ReceivedAt < @end
          GROUP BY ${day('ReceivedAt')}, Method ORDER BY date, method`,
    columns: [{ key: 'date', label: 'Date' }, { key: 'method', label: 'Method' }, { key: 'payments', label: 'Payments' }, { key: 'refunds', label: 'Refunds' }, { key: 'net', label: 'Net' }],
  },
  outstanding: {
    title: 'Outstanding bills (finalised, not fully paid)',
    noRange: true,
    sql: `SELECT b.BillNumber AS bill, p.PatientNumber AS patientNumber, p.FirstName + ' ' + ISNULL(p.LastName, '') AS patient, p.Phone AS phone,
                 b.FinalizedAt AS finalizedAt, b.Total AS total, b.PaidAmount AS paid, b.Total - b.PaidAmount AS balance
          FROM hms.Bills b JOIN hms.Patients p ON p.TenantId = b.TenantId AND p.PatientId = b.PatientId
          WHERE b.TenantId = @tid AND b.Status = 'finalized' AND b.PaidAmount < b.Total ORDER BY b.FinalizedAt`,
    columns: [{ key: 'bill', label: 'Bill' }, { key: 'patientNumber', label: 'Patient no.' }, { key: 'patient', label: 'Patient' }, { key: 'phone', label: 'Phone' },
      { key: 'finalizedAt', label: 'Finalised (UTC)' }, { key: 'total', label: 'Total' }, { key: 'paid', label: 'Paid' }, { key: 'balance', label: 'Balance' }],
  },
  lab: {
    title: 'Lab tests performed',
    sql: `SELECT i.TestName AS test, COUNT(*) AS orders, SUM(CASE WHEN o.Status = 'verified' THEN 1 ELSE 0 END) AS verified,
                 SUM(CASE WHEN i.Flag IN ('low','high','abnormal') THEN 1 ELSE 0 END) AS abnormal
          FROM hms.LabOrderItems i JOIN hms.LabOrders o ON o.TenantId = i.TenantId AND o.LabOrderId = i.LabOrderId
          WHERE i.TenantId = @tid AND o.Status <> 'cancelled' AND o.OrderedAt >= @start AND o.OrderedAt < @end GROUP BY i.TestName ORDER BY orders DESC`,
    columns: [{ key: 'test', label: 'Test' }, { key: 'orders', label: 'Orders' }, { key: 'verified', label: 'Verified' }, { key: 'abnormal', label: 'Abnormal results' }],
  },
  inventory: {
    title: 'Current stock by medicine',
    noRange: true,
    sql: `SELECT m.Name AS medicine, m.Strength AS strength, m.ReorderLevel AS reorderLevel,
                 ISNULL(SUM(CASE WHEN b.ExpiryDate >= CAST(SYSUTCDATETIME() AS DATE) THEN b.QuantityOnHand END), 0) AS usableStock,
                 ISNULL(SUM(CASE WHEN b.ExpiryDate < CAST(SYSUTCDATETIME() AS DATE) THEN b.QuantityOnHand END), 0) AS expiredStock,
                 ISNULL(SUM(b.QuantityOnHand * b.PurchasePrice), 0) AS stockValueAtCost
          FROM hms.Medicines m LEFT JOIN hms.StockBatches b ON b.TenantId = m.TenantId AND b.MedicineId = m.MedicineId
          WHERE m.TenantId = @tid GROUP BY m.Name, m.Strength, m.ReorderLevel ORDER BY m.Name`,
    columns: [{ key: 'medicine', label: 'Medicine' }, { key: 'strength', label: 'Strength' }, { key: 'reorderLevel', label: 'Reorder level' },
      { key: 'usableStock', label: 'Usable stock' }, { key: 'expiredStock', label: 'Expired stock' }, { key: 'stockValueAtCost', label: 'Value at cost' }],
  },
  // ---------- Phase 3 ----------
  pharmacy_sales: {
    title: 'Pharmacy sales by medicine (dispensed)',
    sql: `SELECT m.Name AS medicine, m.Strength AS strength, SUM(-mv.Quantity) AS quantity, SUM(-mv.Quantity * ISNULL(mv.UnitPrice, 0)) AS saleValue,
                 SUM(-mv.Quantity * b.PurchasePrice) AS costValue, SUM(-mv.Quantity * (ISNULL(mv.UnitPrice, 0) - b.PurchasePrice)) AS margin
          FROM hms.StockMovements mv JOIN hms.Medicines m ON m.TenantId = mv.TenantId AND m.MedicineId = mv.MedicineId
          JOIN hms.StockBatches b ON b.TenantId = mv.TenantId AND b.BatchId = mv.BatchId
          WHERE mv.TenantId = @tid AND mv.Kind = 'dispense' AND mv.CreatedAt >= @start AND mv.CreatedAt < @end
          GROUP BY m.Name, m.Strength ORDER BY saleValue DESC`,
    columns: [{ key: 'medicine', label: 'Medicine' }, { key: 'strength', label: 'Strength' }, { key: 'quantity', label: 'Quantity' },
      { key: 'saleValue', label: 'Sale value (before GST)' }, { key: 'costValue', label: 'Cost' }, { key: 'margin', label: 'Margin' }],
  },
  expiry: {
    title: 'Expiry report (expired or expiring in 90 days)',
    noRange: true,
    sql: `SELECT m.Name AS medicine, m.Strength AS strength, b.BatchNumber AS batch, CONVERT(CHAR(10), b.ExpiryDate, 23) AS expiryDate, b.QuantityOnHand AS quantity,
                 b.QuantityOnHand * b.PurchasePrice AS valueAtCost, s.Name AS supplier
          FROM hms.StockBatches b JOIN hms.Medicines m ON m.TenantId = b.TenantId AND m.MedicineId = b.MedicineId
          LEFT JOIN hms.Suppliers s ON s.TenantId = b.TenantId AND s.SupplierId = b.SupplierId
          WHERE b.TenantId = @tid AND b.QuantityOnHand > 0 AND b.ExpiryDate < DATEADD(DAY, 90, CAST(SYSUTCDATETIME() AS DATE)) ORDER BY b.ExpiryDate`,
    columns: [{ key: 'medicine', label: 'Medicine' }, { key: 'strength', label: 'Strength' }, { key: 'batch', label: 'Batch' }, { key: 'expiryDate', label: 'Expiry' },
      { key: 'quantity', label: 'Quantity' }, { key: 'valueAtCost', label: 'Value at cost' }, { key: 'supplier', label: 'Supplier' }],
  },
  purchases: {
    title: 'Purchase orders',
    sql: `SELECT p.PoNumber AS po, s.Name AS supplier, p.Status AS status, CONVERT(CHAR(10), p.OrderDate, 23) AS orderDate, p.TotalAmount AS orderValue,
                 (SELECT ISNULL(SUM(i.ReceivedQuantity * i.UnitCost), 0) FROM hms.PurchaseOrderItems i WHERE i.TenantId = p.TenantId AND i.PurchaseOrderId = p.PurchaseOrderId) AS receivedValue
          FROM hms.PurchaseOrders p JOIN hms.Suppliers s ON s.TenantId = p.TenantId AND s.SupplierId = p.SupplierId
          WHERE p.TenantId = @tid AND p.CreatedAt >= @start AND p.CreatedAt < @end ORDER BY p.CreatedAt`,
    columns: [{ key: 'po', label: 'PO' }, { key: 'supplier', label: 'Supplier' }, { key: 'status', label: 'Status' }, { key: 'orderDate', label: 'Ordered' },
      { key: 'orderValue', label: 'Order value' }, { key: 'receivedValue', label: 'Received value' }],
  },
  home_collections: {
    title: 'Home sample collections',
    sql: `SELECT ${day('h.ScheduledAt')} AS date, ISNULL(s.FullName, 'Unassigned') AS collector, COUNT(*) AS visits,
                 SUM(CASE WHEN h.Status = 'collected' THEN 1 ELSE 0 END) AS collected, SUM(CASE WHEN h.Status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
                 SUM(CASE WHEN h.Status <> 'cancelled' THEN h.Charge ELSE 0 END) AS charges
          FROM hms.LabHomeCollections h LEFT JOIN hms.StaffMembers s ON s.TenantId = h.TenantId AND s.StaffId = h.CollectorStaffId
          WHERE h.TenantId = @tid AND h.ScheduledAt >= @start AND h.ScheduledAt < @end
          GROUP BY ${day('h.ScheduledAt')}, ISNULL(s.FullName, 'Unassigned') ORDER BY date`,
    columns: [{ key: 'date', label: 'Date' }, { key: 'collector', label: 'Collector' }, { key: 'visits', label: 'Visits' }, { key: 'collected', label: 'Collected' },
      { key: 'cancelled', label: 'Cancelled' }, { key: 'charges', label: 'Visit charges' }],
  },
  expenses_by_category: {
    title: 'Expenses by category',
    sql: `SELECT c.Name AS category, COUNT(*) AS entries, SUM(e.Amount) AS amount,
                 SUM(CASE WHEN e.RecurringExpenseId IS NOT NULL THEN e.Amount ELSE 0 END) AS recurring, SUM(CASE WHEN e.PayrollId IS NOT NULL THEN e.Amount ELSE 0 END) AS payroll
          FROM hms.Expenses e JOIN hms.ExpenseCategories c ON c.TenantId = e.TenantId AND c.ExpenseCategoryId = e.ExpenseCategoryId
          WHERE e.TenantId = @tid AND e.ExpenseDate BETWEEN CAST(@fromDate AS DATE) AND CAST(@toDate AS DATE) GROUP BY c.Name ORDER BY amount DESC`,
    columns: [{ key: 'category', label: 'Category' }, { key: 'entries', label: 'Entries' }, { key: 'amount', label: 'Amount' },
      { key: 'recurring', label: 'of which recurring' }, { key: 'payroll', label: 'of which salaries' }],
  },
  attendance: {
    title: 'Staff attendance',
    sql: `SELECT s.FullName AS staff, s.StaffType AS role, SUM(CASE WHEN a.Status = 'present' THEN 1 ELSE 0 END) AS present,
                 SUM(CASE WHEN a.Status = 'half_day' THEN 1 ELSE 0 END) AS halfDays, SUM(CASE WHEN a.Status = 'absent' THEN 1 ELSE 0 END) AS absent,
                 SUM(CASE WHEN a.Status = 'leave' THEN 1 ELSE 0 END) AS onLeave, COUNT(a.AttendanceId) AS daysMarked
          FROM hms.StaffMembers s LEFT JOIN hms.StaffAttendance a ON a.TenantId = s.TenantId AND a.StaffId = s.StaffId
            AND a.WorkDate BETWEEN CAST(@fromDate AS DATE) AND CAST(@toDate AS DATE)
          WHERE s.TenantId = @tid AND s.IsActive = 1 GROUP BY s.FullName, s.StaffType ORDER BY s.FullName`,
    columns: [{ key: 'staff', label: 'Staff' }, { key: 'role', label: 'Role' }, { key: 'present', label: 'Present' }, { key: 'halfDays', label: 'Half days' },
      { key: 'absent', label: 'Absent' }, { key: 'onLeave', label: 'Leave' }, { key: 'daysMarked', label: 'Days marked' }],
  },
};

router.get('/summary', requirePermission('reports.read'), asyncHandler(async (req, res) => {
  const r = range(req);
  const [kpi, occupancy] = await db.many(`
    SELECT
      (SELECT COUNT(*) FROM hms.Patients WHERE TenantId = @tid AND CreatedAt >= @start AND CreatedAt < @end) AS registrations,
      (SELECT COUNT(*) FROM hms.Appointments WHERE TenantId = @tid AND StartAt >= @start AND StartAt < @end AND Status <> 'cancelled') AS appointments,
      (SELECT COUNT(*) FROM hms.Consultations WHERE TenantId = @tid AND Status = 'final' AND FinalizedAt >= @start AND FinalizedAt < @end) AS consultations,
      (SELECT COUNT(*) FROM hms.Admissions WHERE TenantId = @tid AND AdmittedAt >= @start AND AdmittedAt < @end) AS admissions,
      (SELECT COUNT(*) FROM hms.LabOrders WHERE TenantId = @tid AND Status <> 'cancelled' AND OrderedAt >= @start AND OrderedAt < @end) AS labOrders,
      (SELECT ISNULL(SUM(CASE WHEN Kind = 'payment' THEN Amount ELSE -Amount END), 0) FROM hms.MoneyReceived WHERE TenantId = @tid AND ReceivedAt >= @start AND ReceivedAt < @end) AS netCollections,
      (SELECT ISNULL(SUM(Total), 0) FROM hms.Bills WHERE TenantId = @tid AND Status = 'finalized' AND FinalizedAt >= @start AND FinalizedAt < @end) AS billed,
      (SELECT ISNULL(SUM(Total - PaidAmount), 0) FROM hms.Bills WHERE TenantId = @tid AND Status = 'finalized') AS outstanding;
    SELECT (SELECT COUNT(*) FROM hms.Beds b JOIN hms.Wards w ON w.TenantId = b.TenantId AND w.WardId = b.WardId WHERE b.TenantId = @tid AND w.IsActive = 1) AS beds,
           (SELECT COUNT(*) FROM hms.Beds WHERE TenantId = @tid AND Status = 'occupied') AS occupied;`, { tid: req.ctx.tenantId, start: r.start, end: r.end });
  const o = occupancy[0];
  res.json({
    data: {
      from: r.from, to: r.to, ...kpi[0], beds: o.beds, occupiedBeds: o.occupied,
      occupancyPercent: o.beds ? Math.round((o.occupied / o.beds) * 1000) / 10 : null,
      reports: Object.entries(REPORTS).map(([key, v]) => ({ key, title: v.title, dateRange: !v.noRange })),
    },
  });
}));

router.get('/:key', requirePermission('reports.read'), asyncHandler(async (req, res) => {
  const key = String(req.params.key).replace(/\.csv$/, '');
  const csv = req.params.key.endsWith('.csv') || req.query.format === 'csv';
  const rep = Object.prototype.hasOwnProperty.call(REPORTS, key) ? REPORTS[key] : null;
  if (!rep) throw notFound('Unknown report.');
  if (csv && !req.ctx.permissions.has('reports.export')) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Exporting reports requires the reports.export permission.' } });
  }
  const r = range(req);
  const rows = await db.query(rep.sql, { tid: req.ctx.tenantId, start: r.start, end: r.end, offset: r.offset, fromDate: r.from, toDate: r.to });
  if (csv) {
    await auditTenant(req, 'report.exported', 'report', key, { from: r.from, to: r.to, rows: rows.length });
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${key}_${r.from}_${r.to}.csv"`);
    return res.send(`﻿${toCsv(rows, rep.columns)}`);
  }
  return res.json({ data: { key, title: rep.title, from: r.from, to: r.to, columns: rep.columns.map(({ key: k, label }) => ({ key: k, label })), rows: rows.slice(0, 1000) } });
}));

export default router;
