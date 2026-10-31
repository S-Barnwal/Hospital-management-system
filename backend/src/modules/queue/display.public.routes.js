// Public TV display: GET /api/v1/public/display/:token. The token is a long random secret in the screen's URL; only its
// SHA-256 hash is stored. The response carries token numbers, queue names, rooms and counts — never patient data.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler, notFound } from '../../utils/errors.js';
import { db } from '../../db/pool.js';
import { sha256Hex } from '../../utils/crypto.js';
import { queueBoard } from './queue.service.js';

const router = Router();
const limiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests.' } } });

router.get('/:token', limiter, asyncHandler(async (req, res) => {
  const token = String(req.params.token || '');
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) throw notFound('Screen not found.');
  const screen = await db.one(`/* tenant-safe: lookup by secret token hash; TenantId comes from the matched row */
    SELECT s.ScreenId, s.TenantId, s.Name, s.QueueKeys, s.LastSeenAt, t.Name AS Hospital, t.Timezone, t.Status
    FROM hms.DisplayScreens s JOIN hms.Tenants t ON t.TenantId = s.TenantId
    WHERE s.TokenHash = @h AND s.RevokedAt IS NULL`, { h: sha256Hex(token) });
  if (!screen || screen.Status !== 'active') throw notFound('Screen not found.');
  if (!screen.LastSeenAt || Date.now() - new Date(screen.LastSeenAt).getTime() > 60_000) {
    await db.exec('UPDATE hms.DisplayScreens SET LastSeenAt = SYSUTCDATETIME() WHERE TenantId = @tid AND ScreenId = @id', { tid: screen.TenantId, id: screen.ScreenId });
  }
  const board = await queueBoard(screen.TenantId, screen.Timezone, { keys: screen.QueueKeys ? screen.QueueKeys.split(',') : null, publicView: true });
  res.json({ data: { hospital: screen.Hospital, screen: screen.Name, serverTime: new Date().toISOString(), ...board } });
}));

export default router;
