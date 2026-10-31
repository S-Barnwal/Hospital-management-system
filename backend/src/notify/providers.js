// Transport adapters. Each returns { status: 'sent' | 'logged', providerMessageId? } or throws.
// `account` (optional) = a hospital's own e-mail / WhatsApp account; otherwise the platform account from .env is used.
import { config } from '../config/env.js';
import { assertPublicHost } from './hostGuard.js';

let platformTransporter = null;
const loadNodemailer = async () => (await import('nodemailer')).default;

async function platformTransport() {
  if (!platformTransporter) {
    const s = config.email.smtp;
    platformTransporter = (await loadNodemailer()).createTransport({ host: s.host, port: s.port, secure: s.secure, auth: s.user ? { user: s.user, pass: s.pass } : undefined });
  }
  return platformTransporter;
}

/** One-off transport for a hospital's own SMTP server. Connects to the IP we vetted (no DNS rebinding). */
async function hospitalTransport(smtp) {
  const ip = await assertPublicHost(smtp.host);
  return (await loadNodemailer()).createTransport({
    host: ip, port: smtp.port, secure: smtp.secure, auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    tls: { servername: smtp.host }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000,
  });
}

/** True when this send will really be delivered (not log mode). */
export const emailIsLive = (account) => Boolean(account?.smtp) || config.email.provider === 'smtp';
export const whatsappIsLive = (account) => Boolean(account?.whatsapp) || config.whatsapp.provider === 'meta';

export async function sendEmailRaw({ to, subject, text, html, from, replyTo, account }) {
  if (account?.smtp) {
    const info = await (await hospitalTransport(account.smtp)).sendMail({ from, replyTo, to, subject, text, html });
    return { status: 'sent', providerMessageId: info.messageId };
  }
  if (config.email.provider === 'smtp') {
    const info = await (await platformTransport()).sendMail({ from, replyTo, to, subject, text, html });
    return { status: 'sent', providerMessageId: info.messageId };
  }
  // log mode: never print message bodies in production (they may contain codes or health data).
  console.log(`[email:log] from=${from} to=${to}${replyTo ? ` reply-to=${replyTo}` : ''} subject="${subject}"${config.isProd ? '' : `\n${text}\n`}`);
  return { status: 'logged' };
}

/**
 * WhatsApp Cloud API (Meta). Business-initiated messages must use a pre-approved template;
 * `params` fill its {{1}}, {{2}}… body placeholders in order.
 */
export async function sendWhatsAppRaw({ to, template, params, previewText, language, account }) {
  const own = account?.whatsapp;
  if (own || config.whatsapp.provider === 'meta') {
    const phoneNumberId = own ? own.phoneNumberId : config.whatsapp.phoneNumberId;
    const token = own ? own.token : config.whatsapp.token;
    const res = await fetch(`https://graph.facebook.com/v20.0/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to, type: 'template',
        template: { name: template, language: { code: language || config.whatsapp.language }, components: [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p).slice(0, 1000) })) }] },
      }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error?.message || `WhatsApp API error ${res.status}`);
    return { status: 'sent', providerMessageId: body?.messages?.[0]?.id };
  }
  console.log(`[whatsapp:log] to=${to} template=${template}${config.isProd ? '' : `\n${previewText}\n`}`);
  return { status: 'logged' };
}
