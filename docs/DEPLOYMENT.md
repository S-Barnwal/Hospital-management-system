# Deployment

## Environments
| | Local | Staging | Production |
|---|---|---|---|
| Frontend | Vite :5173 | `staging.app.example.com` | `app.example.com`, `*.app.example.com`, `admin.example.com` |
| API | :5000 | `api-staging.example.com` | `api.example.com` (or same origin under `/api`) |
| DB | local / dev DB | separate DB | separate DB, private network only |
| Payments | sandbox | Razorpay **test** keys | Razorpay **live** keys |

## Build & run
```bash
cd frontend && npm ci && npm run build     # static files in frontend/dist → any static host / CDN / IIS / Nginx
cd backend  && npm ci --omit=dev && NODE_ENV=production npm start   # behind a reverse proxy, TRUST_PROXY=1
```
Serve the SPA with a fallback to `index.html`; proxy `/api` to the Node process (same origin keeps cookies simple). On Windows/IIS use iisnode or run Node as a service (NSSM/pm2) behind IIS ARR.

## DNS & TLS
Wildcard A/CNAME `*.app.example.com`, wildcard certificate (Let's Encrypt DNS-01 or your CA). Set `APP_BASE_DOMAIN=app.example.com`, `COOKIE_DOMAIN=.app.example.com`, `COOKIE_SECURE=true`.

## SQL Server
- Connection: `DB_CONNECTION_STRING` (ADO.NET format) or `DB_SERVER/DB_NAME/DB_USER/DB_PASSWORD`. Use `Encrypt=True;TrustServerCertificate=False` in production.
- Never expose port 1433 to the internet; restrict by firewall/VNet to the API hosts.
- Migrations: `npm run db:migrate` (forward-only; to change schema add `004_*.sql`, never edit an applied file). Rollback = restore backup or write a compensating migration.
- Backups (SSMS / T-SQL):
  ```sql
  BACKUP DATABASE [medicore_hms] TO DISK = N'D:\Backups\medicore_full.bak' WITH COMPRESSION, CHECKSUM;
  BACKUP LOG [medicore_hms] TO DISK = N'D:\Backups\medicore_log.trn' WITH COMPRESSION, CHECKSUM;   -- FULL recovery model
  RESTORE VERIFYONLY FROM DISK = N'D:\Backups\medicore_full.bak';
  ```
  Schedule full daily + log every 15 min via SQL Agent (hosted providers: use their backup tool). Test a restore monthly.

## Release & rollback
1. Backup DB → 2. `db:migrate` → 3. deploy API → 4. deploy frontend → 5. smoke test `/api/health`, login, a booking.
Rollback: redeploy previous build; restore DB only if a migration was destructive.

## Monitoring
Structured JSON logs to stdout (request id, status, latency — no bodies). `/api/health` for uptime checks. Alert on 5xx rate, DB failures, webhook signature failures (`onboarding.signature_invalid` audit events).
