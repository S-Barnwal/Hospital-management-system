// `npm run test:e2e` — runs the end-to-end integration tests against the database in backend/.env (your DEVELOPMENT
// database), for setups that have only one database. It creates throwaway hospitals (slugs iso-*, mod-*, free-*),
// exercises every flow over real HTTP + SQL Server, and deactivates those hospitals at the end.
// Refuses to run when NODE_ENV=production. Prefer a separate "…test" database when you can (npm run test:integration).
import { spawn } from 'node:child_process';
import { config } from '../../src/config/env.js';

if (config.isProd) {
  console.error('Refusing: NODE_ENV=production. Never run tests against the live database.');
  process.exit(1);
}
const name = config.db.database;
if (!name) { console.error('No database configured in backend/.env'); process.exit(1); }
console.log(`Running end-to-end tests on development database "${name}" (test hospitals are deactivated afterwards)…\n`);
const child = spawn(process.execPath, ['--test', '--test-concurrency=1', 'tests/integration/**/*.test.js'], {
  stdio: 'inherit', env: { ...process.env, INTEGRATION_DB_OK: name },
});
child.on('exit', (code) => process.exit(code ?? 1));
