// Applies versioned SQL scripts from /database/migrations in filename order.
// Each file runs inside a transaction and is recorded in hms.SchemaMigrations with a checksum.
// Usage: npm run db:migrate            (apply pending)
//        npm run db:migrate -- --status (list applied / pending)
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closePool, sql } from './pool.js';
import { config } from '../config/env.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(here, '../../../database/migrations');

/** Splits a script on lines containing only "GO" (SSMS batch separator). */
export function splitBatches(script) {
  return script
    .split(/^\s*GO\s*;?\s*$/gim)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
}

/** All HMS tables live in their own schema so they never clash with other apps' tables in the same database. */
export const SCHEMA = 'hms';

async function ensureTable(pool) {
  await pool.request().query(`IF SCHEMA_ID('${SCHEMA}') IS NULL EXEC('CREATE SCHEMA ${SCHEMA} AUTHORIZATION dbo');`);
  await pool.request().query(`
    IF OBJECT_ID('hms.SchemaMigrations', 'U') IS NULL
    CREATE TABLE hms.SchemaMigrations (
      Version   NVARCHAR(200) NOT NULL CONSTRAINT PK_SchemaMigrations PRIMARY KEY,
      Checksum  CHAR(64) NOT NULL,
      AppliedAt DATETIME2(3) NOT NULL CONSTRAINT DF_SchemaMigrations_AppliedAt DEFAULT (SYSUTCDATETIME())
    );`);
}

/**
 * How to tell that a migration's changes are already in the database: one object or column it creates. Every migration
 * runs in a single transaction, so if its last object exists the whole file was applied.
 * (tenant-safe: these probes only check that a table/column exists; they read no hospital rows.)
 */
export const APPLIED_PROBES = {
  '001_platform.sql': "SELECT CASE WHEN OBJECT_ID('hms.Notifications', 'U') IS NOT NULL THEN 1 ELSE 0 END AS ok",
  '002_hospital_core.sql': "SELECT CASE WHEN OBJECT_ID('hms.Appointments', 'U') IS NOT NULL THEN 1 ELSE 0 END AS ok",
  '003_seed_plans.sql': "SELECT CASE WHEN EXISTS (SELECT 1 FROM hms.Plans) THEN 1 ELSE 0 END AS ok",
  '004_clinical_modules.sql': "SELECT CASE WHEN OBJECT_ID('hms.StockMovements', 'U') IS NOT NULL THEN 1 ELSE 0 END AS ok",
  '005_lab_finance.sql': "SELECT CASE WHEN OBJECT_ID('hms.TenantBackups', 'U') IS NOT NULL THEN 1 ELSE 0 END AS ok",
  '006_messaging_security_gst.sql': "SELECT CASE WHEN COL_LENGTH('hms.BillItems', 'HsnSac') IS NOT NULL THEN 1 ELSE 0 END AS ok",
  '007_tenant_messaging.sql': "SELECT CASE WHEN COL_LENGTH('hms.MessageLog', 'SentVia') IS NOT NULL THEN 1 ELSE 0 END AS ok",
  '008_free_plans.sql': "SELECT CASE WHEN OBJECT_ID('hms.CK_Plans_FreeNotContactSales', 'C') IS NOT NULL THEN 1 ELSE 0 END AS ok",
  '009_contact_location.sql': "SELECT CASE WHEN COL_LENGTH('hms.DemoRequests', 'Country') IS NOT NULL THEN 1 ELSE 0 END AS ok",
  '010_platform_invoices.sql': "SELECT CASE WHEN OBJECT_ID('hms.PlatformSequences', 'U') IS NOT NULL THEN 1 ELSE 0 END AS ok",
  '011_hospital_location.sql': "SELECT CASE WHEN OBJECT_ID('hms.CK_Tenants_LatLng', 'C') IS NOT NULL THEN 1 ELSE 0 END AS ok",
  '012_phase2_care_and_cash.sql': "SELECT CASE WHEN OBJECT_ID('hms.MoneyReceived', 'V') IS NOT NULL THEN 1 ELSE 0 END AS ok",
  '013_phase3_lab_pharmacy_hr.sql': "SELECT CASE WHEN OBJECT_ID('hms.Attachments', 'U') IS NOT NULL THEN 1 ELSE 0 END AS ok",
  '014_phase4_frontdesk_platform.sql': "SELECT CASE WHEN COL_LENGTH('hms.Tenants', 'GroupId') IS NOT NULL THEN 1 ELSE 0 END AS ok",
  '015_lab_master_data.sql': "SELECT CASE WHEN COL_LENGTH('hms.LabResultValues', 'IsHeading') IS NOT NULL THEN 1 ELSE 0 END AS ok",
  '016_lab_ranges_critical.sql': "SELECT CASE WHEN EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LabResultValues_OpenCritical') THEN 1 ELSE 0 END AS ok",
};

