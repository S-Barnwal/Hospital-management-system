// Stock in: shared by "Receive stock" and purchase-order receipts.
import { badRequest, conflict } from '../../utils/errors.js';
import { t } from '../../db/pool.js';
import { localDateString } from '../../utils/time.js';

/** Adds stock to a batch (creating it if new) and writes the ledger line. Shared by "Receive stock" and purchase orders. */
export async function receiveStock(tx, req, b) {
  if (b.expiryDate <= localDateString(req.ctx.timezone)) throw badRequest('Cannot receive stock that is already expired.');
  const med = await tx.one('SELECT MedicineId FROM hms.Medicines WHERE TenantId = @tid AND MedicineId = @id', { tid: req.ctx.tenantId, id: b.medicineId });
  if (!med) throw badRequest('Medicine not found.');
  if (b.supplierId && !(await tx.one('SELECT 1 AS ok FROM hms.Suppliers WHERE TenantId = @tid AND SupplierId = @id', { tid: req.ctx.tenantId, id: b.supplierId }))) {
    throw badRequest('Supplier not found.');
  }
  const existing = await tx.one(`SELECT BatchId, CONVERT(CHAR(10), ExpiryDate, 23) AS ExpiryDate FROM hms.StockBatches WITH (UPDLOCK)
                                 WHERE TenantId = @tid AND MedicineId = @mid AND BatchNumber = @bn`, { tid: req.ctx.tenantId, mid: b.medicineId, bn: b.batchNumber });
  let id;
  if (existing) {
    if (existing.ExpiryDate !== b.expiryDate) throw conflict(`Batch ${b.batchNumber} already exists with expiry ${existing.ExpiryDate}.`);
    id = existing.BatchId;
    await tx.exec('UPDATE hms.StockBatches SET QuantityOnHand = QuantityOnHand + @q WHERE TenantId = @tid AND BatchId = @id', { tid: req.ctx.tenantId, id, q: b.quantity });
  } else {
    const r = await tx.one(`INSERT INTO hms.StockBatches (TenantId, MedicineId, BatchNumber, ExpiryDate, QuantityOnHand, PurchasePrice, SalePrice, SupplierId)
                            OUTPUT INSERTED.BatchId VALUES (@tid, @mid, @bn, @exp, @q, @pp, @sp, @sup)`,
    { tid: req.ctx.tenantId, mid: b.medicineId, bn: b.batchNumber, exp: t.date(new Date(`${b.expiryDate}T00:00:00Z`)), q: b.quantity,
      pp: t.money(Number(b.purchasePrice).toFixed(2)), sp: t.money(Number(b.salePrice).toFixed(2)), sup: b.supplierId ?? null });
    id = r.BatchId;
  }
  await tx.exec(`INSERT INTO hms.StockMovements (TenantId, MedicineId, BatchId, Kind, Quantity, UnitPrice, Reference, CreatedByUserId)
                 VALUES (@tid, @mid, @bid, 'receive', @q, @pp, @ref, @uid)`,
  { tid: req.ctx.tenantId, mid: b.medicineId, bid: id, q: b.quantity, pp: t.money(Number(b.purchasePrice).toFixed(2)), ref: b.reference ?? null, uid: req.ctx.userId });
  return id;
}
