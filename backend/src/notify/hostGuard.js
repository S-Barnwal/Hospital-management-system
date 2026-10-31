// Stops a hospital-supplied SMTP host from making our server connect to internal machines (SSRF).
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** True for loopback, private, link-local, CGNAT, multicast/reserved and IPv6 local ranges. */
export function isPrivateIp(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0);
  }
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
    return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9')
      || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
  }
  return true;
}

/** Resolves the host and throws if any address is not a public internet address. */
export async function assertPublicHost(host) {
  const name = String(host || '').trim().toLowerCase();
  if (!/^[a-z0-9.-]{1,253}$/.test(name) || name === 'localhost' || name.endsWith('.local') || name.endsWith('.internal')) {
    throw new Error('Enter a public SMTP server name, e.g. smtp.zoho.in');
  }
  const addrs = await lookup(name, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error(`The SMTP server "${name}" could not be found.`);
  if (addrs.some((a) => isPrivateIp(a.address))) throw new Error('This SMTP server address is not allowed.');
  return addrs[0].address;
}
