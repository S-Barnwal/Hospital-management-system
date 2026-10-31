// Pharmacy purchase orders: draft → ordered → (partially) received, or cancelled.
// Receiving adds stock batch-wise through the same receiveStock() as "Receive stock", so the ledger stays complete.
// Nested inside pharmacy.routes.js (hospital session + plan check already done); every query is scoped by TenantId.
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/auth.js';
import { asyncHandler, badRequest, conflict, notFound, unauthorized } from '../../utils/errors.js';
import { db, withTransaction, t } from '../../db/pool.js';
import { parseListQuery, pageMeta } from '../../utils/pagination.js';
import { idParam } from '../../utils/params.js';
import { auditTenant } from '../../utils/audit.js';
import { nextSequence, formatNumber } from '../tenants/sequences.js';
import { poStatusFromLines } from '../clinical/phase3.logic.js';
import { receiveStock } from './stock.service.js';

const router = Router();
router.use((req, _res, next) => (req.ctx?.tenantId ? next() : next(unauthorized())));

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const lineSchema = z.object({ medicineId: z.coerce.number().int().positive(), quantity: z.coerce.number().int().positive().max(1e6), unitCost: z.coerce.number().min(0).max(1e7) }).strict();
const poSchema = z.object({
  supplierId: z.coerce.number().int().positive(), expectedDate: ymd.nullable().optional(), notes: z.string().trim().max(500).nullable().optional(),
  items: z.array(lineSchema).min(1, 'Add at least one medicine.').max(100),
}).strict().refine((v) => new Set(v.items.map((i) => i.medicineId)).size === v.items.length, 'Each medicine can appear only once.');

const totalOf = (items) => (items.reduce((a, i) => a + Math.round(i.quantity * Number(i.unitCost) * 100), 0) / 100).toFixed(2);

async function loadPo(runner, tenantId, id, lock = false) {
  const po = await runner.one(`SELECT p.*, s.Name AS SupplierName, s.Phone AS SupplierPhone, s.Gstin AS SupplierGstin
                               FROM hms.PurchaseOrders p${lock ? ' WITH (UPDLOCK)' : ''} JOIN hms.Suppliers s ON s.TenantId = p.TenantId AND s.SupplierId = p.SupplierId
                               WHERE p.TenantId = @tid AND p.PurchaseOrderId = @id`, { tid: tenantId, id });
  if (!po) throw notFound('Purchase order not found.');
  const items = await runner.query(`SELECT i.PurchaseOrderItemId AS id, i.MedicineId AS medicineId, m.Name AS medicineName, m.Strength AS strength, m.Unit AS unit,
                                           i.Quantity AS quantity, i.ReceivedQuantity AS receivedQuantity, i.UnitCost AS unitCost, m.SalePrice AS salePrice
                                    FROM hms.PurchaseOrderItems i JOIN hms.Medicines m ON m.TenantId = i.TenantId AND m.MedicineId = i.MedicineId
                                    WHERE i.TenantId = @tid AND i.PurchaseOrderId = @id ORDER BY m.Name`, { tid: tenantId, id });
  return { po, items };
}
const view = ({ po, items }) => ({
  id: po.PurchaseOrderId, number: po.PoNumber, status: po.Status, supplier: { id: po.SupplierId, name: po.SupplierName, phone: po.SupplierPhone, gstin: po.SupplierGstin },
  orderDate: po.OrderDate, expectedDate: po.ExpectedDate, notes: po.Notes, total: po.TotalAmount, createdAt: po.CreatedAt, cancelReason: po.CancelReason, items,
});

async function assertLines(tx, tenantId, b) {
  if (!(await tx.one('SELECT 1 AS ok FROM hms.Suppliers WHERE TenantId = @tid AND SupplierId = @id AND IsActive = 1', { tid: tenantId, id: b.supplierId }))) throw badRequest('Supplier not found.');
  const ids = b.items.map((i) => i.medicineId).join(',');
  const found = await tx.one(`SELECT COUNT(*) AS n FROM hms.Medicines WHERE TenantId = @tid AND MedicineId IN (SELECT CAST(value AS INT) FROM STRING_SPLIT(@ids, ','))`, { tid: tenantId, ids });
  if (found.n !== b.items.length) throw badRequest('One or more medicines were not found.');
}
async function writeLines(tx, tenantId, poId, items) {
  await tx.exec('DELETE FROM hms.PurchaseOrderItems WHERE TenantId = @tid AND PurchaseOrderId = @id', { tid: tenantId, id: poId });
  for (const i of items) {
    await tx.exec(`INSERT INTO hms.PurchaseOrderItems (TenantId, PurchaseOrderId, MedicineId, Quantity, UnitCost) VALUES (@tid, @po, @mid, @q, @c)`,
      { tid: tenantId, po: poId, mid: i.medicineId, q: i.quantity, c: t.money(Number(i.unitCost).toFixed(2)) });
  }
}

