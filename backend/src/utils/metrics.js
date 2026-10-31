// Lightweight in-process health counters for the Super Admin monitoring page (reset on restart; no request bodies,
// no personal data — only method, route path, status and time).
const startedAt = new Date();
const state = { requests: 0, errors5xx: 0, errors4xx: 0, recentErrors: [] };

export function countRequest(status) {
  state.requests += 1;
  if (status >= 500) state.errors5xx += 1;
  else if (status >= 400) state.errors4xx += 1;
}

/** Remembers the last 25 server errors (path without query string, so no tokens or search terms are kept). */
export function rememberError({ method, path, code }) {
  state.recentErrors.unshift({ at: new Date().toISOString(), method, path: String(path).split('?')[0].slice(0, 120), code });
  state.recentErrors.length = Math.min(state.recentErrors.length, 25);
}

export function snapshot() {
  const mem = process.memoryUsage();
  return {
    startedAt: startedAt.toISOString(), uptimeSec: Math.round(process.uptime()), node: process.version,
    memoryMb: { rss: Math.round(mem.rss / 1048576), heapUsed: Math.round(mem.heapUsed / 1048576), heapTotal: Math.round(mem.heapTotal / 1048576) },
    requests: state.requests, errors5xx: state.errors5xx, errors4xx: state.errors4xx, recentErrors: [...state.recentErrors],
  };
}
