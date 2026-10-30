# MediCore HMS — Multi-tenant Hospital Management SaaS

> 📘 **New here? Read the plain-language guide in [`documentation/`](documentation/README.md)** — what the project is, how it works, setup, and every screen explained.

React (Vite) + Node.js/Express + **Microsoft SQL Server**. One platform, many hospitals. Each hospital gets its own data, users, roles and its own workspace address.

```
Public website ─► Choose plan ─► Pay (server-verified) ─► Hospital workspace created ─► /app/dashboard
  /                /pricing        /register                  tenant + owner + roles          Hospital A / Hospital B
                                                              + subscription + invoice        (isolated records)
Super Admin portal: /admin  (separate login, separate cookies, separate DB table)
```

## Folder structure

```
backend/                 Express API (ES modules, Node ≥ 22.9)
  src/config/env.js      validated configuration (.env)
  src/db/                pool.js (mssql, parameterised helpers, transactions), migrate.js, seed.js
  src/middleware/        auth (tenant + platform), tenantAccess (pure isolation rules), csrf, validate, errors
  src/payments/          provider abstraction: razorpay.provider.js, sandbox.provider.js (dev only)
  src/modules/           auth, public, onboarding, tenants, admin, tenant, dashboard, patients,
                         appointments, staff, users, rbac
  tests/unit/            36 tests, no database needed
  tests/integration/     tenant-isolation & payment idempotency tests (need a SQL Server TEST database)
database/migrations/     001_platform … 005_lab_finance.sql (run in order by npm run db:migrate)
frontend/                React 19 + Vite + Tailwind v4 + motion
  src/pages/public/      Home, Features, Pricing, Register (checkout), Book a demo, Contact, About, FAQ, legal, auth
  src/pages/app/         Dashboard, Patients, Appointments, Doctors & staff, Users & roles, Settings, Subscription, Audit log
  src/pages/admin/       Overview, Tenants, Plans, Subscriptions, Payments, Demo requests, Messages, Audit logs, Settings
documentation/           PLAIN-LANGUAGE GUIDE for everyone — start at documentation/README.md
docs/                    ARCHITECTURE.md (ER diagram, tenancy), API.md, SECURITY.md, FEATURES.md, DEPLOYMENT.md
```

## Run it locally

Prerequisites: Node.js **22.9+**, a SQL Server database you can reach (local SQL Server Express / Developer, or a hosted one).

```bash
# 1. Backend
cd backend
cp .env.example .env          # then fill in DB_CONNECTION_STRING, JWT_SECRET, SUPERADMIN_*
npm install
npm run db:migrate            # creates all tables (tracked in dbo.SchemaMigrations)
npm run db:seed               # permissions + your Super Admin account
npm run db:seed:demo          # OPTIONAL: two DEMO hospitals (green-valley, blue-care) for testing
npm run dev                   # http://localhost:5000  — check http://localhost:5000/api/health

# 2. Frontend (new terminal)
cd frontend
npm install
npm install motion            # already in package.json; shown because the Motion library is used for animations
npm run dev                   # http://localhost:5173
```

Open:
- `http://localhost:5173` — public website (green / white / gold)
- `http://localhost:5173/pricing` → choose a plan → register → **sandbox payment** → you land in your new hospital dashboard
- `http://localhost:5173/admin/login` — Super Admin (credentials from `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD`)
- Demo hospitals (after `db:seed:demo`): `owner@green-valley.demo` / `DemoPass123!` and `owner@blue-care.demo` / `DemoPass123!`
- Subdomain testing: `http://green-valley.localhost:5173/login` (Chrome/Edge/Firefox resolve `*.localhost` automatically)

### Payments
- `PAYMENT_PROVIDER=sandbox` (default): a clearly labelled **test** gateway; payments are flagged `IsSandbox=1`, invoices are numbered `SBX-…`, and the server refuses to start in production with it.
- Real payments: create **API keys** in Razorpay Dashboard → *Account & Settings → API Keys* (test mode first, `rzp_test_…`), set `PAYMENT_PROVIDER=razorpay`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`. Add a webhook to `https://<api-host>/api/v1/billing/webhooks/razorpay` for `payment.captured`, `order.paid`, `payment.failed` and put its secret in `RAZORPAY_WEBHOOK_SECRET`. The Account ID / Merchant ID are **not** API keys.

### Tests
```bash
cd backend
npm test                      # unit tests (no DB)
# integration: create an EMPTY database whose name contains "test", put its settings in backend/.env.test, then
npm run test:integration
```

## SSMS
Migrations are plain T-SQL — you can also open `database/migrations/*.sql` in SSMS and run them in order. Requires **SQL Server 2017+** (or Azure SQL) with database compatibility level **130+**, because the code uses `STRING_SPLIT` and `STRING_AGG`. Backup/restore guidance is in `docs/DEPLOYMENT.md`.

See **docs/FEATURES.md** for what is implemented, tested, and still pending.
