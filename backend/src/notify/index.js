// Single entry point for sending e-mail / WhatsApp. Every attempt is written to hms.MessageLog
// (recipient masked). Failures are logged and returned — they never break the business action.
import { db } from '../db/pool.js';
import { config } from '../config/env.js';
import { sendEmailRaw, sendWhatsAppRaw, emailIsLive, whatsappIsLive } from './providers.js';
import { senderFor } from './sender.js';
import { normalisePhone, maskPhone, maskEmail, isEmail } from './format.js';
import * as templates from './templates.js';

export { templates };

const DUPLICATE = (err) => [2601, 2627].includes(err?.number ?? err?.originalError?.info?.number);

/**
 * @param {object} m
 * @param {'email'|'whatsapp'} m.channel
 * @param {string} m.to             e-mail address or phone number
 * @param {string} m.template       short name for the log (e.g. 'report_link')
 * @param {object} m.content        e-mail {subject,text,html} or WhatsApp {template,params,previewText}
 * @param {number|null} [m.tenantId]
 * @param {{type:string,id:any}} [m.related]
 * @param {string} [m.dedupeKey]    when set, a message with the same key is sent at most once
 * @returns {Promise<{status:string, masked:string, error?:string}>}
 */
export async function deliver({ channel, to, template, content, tenantId = null, related = null, dedupeKey = null }) {
  let address = to;
  if (channel === 'whatsapp') address = normalisePhone(to, config.whatsapp.defaultCountryCode);
  if (channel === 'email' && !isEmail(to)) address = null;
  const masked = channel === 'email' ? maskEmail(to) : maskPhone(address || to);
  if (!address) return { status: 'skipped', masked, error: `No valid ${channel === 'email' ? 'e-mail address' : 'mobile number'} on record.` };

  const sender = await senderFor(tenantId).catch(() => ({ from: config.email.from, account: null, via: 'platform' }));
  const via = (channel === 'email' ? sender.account?.smtp : sender.account?.whatsapp) ? 'hospital' : 'platform';

  let logId;
  try {
    const row = await db.one(
      `INSERT INTO hms.MessageLog (TenantId, Channel, RecipientMasked, Template, Subject, RelatedType, RelatedId, DedupeKey, SentVia)
       OUTPUT INSERTED.MessageId VALUES (@tid, @ch, @to, @tpl, @subj, @rtype, @rid, @key, @via)`,
      { tid: tenantId, ch: channel, to: masked, tpl: template, subj: content.subject?.slice(0, 200) ?? null,
        rtype: related?.type ?? null, rid: related?.id == null ? null : String(related.id), key: dedupeKey, via });
    logId = row.MessageId;
  } catch (err) {
    if (dedupeKey && DUPLICATE(err)) return { status: 'skipped', masked, error: 'Already sent.' };
    throw err;
  }

  try {
    const r = channel === 'email'
      ? await sendEmailRaw({ to: address, ...content, from: sender.from, replyTo: sender.replyTo, account: sender.account })
      : await sendWhatsAppRaw({ to: address, ...content, account: sender.account });
    await db.exec(`/* tenant-safe: row created by this same send */ UPDATE hms.MessageLog SET Status = @s, ProviderMessageId = @pid, SentAt = SYSUTCDATETIME() WHERE MessageId = @id`,
      { id: logId, s: r.status, pid: r.providerMessageId ?? null });
    return { status: r.status, masked };
  } catch (err) {
    const msg = String(err?.message || err).slice(0, 400);
    console.error(`[notify] ${channel} ${template} failed: ${msg}`);
    await db.exec(`/* tenant-safe: row created by this same send */ UPDATE hms.MessageLog SET Status = 'failed', Error = @e WHERE MessageId = @id`, { id: logId, e: msg }).catch(() => {});
    return { status: 'failed', masked, error: msg };
  }
}

/** Runs a send without making the caller wait or fail (used after a transaction commits). */
export function deliverLater(message) {
  setImmediate(() => { deliver(message).catch((e) => console.error('[notify] background send failed:', e.message)); });
}

/** Whether e-mail / WhatsApp are really delivered for this hospital (own account or platform account). */
export async function messagingStatus(tenantId = null) {
  const s = tenantId ? await senderFor(tenantId).catch(() => null) : null;
  return { email: emailIsLive(s?.account), whatsapp: whatsappIsLive(s?.account), via: s?.via ?? 'platform' };
}
