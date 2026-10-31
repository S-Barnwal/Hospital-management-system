// Tenant provisioning — runs inside the payment-finalisation transaction, so either the whole
// hospital workspace is created (tenant, roles, owner, subscription, invoice) or nothing is.
import { config } from '../../config/env.js';
import { ROLE_TEMPLATES } from '../rbac/permissions.js';
import { addInterval } from '../../utils/pricing.js';
import { audit } from '../../utils/audit.js';
import { t } from '../../db/pool.js';
import { timezoneFor } from '../../utils/geo.js';
import { invoiceForPayment } from '../invoices/invoice.service.js';

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

/** Usual lab departments with their order on the report (each hospital can rename, reorder or switch them off). */
export const DEFAULT_LAB_DEPARTMENTS = [['Haematology', 10], ['Biochemistry', 20], ['Clinical Pathology', 30], ['Serology & Immunology', 40],
  ['Hormones', 50], ['Microbiology', 60], ['Histopathology', 70]];

export async function seedDefaultLabDepartments(tx, tenantId) {
  for (const [name, sort] of DEFAULT_LAB_DEPARTMENTS) {
    await tx.exec(`IF NOT EXISTS (SELECT 1 FROM hms.LabDepartments WHERE TenantId = @tid AND Name = @name)
                   INSERT INTO hms.LabDepartments (TenantId, Name, SortOrder) VALUES (@tid, @name, @sort)`, { tid: tenantId, name, sort });
  }
}

export const DEFAULT_EXPENSE_CATEGORIES = ['Salaries', 'Rent', 'Electricity & utilities', 'Lab reagents & consumables', 'Equipment maintenance', 'Medical supplies', 'Marketing', 'Miscellaneous'];

export async function seedDefaultExpenseCategories(tx, tenantId) {
  for (const name of DEFAULT_EXPENSE_CATEGORIES) {
    await tx.exec(`IF NOT EXISTS (SELECT 1 FROM hms.ExpenseCategories WHERE TenantId = @tid AND Name = @name)
                   INSERT INTO hms.ExpenseCategories (TenantId, Name) VALUES (@tid, @name)`, { tid: tenantId, name });
  }
}

/** A starter list of IPD service charges (price 0 — each hospital sets its own). */
export const DEFAULT_SERVICE_CHARGES = [
  ['Doctor visit (IPD)', 'doctor_visit'], ['Specialist consultation (IPD)', 'doctor_visit'], ['Nursing charges (per day)', 'nursing'],
  ['Dressing', 'procedure'], ['Injection / IV administration', 'procedure'], ['ECG', 'procedure'], ['Nebulisation', 'procedure'],
  ['Oxygen (per hour)', 'consumable'], ['Catheterisation', 'procedure'], ['Ambulance', 'other'],
];

export async function seedDefaultServiceCharges(tx, tenantId) {
  for (const [name, category] of DEFAULT_SERVICE_CHARGES) {
    await tx.exec(`IF NOT EXISTS (SELECT 1 FROM hms.ServiceCharges WHERE TenantId = @tid AND Name = @name)
                   INSERT INTO hms.ServiceCharges (TenantId, Name, Category, Price) VALUES (@tid, @name, @cat, 0)`, { tid: tenantId, name, cat: category });
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
    `INSERT INTO hms.Tenants (Slug, Name, Email, Phone, City, State, Country, FacilityType, Status, Timezone)
     OUTPUT INSERTED.TenantId VALUES (@slug, @name, @email, @phone, @city, @state, @country, @ftype, 'active', @tz)`,
    { slug: o.slug, name: o.orgName, email: o.ownerEmail, phone: o.phone ?? null, city: o.city ?? null, state: o.state ?? null,
      country: o.country || 'IN', ftype: o.facilityType ?? null, tz: o.timezone || timezoneFor(o.country) });
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
  await seedDefaultLabDepartments(tx, tenantId);
  await seedDefaultLabTests(tx, tenantId);
  await seedDefaultExpenseCategories(tx, tenantId);
  await seedDefaultServiceCharges(tx, tenantId);

  const start = new Date();
  // A free trial runs for the plan's trial days; afterwards the normal renewal (payment) flow takes over.
  const end = plan.trialDays ? new Date(start.getTime() + plan.trialDays * 86400000) : addInterval(start, plan.interval);
  const sub = await tx.one(
    `INSERT INTO hms.Subscriptions (TenantId, PlanId, BillingInterval, Status, CurrentPeriodStart, CurrentPeriodEnd, GraceDays, IsFree, IsTrial)
     OUTPUT INSERTED.SubscriptionId VALUES (@tid, @pid, @interval, 'active', @start, @end, @grace, @free, @trial)`,
    { tid: tenantId, pid: plan.planId, interval: plan.interval, start, end, grace: config.subscriptionGraceDays, free: Boolean(plan.isFree), trial: Boolean(plan.trialDays) });

  let invoiceNumber = null;
  if (payment) {
    ({ invoiceNumber } = await invoiceForPayment(tx, { tenantId, payment, description: `${o.planName ?? 'Subscription'} plan — ${plan.interval}`,
      subscriptionId: sub.SubscriptionId, planId: plan.planId, interval: plan.interval, periodStart: start, periodEnd: end }));
    await tx.exec('UPDATE hms.Payments SET TenantId = @tid, SubscriptionId = @sid, UpdatedAt = SYSUTCDATETIME() WHERE PaymentId = @pid',
      { tid: tenantId, sid: sub.SubscriptionId, pid: payment.paymentId });
  }

  await audit({ tenantId, actorType: actor.type, actorId: actor.id, action: 'tenant.provisioned', entityType: 'tenant', entityId: tenantId,
    metadata: { slug: o.slug, planId: plan.planId, interval: plan.interval, free: Boolean(plan.isFree), trialDays: plan.trialDays ?? 0, sandbox: payment?.isSandbox ?? null }, ip: actor.ip }, tx);

  return { tenantId, ownerUserId: owner.UserId, subscriptionId: sub.SubscriptionId, invoiceNumber, periodStart: start, periodEnd: end };
}

