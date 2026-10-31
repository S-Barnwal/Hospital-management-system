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
  src/notify/                deliver() → hms.MessageLog (masked) → providers (log | smtp | WhatsApp Cloud API); templates; format helpers
  src/notify/sender.js       Sender identity per hospital: "Hospital" <platform address> + Reply-To, or the hospital's own account (decrypted)
  src/utils/secretBox.js     AES-256-GCM seal/open for secrets at rest (MESSAGING_ENCRYPTION_KEY)
  src/utils/contact.js       THE phone / e-mail / country-state-city rules (zod): phoneSchema → E.164 via libphonenumber-js,
                             emailSchema, withLocation(schema). Use these in every new schema — never a hand-written regex.
  src/utils/geo.js           World countries/states/cities (country-state-city), loaded once at start; /api/v1/geo serves them
  src/modules/invoices/      invoice.logic.js (FY numbering, totals, GST split, words — pure), invoice.service.js
                             (createInvoice, invoiceForPayment, invoiceForFree, numbering under lock), invoices.routes.js (Super Admin)
  src/jobs/scheduler.js      Every JOBS_INTERVAL_SEC: free-plan roll-over, daily bed charges, appointment & follow-up reminders,
                             subscription reminders, daily summaries (DedupeKey = send once; bed days unique per date)
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
  006_messaging_security_gst.sql  MessageLog, LoginChallenges (OTP), ReportShares (patient links), GST fields
  007_tenant_messaging.sql   TenantMessagingConfig (encrypted own SMTP/WhatsApp), MessageLog.SentVia, plan feature own_messaging
  008_free_plans.sql         Plans.IsFree/FreeSince, Subscriptions.IsFree ("free for now" mode)
  009_contact_location.sql   State/Country on Patients, OnboardingRequests, DemoRequests
  010_platform_invoices.sql  Invoices: kind/status (draft|issued|void), buyer & seller snapshot, FY numbering (PlatformSequences)
  011_hospital_location.sql  Tenants.PostalCode/Latitude/Longitude
  012_phase2_care_and_cash.sql  PrescriptionTemplates(+Items), PatientVitals, NursingNotes, ServiceCharges, BillItems.ChargeDate
                             (+ unique bed-day index), DischargeSummaries, PatientDeposits, BillPaymentLinks, CashClosings,
                             view hms.MoneyReceived (counts deposits once; used by dashboard/reports/analytics/daily summary)
  013_phase3_lab_pharmacy_hr.sql  Lab panels/result values, home collections, purchase orders, barcodes, attendance, leave,
                             payroll, recurring expenses, attachments (VARBINARY, magic-byte checked)
  014_phase4_frontdesk_platform.sql  QueueTokens (+ unique per day/queue/number, one per appointment), DisplayScreens (token hash),
                             OnlineBookingRequests, StaffMembers.Room, Patients.PhotoAttachmentId/AbhaNumber/AbhaAddress,
                             LoginEvents, JobRuns, Coupons/CouponRedemptions (+ Payments.CouponId/DiscountAmount),
                             Plans.TrialDays/Subscriptions.IsTrial/OnboardingRequests.IsTrial, SupportTickets(+Messages),
                             TenantGroups + Tenants.GroupId/BranchName
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

## Multi-tenancy safety net (automatic)

