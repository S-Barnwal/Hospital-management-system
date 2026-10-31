// Pharmacy & inventory: medicines, suppliers, batch-wise stock (with expiry), FEFO dispensing,
// adjustments and an append-only stock ledger. Negative stock is blocked in code AND by a CHECK constraint.
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requireTenant, requirePermission, requireFeature } from '../../middleware/auth.js';
import { asyncHandler, badRequest, conflict, notFound } from '../../utils/errors.js';
import { db, withTransaction, t } from '../../db/pool.js';
import { parseListQuery, pageMeta } from '../../utils/pagination.js';
import { idParam } from '../../utils/params.js';
import { auditTenant } from '../../utils/audit.js';
import { localDateString } from '../../utils/time.js';
import { allocateFefo } from '../clinical/logic.js';
import { addBillItem, getOrCreateDraftBill } from '../billing/billing.service.js';
import { optionalPhone } from '../../utils/contact.js';
import { BARCODE_RE } from '../clinical/phase3.logic.js';
import purchaseOrderRoutes from './purchaseOrders.routes.js';
import { receiveStock } from './stock.service.js';

const router = Router();
router.use(requireTenant, requireFeature('pharmacy'));

const like = (v) => (v ? `%${String(v).trim().slice(0, 100).replace(/[%_[\]]/g, (m) => `[${m}]`)}%` : null);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

// ---------- Medicines ----------
router.get('/medicines', requirePermission('pharmacy.read'), asyncHandler(async (req, res) => {
  const lq = parseListQuery(req.query, { name: 'm.Name', stock: 'stock' }, 'name');
  const today = localDateString(req.ctx.timezone);
  const params = { tid: req.ctx.tenantId, q: like(req.query.q), code: req.query.q ? String(req.query.q).trim().slice(0, 64) : null, low: req.query.lowStock === 'true', today: t.date(new Date(`${today}T00:00:00Z`)), offset: lq.offset, size: lq.pageSize };
  const base = `
    SELECT m.MedicineId AS id, m.Name AS name, m.GenericName AS genericName, m.Form AS form, m.Strength AS strength, m.Unit AS unit,
           m.TaxRatePercent AS taxRatePercent, m.SalePrice AS salePrice, m.ReorderLevel AS reorderLevel, m.IsActive AS isActive, m.HsnCode AS hsnCode, m.Barcode AS barcode,
           ISNULL((SELECT SUM(QuantityOnHand) FROM hms.StockBatches b WHERE b.TenantId = m.TenantId AND b.MedicineId = m.MedicineId AND b.ExpiryDate >= @today), 0) AS stock,
           (SELECT MIN(ExpiryDate) FROM hms.StockBatches b WHERE b.TenantId = m.TenantId AND b.MedicineId = m.MedicineId AND b.QuantityOnHand > 0 AND b.ExpiryDate >= @today) AS nextExpiry
    FROM hms.Medicines m
    WHERE m.TenantId = @tid AND (@q IS NULL OR m.Name LIKE @q OR m.GenericName LIKE @q OR m.Barcode = @code)`;
  const [rows, total] = await db.many(`
    SELECT * FROM (${base}) x WHERE (@low = 0 OR x.stock <= x.reorderLevel) ORDER BY ${lq.orderBy.replace('m.Name', 'name')} OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY;
    SELECT COUNT(*) AS total FROM (${base}) x WHERE (@low = 0 OR x.stock <= x.reorderLevel);`, params);
  res.json({ data: rows.map((r) => ({ ...r, nextExpiry: r.nextExpiry ? new Date(r.nextExpiry).toISOString().slice(0, 10) : null })), meta: pageMeta(lq, total[0].total) });
}));

