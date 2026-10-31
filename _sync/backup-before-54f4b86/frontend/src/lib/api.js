// Thin fetch wrapper: JSON, cookies, anti-CSRF header and one automatic token refresh.
const BASE = (import.meta.env?.VITE_API_BASE_URL || '') + '/api/v1';

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
  /** Field → message map for forms. */
  get fieldErrors() {
    return Object.fromEntries((this.details || []).map((d) => [d.path, d.message]));
  }
}

let refreshing = null;

async function raw(method, path, body) {
  return fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function request(method, path, body, { retry = true } = {}) {
  let res;
  try {
    res = await raw(method, path, body);
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and that the API is running.');
  }
  const isAdmin = path.startsWith('/admin') || path.startsWith('/auth/admin');
  if (res.status === 401 && retry && !/\/auth\/(admin\/)?(login|refresh|logout)/.test(path)) {
    refreshing ??= raw('POST', isAdmin ? '/auth/admin/refresh' : '/auth/refresh').finally(() => { refreshing = null; });
    const r = await refreshing;
    if (r.ok) return request(method, path, body, { retry: false });
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const e = json?.error || {};
    throw new ApiError(res.status, e.code || 'ERROR', e.message || `Request failed (${res.status})`, e.details);
  }
  return json;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b = {}) => request('POST', p, b),
  put: (p, b = {}) => request('PUT', p, b),
  patch: (p, b = {}) => request('PATCH', p, b),
  del: (p) => request('DELETE', p),
};

/** Builds a query string, skipping empty values. */
export const qs = (obj) => {
  const s = new URLSearchParams(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
  return s ? `?${s}` : '';
};
