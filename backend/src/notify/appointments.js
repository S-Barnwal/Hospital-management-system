// Appointment confirmation / reminder for one appointment. Respects the hospital's "notify.whatsapp"
// (= "messages to patients") setting. Channel: WhatsApp when it is live and the patient has a mobile number,
// otherwise e-mail when the patient has an e-mail address.
import { db } from '../db/pool.js';
import { deliver, templates } from './index.js';
import { senderFor } from './sender.js';
import { whatsappIsLive } from './providers.js';
import { normalisePhone, isEmail } from './format.js';
import { config } from '../config/env.js';

const fmtWhen = (date, timeZone) => new Intl.DateTimeFormat('en-IN', { timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(date));

/** kind: 'confirmed' | 'reminder'. Reminders are de-duplicated so each appointment gets at most one. */
export async function sendAppointmentMessage(tenantId, appointmentId, kind) {
  const a = await db.one(`
    SELECT a.AppointmentId, a.AppointmentNumber, a.StartAt, a.Status, p.FirstName, p.Phone, p.Email, s.FullName AS DoctorName, t.Name AS HospitalName, t.Timezone,
           (SELECT SettingValue FROM hms.TenantSettings WHERE TenantId = a.TenantId AND SettingKey = 'notify.whatsapp') AS Setting
    FROM hms.Appointments a
    JOIN hms.Patients p ON p.TenantId = a.TenantId AND p.PatientId = a.PatientId
    JOIN hms.StaffMembers s ON s.TenantId = a.TenantId AND s.StaffId = a.DoctorId
    JOIN hms.Tenants t ON t.TenantId = a.TenantId
    WHERE a.TenantId = @tid AND a.AppointmentId = @id`, { tid: tenantId, id: appointmentId });
  if (!a || a.Setting === 'off' || a.Status !== 'scheduled') return { status: 'skipped' };
  const args = { patientFirst: a.FirstName, hospital: a.HospitalName, doctor: a.DoctorName, when: fmtWhen(a.StartAt, a.Timezone), number: a.AppointmentNumber };
  const sender = await senderFor(tenantId);
  const hasPhone = Boolean(normalisePhone(a.Phone, config.whatsapp.defaultCountryCode));
  const channel = hasPhone && whatsappIsLive(sender.account) ? 'whatsapp' : isEmail(a.Email) ? 'email' : hasPhone ? 'whatsapp' : null;
  if (!channel) return { status: 'skipped' };
  const reminder = kind === 'reminder';
  const content = channel === 'email'
    ? (reminder ? templates.email.appointmentReminder(args) : templates.email.appointmentConfirmed(args))
    : (reminder ? templates.whatsapp.appointmentReminder(args) : templates.whatsapp.appointmentConfirmed(args));
  return deliver({
    channel, to: channel === 'email' ? a.Email : a.Phone, tenantId, related: { type: 'appointment', id: appointmentId },
    template: reminder ? 'appointment_reminder' : 'appointment_confirmed', content,
    dedupeKey: `appt-${kind}:${tenantId}:${appointmentId}`,
  });
}