const medSchema = z.object({
  name: z.string().trim().min(2).max(150), genericName: z.string().trim().max(150).nullable().optional(),
  form: z.string().trim().max(30).nullable().optional(), strength: z.string().trim().max(50).nullable().optional(),
  unit: z.string().trim().min(1).max(20).default('unit'), hsnCode: z.string().trim().max(12).nullable().optional(),
  taxRatePercent: z.coerce.number().min(0).max(100), salePrice: z.coerce.number().min(0).max(1e7),
  reorderLevel: z.coerce.number().int().min(0).max(1e6), isActive: z.boolean().optional(),
  barcode: z.union([z.literal('').transform(() => null), z.null(), z.string().trim().regex(BARCODE_RE, 'Barcode: 4–64 letters, digits, - _ or .')]).optional(),
}).strict();
const medParams = (b) => ({
  name: b.name, gen: b.genericName ?? null, form: b.form ?? null, str: b.strength ?? null, unit: b.unit, hsn: b.hsnCode ?? null,
  tax: t.dec(b.taxRatePercent, 5, 2), price: t.money(b.salePrice.toFixed(2)), reorder: b.reorderLevel, active: b.isActive ?? true, bc: b.barcode ?? null,
});

/** A barcode already used by another medicine of this hospital → clear 409 instead of a database error. */
async function assertBarcodeFree(tenantId, barcode, exceptId = null) {
  if (!barcode) return;
  const other = await db.one('SELECT Name FROM hms.Medicines WHERE TenantId = @tid AND Barcode = @bc AND (@id IS NULL OR MedicineId <> @id)', { tid: tenantId, bc: barcode, id: exceptId });
  if (other) throw conflict(`Barcode ${barcode} is already used by ${other.Name}.`, 'BARCODE_TAKEN');
}

router.post('/medicines', requirePermission('pharmacy.configure'), validate(medSchema), asyncHandler(async (req, res) => {
  await assertBarcodeFree(req.ctx.tenantId, req.body.barcode);
  const r = await db.one(`INSERT INTO hms.Medicines (TenantId, Name, GenericName, Form, Strength, Unit, HsnCode, TaxRatePercent, SalePrice, ReorderLevel, IsActive, Barcode)
                          OUTPUT INSERTED.MedicineId VALUES (@tid, @name, @gen, @form, @str, @unit, @hsn, @tax, @price, @reorder, @active, @bc)`,
  { tid: req.ctx.tenantId, ...medParams(req.body) });
  await auditTenant(req, 'medicine.created', 'medicine', r.MedicineId);
  res.status(201).json({ data: { id: r.MedicineId } });
}));

router.put('/medicines/:id', requirePermission('pharmacy.configure'), validate(medSchema), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  await assertBarcodeFree(req.ctx.tenantId, req.body.barcode, id);
  const n = await db.exec(`UPDATE hms.Medicines SET Name = @name, GenericName = @gen, Form = @form, Strength = @str, Unit = @unit, HsnCode = @hsn,
                             TaxRatePercent = @tax, SalePrice = @price, ReorderLevel = @reorder, IsActive = @active,
                             Barcode = CASE WHEN @setBc = 1 THEN @bc ELSE Barcode END WHERE TenantId = @tid AND MedicineId = @id`,
  { tid: req.ctx.tenantId, id, ...medParams(req.body), setBc: req.body.barcode !== undefined });
  if (!n) throw notFound('Medicine not found.');
  await auditTenant(req, 'medicine.updated', 'medicine', id);
  res.json({ data: { ok: true } });
}));

/** Scanner lookup: a USB/Bluetooth barcode scanner types the code + Enter into the dispense screen. */
router.get('/medicines/by-barcode/:code', requirePermission('pharmacy.read'), asyncHandler(async (req, res) => {
  const code = String(req.params.code || '').trim();
  if (!BARCODE_RE.test(code)) throw notFound('No medicine with this barcode.');
  const today = localDateString(req.ctx.timezone);
  const m = await db.one(`SELECT m.MedicineId AS id, m.Name AS name, m.Strength AS strength, m.SalePrice AS salePrice, m.IsActive AS isActive,
                                 ISNULL((SELECT SUM(QuantityOnHand) FROM hms.StockBatches b WHERE b.TenantId = m.TenantId AND b.MedicineId = m.MedicineId AND b.ExpiryDate >= @today), 0) AS stock
                          FROM hms.Medicines m WHERE m.TenantId = @tid AND m.Barcode = @code`,
  { tid: req.ctx.tenantId, code, today: t.date(new Date(`${today}T00:00:00Z`)) });
  if (!m) throw notFound('No medicine with this barcode.');
  res.json({ data: m });
}));