router.get('/purchase-orders', requirePermission('pharmacy.read'), asyncHandler(async (req, res) => {
  const lq = parseListQuery(req.query, { created: 'p.CreatedAt', number: 'p.PoNumber' }, 'created');
  const status = ['draft', 'ordered', 'partially_received', 'received', 'cancelled'].includes(req.query.status) ? req.query.status : null;
  const params = { tid: req.ctx.tenantId, status, offset: lq.offset, size: lq.pageSize };
  const where = 'WHERE p.TenantId = @tid AND (@status IS NULL OR p.Status = @status)';
  const [rows, total] = await db.many(`
    SELECT p.PurchaseOrderId AS id, p.PoNumber AS number, p.Status AS status, s.Name AS supplierName, p.OrderDate AS orderDate, p.ExpectedDate AS expectedDate,
           p.TotalAmount AS total, p.CreatedAt AS createdAt, (SELECT COUNT(*) FROM hms.PurchaseOrderItems i WHERE i.TenantId = p.TenantId AND i.PurchaseOrderId = p.PurchaseOrderId) AS lines
    FROM hms.PurchaseOrders p JOIN hms.Suppliers s ON s.TenantId = p.TenantId AND s.SupplierId = p.SupplierId
    ${where} ORDER BY ${lq.orderBy} OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY;
    SELECT COUNT(*) AS total FROM hms.PurchaseOrders p ${where};`, params);
  res.json({ data: rows, meta: pageMeta(lq, total[0].total) });
}));

/** Suggested order: active medicines at or below their reorder level, with last purchase cost. */
router.get('/purchase-orders/suggestions', requirePermission('pharmacy.read'), asyncHandler(async (req, res) => {
  const rows = await db.query(`
    SELECT TOP 100 * FROM (
      SELECT m.MedicineId AS medicineId, m.Name AS name, m.Strength AS strength, m.ReorderLevel AS reorderLevel,
             ISNULL((SELECT SUM(QuantityOnHand) FROM hms.StockBatches b WHERE b.TenantId = m.TenantId AND b.MedicineId = m.MedicineId AND b.ExpiryDate >= CAST(SYSUTCDATETIME() AS DATE)), 0) AS stock,
             (SELECT TOP 1 PurchasePrice FROM hms.StockBatches b WHERE b.TenantId = m.TenantId AND b.MedicineId = m.MedicineId ORDER BY b.ReceivedAt DESC) AS lastCost
      FROM hms.Medicines m WHERE m.TenantId = @tid AND m.IsActive = 1) x
    WHERE x.stock <= x.reorderLevel ORDER BY x.stock`, { tid: req.ctx.tenantId });
  res.json({ data: rows.map((r) => ({ ...r, suggestedQuantity: Math.max(1, r.reorderLevel * 2 - r.stock) })) });
}));

router.get('/purchase-orders/:id', requirePermission('pharmacy.read'), asyncHandler(async (req, res) => {
  res.json({ data: view(await loadPo(db, req.ctx.tenantId, idParam(req.params.id))) });
}));

router.post('/purchase-orders', requirePermission('pharmacy.write'), validate(poSchema), asyncHandler(async (req, res) => {
  const b = req.body;
  const out = await withTransaction(async (tx) => {
    await assertLines(tx, req.ctx.tenantId, b);
    const n = await nextSequence(tx, req.ctx.tenantId, 'purchase_order');
    const po = await tx.one(`INSERT INTO hms.PurchaseOrders (TenantId, PoNumber, SupplierId, ExpectedDate, Notes, TotalAmount, CreatedByUserId)
                             OUTPUT INSERTED.PurchaseOrderId, INSERTED.PoNumber VALUES (@tid, @num, @sup, @exp, @notes, @total, @uid)`,
    { tid: req.ctx.tenantId, num: formatNumber('PO', n), sup: b.supplierId, exp: b.expectedDate ? t.date(new Date(`${b.expectedDate}T00:00:00Z`)) : null,
      notes: b.notes || null, total: t.money(totalOf(b.items)), uid: req.ctx.userId });
    await writeLines(tx, req.ctx.tenantId, po.PurchaseOrderId, b.items);
    await auditTenant(req, 'purchase_order.created', 'purchase_order', po.PurchaseOrderId, { lines: b.items.length }, tx);
    return { id: po.PurchaseOrderId, number: po.PoNumber };
  });
  res.status(201).json({ data: out });
}));

