import { config } from './config/env.js';
import { createApp } from './app.js';
import { closePool, getPool, db, withTransaction } from './db/pool.js';
import { startScheduler } from './jobs/scheduler.js';
import { loadGeo } from './utils/geo.js';
import { backfillMissingInvoices } from './modules/invoices/invoice.service.js';

if (config.problems.length) {
  console.error('Configuration problems:\n - ' + config.problems.join('\n - '));
  process.exit(1);
}
if (config.payments.provider === 'sandbox') {
  console.warn('[payments] SANDBOX provider active — no real money is collected. Never use in production.');
}

// Country/state/city lists used by address validation (loaded in the background; validation is lenient until ready).
loadGeo().catch((err) => console.error(`[geo] could not load country/state/city data: ${err.message}`));

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port} (${config.nodeEnv})`);
});

// Startup self-check: tells you exactly what is wrong with the database setup.
getPool()
  .then(async (pool) => {
    console.log(`✓ Connected to SQL Server (${config.db.server} / ${config.db.database})`);
    const r = await pool.request().query(`SELECT
      CASE WHEN OBJECT_ID('hms.Plans', 'U') IS NULL THEN 0 ELSE 1 END AS migrated,
      CASE WHEN OBJECT_ID('hms.Permissions', 'U') IS NULL THEN 0 ELSE (SELECT COUNT(*) FROM hms.Permissions) END AS permissions`);
    const { migrated, permissions } = r.recordset[0];
    if (!migrated) console.error('✗ Tables not found. Run:  npm run db:migrate   then   npm run db:seed');
    else if (!permissions) console.error('✗ Permissions not seeded. Run:  npm run db:seed');
    else {
      console.log('✓ Database schema ready.');
      startScheduler();
      backfillMissingInvoices({ db, withTransaction })
        .then((r) => { if (r.created) console.log(`✓ Created ${r.created} missing invoice(s).`); if (r.skipped) console.warn(`[invoices] ${r.skipped} — run: npm run db:migrate`); })
        .catch((err) => console.error(`[invoices] backfill failed: ${err.message}`));
    }
  })
  .catch((err) => {
    console.error(`✗ SQL Server connection failed [${err.code || 'ERROR'}]: ${err.message}`);
    console.error('  Check DB_CONNECTION_STRING in backend/.env, the password, and that your SQL host allows remote connections from your IP.');
  });

async function shutdown(signal) {
  console.log(`${signal} received, shutting down…`);
  server.close(async () => {
    await closePool().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