router.get('/medicines/:id', requirePermission('pharmacy.read'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const [meds, batches, moves] = await db.many(`
    SELECT MedicineId AS id, Name AS name, GenericName AS genericName, Form AS form, Strength AS strength, Unit AS unit, SalePrice AS salePrice,
           TaxRatePercent AS taxRatePercent, ReorderLevel AS reorderLevel, HsnCode AS hsnCode, IsActive AS isActive, Barcode AS barcode
      FROM hms.Medicines WHERE TenantId = @tid AND MedicineId = @id;
    SELECT b.BatchId AS id, b.BatchNumber AS batchNumber, CONVERT(CHAR(10), b.ExpiryDate, 23) AS expiryDate, b.QuantityOnHand AS quantity,
           b.PurchasePrice AS purchasePrice, b.SalePrice AS salePrice, s.Name AS supplierName, b.ReceivedAt AS receivedAt
      FROM hms.StockBatches b LEFT JOIN hms.Suppliers s ON s.TenantId = b.TenantId AND s.SupplierId = b.SupplierId
      WHERE b.TenantId = @tid AND b.MedicineId = @id ORDER BY b.ExpiryDate;
    SELECT TOP 50 mv.CreatedAt AS at, mv.Kind AS kind, mv.Quantity AS quantity, mv.Reference AS reference, b.BatchNumber AS batchNumber, u.FullName AS byName
      FROM hms.StockMovements mv JOIN hms.StockBatches b ON b.TenantId = mv.TenantId AND b.BatchId = mv.BatchId
      LEFT JOIN hms.Users u ON u.TenantId = mv.TenantId AND u.UserId = mv.CreatedByUserId
      WHERE mv.TenantId = @tid AND mv.MedicineId = @id ORDER BY mv.CreatedAt DESC;`, { tid: req.ctx.tenantId, id });
  if (!meds[0]) throw notFound('Medicine not found.');
  res.json({ data: { ...meds[0], batches, movements: moves } });
}));

// ---------- Suppliers ----------
const supplierSchema = z.object({ name: z.string().trim().min(2).max(150), phone: optionalPhone, gstin: z.string().trim().toUpperCase().max(20).optional() }).strict();
router.get('/suppliers', requirePermission('pharmacy.read'), asyncHandler(async (req, res) => {
  res.json({ data: await db.query('SELECT SupplierId AS id, Name AS name, Phone AS phone, Gstin AS gstin, IsActive AS isActive FROM hms.Suppliers WHERE TenantId = @tid ORDER BY Name', { tid: req.ctx.tenantId }) });
}));
router.post('/suppliers', requirePermission('pharmacy.configure'),
  validate(supplierSchema),
  asyncHandler(async (req, res) => {
    const r = await db.one('INSERT INTO hms.Suppliers (TenantId, Name, Phone, Gstin) OUTPUT INSERTED.SupplierId VALUES (@tid, @n, @p, @g)',
      { tid: req.ctx.tenantId, n: req.body.name, p: req.body.phone ?? null, g: req.body.gstin ?? null });
    await auditTenant(req, 'supplier.created', 'supplier', r.SupplierId);
    res.status(201).json({ data: { id: r.SupplierId } });
  }));

router.put('/suppliers/:id', requirePermission('pharmacy.configure'),
  validate(supplierSchema),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const n = await db.exec('UPDATE hms.Suppliers SET Name = @n, Phone = @p, Gstin = @g WHERE TenantId = @tid AND SupplierId = @id',
      { tid: req.ctx.tenantId, id, n: req.body.name, p: req.body.phone ?? null, g: req.body.gstin ?? null });
    if (!n) throw notFound('Supplier not found.');
    await auditTenant(req, 'supplier.updated', 'supplier', id);
    res.json({ data: { ok: true } });
  }));

