// Applies versioned SQL scripts from /database/migrations in filename order.
// Each file runs inside a transaction and is recorded in dbo.SchemaMigrations with a checksum.
// Usage: npm run db:migrate            (apply pending)
//        npm run db:migrate -- --status (list applied / pending)
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool, sql } from './pool.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(here, '../../../database/migrations');

/** Splits a script on lines containing only "GO" (SSMS batch separator). */
export function splitBatches(script) {
  return script
    .split(/^\s*GO\s*;?\s*$/gim)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
}

async function ensureTable(pool) {
  await pool.request().query(`
    IF OBJECT_ID('dbo.SchemaMigrations', 'U') IS NULL
    CREATE TABLE dbo.SchemaMigrations (
      Version   NVARCHAR(200) NOT NULL CONSTRAINT PK_SchemaMigrations PRIMARY KEY,
      Checksum  CHAR(64) NOT NULL,
      AppliedAt DATETIME2(3) NOT NULL CONSTRAINT DF_SchemaMigrations_AppliedAt DEFAULT (SYSUTCDATETIME())
    );`);
}

export async function migrate({ statusOnly = false, log = console.log } = {}) {
  const pool = await getPool();
  await ensureTable(pool);
  const applied = new Map(
    (await pool.request().query('SELECT Version, Checksum FROM dbo.SchemaMigrations')).recordset.map((r) => [r.Version, r.Checksum]),
  );
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

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

    log(`→ applying ${file}`);
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      for (const batch of splitBatches(script)) {
        await new sql.Request(tx).batch(`SET XACT_ABORT ON;\n${batch}`);
      }
      await new sql.Request(tx)
        .input('v', sql.NVarChar(200), file)
        .input('c', sql.Char(64), checksum)
        .query('INSERT INTO dbo.SchemaMigrations (Version, Checksum) VALUES (@v, @c)');
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
