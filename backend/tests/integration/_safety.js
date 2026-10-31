// Integration tests write real rows. They run only on a database whose name contains "test", or — when you have just
// one development database (e.g. a free hosting plan) — on a database you name explicitly:
//   INTEGRATION_DB_OK=<exact database name> npm run test:integration
// Never in production. The test hospitals are switched to "deactivated" afterwards on a non-test database.
export function assertSafeDatabase(config) {
  const name = config.db.database || '';
  const optedIn = process.env.INTEGRATION_DB_OK && process.env.INTEGRATION_DB_OK === name;
  if (config.isProd || (!/test/i.test(name) && !optedIn)) {
    throw new Error('Refusing to run integration tests: use a database whose name contains "test", or set INTEGRATION_DB_OK to the exact '
      + 'database name to allow your development database. Never run them on production.');
  }
  return /test/i.test(name);
}

/** On a shared dev database: switch the throwaway test hospitals off so they stay out of the way (rows are kept). */
export async function retireTestHospitals(db, slugs, isTestDb) {
  if (isTestDb || !slugs.length) return;
  const list = slugs.map((_, i) => `@s${i}`).join(', ');
  const params = Object.fromEntries(slugs.map((s, i) => [`s${i}`, s]));
  await db.exec(`/* tenant-safe: test clean-up by slug */ UPDATE hms.Tenants SET Status = 'deactivated', SuspendedReason = 'Automated test hospital'
                 WHERE Slug IN (${list})`, params);
  await db.exec(`/* tenant-safe: test clean-up by slug */ UPDATE hms.UserSessions SET RevokedAt = SYSUTCDATETIME()
                 WHERE RevokedAt IS NULL AND TenantId IN (SELECT TenantId FROM hms.Tenants WHERE Slug IN (${list}))`, params);
}