router.delete('/suppliers/:id', requirePermission('pharmacy.configure'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const used = await db.one('SELECT COUNT(*) AS n FROM hms.StockBatches WHERE TenantId = @tid AND SupplierId = @id', { tid: req.ctx.tenantId, id });
  if (used.n) throw conflict('Stock has been received from this supplier, so it cannot be deleted.', 'IN_USE');
  const n = await db.exec('DELETE FROM hms.Suppliers WHERE TenantId = @tid AND SupplierId = @id', { tid: req.ctx.tenantId, id });
  if (!n) throw notFound('Supplier not found.');
  await auditTenant(req, 'supplier.deleted', 'supplier', id);
  res.json({ data: { ok: true } });
}));

router.delete('/medicines/:id', requirePermission('pharmacy.configure'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const used = await db.one('SELECT COUNT(*) AS n FROM hms.StockBatches WHERE TenantId = @tid AND MedicineId = @id', { tid: req.ctx.tenantId, id });
  if (used.n) throw conflict('This medicine has stock history. Mark it inactive instead.', 'IN_USE');
  const n = await db.exec('DELETE FROM hms.Medicines WHERE TenantId = @tid AND MedicineId = @id', { tid: req.ctx.tenantId, id });
  if (!n) throw notFound('Medicine not found.');
  await auditTenant(req, 'medicine.deleted', 'medicine', id);
  res.json({ data: { ok: true } });
}));

// ---------- Stock in ----------
export const receiveSchema = z.object({
  medicineId: z.coerce.number().int().positive(), batchNumber: z.string().trim().min(1).max(40), expiryDate: ymd,
  quantity: z.coerce.number().int().positive().max(1e6), purchasePrice: z.coerce.number().min(0).max(1e7), salePrice: z.coerce.number().min(0).max(1e7),
  supplierId: z.coerce.number().int().positive().nullable().optional(), reference: z.string().trim().max(200).optional(),
}).strict();

router.post('/stock/receive', requirePermission('pharmacy.write'), validate(receiveSchema), asyncHandler(async (req, res) => {
  const batchId = await withTransaction(async (tx) => {
    const id = await receiveStock(tx, req, req.body);
    await auditTenant(req, 'stock.received', 'medicine', req.body.medicineId, { quantity: req.body.quantity, batch: req.body.batchNumber }, tx);
    return id;
  });
  res.status(201).json({ data: { batchId } });
}));

/** Remove an expired batch from stock (kept in the ledger as an adjustment with the reason "Expired"). */
router.post('/stock/expire-batch', requirePermission('pharmacy.configure'),
  validate(z.object({ batchId: z.coerce.number().int().positive() }).strict()),
  asyncHandler(async (req, res) => {
    const today = localDateString(req.ctx.timezone);
    const qty = await withTransaction(async (tx) => {
      const b = await tx.one(`SELECT MedicineId, QuantityOnHand, CONVERT(CHAR(10), ExpiryDate, 23) AS ExpiryDate FROM hms.StockBatches WITH (UPDLOCK)
                              WHERE TenantId = @tid AND BatchId = @id`, { tid: req.ctx.tenantId, id: req.body.batchId });
      if (!b) throw notFound('Batch not found.');
      if (b.ExpiryDate > today) throw conflict('This batch has not expired yet. Use “Adjust stock” for damage or returns.', 'NOT_EXPIRED');
      if (b.QuantityOnHand <= 0) throw conflict('Nothing left in this batch.', 'EMPTY');
      await tx.exec('UPDATE hms.StockBatches SET QuantityOnHand = 0 WHERE TenantId = @tid AND BatchId = @id', { tid: req.ctx.tenantId, id: req.body.batchId });
      await tx.exec(`INSERT INTO hms.StockMovements (TenantId, MedicineId, BatchId, Kind, Quantity, Reference, CreatedByUserId)
                     VALUES (@tid, @mid, @bid, 'adjust', @q, N'Expired — removed from stock', @uid)`,
      { tid: req.ctx.tenantId, mid: b.MedicineId, bid: req.body.batchId, q: -b.QuantityOnHand, uid: req.ctx.userId });
      await auditTenant(req, 'stock.expired_removed', 'medicine', b.MedicineId, { quantity: b.QuantityOnHand }, tx);
      return b.QuantityOnHand;
    });
    res.json({ data: { removed: qty } });
  }));

