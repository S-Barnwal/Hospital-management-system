// Seeds reference data. Safe to re-run.
//   npm run db:seed        → permissions + Super Admin (from SUPERADMIN_* env vars)
//   npm run db:seed:demo   → also two clearly-labelled DEMO hospitals for local testing (never run in production)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config/env.js';
import { db, withTransaction, closePool } from './pool.js';
import { PERMISSIONS, ROLE_TEMPLATES } from '../modules/rbac/permissions.js';
import { hashPassword, passwordProblem } from '../utils/password.js';
import { provisionTenant, seedDefaultLabTests } from '../modules/tenants/provisioning.js';
import { nextSequence, formatNumber } from '../modules/tenants/sequences.js';

export async function seedPermissions() {
  for (const [code, module, description] of PERMISSIONS) {
    await db.exec(`MERGE hms.Permissions AS tgt USING (SELECT @code AS Code) AS src ON tgt.Code = src.Code
                   WHEN MATCHED THEN UPDATE SET Module = @module, Description = @desc
                   WHEN NOT MATCHED THEN INSERT (Code, Module, Description) VALUES (@code, @module, @desc);`,
    { code, module, desc: description });
  }
  // Owners always hold every permission, including ones added in later releases.
  await db.exec(`INSERT INTO hms.RolePermissions (RoleId, PermissionId)
                 SELECT r.RoleId, p.PermissionId FROM hms.Roles r CROSS JOIN hms.Permissions p
                 WHERE r.Code = 'owner' AND NOT EXISTS (SELECT 1 FROM hms.RolePermissions rp WHERE rp.RoleId = r.RoleId AND rp.PermissionId = p.PermissionId)`);
  // Built-in roles receive permissions added in newer releases (custom grants are never removed).
  for (const role of ROLE_TEMPLATES) {
    await db.exec(`INSERT INTO hms.RolePermissions (RoleId, PermissionId)
                   SELECT r.RoleId, p.PermissionId FROM hms.Roles r CROSS JOIN hms.Permissions p
                   WHERE r.Code = @code AND r.IsSystem = 1 AND p.Code IN (SELECT value FROM STRING_SPLIT(@codes, ','))
                     AND NOT EXISTS (SELECT 1 FROM hms.RolePermissions rp WHERE rp.RoleId = r.RoleId AND rp.PermissionId = p.PermissionId)`,
    { code: role.code, codes: role.permissions.join(',') });
  }
  console.log(`✓ ${PERMISSIONS.length} permissions (built-in roles synced)`);
}

/** Gives hospitals created before the lab module its default test catalogue. */
export async function backfillTenants() {
  const tenants = await db.query('SELECT TenantId FROM hms.Tenants');
  for (const { TenantId } of tenants) {
    await withTransaction((tx) => seedDefaultLabTests(tx, TenantId));
  }
  if (tenants.length) console.log(`✓ default lab tests ensured for ${tenants.length} hospital(s)`);
}

export async function seedSuperAdmin() {
  const { email, password, name } = config.superAdmin;
  if (!email || !password) {
    console.log('… SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD not set — skipping Super Admin creation.');
    return;
  }
  const problem = passwordProblem(password);
  if (problem) throw new Error(`SUPERADMIN_PASSWORD: ${problem}`);
  const exists = await db.one('SELECT PlatformUserId FROM hms.PlatformUsers WHERE Email = @e', { e: email.toLowerCase() });
  if (exists) { console.log(`✓ Super Admin ${email} already exists`); return; }
  await db.exec(`INSERT INTO hms.PlatformUsers (Email, PasswordHash, FullName, Role) VALUES (@e, @h, @n, 'super_admin')`,
    { e: email.toLowerCase(), h: await hashPassword(password), n: name });
  console.log(`✓ Super Admin ${email} created`);
}

const DEMO = [
  { slug: 'green-valley', orgName: 'Green Valley Hospital (DEMO)', city: 'Pune', ownerEmail: 'owner@green-valley.demo', ownerName: 'Demo Owner GV' },
  { slug: 'blue-care', orgName: 'Blue Care Clinic (DEMO)', city: 'Indore', ownerEmail: 'owner@blue-care.demo', ownerName: 'Demo Owner BC' },
];
export const DEMO_PASSWORD = 'DemoPass123!';

