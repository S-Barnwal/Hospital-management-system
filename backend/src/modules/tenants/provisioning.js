// Tenant provisioning — runs inside the payment-finalisation transaction, so either the whole
// hospital workspace is created (tenant, roles, owner, subscription, invoice) or nothing is.
import { config } from '../../config/env.js';
import { ROLE_TEMPLATES } from '../rbac/permissions.js';
import { addInterval } from '../../utils/pricing.js';
import { audit } from '../../utils/audit.js';
import { t } from '../../db/pool.js';

/** Common tests every new hospital starts with; prices are 0 so each hospital sets its own. */
export const DEFAULT_LAB_TESTS = [
  ['HB', 'Haemoglobin', 'Blood', 'g/dL', 12, 17, null],
  ['TLC', 'Total Leucocyte Count', 'Blood', '10^3/µL', 4, 11, null],
  ['PLT', 'Platelet Count', 'Blood', '10^3/µL', 150, 450, null],
  ['FBS', 'Blood Sugar (Fasting)', 'Blood', 'mg/dL', 70, 100, null],
  ['PPBS', 'Blood Sugar (Post-prandial)', 'Blood', 'mg/dL', 70, 140, null],
  ['HBA1C', 'HbA1c', 'Blood', '%', 4, 5.6, null],
  ['CREAT', 'Serum Creatinine', 'Blood', 'mg/dL', 0.6, 1.3, null],
  ['UREA', 'Blood Urea', 'Blood', 'mg/dL', 15, 45, null],
  ['TSH', 'TSH', 'Blood', 'µIU/mL', 0.4, 4.0, null],
  ['URINE', 'Urine Routine', 'Urine', null, null, null, 'See report'],
];

export async function seedDefaultLabTests(tx, tenantId) {
  for (const [code, name, sample, unit, lo, hi, text] of DEFAULT_LAB_TESTS) {
    await tx.exec(`IF NOT EXISTS (SELECT 1 FROM hms.LabTests WHERE TenantId = @tid AND Code = @code)
                   INSERT INTO hms.LabTests (TenantId, Code, Name, SampleType, Unit, RefLow, RefHigh, RefText, Price) VALUES (@tid, @code, @name, @st, @unit, @lo, @hi, @txt, 0)`,
    { tid: tenantId, code, name, st: sample, unit, lo: lo == null ? null : t.dec(lo, 12, 4), hi: hi == null ? null : t.dec(hi, 12, 4), txt: text });
  }
}

export const DEFAULT_DEPARTMENTS = ['General Medicine', 'Paediatrics', 'Gynaecology', 'Orthopaedics', 'Emergency'];

/** Copies the default role templates (with permissions) into a tenant. Returns { [roleCode]: RoleId }. */
export async function createDefaultRoles(tx, tenantId) {
  const ids = {};
  for (const role of ROLE_TEMPLATES) {
    const row = await tx.one(
      `INSERT INTO hms.Roles (TenantId, Code, Name, Description, IsSystem)
       OUTPUT INSERTED.RoleId VALUES (@tid, @code, @name, @desc, 1)`,
      { tid: tenantId, code: role.code, name: role.name, desc: role.description });
    ids[role.code] = row.RoleId;
    await tx.exec(
      `INSERT INTO hms.RolePermissions (RoleId, PermissionId)
       SELECT @rid, p.PermissionId FROM hms.Permissions p
       WHERE p.Code IN (SELECT value FROM STRING_SPLIT(@codes, ','))`,
      { rid: row.RoleId, codes: role.permissions.join(',') });
  }
  return ids;
}

/**
 * Creates a fully configured tenant.
 * @param tx       transaction runner
 * @param o        { orgName, slug, facilityType, city, phone, ownerName, ownerEmail, ownerPasswordHash, timezone? }
 * @param plan     { planId, interval }
 * @param payment  { paymentId, subtotal, tax, total, currency, isSandbox } | null (null = admin-created, no invoice)
 */
