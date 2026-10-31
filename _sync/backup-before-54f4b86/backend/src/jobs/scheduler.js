// In-process scheduler for reminders and summaries. Safe to run on several servers at once:
// every message carries a DedupeKey (unique in hms.MessageLog), so it is sent at most once.
import { config } from '../config/env.js';
import { db } from '../db/pool.js';
import { deliver, templates } from '../notify/index.js';
import { sendAppointmentMessage } from '../notify/appointments.js';
import { localDateString, localDayRangeUtc } from '../utils/time.js';
import { autoBedCharges } from '../modules/ipd/bedCharges.service.js';

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

const JOBS = { extendFreeSubscriptions, autoBedCharges, appointmentReminders, followUpReminders, subscriptionReminders, dailySummaries };
let running = false;

export async function runJobsOnce(log = () => {}) {
  if (running) return;
  running = true;
  try {
    for (const [name, job] of Object.entries(JOBS)) {
      try {
        const n = await job();
        if (n) log(`[jobs] ${name}: ${n}`);
      } catch (err) {
        console.error(`[jobs] ${name} failed: ${err.message}`);
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