// ---------- Dispense (FEFO) ----------
router.post('/dispense', requirePermission('pharmacy.write'),
  validate(z.object({
    patientId: z.coerce.number().int().positive().nullable().optional(),
    items: z.array(z.object({ medicineId: z.coerce.number().int().positive(), quantity: z.coerce.number().int().positive().max(100000) }).strict()).min(1).max(50),
    addToBill: z.boolean().optional(), reference: z.string().trim().max(200).optional(),
  }).strict()),
  asyncHandler(async (req, res) => {
    const b = req.body;
    if (b.addToBill && !b.patientId) throw badRequest('Choose a patient to add the medicines to their bill.');
    const today = localDateString(req.ctx.timezone);
    const out = await withTransaction(async (tx) => {
      if (b.patientId && !(await tx.one('SELECT 1 AS ok FROM hms.Patients WHERE TenantId = @tid AND PatientId = @id', { tid: req.ctx.tenantId, id: b.patientId }))) {
        throw badRequest('Patient not found.');
      }
      const billId = b.addToBill && req.ctx.features.has('billing') && req.ctx.permissions.has('billing.write')
        ? await getOrCreateDraftBill(tx, req.ctx, b.patientId) : null;
      const lines = [];
      for (const item of b.items) {
        const med = await tx.one('SELECT MedicineId, Name, Strength, TaxRatePercent FROM hms.Medicines WHERE TenantId = @tid AND MedicineId = @id AND IsActive = 1',
          { tid: req.ctx.tenantId, id: item.medicineId });
        if (!med) throw badRequest('Medicine not found or inactive.');
        const batches = await tx.query(`SELECT BatchId, CONVERT(CHAR(10), ExpiryDate, 23) AS ExpiryDate, QuantityOnHand, SalePrice
                                        FROM hms.StockBatches WITH (UPDLOCK, HOLDLOCK) WHERE TenantId = @tid AND MedicineId = @mid`,
        { tid: req.ctx.tenantId, mid: item.medicineId });
        let alloc;
        try { alloc = allocateFefo(batches, item.quantity, today); } catch (e) { throw conflict(`${med.Name}: ${e.message}`, e.code || 'INSUFFICIENT_STOCK'); }
        for (const a of alloc) {
          const n = await tx.exec(`UPDATE hms.StockBatches SET QuantityOnHand = QuantityOnHand - @q WHERE TenantId = @tid AND BatchId = @bid AND QuantityOnHand >= @q`,
            { tid: req.ctx.tenantId, bid: a.batchId, q: a.quantity });
          if (!n) throw conflict(`${med.Name}: stock changed while dispensing, please retry.`, 'INSUFFICIENT_STOCK');
          await tx.exec(`INSERT INTO hms.StockMovements (TenantId, MedicineId, BatchId, Kind, Quantity, UnitPrice, PatientId, BillId, Reference, CreatedByUserId)
                         VALUES (@tid, @mid, @bid, 'dispense', @q, @price, @pid, @bill, @ref, @uid)`,
          { tid: req.ctx.tenantId, mid: item.medicineId, bid: a.batchId, q: -a.quantity, price: t.money(a.unitPrice.toFixed(2)), pid: b.patientId ?? null,
            bill: billId, ref: b.reference ?? null, uid: req.ctx.userId });
          if (billId) {
            await addBillItem(tx, req.ctx.tenantId, billId, { itemType: 'pharmacy', description: `${med.Name}${med.Strength ? ` ${med.Strength}` : ''}`,
              quantity: a.quantity, unitPrice: a.unitPrice.toFixed(2), taxRatePercent: Number(med.TaxRatePercent), referenceType: 'medicine', referenceId: item.medicineId, hsnSac: med.HsnCode || null });
          }
          lines.push({ medicine: med.Name, batchId: a.batchId, quantity: a.quantity, unitPrice: a.unitPrice });
        }
      }
      await auditTenant(req, 'stock.dispensed', 'patient', b.patientId ?? null, { lines: lines.length, billed: Boolean(billId) }, tx);
      return { lines, billId };
    });
    res.status(201).json({ data: out });
  }));