/**
 * A database whose tables were created but whose migration ledger is empty (ledger dropped, created by hand, or by the
 * old dbo.SchemaMigrations runner): record the migrations that are verifiably already applied, in order, stopping at
 * the first one that is not — that one and everything after it then run normally. Nothing is re-created or dropped.
 */
async function adoptExistingSchema(pool, files, log) {
  const count = (await pool.request().query('SELECT COUNT(*) AS n FROM hms.SchemaMigrations')).recordset[0].n;
  const hasTables = (await pool.request().query("SELECT CASE WHEN OBJECT_ID('hms.Plans', 'U') IS NOT NULL THEN 1 ELSE 0 END AS ok")).recordset[0].ok;
  if (count > 0 || !hasTables) return;
  log('! Tables exist but the migration ledger (hms.SchemaMigrations) is empty — recording the migrations already applied…');
  for (const file of files) {
    const probe = APPLIED_PROBES[file];
    if (!probe || !(await pool.request().query(probe)).recordset[0].ok) break;
    const script = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    await pool.request().input('v', sql.NVarChar(200), file).input('c', sql.Char(64), createHash('sha256').update(script).digest('hex'))
      .query('IF NOT EXISTS (SELECT 1 FROM hms.SchemaMigrations WHERE Version = @v) INSERT INTO hms.SchemaMigrations (Version, Checksum) VALUES (@v, @c)');
    log(`  ✓ already applied: ${file}`);
  }
}

/**
 * Migrations use their own single connection with a long per-statement timeout: back-fills on a hosted SQL Server
 * over the internet can take longer than the app's normal 30-second request timeout.
 */
const MIGRATION_TIMEOUT_MS = 5 * 60 * 1000;

export async function migrate(opts = {}) {
  const pool = await new sql.ConnectionPool({ ...config.db, requestTimeout: MIGRATION_TIMEOUT_MS, pool: { max: 1, min: 0, idleTimeoutMillis: 30000 } }).connect();
  try {
    return await runMigrations(pool, opts);
  } finally {
    await pool.close().catch(() => {});
  }
}

async function runMigrations(pool, { statusOnly = false, log = console.log } = {}) {
  await ensureTable(pool);
  const allFiles = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  if (!statusOnly) await adoptExistingSchema(pool, allFiles, log);
  const applied = new Map(
    (await pool.request().query('SELECT Version, Checksum FROM hms.SchemaMigrations')).recordset.map((r) => [r.Version, r.Checksum]),
  );
  const files = allFiles;

  for (const file of files) {
    const script = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    const checksum = createHash('sha256').update(script).digest('hex');
    if (applied.has(file)) {
      if (applied.get(file) !== checksum) {
        log(`! ${file} was modified after being applied. Create a new migration instead of editing applied ones.`);
      } else if (statusOnly) {
        log(`  applied  ${file}`);
      }
      continue;
    }
    if (statusOnly) { log(`  pending  ${file}`); continue; }

    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      // Several processes may migrate at once (e.g. test files running in parallel, or two servers starting together).
      // An exclusive app lock serialises them; re-checking inside the lock means a migration another process has just
      // applied is skipped instead of being run a second time ("There is already an object named …").
      const lock = await new sql.Request(tx).query(
        "DECLARE @r INT; EXEC @r = sp_getapplock @Resource = N'hms_schema_migrate', @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 300000; SELECT @r AS r;");
      if (lock.recordset[0].r < 0) throw new Error('Another migration is still running. Try again in a minute.');
      const done = await new sql.Request(tx).input('v', sql.NVarChar(200), file).query('SELECT 1 AS x FROM hms.SchemaMigrations WHERE Version = @v');
      if (done.recordset.length) { await tx.commit(); continue; }
      log(`→ applying ${file}`);
      for (const batch of splitBatches(script)) {
        await new sql.Request(tx).batch(`SET XACT_ABORT ON;\n${batch}`);
      }
      await new sql.Request(tx)
        .input('v', sql.NVarChar(200), file)
        .input('c', sql.Char(64), checksum)
        .query('INSERT INTO hms.SchemaMigrations (Version, Checksum) VALUES (@v, @c)');
      await tx.commit();
      log(`✓ ${file}`);
    } catch (err) {
      try { await tx.rollback(); } catch { /* ignore */ }
      throw new Error(`Migration ${file} failed: ${err.message}`);
    }
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  migrate({ statusOnly: process.argv.includes('--status') })
    .then(() => console.log('Migrations complete.'))
    .catch((err) => { console.error(err.message); process.exitCode = 1; })
    .finally(closePool);
}
