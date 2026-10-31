// In-process scheduler for reminders and summaries. Safe to run on several servers at once:
// every message carries a DedupeKey (unique in hms.MessageLog), so it is sent at most once.
import { config } from '../config/env.js';
import { db } from '../db/pool.js';
import { deliver, templates } from '../notify/index.js';
import { sendAppointmentMessage } from '../notify/appointments.js';
import { localDateString, localDayRangeUtc } from '../utils/time.js';
import { autoBedCharges } from '../modules/ipd/bedCharges.service.js';
import { postDueRecurringExpenses } from '../modules/expenses/recurring.service.js';

const money = (v) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(v || 0));
const localHour = (tz) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));

/** WhatsApp reminder for appointments starting 12–36 hours from now. */
export async function appointmentReminders() {
  const rows = await db.query(`
    SELECT TOP 500 a.TenantId, a.AppointmentId FROM hms.Appointments a JOIN hms.Tenants t ON t.TenantId = a.TenantId
    WHERE t.Status = 'active' AND a.Status = 'scheduled'
      AND a.StartAt >= DATEADD(HOUR, 12, SYSUTCDATETIME()) AND a.StartAt < DATEADD(HOUR, 36, SYSUTCDATETIME())
      AND NOT EXISTS (SELECT 1 FROM hms.MessageLog m WHERE m.DedupeKey = CONCAT('appt-reminder:', a.TenantId, ':', a.AppointmentId))`);
  for (const r of rows) await sendAppointmentMessage(r.TenantId, r.AppointmentId, 'reminder');
  return rows.length;
}

/**
 * While a plan is "free for now", its free subscriptions are rolled forward automatically (no e-mails, no payment),
 * so a free hospital never drops into grace/read-only just because a month passed.
 */
export async function extendFreeSubscriptions() {
  return db.exec(`
    /* tenant-safe: platform job over free subscriptions, keyed by SubscriptionId */
    UPDATE s SET CurrentPeriodStart = s.CurrentPeriodEnd,
                 CurrentPeriodEnd = CASE WHEN s.BillingInterval = 'annual' THEN DATEADD(YEAR, 1, s.CurrentPeriodEnd) ELSE DATEADD(MONTH, 1, s.CurrentPeriodEnd) END,
                 Status = 'active', UpdatedAt = SYSUTCDATETIME()
    FROM hms.Subscriptions s JOIN hms.Plans p ON p.PlanId = s.PlanId
    WHERE s.IsFree = 1 AND p.IsFree = 1 AND s.Status IN ('active', 'past_due')
      AND s.CurrentPeriodEnd < DATEADD(DAY, 3, SYSUTCDATETIME())`);
}

/** E-mail the hospital 7, 3 and 1 day(s) before the subscription ends, and on the day it lapses. */
export async function subscriptionReminders() {
  const rows = await db.query(`
    SELECT s.SubscriptionId, s.TenantId, s.CurrentPeriodEnd, p.Name AS PlanName, t.Name AS HospitalName, t.Email AS HospitalEmail,
           DATEDIFF(DAY, CAST(SYSUTCDATETIME() AS DATE), CAST(s.CurrentPeriodEnd AS DATE)) AS DaysLeft,
           (SELECT TOP 1 u.Email FROM hms.Users u WHERE u.TenantId = s.TenantId AND u.IsOwner = 1 AND u.Status = 'active') AS OwnerEmail
    FROM hms.Subscriptions s JOIN hms.Plans p ON p.PlanId = s.PlanId JOIN hms.Tenants t ON t.TenantId = s.TenantId
    WHERE t.Status = 'active' AND NOT (s.IsFree = 1 AND p.IsFree = 1)
      AND DATEDIFF(DAY, CAST(SYSUTCDATETIME() AS DATE), CAST(s.CurrentPeriodEnd AS DATE)) IN (7, 3, 1, 0)`);
  let sent = 0;
  for (const r of rows) {
    const endDate = new Date(r.CurrentPeriodEnd).toISOString().slice(0, 10);
    const content = templates.email.subscriptionReminder({ hospital: r.HospitalName, plan: r.PlanName, endDate, daysLeft: r.DaysLeft, renewUrl: `${config.publicAppUrl}/app/subscription` });
    for (const to of [...new Set([r.OwnerEmail, r.HospitalEmail].filter(Boolean).map((e) => e.toLowerCase()))]) {
      const res = await deliver({ channel: 'email', to, template: 'subscription_reminder', tenantId: r.TenantId, content,
        related: { type: 'subscription', id: r.SubscriptionId }, dedupeKey: `sub-reminder:${r.SubscriptionId}:${endDate}:${r.DaysLeft}:${to}` });
      if (res.status === 'sent' || res.status === 'logged') sent += 1;
    }
  }
  return sent;
}