async function seedDemo() {
  if (config.isProd) throw new Error('Refusing to seed demo data in production.');
  const plan = await db.one(`SELECT PlanId FROM hms.Plans WHERE Code = 'professional'`);
  const hash = await hashPassword(DEMO_PASSWORD);
  for (const d of DEMO) {
    if (await db.one('SELECT TenantId FROM hms.Tenants WHERE Slug = @s', { s: d.slug })) { console.log(`✓ demo tenant ${d.slug} exists`); continue; }
    await withTransaction(async (tx) => {
      const { tenantId } = await provisionTenant(tx, { ...d, facilityType: 'hospital', phone: '+91 90000 00000', ownerPasswordHash: hash, planName: 'Professional' },
        { planId: plan.PlanId, interval: 'monthly' }, null, { type: 'system', id: null, ip: null });
      const dept = await tx.one(`SELECT DepartmentId FROM hms.Departments WHERE TenantId = @tid AND Name = 'General Medicine'`, { tid: tenantId });
      const doc = await tx.one(`INSERT INTO hms.StaffMembers (TenantId, StaffType, FullName, DepartmentId, Designation, Specialization, ConsultationFee)
                                OUTPUT INSERTED.StaffId VALUES (@tid, 'doctor', @n, @dept, 'Consultant', 'General Physician', 500)`,
      { tid: tenantId, n: `Dr. Demo ${d.slug === 'green-valley' ? 'Sharma' : 'Verma'}`, dept: dept.DepartmentId });
      for (let dow = 1; dow <= 6; dow += 1) {
        await tx.exec(`INSERT INTO hms.DoctorSchedules (TenantId, StaffId, DayOfWeek, StartTime, EndTime, SlotMinutes) VALUES (@tid, @s, @d, '09:00', '13:00', 15)`,
          { tid: tenantId, s: doc.StaffId, d: dow });
      }
      const prefix = d.slug === 'green-valley' ? 'GRE' : 'BLU';
      for (const [first, last, gender] of [['Test', 'Patient One', 'female'], ['Test', 'Patient Two', 'male'], ['Test', 'Patient Three', 'other']]) {
        const n = await nextSequence(tx, tenantId, 'patient');
        await tx.exec(`INSERT INTO hms.Patients (TenantId, PatientNumber, FirstName, LastName, Gender) VALUES (@tid, @num, @f, @l, @g)`,
          { tid: tenantId, num: formatNumber(prefix, n), f: first, l: `${last} (${d.slug})`, g: gender });
      }
    });
    console.log(`✓ demo tenant ${d.slug} — login ${d.ownerEmail} / ${DEMO_PASSWORD}`);
  }
  // Demo wards & pharmacy stock (only added once).
  for (const d of DEMO) {
    const tenant = await db.one('SELECT TenantId FROM hms.Tenants WHERE Slug = @s', { s: d.slug });
    if (!tenant) continue;
    const tid = tenant.TenantId;
    if (!(await db.one('SELECT TOP 1 1 AS x FROM hms.Wards WHERE TenantId = @tid', { tid }))) {
      await withTransaction(async (tx) => {
        for (const [name, type, rate, beds] of [['General Ward', 'general', 1500, 6], ['Private Rooms', 'private', 4000, 3], ['ICU', 'icu', 8000, 2]]) {
          const w = await tx.one('INSERT INTO hms.Wards (TenantId, Name, WardType, DailyRate) OUTPUT INSERTED.WardId VALUES (@tid, @n, @t, @r)', { tid, n: name, t: type, r: rate });
          for (let i = 1; i <= beds; i += 1) await tx.exec('INSERT INTO hms.Beds (TenantId, WardId, BedNumber) VALUES (@tid, @w, @b)', { tid, w: w.WardId, b: `${name[0]}${i}` });
        }
      });
    }
    if (!(await db.one('SELECT TOP 1 1 AS x FROM hms.Medicines WHERE TenantId = @tid', { tid }))) {
      await withTransaction(async (tx) => {
        const exp = new Date(Date.UTC(new Date().getUTCFullYear() + 1, 5, 30));
        for (const [name, strength, form, price, qty] of [['Paracetamol', '500 mg', 'Tablet', 2, 200], ['Amoxicillin', '500 mg', 'Capsule', 8, 100], ['ORS', '21 g', 'Sachet', 20, 8]]) {
          const m = await tx.one(`INSERT INTO hms.Medicines (TenantId, Name, Strength, Form, Unit, TaxRatePercent, SalePrice, ReorderLevel)
                                  OUTPUT INSERTED.MedicineId VALUES (@tid, @n, @s, @f, 'unit', 12, @p, 10)`, { tid, n: name, s: strength, f: form, p: price });
          const b = await tx.one(`INSERT INTO hms.StockBatches (TenantId, MedicineId, BatchNumber, ExpiryDate, QuantityOnHand, PurchasePrice, SalePrice)
                                  OUTPUT INSERTED.BatchId VALUES (@tid, @m, 'DEMO-001', @e, @q, @pp, @p)`, { tid, m: m.MedicineId, e: exp, q: qty, pp: price * 0.7, p: price });
          await tx.exec(`INSERT INTO hms.StockMovements (TenantId, MedicineId, BatchId, Kind, Quantity, Reference) VALUES (@tid, @m, @b, 'receive', @q, 'Demo opening stock')`,
            { tid, m: m.MedicineId, b: b.BatchId, q: qty });
        }
      });
    }
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  (async () => {
    await seedPermissions();
    await backfillTenants();
    await seedSuperAdmin();
    if (process.argv.includes('--demo')) await seedDemo();
  })()
    .then(() => console.log('Seed complete.'))
    .catch((err) => { console.error(err.message); process.exitCode = 1; })
    .finally(closePool);
}
