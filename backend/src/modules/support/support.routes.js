// Hospital side of support tickets (/api/v1/support). Works even when the subscription has lapsed or the hospital is
// suspended (see tenantAccess.js), because that is exactly when a hospital needs help.
import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { validate } from '../../middleware/validate.js';
import { requireTenant, requirePermission } from '../../middleware/auth.js';
import { asyncHandler, conflict, notFound } from '../../utils/errors.js';
import { db, withTransaction } from '../../db/pool.js';
import { idParam } from '../../utils/params.js';
import { auditTenant } from '../../utils/audit.js';
import { TICKET_CATEGORIES, TICKET_PRIORITIES, statusAfterReply } from '../clinical/phase4.logic.js';
import { nextTicketNumber, loadTicket, notifyTicket, TICKET_COLS } from './support.service.js';

const router = Router();
router.use(requireTenant);
const writeLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: (req) => `support:${req.ctx.tenantId}`,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many support messages. Please wait a little.' } } });

const body = z.string().trim().min(2, 'Write a message.').max(4000);

router.get('/tickets', requirePermission('support.use'), asyncHandler(async (req, res) => {
  const status = ['open', 'awaiting_support', 'awaiting_hospital', 'resolved', 'closed'].includes(req.query.status) ? req.query.status : null;
  const rows = await db.query(`SELECT TOP 200 ${TICKET_COLS}, u.FullName AS createdBy FROM hms.SupportTickets k
    LEFT JOIN hms.Users u ON u.TenantId = k.TenantId AND u.UserId = k.CreatedByUserId
    WHERE k.TenantId = @tid AND (@status IS NULL OR k.Status = @status)
    ORDER BY CASE WHEN k.Status IN ('resolved','closed') THEN 1 ELSE 0 END, k.UpdatedAt DESC`, { tid: req.ctx.tenantId, status });
  res.json({ data: rows });
}));

router.post('/tickets', requirePermission('support.use'), writeLimiter,
  validate(z.object({
    subject: z.string().trim().min(4, 'Write a short subject.').max(200), category: z.enum(TICKET_CATEGORIES),
    priority: z.enum(TICKET_PRIORITIES).default('normal'), message: body,
  }).strict()),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const out = await withTransaction(async (tx) => {
      const number = await nextTicketNumber(tx);
      const me = await tx.one('SELECT FullName FROM hms.Users WHERE TenantId = @tid AND UserId = @uid', { tid: req.ctx.tenantId, uid: req.ctx.userId });
      const row = await tx.one(`INSERT INTO hms.SupportTickets (TenantId, TicketNumber, Subject, Category, Priority, Status, CreatedByUserId, LastReplyBy, LastReplyAt)
                                OUTPUT INSERTED.TicketId VALUES (@tid, @num, @subj, @cat, @pri, 'open', @uid, 'hospital', SYSUTCDATETIME())`,
      { tid: req.ctx.tenantId, num: number, subj: b.subject, cat: b.category, pri: b.priority, uid: req.ctx.userId });
      await tx.exec(`INSERT INTO hms.SupportTicketMessages (TenantId, TicketId, AuthorType, AuthorUserId, AuthorName, Body)
                     VALUES (@tid, @id, 'hospital', @uid, @name, @body)`, { tid: req.ctx.tenantId, id: row.TicketId, uid: req.ctx.userId, name: me?.FullName ?? 'Hospital user', body: b.message });
      await auditTenant(req, 'support.ticket_created', 'support_ticket', row.TicketId, { number, category: b.category }, tx);
      return { id: row.TicketId, number, by: me?.FullName };
    });
    notifyTicket({ ticketId: out.id, tenantId: req.ctx.tenantId, toSupport: true, by: `${out.by} (${req.ctx.tenantSlug})`, body: b.message });
    res.status(201).json({ data: { id: out.id, number: out.number } });
  }));

router.get('/tickets/:id', requirePermission('support.use'), asyncHandler(async (req, res) => {
  res.json({ data: await loadTicket({ ticketId: idParam(req.params.id), tenantId: req.ctx.tenantId, forHospital: true }) });
}));

router.post('/tickets/:id/messages', requirePermission('support.use'), writeLimiter, validate(z.object({ body }).strict()), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const by = await withTransaction(async (tx) => {
    const k = await tx.one('SELECT Status FROM hms.SupportTickets WITH (UPDLOCK) WHERE TenantId = @tid AND TicketId = @id', { tid: req.ctx.tenantId, id });
    if (!k) throw notFound('Ticket not found.');
    if (k.Status === 'closed') throw conflict('This ticket is closed. Please open a new one.', 'TICKET_CLOSED');
    const me = await tx.one('SELECT FullName FROM hms.Users WHERE TenantId = @tid AND UserId = @uid', { tid: req.ctx.tenantId, uid: req.ctx.userId });
    await tx.exec(`INSERT INTO hms.SupportTicketMessages (TenantId, TicketId, AuthorType, AuthorUserId, AuthorName, Body) VALUES (@tid, @id, 'hospital', @uid, @name, @body)`,
      { tid: req.ctx.tenantId, id, uid: req.ctx.userId, name: me?.FullName ?? 'Hospital user', body: req.body.body });
    await tx.exec(`UPDATE hms.SupportTickets SET Status = @s, LastReplyBy = 'hospital', LastReplyAt = SYSUTCDATETIME(), ResolvedAt = NULL, UpdatedAt = SYSUTCDATETIME()
                   WHERE TenantId = @tid AND TicketId = @id`, { tid: req.ctx.tenantId, id, s: statusAfterReply('hospital') });
    return me?.FullName ?? 'Hospital user';
  });
  notifyTicket({ ticketId: id, tenantId: req.ctx.tenantId, toSupport: true, by: `${by} (${req.ctx.tenantSlug})`, body: req.body.body });
  res.status(201).json({ data: { ok: true } });
}));

router.post('/tickets/:id/close', requirePermission('support.use'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const n = await db.exec(`UPDATE hms.SupportTickets SET Status = 'closed', ResolvedAt = ISNULL(ResolvedAt, SYSUTCDATETIME()), UpdatedAt = SYSUTCDATETIME()
                           WHERE TenantId = @tid AND TicketId = @id AND Status <> 'closed'`, { tid: req.ctx.tenantId, id });
  if (!n) throw notFound('Ticket not found or already closed.');
  await auditTenant(req, 'support.ticket_closed', 'support_ticket', id);
  res.json({ data: { ok: true } });
}));

export default router;