router.put('/purchase-orders/:id', requirePermission('pharmacy.write'), validate(poSchema), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const b = req.body;
  await withTransaction(async (tx) => {
    const { po } = await loadPo(tx, req.ctx.tenantId, id, true);
    if (po.Status !== 'draft') throw conflict('Only a draft can be changed. Cancel it and create a new order instead.', 'PO_STATE');
    await assertLines(tx, req.ctx.tenantId, b);
    await tx.exec(`UPDATE hms.PurchaseOrders SET SupplierId = @sup, ExpectedDate = @exp, Notes = @notes, TotalAmount = @total, UpdatedAt = SYSUTCDATETIME()
                   WHERE TenantId = @tid AND PurchaseOrderId = @id`,
    { tid: req.ctx.tenantId, id, sup: b.supplierId, exp: b.expectedDate ? t.date(new Date(`${b.expectedDate}T00:00:00Z`)) : null, notes: b.notes || null, total: t.money(totalOf(b.items)) });
    await writeLines(tx, req.ctx.tenantId, id, b.items);
    await auditTenant(req, 'purchase_order.updated', 'purchase_order', id, { lines: b.items.length }, tx);
  });
  res.json({ data: { ok: true } });
}));

router.post('/purchase-orders/:id/place', requirePermission('pharmacy.write'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  await withTransaction(async (tx) => {
    const { po } = await loadPo(tx, req.ctx.tenantId, id, true);
    if (po.Status !== 'draft') throw conflict('This order has already been placed.', 'PO_STATE');
    await tx.exec(`UPDATE hms.PurchaseOrders SET Status = 'ordered', OrderDate = CAST(SYSUTCDATETIME() AS DATE), UpdatedAt = SYSUTCDATETIME()
                   WHERE TenantId = @tid AND PurchaseOrderId = @id`, { tid: req.ctx.tenantId, id });
    await auditTenant(req, 'purchase_order.placed', 'purchase_order', id, null, tx);
  });
  res.json({ data: { ok: true } });
}));

router.post('/purchase-orders/:id/receive', requirePermission('pharmacy.write'),
  validate(z.object({
    reference: z.string().trim().max(100).optional(), // supplier invoice no.
    lines: z.array(z.object({
      itemId: z.coerce.number().int().positive(), quantity: z.coerce.number().int().positive().max(1e6),
      batchNumber: z.string().trim().min(1).max(40), expiryDate: ymd, salePrice: z.coerce.number().min(0).max(1e7),
    }).strict()).min(1).max(200),
  }).strict()),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const status = await withTransaction(async (tx) => {
      const { po, items } = await loadPo(tx, req.ctx.tenantId, id, true);
      if (!['ordered', 'partially_received'].includes(po.Status)) throw conflict(po.Status === 'draft' ? 'Place the order before receiving goods.' : `This order is ${po.Status.replace('_', ' ')}.`, 'PO_STATE');
      const byId = new Map(items.map((i) => [Number(i.id), i]));
      for (const l of req.body.lines) {
        const item = byId.get(l.itemId);
        if (!item) throw badRequest('A line does not belong to this purchase order.');
        await receiveStock(tx, req, { medicineId: item.medicineId, batchNumber: l.batchNumber, expiryDate: l.expiryDate, quantity: l.quantity,
          purchasePrice: Number(item.unitCost), salePrice: l.salePrice, supplierId: po.SupplierId, reference: `${po.PoNumber}${req.body.reference ? ` · inv ${req.body.reference}` : ''}` });
        await tx.exec('UPDATE hms.PurchaseOrderItems SET ReceivedQuantity = ReceivedQuantity + @q WHERE TenantId = @tid AND PurchaseOrderItemId = @iid',
          { tid: req.ctx.tenantId, iid: l.itemId, q: l.quantity });
        item.receivedQuantity = Number(item.receivedQuantity) + l.quantity;
      }
      const next = poStatusFromLines(items, po.Status);
      await tx.exec('UPDATE hms.PurchaseOrders SET Status = @s, UpdatedAt = SYSUTCDATETIME() WHERE TenantId = @tid AND PurchaseOrderId = @id', { tid: req.ctx.tenantId, id, s: next });
      await auditTenant(req, 'purchase_order.received', 'purchase_order', id, { lines: req.body.lines.length, status: next }, tx);
      return next;
    });
    res.json({ data: { status } });
  }));

router.post('/purchase-orders/:id/cancel', requirePermission('pharmacy.write'),
  validate(z.object({ reason: z.string().trim().min(3, 'Give a reason.').max(300) }).strict()),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    await withTransaction(async (tx) => {
      const { po } = await loadPo(tx, req.ctx.tenantId, id, true);
      if (!['draft', 'ordered'].includes(po.Status)) throw conflict('Goods have been received on this order; it can no longer be cancelled.', 'PO_STATE');
      await tx.exec(`UPDATE hms.PurchaseOrders SET Status = 'cancelled', CancelReason = @r, UpdatedAt = SYSUTCDATETIME() WHERE TenantId = @tid AND PurchaseOrderId = @id`,
        { tid: req.ctx.tenantId, id, r: req.body.reason });
      await auditTenant(req, 'purchase_order.cancelled', 'purchase_order', id, { reason: req.body.reason }, tx);
    });
    res.json({ data: { ok: true } });
  }));

export default router;
