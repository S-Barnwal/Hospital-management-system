// File attachments: bill & expense photos, purchase-order invoices, patient documents and photo.
// Files live in the database (hms.Attachments) and are served only through this API after the SAME tenant,
// permission and plan checks as the record they belong to. Uploads are sent as raw bytes (no multipart parser):
//   POST /api/v1/attachments?entityType=expense&entityId=12&fileName=receipt.jpg&category=receipt   (body = file)
// The type is decided from the file's first bytes (JPEG, PNG, WebP or PDF only); maximum 5 MB.
import { Router } from 'express';
import { z } from 'zod';
import { requireTenant } from '../../middleware/auth.js';
import { asyncHandler, badRequest, forbidden, notFound, HttpError } from '../../utils/errors.js';
import { db, t, sql } from '../../db/pool.js';
import { idParam } from '../../utils/params.js';
import { auditTenant } from '../../utils/audit.js';
import { sha256Hex } from '../../utils/crypto.js';
import { sniffFileType, safeFileName, MAX_UPLOAD_BYTES } from '../clinical/phase3.logic.js';

/** What each kind of record needs: table + key, read/write permission and plan module. */
export const ENTITIES = {
  expense: { table: 'hms.Expenses', key: 'ExpenseId', read: 'expenses.read', write: 'expenses.write', feature: 'billing' },
  bill: { table: 'hms.Bills', key: 'BillId', read: 'billing.read', write: 'billing.write', feature: 'billing' },
  patient: { table: 'hms.Patients', key: 'PatientId', read: 'patients.read', write: 'patients.write', feature: null },
  purchase_order: { table: 'hms.PurchaseOrders', key: 'PurchaseOrderId', read: 'pharmacy.read', write: 'pharmacy.write', feature: 'pharmacy' },
};
const CATEGORIES = ['receipt', 'invoice', 'photo', 'id_proof', 'report', 'prescription', 'consent', 'insurance', 'discharge', 'other'];
const MAX_PER_RECORD = 30;

const router = Router();
router.use(requireTenant);

function entityFor(req, type, mode) {
  const e = ENTITIES[type];
  if (!e) throw badRequest('Unknown record type.');
  if (e.feature && !req.ctx.features.has(e.feature)) throw forbidden('This module is not included in your plan.', 'FEATURE_NOT_IN_PLAN');
  if (!req.ctx.permissions.has(e[mode])) throw forbidden();
  return e;
}
async function assertRecord(req, e, id) {
  // e.table / e.key come from the fixed ENTITIES map above, never from the request.
  const row = await db.one(`SELECT 1 AS ok FROM ${e.table} WHERE TenantId = @tid AND ${e.key} = @id`, { tid: req.ctx.tenantId, id });
  if (!row) throw notFound('Record not found.');
}

const listQuery = z.object({ entityType: z.enum(Object.keys(ENTITIES)), entityId: z.coerce.number().int().positive() });

router.get('/', asyncHandler(async (req, res) => {
  const q = listQuery.safeParse(req.query);
  if (!q.success) throw badRequest('Choose a record.');
  const e = entityFor(req, q.data.entityType, 'read');
  await assertRecord(req, e, q.data.entityId);
  const rows = await db.query(`SELECT a.AttachmentId AS id, a.FileName AS fileName, a.ContentType AS contentType, a.SizeBytes AS size, a.Category AS category,
                                      a.CreatedAt AS createdAt, u.FullName AS uploadedBy
                               FROM hms.Attachments a LEFT JOIN hms.Users u ON u.TenantId = a.TenantId AND u.UserId = a.UploadedByUserId
                               WHERE a.TenantId = @tid AND a.EntityType = @type AND a.EntityId = @id AND a.IsDeleted = 0 ORDER BY a.CreatedAt DESC`,
  { tid: req.ctx.tenantId, type: q.data.entityType, id: q.data.entityId });
  res.json({ data: rows });
}));