export async function provisionTenant(tx, o, plan, payment, actor = { type: 'system', id: null, ip: null }) {
  const tenant = await tx.one(
    `INSERT INTO hms.Tenants (Slug, Name, Email, Phone, City, FacilityType, Status, Timezone)
     OUTPUT INSERTED.TenantId VALUES (@slug, @name, @email, @phone, @city, @ftype, 'active', @tz)`,
    { slug: o.slug, name: o.orgName, email: o.ownerEmail, phone: o.phone ?? null, city: o.city ?? null, ftype: o.facilityType ?? null, tz: o.timezone || 'Asia/Kolkata' });
  const tenantId = tenant.TenantId;

  await tx.exec(`INSERT INTO hms.TenantDomains (TenantId, Hostname, IsPrimary, IsVerified) VALUES (@tid, @host, 1, 1)`,
    { tid: tenantId, host: `${o.slug}.${config.appBaseDomain}` });

  const prefix = o.slug.replace(/-/g, '').slice(0, 3).toUpperCase() || 'PT';
  await tx.exec(
    `INSERT INTO hms.TenantSettings (TenantId, SettingKey, SettingValue) VALUES
       (@tid, 'patient.number_prefix', @prefix),
       (@tid, 'appointment.default_minutes', '15'),
       (@tid, 'hospital.address', NULL)`,
    { tid: tenantId, prefix });
  await tx.exec(
    `INSERT INTO hms.TenantSequences (TenantId, SequenceKey, NextValue) VALUES (@tid, 'patient', 1), (@tid, 'appointment', 1)`,
    { tid: tenantId });

  const roleIds = await createDefaultRoles(tx, tenantId);

  const owner = await tx.one(
    `INSERT INTO hms.Users (TenantId, Email, PasswordHash, FullName, Phone, Status, IsOwner)
     OUTPUT INSERTED.UserId VALUES (@tid, @email, @hash, @name, @phone, 'active', 1)`,
    { tid: tenantId, email: o.ownerEmail.toLowerCase(), hash: o.ownerPasswordHash, name: o.ownerName, phone: o.phone ?? null });
  await tx.exec('INSERT INTO hms.UserRoles (TenantId, UserId, RoleId) VALUES (@tid, @uid, @rid)',
    { tid: tenantId, uid: owner.UserId, rid: roleIds.owner });

  for (const name of DEFAULT_DEPARTMENTS) {
    await tx.exec('INSERT INTO hms.Departments (TenantId, Name) VALUES (@tid, @name)', { tid: tenantId, name });
  }
  await seedDefaultLabTests(tx, tenantId);

  const start = new Date();
  const end = addInterval(start, plan.interval);
  const sub = await tx.one(
    `INSERT INTO hms.Subscriptions (TenantId, PlanId, BillingInterval, Status, CurrentPeriodStart, CurrentPeriodEnd, GraceDays)
     OUTPUT INSERTED.SubscriptionId VALUES (@tid, @pid, @interval, 'active', @start, @end, @grace)`,
    { tid: tenantId, pid: plan.planId, interval: plan.interval, start, end, grace: config.subscriptionGraceDays });

  let invoiceNumber = null;
  if (payment) {
    invoiceNumber = await issueInvoice(tx, { tenantId, payment, description: `${o.planName ?? 'Subscription'} plan — ${plan.interval}` });
    await tx.exec('UPDATE hms.Payments SET TenantId = @tid, SubscriptionId = @sid, UpdatedAt = SYSUTCDATETIME() WHERE PaymentId = @pid',
      { tid: tenantId, sid: sub.SubscriptionId, pid: payment.paymentId });
  }

  await audit({ tenantId, actorType: actor.type, actorId: actor.id, action: 'tenant.provisioned', entityType: 'tenant', entityId: tenantId,
    metadata: { slug: o.slug, planId: plan.planId, interval: plan.interval, sandbox: payment?.isSandbox ?? null }, ip: actor.ip }, tx);

  return { tenantId, ownerUserId: owner.UserId, subscriptionId: sub.SubscriptionId, invoiceNumber };
}

/** Platform invoice numbers: INV-YYYYMM-<PaymentId>, sandbox invoices are prefixed SBX. Unique per payment. */
export async function issueInvoice(tx, { tenantId, payment, description }) {
  const now = new Date();
  const ym = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const number = `${payment.isSandbox ? 'SBX' : 'INV'}-${ym}-${String(payment.paymentId).padStart(6, '0')}`;
  await tx.exec(
    `INSERT INTO hms.Invoices (TenantId, PaymentId, InvoiceNumber, Description, Subtotal, TaxAmount, Total, Currency, IsSandbox)
     VALUES (@tid, @pid, @num, @desc, @sub, @tax, @total, @cur, @sbx)`,
    { tid: tenantId, pid: payment.paymentId, num: number, desc: description, sub: t.money(payment.subtotal), tax: t.money(payment.tax), total: t.money(payment.total), cur: payment.currency, sbx: payment.isSandbox });
  return number;
}
