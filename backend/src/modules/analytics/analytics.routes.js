// Analytics: one call returns the hospital's business picture for a date range (hospital-local dates).
// Figures come only from recorded transactions. Sections a plan does not include are returned as null.
import { Router } from 'express';
import { requireTenant, requirePermission, requireFeature } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/errors.js';
import { db } from '../../db/pool.js';
import { range, day } from '../reports/reports.routes.js';

const router = Router();
router.use(requireTenant, requireFeature('reports'));

/** Every calendar day between two YYYY-MM-DD dates (inclusive). */
function daysBetween(from, to) {
  const out = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d = new Date(d.getTime() + 86400000)) out.push(d.toISOString().slice(0, 10));
  return out;
}

router.get('/', requirePermission('reports.read'), asyncHandler(async (req, res) => {
  const r = range(req);
  const p = { tid: req.ctx.tenantId, start: r.start, end: r.end, offset: r.offset, from: r.from, to: r.to };
  const f = req.ctx.features;

  const [patients] = await db.many(`SELECT COUNT(*) AS n FROM hms.Patients WHERE TenantId = @tid AND CreatedAt >= @start AND CreatedAt < @end;`, p);

  let finance = null; let dailyMoney = []; let byMethod = []; let expenseByCategory = [];
  if (f.has('billing')) {
    const [tot, daily, methods, exp, expDaily, expCat] = await db.many(`
      SELECT ISNULL(SUM(CASE WHEN Kind = 'payment' THEN Amount ELSE 0 END), 0) AS payments, ISNULL(SUM(CASE WHEN Kind = 'refund' THEN Amount ELSE 0 END), 0) AS refunds
        FROM hms.MoneyReceived WHERE TenantId = @tid AND ReceivedAt >= @start AND ReceivedAt < @end;
      SELECT ${day('ReceivedAt')} AS date, SUM(CASE WHEN Kind = 'payment' THEN Amount ELSE -Amount END) AS net
        FROM hms.MoneyReceived WHERE TenantId = @tid AND ReceivedAt >= @start AND ReceivedAt < @end GROUP BY ${day('ReceivedAt')};
      SELECT Method AS method, SUM(CASE WHEN Kind = 'payment' THEN Amount ELSE -Amount END) AS amount, COUNT(*) AS [count]
        FROM hms.MoneyReceived WHERE TenantId = @tid AND ReceivedAt >= @start AND ReceivedAt < @end GROUP BY Method ORDER BY amount DESC;
      SELECT ISNULL(SUM(Amount), 0) AS total FROM hms.Expenses WHERE TenantId = @tid AND ExpenseDate BETWEEN @from AND @to;
      SELECT CONVERT(CHAR(10), ExpenseDate, 23) AS date, SUM(Amount) AS amount FROM hms.Expenses WHERE TenantId = @tid AND ExpenseDate BETWEEN @from AND @to GROUP BY ExpenseDate;
      SELECT c.Name AS category, SUM(e.Amount) AS amount FROM hms.Expenses e JOIN hms.ExpenseCategories c ON c.TenantId = e.TenantId AND c.ExpenseCategoryId = e.ExpenseCategoryId
        WHERE e.TenantId = @tid AND e.ExpenseDate BETWEEN @from AND @to GROUP BY c.Name ORDER BY amount DESC;`, p);
    const outstanding = (await db.one(`SELECT ISNULL(SUM(Total - PaidAmount), 0) AS v FROM hms.Bills WHERE TenantId = @tid AND Status = 'finalized' AND PaidAmount < Total`, p)).v;
    const payments = Number(tot[0].payments); const refunds = Number(tot[0].refunds); const expenses = Number(exp[0].total);
    finance = {
      payments: payments.toFixed(2), refunds: refunds.toFixed(2), netCollections: (payments - refunds).toFixed(2),
      expenses: expenses.toFixed(2), profit: (payments - refunds - expenses).toFixed(2), outstanding: Number(outstanding).toFixed(2),
    };
    const inMap = new Map(daily.map((d) => [d.date, Number(d.net)]));
    const outMap = new Map(expDaily.map((d) => [d.date, Number(d.amount)]));
    dailyMoney = daysBetween(r.from, r.to).map((date) => ({ date, collections: inMap.get(date) || 0, expenses: outMap.get(date) || 0 }));
    byMethod = methods;
    expenseByCategory = expCat;
  }

  let lab = null;
  if (f.has('laboratory')) {
    const [kpi, status, tests, packages, referrals, daily] = await db.many(`
      SELECT COUNT(*) AS orders, ISNULL(SUM(NetAmount), 0) AS revenue, ISNULL(SUM(DiscountAmount), 0) AS discounts,
             SUM(CASE WHEN Status = 'verified' THEN 1 ELSE 0 END) AS verified,
             AVG(CASE WHEN VerifiedAt IS NOT NULL THEN DATEDIFF(MINUTE, OrderedAt, VerifiedAt) END) AS avgTatMinutes
        FROM hms.LabOrders WHERE TenantId = @tid AND OrderedAt >= @start AND OrderedAt < @end AND Status <> 'cancelled';
      SELECT Status AS status, COUNT(*) AS [count] FROM hms.LabOrders WHERE TenantId = @tid AND OrderedAt >= @start AND OrderedAt < @end GROUP BY Status;
      SELECT TOP 10 i.TestName AS name, COUNT(*) AS [count], SUM(i.Price) AS revenue
        FROM hms.LabOrderItems i JOIN hms.LabOrders o ON o.TenantId = i.TenantId AND o.LabOrderId = i.LabOrderId
        WHERE o.TenantId = @tid AND o.OrderedAt >= @start AND o.OrderedAt < @end AND o.Status <> 'cancelled'
        GROUP BY i.TestName ORDER BY [count] DESC, revenue DESC;
      SELECT TOP 10 x.PackageName AS name, COUNT(*) AS [count] FROM (
          SELECT DISTINCT i.LabOrderId, i.PackageName FROM hms.LabOrderItems i JOIN hms.LabOrders o ON o.TenantId = i.TenantId AND o.LabOrderId = i.LabOrderId
          WHERE o.TenantId = @tid AND o.OrderedAt >= @start AND o.OrderedAt < @end AND o.Status <> 'cancelled' AND i.PackageName IS NOT NULL) x
        GROUP BY x.PackageName ORDER BY [count] DESC;
      SELECT rd.Name AS name, rd.CommissionPercent AS commissionPercent, COUNT(*) AS orders, SUM(o.NetAmount) AS business,
             CAST(SUM(o.NetAmount) * rd.CommissionPercent / 100 AS DECIMAL(12,2)) AS commission
        FROM hms.LabOrders o JOIN hms.ReferralDoctors rd ON rd.TenantId = o.TenantId AND rd.ReferralDoctorId = o.ReferralDoctorId
        WHERE o.TenantId = @tid AND o.OrderedAt >= @start AND o.OrderedAt < @end AND o.Status <> 'cancelled'
        GROUP BY rd.Name, rd.CommissionPercent ORDER BY business DESC;
      SELECT ${day('OrderedAt')} AS date, COUNT(*) AS orders FROM hms.LabOrders
        WHERE TenantId = @tid AND OrderedAt >= @start AND OrderedAt < @end AND Status <> 'cancelled' GROUP BY ${day('OrderedAt')};`, p);
    const k = kpi[0];
    const dMap = new Map(daily.map((d) => [d.date, d.orders]));
    lab = {
      orders: k.orders, revenue: Number(k.revenue).toFixed(2), discounts: Number(k.discounts).toFixed(2), verified: k.verified || 0,
      avgOrderValue: k.orders ? (Number(k.revenue) / k.orders).toFixed(2) : '0.00',
      avgTurnaroundHours: k.avgTatMinutes == null ? null : Math.round((k.avgTatMinutes / 60) * 10) / 10,
      byStatus: status, topTests: tests, topPackages: packages, referrals,
      daily: daysBetween(r.from, r.to).map((date) => ({ date, orders: dMap.get(date) || 0 })),
    };
  }

  res.json({
    data: {
      range: { from: r.from, to: r.to },
      newPatients: patients[0].n,
      finance, dailyMoney, byMethod, expenseByCategory, lab,
    },
  });
}));

export default router;
