// Guard rail for future code: every SQL statement that touches a hospital-owned table must filter by
// TenantId (or carry an explicit /* tenant-safe: reason */ comment explaining why it does not need to).
// Runs with `npm test` — no database needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = path.join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
});

/** Tables that have a TenantId column, read from the migrations. */
function tenantTables() {
  const dir = path.join(root, '..', 'database', 'migrations');
  const sql = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(path.join(dir, f), 'utf8')).join('\n');
  const out = new Set();
  for (const m of sql.matchAll(/CREATE TABLE hms\.(\w+) \(([\s\S]*?)\n\);/g)) if (/\bTenantId\b/.test(m[2])) out.add(m[1]);
  return out;
}

test('every query on a hospital table is scoped by TenantId (or explicitly marked tenant-safe)', () => {
  const tables = tenantTables();
  assert.ok(tables.size > 30, 'expected to find the tenant tables in the migrations');
  const problems = [];
  for (const file of walk(path.join(root, 'src'))) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/`([^`]*?\b(?:SELECT|UPDATE|DELETE|INSERT|MERGE)\b[^`]*?)`/g)) {
      const q = m[1];
      const used = [...q.matchAll(/hms\.\[?(\w+)/g)].map((x) => x[1]).filter((t) => tables.has(t));
      if (!used.length || /\bTenantId\b|@tid\b|tenant-safe/.test(q)) continue;
      problems.push(`${path.relative(root, file)}:${src.slice(0, m.index).split('\n').length} uses ${[...new Set(used)].join(', ')} without TenantId`);
    }
  }
  assert.deepEqual(problems, [], `Add a TenantId filter (or a /* tenant-safe: reason */ comment):\n${problems.join('\n')}`);
});