router.post('/', asyncHandler(async (req, res) => {
  const q = listQuery.extend({ fileName: z.string().trim().min(1).max(200), category: z.enum(CATEGORIES).optional() }).safeParse(req.query);
  if (!q.success) throw badRequest('Missing or invalid file details.');
  const e = entityFor(req, q.data.entityType, 'write');
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw badRequest('The file is empty.');
  if (buf.length > MAX_UPLOAD_BYTES) throw new HttpError(413, 'TOO_LARGE', 'The file is larger than 5 MB.');
  const type = sniffFileType(buf);
  if (!type) throw badRequest('Only JPEG, PNG, WebP photos and PDF files can be uploaded.');
  await assertRecord(req, e, q.data.entityId);
  const count = await db.one('SELECT COUNT(*) AS n FROM hms.Attachments WHERE TenantId = @tid AND EntityType = @type AND EntityId = @id AND IsDeleted = 0',
    { tid: req.ctx.tenantId, type: q.data.entityType, id: q.data.entityId });
  if (count.n >= MAX_PER_RECORD) throw badRequest(`At most ${MAX_PER_RECORD} files per record.`);
  const row = await db.one(`INSERT INTO hms.Attachments (TenantId, EntityType, EntityId, Category, FileName, ContentType, SizeBytes, Sha256, Content, UploadedByUserId)
                            OUTPUT INSERTED.AttachmentId VALUES (@tid, @type, @id, @cat, @name, @ct, @size, @sha, @content, @uid)`,
  { tid: req.ctx.tenantId, type: q.data.entityType, id: q.data.entityId, cat: q.data.category ?? null, name: safeFileName(q.data.fileName), ct: type,
    size: buf.length, sha: sha256Hex(buf), content: { type: sql.VarBinary(sql.MAX), value: buf }, uid: req.ctx.userId });
  await auditTenant(req, 'attachment.uploaded', q.data.entityType, q.data.entityId, { attachmentId: row.AttachmentId, type, size: buf.length });
  res.status(201).json({ data: { id: row.AttachmentId, contentType: type, size: buf.length } });
}));

async function loadAttachment(req, id, withContent = false) {
  const a = await db.one(`SELECT AttachmentId, EntityType, EntityId, FileName, ContentType, SizeBytes${withContent ? ', Content' : ''}
                          FROM hms.Attachments WHERE TenantId = @tid AND AttachmentId = @id AND IsDeleted = 0`, { tid: req.ctx.tenantId, id });
  if (!a) throw notFound('File not found.');
  return a;
}

/** Streams the file. Images are shown inline; everything is sandboxed so a file can never run script in our origin. */
router.get('/:id/file', asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const meta = await loadAttachment(req, id);
  entityFor(req, meta.EntityType, 'read');
  const a = await loadAttachment(req, id, true);
  const disposition = req.query.download === '1' ? 'attachment' : 'inline';
  res.set({
    'Content-Type': a.ContentType, 'Content-Length': String(a.SizeBytes), 'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `${disposition}; filename="${safeFileName(a.FileName)}"`, 'Cache-Control': 'private, no-store',
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  // Images opened directly get a locked-down sandbox. (Browsers refuse to show PDFs inside a CSP sandbox; PDFs are
  // rendered by the browser's own isolated viewer, and only real PDFs — checked by their bytes — are ever stored.)
  if (a.ContentType.startsWith('image/')) res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  else res.removeHeader('Content-Security-Policy');
  res.end(a.Content);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const a = await loadAttachment(req, id);
  entityFor(req, a.EntityType, 'write');
  await db.exec('UPDATE hms.Attachments SET IsDeleted = 1 WHERE TenantId = @tid AND AttachmentId = @id', { tid: req.ctx.tenantId, id });
  if (a.EntityType === 'patient') {
    await db.exec('UPDATE hms.Patients SET PhotoAttachmentId = NULL WHERE TenantId = @tid AND PatientId = @pid AND PhotoAttachmentId = @id', { tid: req.ctx.tenantId, pid: a.EntityId, id });
  }
  await auditTenant(req, 'attachment.deleted', a.EntityType, a.EntityId, { attachmentId: id });
  res.json({ data: { ok: true } });
}));

export default router;
