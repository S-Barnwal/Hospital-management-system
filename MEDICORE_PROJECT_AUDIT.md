# MediCore HMS — Project Audit

*Audit date: 31 Oct 2026 · Code at commit `20648e2` (branch `feature/saas-foundation`) · Analysis only, no source code was changed.*

> **Stack correction.** MediCore is **not a MERN app**. It is **React 19 + Vite + Tailwind (frontend)**, **Node.js + Express (backend)** and **Microsoft SQL Server** (schema `hms`, versioned `.sql` migrations). There are no MongoDB collections or Mongoose models: every "schema change" in this plan is a new numbered SQL migration (`database/migrations/015_…sql`), applied with `npm run db:migrate`.

## 1. Architecture at a glance

| Layer | What exists | Notes |
|---|---|---|
| Frontend | `frontend/src` — React Router, `pages/public` (website, booking, report/pay/TV pages), `pages/app` (hospital, 25 screens), `pages/admin` (Super Admin), shared `components/ui.jsx` design system, `lib/api.js` (fetch + auto token refresh) | Tailwind tokens (forest/gold), responsive, toasts, accessible forms |
| Backend | `backend/src` — Express app, 40+ route modules under `modules/<area>/`, pure rules in `*.logic.js` (unit-tested), services, scheduler (`jobs/scheduler.js`, 11 jobs) | zod validation on every write (`.strict()`), CSRF guard, helmet, rate limits |
| Database | SQL Server, 14 migrations (`001`–`014`), 89 tables + 1 view (`MoneyReceived`) | Every hospital table has `TenantId`, `(TenantId, Id)` unique keys and composite foreign keys |
| Multi-tenancy | Tenant comes only from the signed-in session (`req.ctx.tenantId`); subdomain may narrow, never change it | Automatic guard test fails the build if any SQL touches a hospital table without `TenantId` |
| Auth | JWT access + rotating refresh cookies, separate hospital vs Super Admin tokens, lockout, 2-step e-mail OTP, password reset, sign-in history | |
| RBAC | 46 permissions, 9 built-in roles per hospital, custom role editor with escalation rules | `backend/src/modules/rbac` |
| Messaging | E-mail (SMTP) + WhatsApp Cloud API, per-hospital sender identity, masked Message log, send-once dedupe keys | **No SMS provider yet** |
| Payments | Razorpay adapter + sandbox (dev only), idempotent webhooks, GST invoices | |
| Tests | 114 unit tests (pass on your laptop), 4 integration suites over real HTTP + SQL Server (written; running on your dev DB is in progress), Playwright UI walkthroughs with a mocked API | |

### Folder map (key paths)
```
backend/src/app.js                     routers, security middleware
backend/src/middleware/                auth, tenantAccess (pure), csrf, validate, errorHandler
backend/src/modules/lab/               lab.routes.js (763 lines), labExtras.routes.js, report.service.js, reportShare.routes.js, lab.shared.js
backend/src/modules/clinical/          logic.js, phase2/3/4.logic.js  (lab flags, panels, trends, payroll, queue… — pure functions)
backend/src/notify/                    deliver(), templates, providers (log | smtp | WhatsApp)
database/migrations/                   001_platform … 014_phase4_frontdesk_platform
frontend/src/pages/app/Lab.jsx         orders, order detail, result entry, printed report
frontend/src/pages/app/LabPages.jsx    tests, packages, price history, samples, results worklists, referral doctors
frontend/src/pages/app/LabExtras.jsx   panel parameters, home collections, lab trends chart
frontend/src/pages/public/ReportView.jsx   patient report link (OTP)
```

## 2. Module inventory

Legend — **Working**: backend API + database + screen connected, unit and/or integration tests written. **Partial**: works but has a known functional gap. **UI-only**: none found. "Verified" below means *tested in this project's automated tests*; a full run of the integration suites on your SQL Server is still pending (migration ledger was just repaired).

