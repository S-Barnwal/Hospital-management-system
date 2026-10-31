import { HttpError } from '../utils/errors.js';
import { config } from '../config/env.js';
import { rememberError } from '../utils/metrics.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } });
}

const sqlNumber = (err) => err?.number ?? err?.originalError?.info?.number ?? err?.precedingErrors?.[0]?.number;

// Maps SQL Server / connection errors to safe client messages. Never leaks SQL text or stack traces in production.
function mapSqlError(err, req) {
  const n = sqlNumber(err);
  if (n === 547 && req?.method === 'DELETE') return new HttpError(409, 'IN_USE', 'This record is used elsewhere, so it cannot be deleted. Deactivate or archive it instead.');
  if (n === 2627 || n === 2601) return new HttpError(409, 'DUPLICATE', 'A record with the same unique value already exists.');
  if (n === 547) return new HttpError(409, 'CONSTRAINT', 'The operation conflicts with related records.');
  if (n === 1205) return new HttpError(503, 'RETRY', 'The server was busy. Please retry.');
  // Connection problems: wrong server/password, firewall, remote access disabled, timeout.
  if (['ELOGIN', 'ESOCKET', 'ETIMEOUT', 'ECONNCLOSED', 'EINSTLOOKUP', 'ENOTOPEN'].includes(err?.code)) {
    return new HttpError(503, 'DB_UNAVAILABLE', config.isProd
      ? 'The service is temporarily unavailable. Please try again shortly.'
      : `Database connection failed (${err.code}): ${err.message}. Check DB_CONNECTION_STRING in backend/.env and that remote access to SQL Server is allowed.`);
  }
  // 208 = Invalid object name → tables not created yet.
  if (n === 208 && !config.isProd) {
    return new HttpError(500, 'DB_NOT_MIGRATED', `Database tables are missing (${err.message}). Run: cd backend && npm run db:migrate && npm run db:seed`);
  }
  return null;
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON body.' } });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'TOO_LARGE', message: 'Request body too large.' } });
  }
  const mapped = err instanceof HttpError ? err : mapSqlError(err, req);
  if (mapped) {
    if (mapped.status >= 500) {
      console.error(`[${req.method} ${req.path}] ${mapped.code}: ${mapped.message}`);
      rememberError({ method: req.method, path: req.path, code: mapped.code });
    }
    return res.status(mapped.status).json({ error: { code: mapped.code, message: mapped.message, ...(mapped.details ? { details: mapped.details } : {}) } });
  }
  const requestId = req.id;
  rememberError({ method: req.method, path: req.path, code: 'INTERNAL' });
  console.error(JSON.stringify({ level: 'error', requestId, method: req.method, path: req.path, message: err?.message, sqlNumber: sqlNumber(err), stack: err?.stack }));
  // In development show the real cause so problems can be fixed quickly; production stays generic.
  const message = config.isProd ? 'Something went wrong. Please try again.' : `Server error: ${err?.message || 'unknown'} (see backend terminal)`;
  return res.status(500).json({ error: { code: 'INTERNAL', message, requestId } });
}
