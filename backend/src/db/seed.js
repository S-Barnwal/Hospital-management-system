// Seeds reference data. Safe to re-run.
//   npm run db:seed        → permissions + Super Admin (from SUPERADMIN_* env vars)
//   npm run db:seed:demo   → also two clearly-labelled DEMO hospitals for local testing (never run in production)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config/env.js';
import { db, withTransaction, closePool } from './pool.js';
import { PERMISSIONS } from '../modules/rbac/permissions.js';
import { hashPassword, passwordProblem } from '../utils/password.js';
import { provisionTenant } from '../modules/tenants/provisioning.js';
import { nextSequence, formatNumber } from '../modules/tenants/sequences.js';

export async function seedPermissions() {
  for (const [code, module, description] of PERMISSIONS) {
    await db.exec(`MERGE dbo.Permissions AS tgt USING (SELECT @code AS Code) AS src ON tgt.Code = src.Code
                   WHEN MATCHED THEN UPDATE SET Module = @module, Description = @desc
                   WHEN NOT MATCHED THEN INSERT (Code, Module, Description) VALUES (@code, @module, @desc);`,
    { code, module, desc: description });
  }
  // Owners always hold every permission, including ones added in later releases.
  await db.exec(`INSERT INTO dbo.RolePermissions (RoleId, PermissionId)
                 SELECT r.RoleId, p.PermissionId FROM dbo.Roles r CROSS JOIN dbo.Permissions p
                 WHERE r.Code = 'owner' AND NOT EXISTS (SELECT 1 FROM dbo.RolePermissions rp WHERE rp.RoleId = r.RoleId AND rp.PermissionId = p.PermissionId)`);
  console.log(`✓ ${PERMISSIONS.length} permissions`);
}

export async function seedSuperAdmin() {
  const { email, password, name } = config.superAdmin;
  if (!email || !password) {
    console.log('… SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD not set — skipping Super Admin creation.');
    return;
  }
  const problem = passwordProblem(password);
  if (problem) throw new Error(`SUPERADMIN_PASSWORD: ${problem}`);
  const exists = await db.one('SELECT PlatformUserId FROM dbo.PlatformUsers WHERE Email = @e', { e: email.toLowerCase() });
  if (exists) { console.log(`✓ Super Admin ${email} already exists`); return; }
  await db.exec(`INSERT INTO dbo.PlatformUsers (Email, PasswordHash, FullName, Role) VALUES (@e, @h, @n, 'super_admin')`,
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
  const plan = await db.one(`SELECT PlanId FROM dbo.Plans WHERE Code = 'professional'`);
  const hash = await hashPassword(DEMO_PASSWORD);
  for (const d of DEMO) {
    if (await db.one('SELECT TenantId FROM dbo.Tenants WHERE Slug = @s', { s: d.slug })) { console.log(`✓ demo tenant ${d.slug} exists`); continue; }
    await withTransaction(async (tx) => {
      const { tenantId } = await provisionTenant(tx, { ...d, facilityType: 'hospital', phone: '+91 90000 00000', ownerPasswordHash: hash, planName: 'Professional' },
        { planId: plan.PlanId, interval: 'monthly' }, null, { type: 'system', id: null, ip: null });
      const dept = await tx.one(`SELECT DepartmentId FROM dbo.Departments WHERE TenantId = @tid AND Name = 'General Medicine'`, { tid: tenantId });
      const doc = await tx.one(`INSERT INTO dbo.StaffMembers (TenantId, StaffType, FullName, DepartmentId, Designation, Specialization, ConsultationFee)
                                OUTPUT INSERTED.StaffId VALUES (@tid, 'doctor', @n, @dept, 'Consultant', 'General Physician', 500)`,
      { tid: tenantId, n: `Dr. Demo ${d.slug === 'green-valley' ? 'Sharma' : 'Verma'}`, dept: dept.DepartmentId });
      for (let dow = 1; dow <= 6; dow += 1) {
        await tx.exec(`INSERT INTO dbo.DoctorSchedules (TenantId, StaffId, DayOfWeek, StartTime, EndTime, SlotMinutes) VALUES (@tid, @s, @d, '09:00', '13:00', 15)`,
          { tid: tenantId, s: doc.StaffId, d: dow });
      }
      const prefix = d.slug === 'green-valley' ? 'GRE' : 'BLU';
      for (const [first, last, gender] of [['Test', 'Patient One', 'female'], ['Test', 'Patient Two', 'male'], ['Test', 'Patient Three', 'other']]) {
        const n = await nextSequence(tx, tenantId, 'patient');
        await tx.exec(`INSERT INTO dbo.Patients (TenantId, PatientNumber, FirstName, LastName, Gender) VALUES (@tid, @num, @f, @l, @g)`,
          { tid: tenantId, num: formatNumber(prefix, n), f: first, l: `${last} (${d.slug})`, g: gender });
      }
    });
    console.log(`✓ demo tenant ${d.slug} — login ${d.ownerEmail} / ${DEMO_PASSWORD}`);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  (async () => {
    await seedPermissions();
    await seedSuperAdmin();
    if (process.argv.includes('--demo')) await seedDemo();
  })()
    .then(() => console.log('Seed complete.'))
    .catch((err) => { console.error(err.message); process.exitCode = 1; })
    .finally(closePool);
}