/**
 * The day before a follow-up date (after 9 am hospital time): remind the patient once, by e-mail if we have it, else
 * WhatsApp when the hospital has it switched on. Skipped when the patient already has a later visit or booking.
 */
export async function followUpReminders() {
  const rows = await db.query(`
    /* tenant-safe: platform job; every row carries its own TenantId */
    SELECT TOP 500 c.TenantId, c.ConsultationId, CONVERT(CHAR(10), c.FollowUpDate, 23) AS FollowUp, p.FirstName, p.Email, p.Phone, s.FullName AS Doctor,
           t.Name AS Hospital, t.Timezone,
           ISNULL((SELECT SettingValue FROM hms.TenantSettings x WHERE x.TenantId = c.TenantId AND x.SettingKey = 'notify.whatsapp'), 'on') AS Wa
    FROM hms.Consultations c
    JOIN hms.Patients p ON p.TenantId = c.TenantId AND p.PatientId = c.PatientId
    JOIN hms.StaffMembers s ON s.TenantId = c.TenantId AND s.StaffId = c.DoctorId
    JOIN hms.Tenants t ON t.TenantId = c.TenantId AND t.Status = 'active'
    WHERE c.Status = 'final' AND c.FollowUpDate = CAST(DATEADD(DAY, 1, SYSUTCDATETIME()) AS DATE) AND p.IsArchived = 0
      AND ISNULL((SELECT SettingValue FROM hms.TenantSettings x WHERE x.TenantId = c.TenantId AND x.SettingKey = 'notify.follow_up'), 'on') = 'on'
      AND NOT EXISTS (SELECT 1 FROM hms.Consultations c2 WHERE c2.TenantId = c.TenantId AND c2.PatientId = c.PatientId AND c2.CreatedAt > c.CreatedAt)
      AND NOT EXISTS (SELECT 1 FROM hms.Appointments a WHERE a.TenantId = c.TenantId AND a.PatientId = c.PatientId AND a.StartAt > c.CreatedAt
                      AND a.Status IN ('scheduled', 'checked_in', 'completed'))
      AND NOT EXISTS (SELECT 1 FROM hms.MessageLog m WHERE m.DedupeKey = CONCAT('followup:', c.TenantId, ':', c.ConsultationId))`);
  let sent = 0;
  for (const r of rows) {
    if (localHour(r.Timezone) < 9) continue;
    const date = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${r.FollowUp}T00:00:00Z`));
    const args = { patientFirst: r.FirstName, hospital: r.Hospital, doctor: r.Doctor, date };
    const channel = r.Email ? 'email' : (r.Phone && r.Wa === 'on' ? 'whatsapp' : null);
    if (!channel) continue;
    const res = await deliver({ channel, to: channel === 'email' ? r.Email : r.Phone, template: 'follow_up_reminder', tenantId: r.TenantId,
      content: channel === 'email' ? templates.email.followUpReminder(args) : templates.whatsapp.followUpReminder(args),
      related: { type: 'consultation', id: r.ConsultationId }, dedupeKey: `followup:${r.TenantId}:${r.ConsultationId}` });
    if (res.status === 'sent' || res.status === 'logged') sent += 1;
  }
  return sent;
}

/**
 * Once a day after 9 am hospital time: e-mail the owner (and pharmacists with an e-mail) the expired, expiring (≤ 30 days)
 * and low-stock medicines. Only when there is something to report; switch off with Settings → notify.stock_alerts.
 */
export async function pharmacyAlerts() {
  const tenants = await db.query(`
    /* tenant-safe: platform job; each hospital is processed with its own TenantId */
    SELECT t.TenantId, t.Name, t.Timezone FROM hms.Tenants t
    WHERE t.Status = 'active' AND ISNULL((SELECT SettingValue FROM hms.TenantSettings s WHERE s.TenantId = t.TenantId AND s.SettingKey = 'notify.stock_alerts'), 'on') = 'on'
      AND EXISTS (SELECT 1 FROM hms.StockBatches b WHERE b.TenantId = t.TenantId)`);
  let sent = 0;
  for (const tn of tenants) {
    if (localHour(tn.Timezone) < 9) continue;
    const date = localDateString(tn.Timezone);
    const [expiring, low] = await db.many(`
      SELECT TOP 60 m.Name AS name, m.Strength AS strength, b.BatchNumber AS batchNumber, CONVERT(CHAR(10), b.ExpiryDate, 23) AS expiryDate, b.QuantityOnHand AS quantity
      FROM hms.StockBatches b JOIN hms.Medicines m ON m.TenantId = b.TenantId AND m.MedicineId = b.MedicineId
      WHERE b.TenantId = @tid AND b.QuantityOnHand > 0 AND b.ExpiryDate <= DATEADD(DAY, 30, CAST(@date AS DATE)) ORDER BY b.ExpiryDate;
      SELECT TOP 60 * FROM (SELECT m.Name AS name, m.Strength AS strength, m.ReorderLevel AS reorderLevel,
             ISNULL((SELECT SUM(QuantityOnHand) FROM hms.StockBatches b WHERE b.TenantId = m.TenantId AND b.MedicineId = m.MedicineId AND b.ExpiryDate >= CAST(@date AS DATE)), 0) AS stock
        FROM hms.Medicines m WHERE m.TenantId = @tid AND m.IsActive = 1) x WHERE x.stock <= x.reorderLevel ORDER BY x.stock;`, { tid: tn.TenantId, date });
    const expired = expiring.filter((r) => r.expiryDate < date);
    const soon = expiring.filter((r) => r.expiryDate >= date);
    if (!expired.length && !soon.length && !low.length) continue;
    const content = templates.email.stockAlerts({ hospital: tn.Name, expiring: soon, expired, low, appUrl: `${config.publicAppUrl}/app/pharmacy` });
    const recipients = await db.query(`
      SELECT DISTINCT LOWER(u.Email) AS Email FROM hms.Users u
      WHERE u.TenantId = @tid AND u.Status = 'active' AND (u.IsOwner = 1 OR EXISTS (
        SELECT 1 FROM hms.UserRoles ur JOIN hms.Roles r ON r.TenantId = ur.TenantId AND r.RoleId = ur.RoleId
        WHERE ur.TenantId = u.TenantId AND ur.UserId = u.UserId AND r.Code = 'pharmacist'))`, { tid: tn.TenantId });
    for (const r of recipients) {
      const res = await deliver({ channel: 'email', to: r.Email, template: 'stock_alerts', tenantId: tn.TenantId, content,
        related: { type: 'pharmacy', id: null }, dedupeKey: `stock-alerts:${tn.TenantId}:${date}:${r.Email}` });
      if (res.status === 'sent' || res.status === 'logged') sent += 1;
    }
  }
  return sent;
}

/** After 8 pm hospital time, e-mail each owner a summary of the day (switch off in Settings). */
export async function dailySummaries() {
  const tenants = await db.query(`
    SELECT t.TenantId, t.Name, t.Timezone FROM hms.Tenants t
    WHERE t.Status = 'active' AND ISNULL((SELECT SettingValue FROM hms.TenantSettings s WHERE s.TenantId = t.TenantId AND s.SettingKey = 'notify.daily_summary'), 'on') = 'on'`);
  let sent = 0;
  for (const t of tenants) {
    if (localHour(t.Timezone) < 20) continue;
    const date = localDateString(t.Timezone);
    const { start, end } = localDayRangeUtc(t.Timezone, date);
    const k = await db.one(`SELECT
        (SELECT COUNT(*) FROM hms.Patients WHERE TenantId = @tid AND CreatedAt >= @start AND CreatedAt < @end) AS newPatients,
        (SELECT COUNT(*) FROM hms.Appointments WHERE TenantId = @tid AND StartAt >= @start AND StartAt < @end AND Status <> 'cancelled') AS appointments,
        (SELECT COUNT(*) FROM hms.Appointments WHERE TenantId = @tid AND StartAt >= @start AND StartAt < @end AND Status = 'completed') AS completed,
        (SELECT ISNULL(SUM(CASE WHEN Kind = 'payment' THEN Amount ELSE -Amount END), 0) FROM hms.MoneyReceived WHERE TenantId = @tid AND ReceivedAt >= @start AND ReceivedAt < @end) AS collections,
        (SELECT ISNULL(SUM(Amount), 0) FROM hms.Expenses WHERE TenantId = @tid AND ExpenseDate = CAST(@date AS DATE)) AS expenses,
        (SELECT COUNT(*) FROM hms.LabOrders WHERE TenantId = @tid AND OrderedAt >= @start AND OrderedAt < @end AND Status <> 'cancelled') AS labOrders,
        (SELECT COUNT(*) FROM hms.LabOrders WHERE TenantId = @tid AND Status IN ('ordered','sample_collected','completed')) AS labPending,
        (SELECT COUNT(*) FROM hms.Admissions WHERE TenantId = @tid AND Status = 'admitted') AS inpatients`,
    { tid: t.TenantId, start, end, date });
    const rows = [
      ['New patients', k.newPatients], ['Appointments (completed)', `${k.appointments} (${k.completed})`], ['Patients admitted now', k.inpatients],
      ['Lab orders today', k.labOrders], ['Lab orders still pending', k.labPending],
      ['Net collections', money(k.collections)], ['Expenses', money(k.expenses)], ['Cash profit today', money(Number(k.collections) - Number(k.expenses))],
    ];
    const owners = await db.query(`SELECT Email FROM hms.Users WHERE TenantId = @tid AND IsOwner = 1 AND Status = 'active'`, { tid: t.TenantId });
    for (const o of owners) {
      const res = await deliver({ channel: 'email', to: o.Email, template: 'daily_summary', tenantId: t.TenantId,
        content: templates.email.dailySummary({ hospital: t.Name, date, rows, appUrl: `${config.publicAppUrl}/app/dashboard` }),
        dedupeKey: `daily-summary:${t.TenantId}:${date}:${o.Email.toLowerCase()}` });
      if (res.status === 'sent' || res.status === 'logged') sent += 1;
    }
  }
  return sent;
}

/** Yesterday's tokens still waiting/called are closed so a new day starts clean. */
async function closeOldQueueTokens() {
  return db.exec(`/* tenant-safe: platform housekeeping across hospitals; each row keeps its TenantId */
    UPDATE q SET Status = 'cancelled', DoneAt = SYSUTCDATETIME() FROM hms.QueueTokens q
    WHERE q.Status IN ('waiting','called','skipped') AND q.TokenDate < CAST(DATEADD(DAY, -1, SYSUTCDATETIME()) AS DATE)`);
}

/** Online booking requests whose requested time has passed without a decision are closed (the slot is gone). */
async function expireBookingRequests() {
  return db.exec(`/* tenant-safe: platform housekeeping across hospitals; each row keeps its TenantId */
    UPDATE hms.OnlineBookingRequests SET Status = 'cancelled', DecisionNote = N'Expired — not confirmed before the requested time', DecidedAt = SYSUTCDATETIME()
    WHERE Status = 'pending' AND StartAt < DATEADD(HOUR, -2, SYSUTCDATETIME())`);
}

/** Sign-in history is kept for 180 days. */
async function pruneLoginEvents() {
  return db.exec(`/* tenant-safe: retention across hospitals */ DELETE TOP (5000) FROM hms.LoginEvents WHERE CreatedAt < DATEADD(DAY, -180, SYSUTCDATETIME())`);
}

const JOBS = { extendFreeSubscriptions, autoBedCharges, appointmentReminders, followUpReminders, subscriptionReminders, pharmacyAlerts,
  recurringExpenses: () => postDueRecurringExpenses(), dailySummaries, closeOldQueueTokens, expireBookingRequests, pruneLoginEvents };
export const JOB_NAMES = Object.keys(JOBS);
let running = false;

/** One row per job in hms.JobRuns, shown on the Super Admin monitoring page. Never throws. */
async function recordJobRun(name, startedAt, error) {
  try {
    await db.exec(`MERGE hms.JobRuns WITH (HOLDLOCK) AS tgt USING (SELECT @n AS JobName) AS src ON tgt.JobName = src.JobName
      WHEN MATCHED THEN UPDATE SET LastStartedAt = @s, LastFinishedAt = SYSUTCDATETIME(), LastOk = @ok, LastError = @err, LastDurationMs = @ms,
        RunCount = tgt.RunCount + 1, FailCount = tgt.FailCount + CASE WHEN @ok = 1 THEN 0 ELSE 1 END
      WHEN NOT MATCHED THEN INSERT (JobName, LastStartedAt, LastFinishedAt, LastOk, LastError, LastDurationMs, RunCount, FailCount)
        VALUES (@n, @s, SYSUTCDATETIME(), @ok, @err, @ms, 1, CASE WHEN @ok = 1 THEN 0 ELSE 1 END);`,
    { n: name, s: startedAt, ok: !error, err: error ? String(error.message || error).slice(0, 500) : null, ms: Date.now() - startedAt.getTime() });
  } catch (err) {
    console.error(`[jobs] could not record run of ${name}: ${err.message}`);
  }
}

export async function runJobsOnce(log = () => {}) {
  if (running) return;
  running = true;
  try {
    for (const [name, job] of Object.entries(JOBS)) {
      const startedAt = new Date();
      try {
        const n = await job();
        if (n) log(`[jobs] ${name}: ${n}`);
        await recordJobRun(name, startedAt, null);
      } catch (err) {
        console.error(`[jobs] ${name} failed: ${err.message}`);
        await recordJobRun(name, startedAt, err);
      }
    }
  } finally { running = false; }
}

export function startScheduler() {
  if (!config.jobs.enabled) { console.log('[jobs] scheduler disabled (JOBS_ENABLED=false)'); return () => {}; }
  const first = setTimeout(() => runJobsOnce(console.log), 30_000);
  const timer = setInterval(() => runJobsOnce(console.log), config.jobs.intervalSec * 1000);
  timer.unref(); first.unref();
  return () => { clearTimeout(first); clearInterval(timer); };
}
