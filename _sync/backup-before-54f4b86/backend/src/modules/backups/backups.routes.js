// Backups: a hospital can download a complete JSON export of ITS OWN data at any time (even when the
// subscription has expired). Only rows with this hospital's TenantId are exported; password hashes,
// session tokens and payment-gateway payloads are never included. Each export is logged.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireTenant, requirePermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/errors.js';
import { db } from '../../db/pool.js';
import { auditTenant } from '../../utils/audit.js';

const router = Router();
router.use(requireTenant);

/** Tables never exported (secrets, platform-internal data). */
export const EXCLUDED_TABLES = new Set(['UserSessions', 'PasswordResetTokens', 'OnboardingRequests', 'PaymentEvents', 'SchemaMigrations']);
/** Columns never exported, whatever table they are in. */
export const isSecretColumn = (name) => /hash|token|secret|signature|payload/i.test(name);
const SAFE_IDENT = /^[A-Za-z0-9_]+$/;

router.get('/', requirePermission('backups.manage'), asyncHandler(async (req, res) => {
  const rows = await db.query(`SELECT TOP 50 b.TenantBackupId AS id, b.CreatedAt AS createdAt, b.TableCount AS tableCount, b.TotalRows AS totalRows,
                                      b.SizeBytes AS sizeBytes, b.Status AS status, u.FullName AS createdBy
                               FROM hms.TenantBackups b LEFT JOIN hms.Users u ON u.TenantId = b.TenantId AND u.UserId = b.CreatedByUserId
                               WHERE b.TenantId = @tid ORDER BY b.CreatedAt DESC`, { tid: req.ctx.tenantId });
  res.json({ data: rows });
}));

const exportLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 3, standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: (req) => `backup:${req.ctx?.tenantId ?? req.ip}`,
  message: { error: { code: 'RATE_LIMITED', message: 'Please wait a minute before downloading another backup.' } },
});

router.get('/export', requirePermission('backups.manage'), exportLimiter, asyncHandler(async (req, res) => {
  const tid = req.ctx.tenantId;
  const columns = await db.query(`
    SELECT c.TABLE_NAME AS tableName, c.COLUMN_NAME AS columnName
    FROM INFORMATION_SCHEMA.COLUMNS c JOIN INFORMATION_SCHEMA.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
    WHERE c.TABLE_SCHEMA = 'hms' AND t.TABLE_TYPE = 'BASE TABLE'
      AND EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS k WHERE k.TABLE_SCHEMA = 'hms' AND k.TABLE_NAME = c.TABLE_NAME AND k.COLUMN_NAME = 'TenantId')
    ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`);
  const tables = new Map();
  for (const { tableName, columnName } of columns) {
    if (EXCLUDED_TABLES.has(tableName) || !SAFE_IDENT.test(tableName) || !SAFE_IDENT.test(columnName) || isSecretColumn(columnName)) continue;
    if (!tables.has(tableName)) tables.set(tableName, []);
    tables.get(tableName).push(columnName);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${req.ctx.tenantSlug}-backup-${stamp}.json"`);
  res.setHeader('Cache-Control', 'no-store');

  let size = 0; let totalRows = 0; let tableCount = 0;
  const write = (s) => { size += Buffer.byteLength(s); res.write(s); };
  try {
    write(`{"format":"medicore-hms-backup","version":1,"hospital":${JSON.stringify({ name: req.ctx.tenantName, slug: req.ctx.tenantSlug })},`
      + `"exportedAt":${JSON.stringify(new Date().toISOString())},"tables":{`);
    let first = true;
    for (const [table, cols] of tables) {
      const rows = await db.query(`SELECT ${cols.map((c) => `[${c}]`).join(', ')} FROM hms.[${table}] WHERE TenantId = @tid`, { tid });
      write(`${first ? '' : ','}${JSON.stringify(table)}:${JSON.stringify(rows)}`);
      first = false; totalRows += rows.length; tableCount += 1;
    }
    write('}}');
    res.end();
    await db.exec(`INSERT INTO hms.TenantBackups (TenantId, CreatedByUserId, TableCount, TotalRows, SizeBytes, Status) VALUES (@tid, @uid, @tables, @rows, @size, 'completed')`,
      { tid, uid: req.ctx.userId, tables: tableCount, rows: totalRows, size });
    await auditTenant(req, 'backup.exported', 'backup', null, { tables: tableCount, rows: totalRows });
  } catch (err) {
    await db.exec(`INSERT INTO hms.TenantBackups (TenantId, CreatedByUserId, Status) VALUES (@tid, @uid, 'failed')`, { tid, uid: req.ctx.userId }).catch(() => {});
    if (!res.headersSent) throw err;
    console.error('Backup export failed mid-stream:', err.message);
    res.destroy(err);
  }
}));

export default router;
