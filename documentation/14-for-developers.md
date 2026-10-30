# 14. For developers — code map

Deeper technical references live in [`docs/`](../docs): `ARCHITECTURE.md` (ER diagram, tenancy model), `API.md` (endpoints), `SECURITY.md`, `FEATURES.md`, `DEPLOYMENT.md`.

## Tech stack

| Layer | Stack |
|-------|-------|
| Frontend | React 19, Vite, react-router-dom 7, Tailwind CSS v4 (`@tailwindcss/vite`), `motion` (animations), `react-icons/lu`, `react-toastify` |
| Backend | Node.js ≥ 22.9 (ES modules), Express 4, `mssql`, `zod` (validation), `bcryptjs`, `helmet`, `express-rate-limit`, `cookie-parser` |
| Database | Microsoft SQL Server 2017+ (compat. level 130+), everything in schema **`hms`** |
| Payments | Provider abstraction: Razorpay (REST) + sandbox (dev only) |
| Tests | `node --test` (unit, no DB) + integration tests against a test DB |

## Folder map

```
backend/
  src/app.js                 Express app: security headers, CORS, CSRF, routers under /api/v1
  src/server.js              Startup + database self-check
  src/config/env.js          Reads & validates .env
  src/db/pool.js             Connection pool with retry; db.query/one/many/exec; withTransaction; typed params `t`
  src/db/migrate.js          Runs database/migrations/*.sql in order (checksummed, transactional)
  src/db/seed.js             Permissions & role sync, tenant back-fills, Super Admin, demo hospitals
  src/middleware/            auth (tenant & platform), tenantAccess (pure rules), csrf, validate, errorHandler
  src/payments/              razorpay.provider.js, sandbox.provider.js
  src/utils/                 jwt, password, pricing (paise maths), time zones, pagination, audit, sanitise…
  src/modules/<area>/        One folder per feature: *.routes.js (+ *.service.js / *.logic.js)
      auth onboarding tenants public admin tenant dashboard patients appointments staff users rbac
      opd ipd billing lab pharmacy reports expenses analytics backups clinical(logic shared by modules)
  tests/unit/                Pure-function tests (run: npm test)
  tests/integration/         Tenant isolation, payment idempotency (need a TEST database)
database/migrations/
  001_platform.sql           Plans, tenants, users, roles, sessions, subscriptions, payments, audit…
  002_hospital_core.sql      Departments, staff, schedules, patients, appointments
  003_seed_plans.sql         Default plans & feature matrix
  004_clinical_modules.sql   OPD, IPD, billing, lab, pharmacy
  005_lab_finance.sql        Lab departments, packages, price history, referral doctors, samples,
                             order amounts/bill link, expenses, backup log
frontend/src/
  App.jsx                    All routes; guard(perm, element, feature)
  layouts/                   PublicLayout, AppLayout (sidebar = APP_NAV), AdminLayout
  context/AuthContext.jsx    Logged-in user, can(perm), hasFeature(key)
  lib/                       api.js (fetch wrapper + auto refresh), hooks.js (useApi, useForm…), format.js, toast.js
  components/                ui.jsx (Button, Input, Modal, DataTable…), Pickers, BarChart, Logo…
  pages/public/              Website pages
  pages/app/                 Hospital screens (Lab.jsx, LabPages.jsx, FinancePages.jsx, Analytics.jsx, Backups.jsx…)
  pages/admin/               Super Admin screens
```

## The golden rules (please keep them)

1. **Tenant ID comes only from `req.ctx.tenantId`** (set by `requireTenant` from the signed session). Never accept it from the body/query; zod schemas are `.strict()` so unknown fields are rejected.
2. **Every query on tenant data has `WHERE TenantId = @tid`**, and every new table has `TenantId`, `UNIQUE (TenantId, Id)` and **composite foreign keys** `(TenantId, XId)`.
3. **Always parameterise** (`@name` params). Only allow-listed identifiers are interpolated (e.g. sort columns via `parseListQuery`).
4. **Guard every route** with `requirePermission('x.y')` and, for plan modules, `requireFeature('key')`.
5. **Money in paise** (`toMinor` / `fromMinor`), stored as `DECIMAL(12,2)`. **Times in UTC**, converted with the tenant's IANA time zone.
6. **Multi-step writes in `withTransaction`**; use `UPDLOCK` when reading a row you will change (stock, bills, sequences).
7. **Audit** important actions with `auditTenant(req, 'thing.action', 'thing', id, meta, tx)`.
8. **Never edit an applied migration** — add `00N_description.sql`.
9. **New permission?** Add it to `modules/rbac/permissions.js` (and role templates), then `npm run db:seed` syncs all hospitals.

## Adding a new module (recipe)

1. Migration `database/migrations/00N_x.sql` (tables with TenantId + composite FKs).
2. Permissions in `rbac/permissions.js`.
3. `backend/src/modules/x/x.routes.js` → `router.use(requireTenant, requireFeature(...))`, zod schemas, tenant-scoped SQL, audit.
4. Mount in `src/app.js` under `/api/v1/x`.
5. Pure logic in a `*.logic.js` + unit tests in `tests/unit`.
6. Page(s) in `frontend/src/pages/app`, route in `App.jsx` with `guard(...)`, menu entry in `APP_NAV`.
7. Document it in `docs/API.md`, `docs/FEATURES.md` and this `documentation/` folder.

## Useful commands

```bash
cd backend
npm run dev                    # API with auto-reload
npm test                       # unit tests
npm run db:migrate -- --status # list applied / pending migrations
npm run db:seed                # sync permissions/roles, back-fill defaults

cd frontend
npm run dev                    # screens at :5173 (proxies /api to :5000)
npm run build                  # production build into dist/
```

## Main API endpoints added for Laboratory & Finance

| Method & path | Purpose |
|---------------|---------|
| `GET/POST/PUT/DELETE /lab/tests[/:id]` | Test catalogue |
| `GET/POST /lab/tests/:id/prices` | Test price history / new price |
| `GET/POST/PUT/DELETE /lab/packages[/:id]` | Packages with test list |
| `GET/POST /lab/packages/:id/prices` | Package price history / new price |
| `GET /lab/departments` | Department suggestions |
| `GET/POST/PUT/DELETE /lab/referrals[/:id]` | Referral doctors |
| `GET/POST /lab/orders`, `GET /lab/orders/:id` | Orders (tests + packages, discount, own invoice, payment) |
| `POST /lab/orders/:id/status`, `PUT …/results`, `POST …/verify` | Workflow |
| `GET /lab/samples`, `POST /lab/samples/:id/(collect|receive|reject)` | Sample tracking |
| `GET /billing/payments` | Payments register with totals |
| `GET/POST/PUT/DELETE /expenses[/:id]`, `…/expenses/categories[/:id]` | Expenses |
| `GET /analytics?from&to` | Business analytics |
| `GET /backups`, `GET /backups/export` | Backup history, JSON export download |

[← Back to the documentation index](README.md)
