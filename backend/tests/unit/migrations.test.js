// Every migration needs an "already applied" probe, so a database whose ledger was lost can be adopted safely.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { MIGRATIONS_DIR, APPLIED_PROBES, splitBatches } from '../../src/db/migrate.js';

test('each migration file has an applied-probe (add one in src/db/migrate.js for new migrations)', () => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  assert.deepEqual(files.filter((f) => !APPLIED_PROBES[f]), []);
});

test('GO splits batches', () => {
  assert.deepEqual(splitBatches('A\nGO\nB\n  go ;\nC'), ['A', 'B', 'C']);
});
