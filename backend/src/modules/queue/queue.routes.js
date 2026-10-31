// Token queue for the front desk, doctors, lab, pharmacy and billing counters (/api/v1/queue) and the TV display screens
// that show it. Tokens restart at 1 every day per queue. Every query is scoped by TenantId.
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requireTenant, requirePermission, requireAnyPermission } from '../../middleware/auth.js';
import { asyncHandler, conflict, notFound } from '../../utils/errors.js';
import { db, withTransaction } from '../../db/pool.js';
import { idParam } from '../../utils/params.js';
import { auditTenant } from '../../utils/audit.js';
import { randomToken, sha256Hex } from '../../utils/crypto.js';
import { localDateString } from '../../utils/time.js';
import { config } from '../../config/env.js';
import { parseQueueKey, pickNext, canMoveToken } from '../clinical/phase4.logic.js';
import { issueToken, queueBoard, resolveQueue } from './queue.service.js';

const router = Router();
router.use(requireTenant);

const queueKey = z.string().trim().max(40).refine((k) => parseQueueKey(k), 'Unknown queue.');

router.get('/board', requireAnyPermission('queue.manage', 'appointments.read'), asyncHandler(async (req, res) => {
  res.json({ data: await queueBoard(req.ctx.tenantId, req.ctx.timezone) });
}));

router.post('/tokens', requirePermission('queue.manage'),
  validate(z.object({
    queueKey: queueKey.optional(), patientId: z.coerce.number().int().positive().nullable().optional(),
    appointmentId: z.coerce.number().int().positive().nullable().optional(), priority: z.boolean().default(false),
  }).strict().refine((v) => v.queueKey || v.appointmentId, { message: 'Choose a queue.', path: ['queueKey'] })),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const out = await withTransaction(async (tx) => {
      let key = b.queueKey;
      let patientId = b.patientId ?? null;
      if (b.appointmentId) {
        const a = await tx.one('SELECT DoctorId, PatientId, Status FROM hms.Appointments WHERE TenantId = @tid AND AppointmentId = @id', { tid: req.ctx.tenantId, id: b.appointmentId });
        if (!a) throw notFound('Appointment not found.');
        if (['cancelled', 'no_show', 'completed'].includes(a.Status)) throw conflict(`This appointment is ${a.Status.replace('_', ' ')}.`, 'INVALID_STATE');
        key = key ?? `doctor:${a.DoctorId}`;
        patientId = a.PatientId;
      }
      const token = await issueToken(tx, { tenantId: req.ctx.tenantId, timezone: req.ctx.timezone, userId: req.ctx.userId, queueKey: key,
        patientId, appointmentId: b.appointmentId ?? null, priority: b.priority });
      if (!token.existed) await auditTenant(req, 'queue.token_issued', 'queue_token', token.id, { queue: key, number: token.number }, tx);
      return token;
    });
    res.status(out.existed ? 200 : 201).json({ data: out });
  }));

/** Calls the next person: the token currently called in this queue is marked done, the next waiting one (priority first) is called. */
router.post('/call-next', requirePermission('queue.manage'),
  validate(z.object({ queueKey, counter: z.string().trim().max(30).optional() }).strict()),
  asyncHandler(async (req, res) => {
    const { queueKey: key, counter } = req.body;
    const date = localDateString(req.ctx.timezone);
    const out = await withTransaction(async (tx) => {
      const queue = await resolveQueue(tx, req.ctx.tenantId, key);
      const rows = await tx.query(`SELECT TokenId, TokenNumber, Status, Priority FROM hms.QueueTokens WITH (UPDLOCK, HOLDLOCK)
                                   WHERE TenantId = @tid AND TokenDate = CAST(@d AS DATE) AND QueueKey = @k AND Status IN ('waiting','called')`,
      { tid: req.ctx.tenantId, d: date, k: key });
      await tx.exec(`UPDATE hms.QueueTokens SET Status = 'done', DoneAt = SYSUTCDATETIME()
                     WHERE TenantId = @tid AND TokenDate = CAST(@d AS DATE) AND QueueKey = @k AND Status = 'called'`, { tid: req.ctx.tenantId, d: date, k: key });
      const next = pickNext(rows.filter((r) => r.Status === 'waiting').map((r) => ({ id: r.TokenId, tokenNumber: r.TokenNumber, priority: r.Priority })));
      if (!next) return null;
      await tx.exec(`UPDATE hms.QueueTokens SET Status = 'called', CalledAt = SYSUTCDATETIME(), CallCount = CallCount + 1, Counter = @c
                     WHERE TenantId = @tid AND TokenId = @id`, { tid: req.ctx.tenantId, id: next.id, c: counter || queue.room || null });
      return { id: next.id, number: next.tokenNumber, counter: counter || queue.room || null };
    });
    res.json({ data: out, meta: out ? undefined : { message: 'No one is waiting in this queue.' } });
  }));