- `npm test` includes **tenancy-guard**: it reads the migrations to find every table with a `TenantId`, then scans all SQL in `backend/src`. Any query on such a table without a `TenantId` filter **fails the build** — unless it carries a comment `/* tenant-safe: reason */` (e.g. platform-admin views, rows found by a secret token). So a future developer cannot silently forget the tenant filter.
- `npm run test:integration` (needs a *test* database) registers two hospitals side by side and proves over HTTP that each gets its own defaults and numbering (both start at `LAB-000001`) and that one hospital gets **404** for every patient, lab order, package, referral doctor, sample, expense, message and backup row of the other.
- The same suite walks the **Phase 2 flows end to end** over real HTTP + SQL Server: prescription template → consultation with vitals, prescription and follow-up → follow-up list; ward → admission → vitals (critical flags) → nursing note → service charge → daily bed charge (never twice) → discharge summary saved, signed (then locked) → discharge; deposit → finalise bill → apply deposit → refund limit; UPI payment link → public page (no patient surname/e-mail/clinical data) → revoke → link dead; cash closing. Hospital B gets 404 for every one of A's records.
- `tests/integration/phase4.test.js` walks **Phase 4**: token numbering per queue/day, priority calling, doctor room as counter, B locked out of A's queues/tokens/patients, TV feed without patient data and dead after revoke; check-in issues one token; online booking off by default → on → request (consent, honeypot, slot held, no double request) → confirm creates patient + appointment, B gets 404; ABHA validation/uniqueness; support tickets isolated and internal notes hidden; sign-in history per hospital incl. failures; branches figures only where the same e-mail has an account; coupon preview maths; free trial (14 days, one per e-mail); every new `/admin/*` route refuses hospital and anonymous sessions.
- `tests/integration/phase3.test.js` walks **Phase 3** end to end: lab panel → order with home collection (charge added) → assign collector (B's staff refused) → collected → per-parameter results and flags → trends; barcode unique per hospital → PO draft → place → partial and full receipt (stock rises) → cancel refused; attendance (no future dates) → unpaid half-day leave → payroll maths → pay once → locked salary expense; recurring expense posted for each due date exactly once; attachments checked by bytes, sandboxed, soft-deleted. Hospital B gets 404/400 for every one of A's records.

### Running the end-to-end tests

| Command | Database | When |
|---------|----------|------|
| `npm run test:integration` | the one in `backend/.env.test` — its name must contain `test` | Best: a separate test database |
| `npm run test:e2e` | your **development** database from `backend/.env` | When you have only one database (e.g. a free hosting plan). Creates throwaway hospitals (`iso-…`, `mod-…`, `free-…`) and **deactivates** them at the end. Refuses to run with `NODE_ENV=production`. |

Run `npm run db:migrate` first. A green run ends with `# fail 0`.

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
8. Sending a message? Use `deliver()` from `src/notify` (never call a provider directly) so it is logged, masked and de-duplicated.
9. Phone / e-mail / address fields? Backend: `optionalPhone`, `phoneSchema`, `optionalEmail`, `emailSchema`, `withLocation()` from `utils/contact.js`. Screens: `<PhoneInput>`, `<EmailInput>`, `<LocationFields form={f}>`; show stored numbers with `formatPhone()`.

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
| `POST /auth/login` → `{ mfaRequired, challengeId }` · `POST /auth/login/verify` | 2-step sign-in (same for `/auth/admin/…`) |
| `POST /lab/orders/:id/share`, `GET …/shares`, `POST …/shares/:shareId/revoke` | Send / list / revoke patient report links |
| `GET /public/reports/:token`, `POST …/otp`, `POST …/view` | Patient side of the report link (no login) |
| `GET /message-log` | Message log (audit.read) |
| `GET/PUT /settings/messaging`, `POST /settings/messaging/test` | Reply-to, own SMTP/WhatsApp (Enterprise, secrets write-only), test message |
| `PATCH /billing/bills/:id` `{ isInterState, buyerGstin }` | GST options on a draft bill |
| `POST /admin/plans/free-mode` `{ free, planId?, noticeDays? }` | Super Admin "free for now" switch (free sign-up path: `registerFree()` in `onboarding.service.js`) |
| `GET /geo/countries`, `/geo/states?country=IN`, `/geo/cities?country=IN&state=MH` | Public address lists (cached a day) |
| `GET/POST /admin/invoices`, `GET/PUT/DELETE /admin/invoices/:id`, `POST …/:id/issue`, `POST …/:id/void`, `GET /admin/invoices/export.csv` | Platform invoices (write = super_admin; delete = drafts only) |
| `GET /subscription/invoices/:id` | A hospital's own invoice (never drafts) |
| `PUT /settings/location` `{ latitude, longitude, postalCode }` · `GET /admin/hospital-locations` | Hospital map pin; Super Admin map |
| `GET/POST/PUT/DELETE /opd/templates[/:id]` · `GET /opd/follow-ups?view=week|overdue|today|all` | Prescription templates · open follow-ups |
| `GET/POST /ipd/admissions/:id/vitals` · `GET/POST …/notes` · `GET/POST …/charges` · `POST …/bed-charges` | Vitals chart, nursing notes (append-only), charges, bed-day posting |
| `GET/PUT /ipd/admissions/:id/discharge-summary` · `POST …/discharge-summary/finalize` | Structured discharge summary; sign needs `ipd.discharge_summary` |
| `GET/POST/PUT/DELETE /ipd/service-charges[/:id]` | IPD service price list |
| `GET/POST /billing/deposits` · `POST /billing/deposits/apply` · `POST /billing/deposits/refund` | Advance deposit ledger |
| `POST /billing/bills/:id/payment-link` · `GET …/payment-links` · `POST …/payment-links/:linkId/revoke` · `GET /public/pay/:token` | UPI payment links (public page: rate-limited, token hashed) |
| `GET /billing/cash/current` · `POST /billing/cash/close` · `GET /billing/cash/closings[/:id]` | Cash closing |

[← Back to the documentation index](README.md)
