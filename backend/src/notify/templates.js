// Message texts. E-mail = { subject, text, html }. WhatsApp = { template, params, previewText };
// `template` names must exist (approved) in your WhatsApp Business account — see documentation/15-messaging-setup.md.
import { escapeHtml as h } from './format.js';

const wrap = (title, bodyHtml, footer) => `<!doctype html><html><body style="margin:0;background:#f6f7f3;font-family:Arial,sans-serif;color:#0f2a20">
<div style="max-width:560px;margin:24px auto;background:#fff;border:1px solid #e3e8e4;border-radius:12px;overflow:hidden">
<div style="background:#0d2a1f;color:#fff;padding:16px 24px;font-size:18px;font-weight:bold">${h(title)}</div>
<div style="padding:24px;font-size:15px;line-height:1.6">${bodyHtml}</div>
<div style="padding:12px 24px;font-size:12px;color:#6b7c74;border-top:1px solid #e3e8e4">${h(footer || 'Sent by MediCore HMS. Please do not reply to this e-mail.')}</div>
</div></body></html>`;
const button = (href, label) => `<p><a href="${h(href)}" style="display:inline-block;background:#0d4d36;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">${h(label)}</a></p>`;

export const email = {
  passwordReset: ({ name, link, minutes }) => ({
    subject: 'Reset your MediCore password',
    text: `Hello ${name},\n\nUse this link to set a new password (valid for ${minutes} minutes):\n${link}\n\nIf you did not ask for this, ignore this e-mail — your password stays the same.`,
    html: wrap('Reset your password', `<p>Hello ${h(name)},</p><p>Click below to set a new password. The link is valid for ${minutes} minutes and works once.</p>${button(link, 'Set a new password')}<p style="color:#6b7c74">If you did not ask for this, ignore this e-mail — your password stays the same.</p>`),
  }),
  loginOtp: ({ name, code, minutes }) => ({
    subject: `${code} is your MediCore sign-in code`,
    text: `Hello ${name},\n\nYour sign-in code is ${code}. It expires in ${minutes} minutes.\nNever share this code with anyone. If you did not try to sign in, change your password.`,
    html: wrap('Your sign-in code', `<p>Hello ${h(name)},</p><p style="font-size:28px;letter-spacing:6px;font-weight:bold">${h(code)}</p><p>It expires in ${minutes} minutes. Never share this code with anyone.</p><p style="color:#6b7c74">If you did not try to sign in, change your password now.</p>`),
  }),
  reportLink: ({ hospital, patientFirst, link, days }) => ({
    subject: `Your lab report from ${hospital} is ready`,
    text: `Dear ${patientFirst},\n\nYour lab report from ${hospital} is ready. Open this secure link and enter the one-time code we send you:\n${link}\n\nThe link is valid for ${days} days.`,
    html: wrap(`${hospital}`, `<p>Dear ${h(patientFirst)},</p><p>Your lab report is ready. For your privacy, you will be asked for a one-time code before it opens.</p>${button(link, 'View my report')}<p style="color:#6b7c74">The link is valid for ${days} days.</p>`),
  }),
  reportOtp: ({ hospital, code, minutes }) => ({
    subject: `${code} is your code to open your report`,
    text: `Your code to open your lab report from ${hospital} is ${code}. It expires in ${minutes} minutes. Do not share it.`,
    html: wrap(hospital, `<p>Your code to open your lab report:</p><p style="font-size:28px;letter-spacing:6px;font-weight:bold">${h(code)}</p><p>It expires in ${minutes} minutes. Do not share it.</p>`),
  }),
  subscriptionReminder: ({ hospital, plan, endDate, daysLeft, renewUrl }) => {
    const when = daysLeft > 0 ? `ends in ${daysLeft} day(s), on ${endDate}` : `ended on ${endDate}`;
    return {
      subject: daysLeft > 0 ? `Your MediCore subscription ends in ${daysLeft} day(s)` : 'Your MediCore subscription has ended',
      text: `Hello,\n\nThe ${plan} plan for ${hospital} ${when}.\nRenew here: ${renewUrl}\n\nYour data is always safe — if the subscription lapses it becomes read-only until renewed.`,
      html: wrap('Subscription reminder', `<p>Hello,</p><p>The <strong>${h(plan)}</strong> plan for <strong>${h(hospital)}</strong> ${h(when)}.</p>${button(renewUrl, 'Renew now')}<p style="color:#6b7c74">Your data is always safe — if the subscription lapses it becomes read-only until renewed.</p>`),
    };
  },
  appointmentConfirmed: ({ patientFirst, hospital, doctor, when, number }) => ({
    subject: `Appointment confirmed — ${hospital}, ${when}`,
    text: `Dear ${patientFirst},\n\nYour appointment with ${doctor} on ${when} at ${hospital} is confirmed.\nReference: ${number}\n\nPlease arrive 10 minutes early. To change it, reply to this e-mail or call the hospital.`,
    html: wrap(hospital, `<p>Dear ${h(patientFirst)},</p><p>Your appointment is <strong>confirmed</strong>.</p><table style="border-collapse:collapse"><tr><td style="padding:4px 12px 4px 0;color:#6b7c74">Doctor</td><td><strong>${h(doctor)}</strong></td></tr><tr><td style="padding:4px 12px 4px 0;color:#6b7c74">When</td><td><strong>${h(when)}</strong></td></tr><tr><td style="padding:4px 12px 4px 0;color:#6b7c74">Reference</td><td>${h(number)}</td></tr></table><p>Please arrive 10 minutes early. To change it, reply to this e-mail or call the hospital.</p>`),
  }),
  appointmentReminder: ({ patientFirst, hospital, doctor, when, number }) => ({
    subject: `Reminder: appointment ${when} — ${hospital}`,
    text: `Dear ${patientFirst},\n\nThis is a reminder of your appointment with ${doctor} on ${when} at ${hospital}.\nReference: ${number}\n\nIf you cannot come, please reply to this e-mail or call the hospital.`,
    html: wrap(hospital, `<p>Dear ${h(patientFirst)},</p><p>This is a reminder of your appointment:</p><table style="border-collapse:collapse"><tr><td style="padding:4px 12px 4px 0;color:#6b7c74">Doctor</td><td><strong>${h(doctor)}</strong></td></tr><tr><td style="padding:4px 12px 4px 0;color:#6b7c74">When</td><td><strong>${h(when)}</strong></td></tr><tr><td style="padding:4px 12px 4px 0;color:#6b7c74">Reference</td><td>${h(number)}</td></tr></table><p>If you cannot come, please reply to this e-mail or call the hospital.</p>`),
  }),
  paymentLink: ({ hospital, patientFirst, billNumber, amount, link, days }) => ({
    subject: `Bill ${billNumber} from ${hospital} — ₹${amount} due`,
    text: `Dear ${patientFirst},\n\nYour bill ${billNumber} from ${hospital} has ₹${amount} due. Pay securely by UPI here:\n${link}\n\nThe link is valid for ${days} days. If you have already paid, please ignore this message.`,
    html: wrap(hospital, `<p>Dear ${h(patientFirst)},</p><p>Your bill <strong>${h(billNumber)}</strong> has <strong>₹${h(amount)}</strong> due. You can pay with any UPI app.</p>${button(link, 'Pay now')}<p style="color:#6b7c74">The link is valid for ${days} days. If you have already paid, please ignore this message.</p>`),
  }),
  followUpReminder: ({ patientFirst, hospital, doctor, date }) => ({
    subject: `Follow-up visit due ${date} — ${hospital}`,
    text: `Dear ${patientFirst},\n\n${doctor} asked to see you again on ${date} at ${hospital}. Please call the hospital to book a time.\n\nIf you have already booked, please ignore this message.`,
    html: wrap(hospital, `<p>Dear ${h(patientFirst)},</p><p><strong>${h(doctor)}</strong> asked to see you again on <strong>${h(date)}</strong>.</p><p>Please call the hospital to book a time. If you have already booked, ignore this message.</p>`),
  }),
  stockAlerts: ({ hospital, expiring, expired, low, appUrl }) => {
    const li = (r) => `${r.name}${r.strength ? ` ${r.strength}` : ''}${r.batchNumber ? ` · batch ${r.batchNumber}` : ''}${r.expiryDate ? ` · ${r.expiryDate}` : ''} · qty ${r.quantity ?? r.stock}`;
    const section = (title, rows) => (rows.length ? `<p><strong>${h(title)}</strong></p><ul>${rows.slice(0, 30).map((r) => `<li>${h(li(r))}</li>`).join('')}</ul>` : '');
    return {
      subject: `${hospital} — pharmacy alerts: ${expired.length} expired, ${expiring.length} expiring, ${low.length} low`,
      text: [`${hospital} — pharmacy alerts`, '', expired.length ? `EXPIRED (remove from shelf):\n${expired.map(li).join('\n')}` : '',
        expiring.length ? `EXPIRING within 30 days:\n${expiring.map(li).join('\n')}` : '', low.length ? `LOW STOCK:\n${low.map(li).join('\n')}` : '', `Open pharmacy: ${appUrl}`].filter(Boolean).join('\n\n'),
      html: wrap(`Pharmacy alerts · ${hospital}`, `${section('Expired — remove from the shelf', expired)}${section('Expiring within 30 days', expiring)}${section('Low stock — reorder', low)}${button(appUrl, 'Open pharmacy')}`,
        'You receive this because pharmacy alerts are switched on in Settings.'),
    };
  },
  supportUpdate: ({ ticketNumber, subject, by, status, excerpt, link, toSupport }) => ({
    subject: `[${ticketNumber}] ${subject}${toSupport ? ' — new message from hospital' : ' — reply from support'}`,
    text: `${toSupport ? `New message on ${ticketNumber} from ${by}` : `Support replied on ${ticketNumber}`}.\nStatus: ${status.replace(/_/g, ' ')}\n\n${excerpt}\n\nOpen the ticket: ${link}`,
    html: wrap(`Support ticket ${ticketNumber}`, `<p><strong>${h(subject)}</strong></p><p>${h(toSupport ? `New message from ${by}` : 'Our support team replied')} · status <strong>${h(status.replace(/_/g, ' '))}</strong></p>
      <blockquote style="border-left:3px solid #c9a227;margin:12px 0;padding:4px 12px;color:#334">${h(excerpt)}</blockquote>${button(link, 'Open ticket')}`,
    'Please do not include patient names or medical details in support tickets.'),
  }),
  bookingReceived: ({ hospital, patientFirst, doctor, when, ref }) => ({
    subject: `${hospital} — appointment request ${ref} received`,
    text: `Dear ${patientFirst},\n\nWe have received your request to see ${doctor} on ${when} (reference ${ref}). The hospital will confirm it shortly.\n\n${hospital}`,
    html: wrap('Appointment request received', `<p>Dear ${h(patientFirst)},</p><p>We have received your request to see <strong>${h(doctor)}</strong> on <strong>${h(when)}</strong>.</p>
      <p>Reference: <strong>${h(ref)}</strong>. ${h(hospital)} will confirm it shortly.</p>`, 'You receive this because you requested an appointment online.'),
  }),
  bookingDeclined: ({ hospital, patientFirst, when, ref, note }) => ({
    subject: `${hospital} — appointment request ${ref}`,
    text: `Dear ${patientFirst},\n\nSorry, ${hospital} could not confirm your appointment request for ${when} (reference ${ref}).${note ? `\nNote: ${note}` : ''}\nPlease book another time or call the hospital.`,
    html: wrap('Appointment request', `<p>Dear ${h(patientFirst)},</p><p>Sorry, ${h(hospital)} could not confirm your request for <strong>${h(when)}</strong> (reference ${h(ref)}).</p>${note ? `<p>${h(note)}</p>` : ''}<p>Please choose another time or call the hospital.</p>`,
      'You receive this because you requested an appointment online.'),
  }),
  dailySummary: ({ hospital, date, rows, appUrl }) => ({
    subject: `${hospital} — daily summary for ${date}`,
    text: `${hospital} — ${date}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nOpen the dashboard: ${appUrl}`,
    html: wrap(`Daily summary · ${date}`, `<p><strong>${h(hospital)}</strong></p><table style="width:100%;border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="padding:6px 0;border-bottom:1px solid #eef1ee">${h(k)}</td><td style="padding:6px 0;border-bottom:1px solid #eef1ee;text-align:right;font-weight:bold">${h(v)}</td></tr>`).join('')}</table>${button(appUrl, 'Open dashboard')}`,
      'You receive this because daily summaries are switched on in Settings.'),
  }),
};

export const whatsapp = {
  reportLink: ({ hospital, patientFirst, link }) => ({
    template: 'lab_report_ready', params: [patientFirst, hospital, link],
    previewText: `Dear ${patientFirst}, your lab report from ${hospital} is ready: ${link}`,
  }),
  reportOtp: ({ hospital, code }) => ({
    template: 'report_otp', params: [code, hospital],
    previewText: `${code} is your code to open your lab report from ${hospital}.`,
  }),
  appointmentConfirmed: ({ patientFirst, hospital, doctor, when, number }) => ({
    template: 'appointment_confirmed', params: [patientFirst, doctor, when, hospital, number],
    previewText: `Dear ${patientFirst}, your appointment with ${doctor} on ${when} at ${hospital} is confirmed (${number}).`,
  }),
  paymentLink: ({ hospital, patientFirst, billNumber, amount, link }) => ({
    template: 'bill_payment_link', params: [patientFirst, hospital, billNumber, amount, link],
    previewText: `Dear ${patientFirst}, bill ${billNumber} from ${hospital}: ₹${amount} due. Pay by UPI: ${link}`,
  }),
  followUpReminder: ({ patientFirst, hospital, doctor, date }) => ({
    template: 'follow_up_reminder', params: [patientFirst, doctor, date, hospital],
    previewText: `Dear ${patientFirst}, ${doctor} asked to see you again on ${date} at ${hospital}. Please call to book.`,
  }),
  appointmentReminder: ({ patientFirst, hospital, doctor, when, number }) => ({
    template: 'appointment_reminder', params: [patientFirst, doctor, when, hospital, number],
    previewText: `Reminder: ${patientFirst}, you have an appointment with ${doctor} on ${when} at ${hospital} (${number}).`,
  }),
};