router.post('/tokens/:id/status', requirePermission('queue.manage'),
  validate(z.object({ status: z.enum(['called', 'done', 'skipped', 'waiting', 'cancelled']), counter: z.string().trim().max(30).optional() }).strict()),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const { status, counter } = req.body;
    await withTransaction(async (tx) => {
      const tok = await tx.one('SELECT Status, QueueKey FROM hms.QueueTokens WITH (UPDLOCK) WHERE TenantId = @tid AND TokenId = @id', { tid: req.ctx.tenantId, id });
      if (!tok) throw notFound('Token not found.');
      if (!canMoveToken(tok.Status, status)) throw conflict(`A ${tok.Status} token cannot be marked ${status}.`, 'INVALID_TRANSITION');
      await tx.exec(`UPDATE hms.QueueTokens SET Status = @s,
                       CalledAt = CASE WHEN @s = 'called' THEN SYSUTCDATETIME() ELSE CalledAt END,
                       CallCount = CASE WHEN @s = 'called' THEN CallCount + 1 ELSE CallCount END,
                       Counter = CASE WHEN @s = 'called' AND @c IS NOT NULL THEN @c ELSE Counter END,
                       DoneAt = CASE WHEN @s IN ('done','cancelled') THEN SYSUTCDATETIME() ELSE NULL END
                     WHERE TenantId = @tid AND TokenId = @id`, { tid: req.ctx.tenantId, id, s: status, c: counter ?? null });
    });
    res.json({ data: { ok: true } });
  }));

// ---------- TV / display screens ----------
router.get('/screens', requirePermission('queue.manage'), asyncHandler(async (req, res) => {
  const rows = await db.query(`SELECT ScreenId AS id, Name AS name, QueueKeys AS queueKeys, LastSeenAt AS lastSeenAt, CreatedAt AS createdAt
                               FROM hms.DisplayScreens WHERE TenantId = @tid AND RevokedAt IS NULL ORDER BY CreatedAt DESC`, { tid: req.ctx.tenantId });
  res.json({ data: rows.map((r) => ({ ...r, queueKeys: r.queueKeys ? r.queueKeys.split(',') : [] })) });
}));

/** Creates a screen and returns its URL ONCE (only a hash is stored). Needs settings.manage: the link is public. */
router.post('/screens', requirePermission('queue.manage', 'settings.manage'),
  validate(z.object({ name: z.string().trim().min(2).max(80), queueKeys: z.array(queueKey).max(20).default([]) }).strict()),
  asyncHandler(async (req, res) => {
    for (const k of req.body.queueKeys) await resolveQueue(db, req.ctx.tenantId, k);
    const count = await db.one('SELECT COUNT(*) AS n FROM hms.DisplayScreens WHERE TenantId = @tid AND RevokedAt IS NULL', { tid: req.ctx.tenantId });
    if (count.n >= 20) throw conflict('At most 20 screens. Remove an old one first.', 'LIMIT');
    const token = randomToken(32);
    const row = await db.one(`INSERT INTO hms.DisplayScreens (TenantId, Name, QueueKeys, TokenHash, CreatedByUserId) OUTPUT INSERTED.ScreenId
                              VALUES (@tid, @n, @k, @h, @uid)`,
    { tid: req.ctx.tenantId, n: req.body.name, k: req.body.queueKeys.length ? req.body.queueKeys.join(',') : null, h: sha256Hex(token), uid: req.ctx.userId });
    await auditTenant(req, 'queue.screen_created', 'display_screen', row.ScreenId, { name: req.body.name });
    res.status(201).json({ data: { id: row.ScreenId, url: `${config.publicAppUrl}/tv/${token}` } });
  }));

router.delete('/screens/:id', requirePermission('queue.manage', 'settings.manage'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const n = await db.exec('UPDATE hms.DisplayScreens SET RevokedAt = SYSUTCDATETIME() WHERE TenantId = @tid AND ScreenId = @id AND RevokedAt IS NULL', { tid: req.ctx.tenantId, id });
  if (!n) throw notFound('Screen not found.');
  await auditTenant(req, 'queue.screen_revoked', 'display_screen', id);
  res.json({ data: { ok: true } });
}));

export default router;
