// Sign-in history (hospital users and Super Admins). Best effort: a logging failure never blocks a sign-in.
import { db } from '../db/pool.js';

/** reason: ok | bad_password | unknown_user | locked | disabled | tenant_inactive */
export async function recordLogin({ subjectType, tenantId = null, userId = null, email = null, success, reason, ip = null, userAgent = null }) {
  try {
    await db.exec(`/* tenant-safe: sign-in event, TenantId stored on the row */ INSERT INTO hms.LoginEvents (SubjectType, TenantId, UserId, Email, Success, Reason, Ip, UserAgent)
                   VALUES (@type, @tid, @uid, @email, @ok, @reason, @ip, @ua)`,
    { type: subjectType, tid: tenantId, uid: userId, email: email ? String(email).toLowerCase().slice(0, 254) : null, ok: Boolean(success),
      reason: reason?.slice(0, 40) ?? null, ip: ip ? String(ip).slice(0, 64) : null, ua: userAgent ? String(userAgent).slice(0, 300) : null });
  } catch (err) {
    console.error('[login-events] could not record sign-in:', err.message);
  }
}

/** Short, readable device name from a User-Agent string (no fingerprinting library). */
export function describeAgent(ua) {
  const s = String(ua || '');
  if (!s) return 'Unknown device';
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera' : /Chrome\//.test(s) ? 'Chrome' : /Firefox\//.test(s) ? 'Firefox' : /Safari\//.test(s) ? 'Safari' : 'Browser';
  const os = /Windows/.test(s) ? 'Windows' : /Android/.test(s) ? 'Android' : /iPhone|iPad/.test(s) ? 'iOS' : /Mac OS X/.test(s) ? 'macOS' : /Linux/.test(s) ? 'Linux' : 'Other';
  return `${browser} on ${os}`;
}
