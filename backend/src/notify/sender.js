// Who a message comes from.
//  • Default ("on behalf of"): the platform's account, but the hospital's NAME as the sender and the
//    hospital's e-mail as Reply-To — so patients see and reply to their hospital. No setup per hospital.
//  • Enterprise option: the hospital's OWN SMTP / WhatsApp account (hms.TenantMessagingConfig, secrets encrypted).
import { db } from '../db/pool.js';
import { config } from '../config/env.js';
import { open } from '../utils/secretBox.js';
import { isEmail, addressOf, formatFrom } from './format.js';

const CACHE_MS = 60_000;
const cache = new Map(); // tenantId -> { at, value }

const platformSender = () => ({ from: config.email.from, replyTo: undefined, account: null, via: 'platform' });

export function clearSenderCache(tenantId) { cache.delete(Number(tenantId)); }

/** Resolves the sender for a hospital (cached for a minute). Never throws: falls back to the platform account. */
export async function senderFor(tenantId) {
  if (!tenantId) return platformSender();
  const hit = cache.get(Number(tenantId));
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const r = await db.one(`
    SELECT t.Name, t.Email,
           (SELECT SettingValue FROM hms.TenantSettings WHERE TenantId = t.TenantId AND SettingKey = 'notify.reply_to') AS ReplyTo,
           (SELECT TOP 1 pf.IsIncluded FROM hms.Subscriptions s JOIN hms.PlanFeatures pf ON pf.PlanId = s.PlanId AND pf.FeatureKey = 'own_messaging'
             WHERE s.TenantId = t.TenantId ORDER BY s.CurrentPeriodEnd DESC) AS OwnAllowed,
           c.EmailEnabled, c.SmtpHost, c.SmtpPort, c.SmtpSecure, c.SmtpUser, c.SmtpPassEnc, c.FromEmail, c.WhatsAppEnabled, c.WaPhoneNumberId, c.WaTokenEnc
    FROM hms.Tenants t LEFT JOIN hms.TenantMessagingConfig c ON c.TenantId = t.TenantId
    WHERE t.TenantId = @tid`, { tid: tenantId });
  if (!r) return platformSender();

  const replyTo = [r.ReplyTo, r.Email].find(isEmail);
  const value = { from: formatFrom(r.Name, addressOf(config.email.from)), replyTo, account: null, via: 'platform' };

  if (r.OwnAllowed && config.messagingKey) {
    try {
      const account = {};
      if (r.EmailEnabled && r.SmtpHost && r.FromEmail) {
        account.smtp = { host: r.SmtpHost, port: r.SmtpPort || 587, secure: Boolean(r.SmtpSecure), user: r.SmtpUser || '',
          pass: r.SmtpPassEnc ? open(r.SmtpPassEnc, config.messagingKey) : '' };
        value.from = formatFrom(r.Name, r.FromEmail);
      }
      if (r.WhatsAppEnabled && r.WaPhoneNumberId && r.WaTokenEnc) {
        account.whatsapp = { phoneNumberId: r.WaPhoneNumberId, token: open(r.WaTokenEnc, config.messagingKey) };
      }
      if (account.smtp || account.whatsapp) { value.account = account; value.via = 'hospital'; }
    } catch (err) {
      console.error(`[notify] hospital ${tenantId}: own messaging account unusable (${err.message}); using the platform account.`);
    }
  }
  cache.set(Number(tenantId), { at: Date.now(), value });
  return value;
}