| Module | Backend API | DB tables | Screen(s) | Status | Connected to | Improvements needed (lab focus) |
|---|---|---|---|---|---|---|
| Auth & sessions | `/auth/*` | Users, UserSessions, LoginChallenges, LoginEvents | Login, 2-step, reset | Working | RBAC, tenancy, sign-in history | Optional IP/browser allow-list (Labsmart "browser security") |
| RBAC | `/users/*` | Roles, RolePermissions, Permissions, UserRoles | Users & roles, role matrix | Working | every route | Split `lab.verify` into *technician review* and *pathologist approve*; add `lab.amend`, `lab.discount` |
| Dashboard | `/dashboard` | aggregates | Dashboard | Working | patients, appts, billing, lab, IPD | Lab worklist widgets (pending by stage, TAT breach, critical values) |
| Patients | `/patients/*` | Patients (+ABHA, photo), Attachments | Register/edit, detail, card, documents | Working | appts, OPD, IPD, lab, billing, booking | Patient lab-report history list with re-print/re-send; age in years/months/days for paediatric ranges |
| Duplicate detection | `/patients/check-duplicates` | — | live warning while typing | Working | — | — |
| Doctors & staff | `/hr/staff*` | StaffMembers, Departments, DoctorSchedules | Doctors & staff | Working | appointments, queue, HR | Signatory profile (qualification, reg. no., signature image) for pathologists |
| Appointments / calendar / online booking / token queue | `/appointments`, `/booking`, `/queue` | Appointments, OnlineBookingRequests, QueueTokens, DisplayScreens | Appointments (list/calendar/online), Token queue, TV, public booking | Working | patients, doctors | Lab collection counter queue already supported (`lab` queue) |
| OPD | `/opd/*` | Consultations, Prescriptions, templates, follow-ups | OPD | Working | lab orders from consultation, billing | — |
| IPD | `/ipd/*` | Admissions, Beds, Vitals, NursingNotes, ServiceCharges, DischargeSummaries | Admissions | Working | billing, lab (labs inserted into discharge summary) | — |
| Billing | `/billing/*` | Bills, BillItems, Payments(bill), Deposits, PaymentLinks, CashClosings | Billing, bill detail, payments, deposits, cash closing | Working | lab, pharmacy, IPD, OPD | Thermal 3-inch / A5 bill layouts; bill QR for **patient** (current QR is staff-only); Insurance/TPA payment mode; report-release-on-full-payment rule |
| **Lab — test master** | `/lab/tests`, `/lab/departments`, `/lab/tests/:id/parameters` | LabTests (code, name, department *text*, sample type, unit, one range, price), LabTestParameters (panel lines, one range each), LabPriceHistory | Tests, ☰ Parameters, price history | **Partial** | orders, packages | Department **master**; age/gender ranges; critical limits; method/instrument/interpretation; formulas; parameter input types (numeric / text / dropdown); default seed library |
| **Lab — packages** | `/lab/packages` | LabPackages, LabPackageTests | Packages (proportional price split, savings) | Working | orders, billing | — |
| **Lab — orders / booking** | `/lab/orders` | LabOrders (status, priority, referral, amounts, bill link), LabOrderItems (snapshot of name/unit/range/price) | New order modal, order list (Net/Paid/Balance/payment status) | Working | patient, bill (own invoice or OPD bill), payment at order time, referral doctor, home collection | Per-**test** status (today status is per order); add/remove test after creation; outsourced tests |
| **Lab — samples** | `/lab/samples`, `/samples/:id/collect|receive|reject` | LabSamples (one per sample type per order, numbered) | Samples worklist, Code 128 barcode labels | Working | order status follows samples | Container/tube colour; scan-to-receive; rejection reasons list; re-collection link |
| **Lab — results** | `PUT /lab/orders/:id/results` | LabOrderItems.ResultValue/Flag, LabResultValues (panel lines snapshot + flag) | Results & reports → awaiting results | **Partial** | flags, trends, discharge summary | Formulas; critical flag; age/gender range selection; keyboard grid entry; per-test comments; delta check vs previous result |
| **Lab — verification** | `POST /lab/orders/:id/verify` (`lab.verify`) | LabOrders.VerifiedAt/By | Awaiting verification | **Partial** | locks results | Two-level sign-off (technician review → pathologist approval), per-test approval, signatures, amendment with version history after approval |
| **Lab — report output** | `report.service.js`, print page, `/public/reports/:token` | ReportShares | Printed report (browser print → PDF), patient link with OTP | **Partial** | share via WhatsApp/e-mail | Server-generated PDF; letterhead image + margins; with/without letterhead; signature images; QR on report; method & interpretation blocks; previous-result column |
| **Lab — delivery** | `/lab/orders/:id/share`, notify | ReportShares, MessageLog | Share dialog (e-mail / WhatsApp link + OTP), message log | **Partial** | messaging | Automatic send on approval; SMS channel; per-order delivery timeline & resend; doctor copy |
| Lab — referral doctors | `/lab/referrals` | ReferralDoctors (commission %) | Referral doctors, analytics business | Working | orders, analytics | Doctor portal (read-only case list), commission statement & payout record |
| Lab — home collection | `/lab/home-collections` | LabHomeCollections | Home collections | Working | order, samples, collector (staff) | Phlebotomist mobile view (my visits today), cash collected at home |
| Lab — trends | `/lab/patients/:id/trends` | — | Patient page chart | Working | results | Show previous value on the printed report |
| Pharmacy & inventory | `/pharmacy/*` | Medicines, StockBatches, StockMovements, Suppliers, PurchaseOrders | Pharmacy (stock, dispense, PO, alerts) | Working | billing | Reuse for **lab reagents/consumables** (item type + per-test consumption) |
| Expenses & accounting | `/expenses/*`, `/billing/payments`, analytics | Expenses, RecurringExpenses, ExpenseCategories, MoneyReceived view | Expenses, recurring, payments register, analytics (profit), cash closing | Working | payroll, bills | Category budgets (Labsmart Premium); one-screen "daily business" for labs |
| Reports & analytics | `/reports`, `/analytics` | — | 13 reports with CSV, analytics (lab KPIs, TAT, referral business) | Working | all | Test-count analysis, case-type (lab / radiology) business |
| HR / payroll | `/hr/*` | StaffAttendance, LeaveRequests, PayrollRuns | Attendance & payroll | Working | expenses | — |
| Attachments | `/attachments` | Attachments (DB-stored, magic-byte check) | Files on expense/bill/PO/patient | Working | — | Add `lab_order` entity (outsourced report PDFs, consent) |
| Audit | everywhere | AuditLogs | Audit log | Working | — | Clinical result **before/after** values on amendment |
| Messaging settings | `/settings/messaging` | TenantMessagingConfig (encrypted) | Settings | Working | notify | SMS provider (DLT templates for India) |
| Backups / export | `/backups` | TenantBackups | Backups (JSON) | Working | — | CSV export per entity (patients, results) |
| SaaS: plans, subscriptions, invoices, coupons, trials, support, MRR, monitoring, groups | `/admin/*`, `/onboarding`, `/subscription`, `/support` | Plans, Subscriptions, Payments, Invoices, Coupons, SupportTickets, TenantGroups, JobRuns… | Super Admin portal, pricing, register | Working | — | Usage-based limits (bills per year like Labsmart) if you want that pricing model |

