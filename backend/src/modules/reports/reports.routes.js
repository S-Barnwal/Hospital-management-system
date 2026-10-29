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

function range(req) {
  const tz = req.ctx.timezone;
  const today = localDateString(tz);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : today;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : localDateString(tz, new Date(Date.now() - 29 * 86400000));
  if (from > to) throw badRequest('“From” date must be on or before “To” date.');
  const days = (new Date(to) - new Date(from)) / 86400000;
  if (days > 366) throw badRequest('Choose a range of one year or less.');
  return { from, to, start: localDayRangeUtc(tz, from).start, end: localDayRangeUtc(tz, to).end, offset: tzOffsetMinutes(tz) };
}

const day = (col) => `CONVERT(CHAR(10), CAST(DATEADD(MINUTE, @offset, ${col}) AS DATE), 23)`;

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
          FROM hms.BillPayments WHERE TenantId = @tid AND ReceivedAt >= @start AND ReceivedAt < @end
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
      (SELECT ISNULL(SUM(CASE WHEN Kind = 'payment' THEN Amount ELSE -Amount END), 0) FROM hms.BillPayments WHERE TenantId = @tid AND ReceivedAt >= @start AND ReceivedAt < @end) AS netCollections,
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
  const rows = await db.query(rep.sql, { tid: req.ctx.tenantId, start: r.start, end: r.end, offset: r.offset });
  if (csv) {
    await auditTenant(req, 'report.exported', 'report', key, { from: r.from, to: r.to, rows: rows.length });
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${key}_${r.from}_${r.to}.csv"`);
    return res.send(`﻿${toCsv(rows, rep.columns)}`);
  }
  return res.json({ data: { key, title: rep.title, from: r.from, to: r.to, columns: rep.columns.map(({ key: k, label }) => ({ key: k, label })), rows: rows.slice(0, 1000) } });
}));

export default router;