// ---------- Adjustments (damage, count correction, returns) ----------
router.post('/stock/adjust', requirePermission('pharmacy.configure'),
  validate(z.object({ batchId: z.coerce.number().int().positive(), quantity: z.number().int().refine((v) => v !== 0, 'Quantity cannot be zero').refine((v) => Math.abs(v) <= 1e6), reason: z.string().trim().min(3).max(200) }).strict()),
  asyncHandler(async (req, res) => {
    const b = req.body;
    await withTransaction(async (tx) => {
      const batch = await tx.one('SELECT MedicineId, QuantityOnHand FROM hms.StockBatches WITH (UPDLOCK) WHERE TenantId = @tid AND BatchId = @id', { tid: req.ctx.tenantId, id: b.batchId });
      if (!batch) throw notFound('Batch not found.');
      if (batch.QuantityOnHand + b.quantity < 0) throw badRequest(`Only ${batch.QuantityOnHand} unit(s) in this batch.`);
      await tx.exec('UPDATE hms.StockBatches SET QuantityOnHand = QuantityOnHand + @q WHERE TenantId = @tid AND BatchId = @id', { tid: req.ctx.tenantId, id: b.batchId, q: b.quantity });
      await tx.exec(`INSERT INTO hms.StockMovements (TenantId, MedicineId, BatchId, Kind, Quantity, Reference, CreatedByUserId) VALUES (@tid, @mid, @bid, 'adjust', @q, @r, @uid)`,
        { tid: req.ctx.tenantId, mid: batch.MedicineId, bid: b.batchId, q: b.quantity, r: b.reason, uid: req.ctx.userId });
      await auditTenant(req, 'stock.adjusted', 'medicine', batch.MedicineId, { quantity: b.quantity }, tx);
    });
    res.json({ data: { ok: true } });
  }));

router.get('/alerts', requirePermission('pharmacy.read'), asyncHandler(async (req, res) => {
  const today = localDateString(req.ctx.timezone);
  const params = { tid: req.ctx.tenantId, today: t.date(new Date(`${today}T00:00:00Z`)) };
  const [low, expiring] = await db.many(`
    SELECT TOP 50 * FROM (
      SELECT m.MedicineId AS id, m.Name AS name, m.Strength AS strength, m.ReorderLevel AS reorderLevel,
             ISNULL((SELECT SUM(QuantityOnHand) FROM hms.StockBatches b WHERE b.TenantId = m.TenantId AND b.MedicineId = m.MedicineId AND b.ExpiryDate >= @today), 0) AS stock
      FROM hms.Medicines m WHERE m.TenantId = @tid AND m.IsActive = 1) x
    WHERE x.stock <= x.reorderLevel ORDER BY x.stock;
    SELECT TOP 50 b.BatchId AS batchId, m.MedicineId AS medicineId, m.Name AS name, m.Strength AS strength, b.BatchNumber AS batchNumber, CONVERT(CHAR(10), b.ExpiryDate, 23) AS expiryDate,
           b.QuantityOnHand AS quantity, CAST(CASE WHEN b.ExpiryDate < @today THEN 1 ELSE 0 END AS BIT) AS expired
    FROM hms.StockBatches b JOIN hms.Medicines m ON m.TenantId = b.TenantId AND m.MedicineId = b.MedicineId
    WHERE b.TenantId = @tid AND b.QuantityOnHand > 0 AND b.ExpiryDate < DATEADD(DAY, 60, @today) ORDER BY b.ExpiryDate;`, params);
  res.json({ data: { lowStock: low, expiring } });
}));

// Phase 3: purchase orders.
router.use(purchaseOrderRoutes);

export default router;