## 3. Laboratory workflow today (end to end)

```
Register patient (duplicate warning, number BAB-000123) ─┐
                                                         ▼
New lab order: tests + packages, referral doctor, priority, discount, home collection,
               own invoice or attach to OPD bill, pay now (cash/UPI/card/bank)
                                                         ▼
Samples auto-created (one per sample type) → print Code-128 labels → Collect → Receive / Reject → Re-collect
                                                         ▼
Result entry (single value or panel lines) → automatic low/high flag → order "completed"
                                                         ▼
Verify (user with lab.verify) → results locked → printed report (browser PDF) / patient link + OTP via WhatsApp or e-mail
                                                         ▼
Trends on patient page · referral business & TAT in analytics · lab results inserted into discharge summary
```

What already matches your target workflow: one registration for many orders, many tests and packages per order, multiple samples per order, per-test result rows/parameters, report locked until verified, invoice-linked payment status, delivery logged in the Message log.

What does **not** match yet: status per test, two-level approval with signatures, age/gender ranges, critical values, formulas, server PDF with letterhead/QR, automatic delivery on approval, SMS, delivery timeline per order.

## 4. Quality notes

- **Security/tenancy:** strong (session-derived tenant, composite FKs, tenancy guard test, OTP report links storing only hashes, no patient data in Super Admin).
- **Clinical safety:** reference ranges and flags are configurable (not hard-coded), but the model has only *one* range per test/parameter — adequate for adults, not for paediatrics/pregnancy/gender-specific tests.
- **Known operational issue fixed today:** the migration ledger on your dev database was empty; `migrate.js` now adopts an existing schema safely. Run `npm run db:migrate` then `npm run test:e2e` to complete verification.
- **Not verifiable from code alone:** real WhatsApp/e-mail delivery on your server (depends on your keys), Razorpay live mode.
