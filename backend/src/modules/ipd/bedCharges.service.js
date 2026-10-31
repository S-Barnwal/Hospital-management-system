// Daily bed charges: one bill line per admission per calendar day (hospital time zone), at the ward's daily rate.
// Safe to run any number of times — already-charged days are skipped, and the database unique index
// UX_BillItems_BedDay refuses a duplicate even if two servers race.
import { db, withTransaction } from '../../db/pool.js';
import { bedChargeDates } from '../clinical/phase2.logic.js';
import { addBillItem, getOrCreateDraftBill } from '../billing/billing.service.js';

/** Posts every missing bed-day up to `until` for one admission. Returns the number of days added. */
export async function postBedCharges(tx, ctx, admissionId, until = new Date()) {
  const a = await tx.one(`SELECT a.AdmissionId, a.AdmissionNumber, a.PatientId, a.AdmittedAt, a.DischargedAt, a.Status, w.Name AS WardName, w.DailyRate, t.Timezone
                          FROM hms.Admissions a WITH (UPDLOCK)
                          JOIN hms.Beds b ON b.TenantId = a.TenantId AND b.BedId = a.BedId
                          JOIN hms.Wards w ON w.TenantId = b.TenantId AND w.WardId = b.WardId
                          JOIN hms.Tenants t ON t.TenantId = a.TenantId
                          WHERE a.TenantId = @tid AND a.AdmissionId = @id`, { tid: ctx.tenantId, id: admissionId });
  if (!a || Number(a.DailyRate) <= 0) return 0;
  const end = a.DischargedAt && new Date(a.DischargedAt) < until ? new Date(a.DischargedAt) : until;
  const dates = bedChargeDates(a.AdmittedAt, end, a.Timezone || 'Asia/Kolkata');
  const done = new Set((await tx.query(`SELECT CONVERT(CHAR(10), ChargeDate, 23) AS d FROM hms.BillItems
                                        WHERE TenantId = @tid AND ReferenceType = 'bed_day' AND ReferenceId = @id`, { tid: ctx.tenantId, id: admissionId })).map((r) => r.d));
  const missing = dates.filter((d) => !done.has(d));
  if (!missing.length) return 0;
  const billId = await getOrCreateDraftBill(tx, ctx, a.PatientId, admissionId);
  for (const d of missing) {
    await addBillItem(tx, ctx.tenantId, billId, {
      itemType: 'bed', description: `Bed — ${a.WardName} · ${d} (${a.AdmissionNumber})`, quantity: 1,
      unitPrice: Number(a.DailyRate).toFixed(2), taxRatePercent: 0, referenceType: 'bed_day', referenceId: admissionId, chargeDate: d,
    });
  }
  return missing.length;
}

/** Scheduler job: for every admitted patient in hospitals that have Billing + IPD and auto bed charges on. */
export async function autoBedCharges() {
  const rows = await db.query(`
    /* tenant-safe: platform job; each admission is then processed with its own TenantId */
    SELECT TOP 2000 a.TenantId, a.AdmissionId FROM hms.Admissions a
    JOIN hms.Tenants t ON t.TenantId = a.TenantId AND t.Status = 'active'
    CROSS APPLY (SELECT TOP 1 s.PlanId FROM hms.Subscriptions s WHERE s.TenantId = a.TenantId ORDER BY s.CurrentPeriodEnd DESC) sub
    WHERE a.Status = 'admitted'
      AND EXISTS (SELECT 1 FROM hms.PlanFeatures f WHERE f.PlanId = sub.PlanId AND f.FeatureKey = 'billing' AND f.IsIncluded = 1)
      AND ISNULL((SELECT SettingValue FROM hms.TenantSettings x WHERE x.TenantId = a.TenantId AND x.SettingKey = 'ipd.auto_bed_charges'), 'on') = 'on'`);
  let added = 0;
  for (const r of rows) {
    try {
      added += await withTransaction((tx) => postBedCharges(tx, { tenantId: r.TenantId, userId: null }, r.AdmissionId));
    } catch (err) {
      if (!/UX_BillItems_BedDay|duplicate key/i.test(err.message)) console.error(`[jobs] bed charges for admission ${r.AdmissionId}: ${err.message}`);
    }
  }
  return added;
}
