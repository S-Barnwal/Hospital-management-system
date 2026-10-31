# API (v1)

Base: `/api/v1`. JSON in/out. Errors: `{ "error": { "code", "message", "details?" } }`. Lists: `?page=&pageSize=(≤100)&sort=&order=asc|desc` → `{ data, meta: { page, pageSize, total, totalPages } }`.
State-changing requests need header `X-Requested-With` (CSRF guard). Auth is via HttpOnly cookies.

| Method & path | Auth / permission | Notes |
|---|---|---|
| GET `/plans` | public | prices incl. GST quote; `isFree` true while the plan is free for now |
| GET `/site-settings` | public | contact details |
| POST `/demo-requests` | public, rate-limited, honeypot | `{orgName, contactName, email, phone, city?, facilityType?, expectedUsers?, preferredAt?, message?}` |
| POST `/contact` | public, rate-limited | `{name, email, phone?, subject?, message}` |
| GET `/onboarding/slug-availability?slug=` | public | |
| POST `/onboarding/checkout` | public, rate-limited | `{planCode, interval, orgName, slug, facilityType?, city?, phone, ownerName, ownerEmail, password, acceptTerms:true}` → `{onboardingId, amount, payment}` |
| POST `/onboarding/verify` | public (signature) | `{onboardingId, orderId, paymentId, signature}` → provisions + signs owner in |
| POST `/onboarding/sandbox/pay` | dev only | simulated gateway |
| GET `/onboarding/:id/status` | public (UUID) | |
| POST `/billing/webhooks/razorpay` | HMAC signature | idempotent per event & order |
| POST `/auth/login` | public | `{email, password, workspace?}` (workspace from subdomain if present) |
| POST `/auth/refresh` · `/auth/logout` · `/auth/logout-all` | cookie | refresh rotates; reuse revokes all sessions |
| POST `/auth/forgot-password` · `/auth/reset-password` | public | 30-min single-use token |
| POST `/auth/admin/login` · `/admin/refresh` · `/admin/logout`; GET `/auth/admin/me` | platform | |
| GET `/tenant/me` | tenant user | user, tenant, permissions, subscription state |
| GET/PUT `/settings` | settings.read / settings.manage | |
| GET `/subscription` | subscription.read | plan, state, invoices, renewal options |
| POST `/subscription/renew` · `/subscription/verify` | subscription.manage | |
| GET `/notifications`, POST `/notifications/read-all` | tenant user | |
| GET `/audit-logs` | audit.read | tenant's latest 200 |
| GET `/dashboard/summary` | dashboard.view | per-widget permission filtering |
| GET `/patients?q=&archived=` · POST `/patients` | patients.read / patients.write | |
| POST `/patients/check-duplicates` | patients.write | |
| GET/PATCH `/patients/:id` · POST `/patients/:id/archive` | read / write / archive | 404 for other tenants' ids |
| GET `/appointments?date=&doctorId=&departmentId=&patientId=&status=` | appointments.read | `date` is hospital-local |
| GET `/appointments/availability?doctorId=&date=` | appointments.read | free slots |
| POST `/appointments` | appointments.write | `{patientId, doctorId, date, time, durationMinutes?, visitType?, reason?}`; 409 on overlap |
| POST `/appointments/:id/reschedule` · `/appointments/:id/status` | appointments.write | validated transitions |
| GET/POST `/hr/departments`, PATCH `/hr/departments/:id` | staff.read / departments.manage | |
| GET/POST `/hr/staff`, GET/PATCH `/hr/staff/:id`, PUT `/hr/staff/:id/schedule` | staff.read / staff.write | `type=doctor|non_doctor|…` |
| GET `/users`, POST `/users`, PATCH `/users/:id` | users.read / users.manage | plan user limit; no self-escalation |
| GET `/users/roles`, GET `/users/permissions`, PUT `/users/roles/:id/permissions` | users.read / roles.manage | |
| GET `/admin/overview`, `/admin/tenants`, `/admin/tenants/:id`, POST `/admin/tenants/:id/status` | platform (status: super_admin) | |
| GET/PUT/POST `/admin/plans` | platform (write: super_admin) | GET adds `isFree`, `freeSince`, `freeHospitals` |
| POST `/admin/plans/free-mode` `{ free, planId?, noticeDays? }` | super_admin | "Free for now" switch. No `planId` = all priced plans. `free:false` gives free hospitals `noticeDays` (default 7, max 90) then normal renewal. Audited |
| GET `/admin/subscriptions`, `/admin/payments`, `/admin/contact-messages`, `/admin/audit-logs` | platform | |
| GET/PATCH `/admin/demo-requests[/:id]` | platform | status, assignee, notes |
| GET/PUT `/admin/settings` | platform (write: super_admin) | |
| GET `/api/health` | public | DB check |

Example:
```http
POST /api/v1/appointments
X-Requested-With: fetch
{"patientId":12,"doctorId":3,"date":"2026-11-02","time":"10:15","durationMinutes":15}
→ 201 {"data":{"id":88,"number":"APT-000088"}}
→ 409 {"error":{"code":"SLOT_TAKEN","message":"The doctor already has appointment APT-000087 at that time."}}
```

## Clinical & finance modules (plan-gated)
All require a hospital session, the module in the plan (`FEATURE_NOT_IN_PLAN` otherwise) and the listed permission.

| Method & path | Permission |
|---|---|
| GET/POST `/opd/consultations`, GET/PUT/DELETE `/opd/consultations/:id`, POST `/opd/consultations/:id/finalize` | opd.read / opd.write |
| GET/POST/PATCH/DELETE `/ipd/wards[/:id]`, POST `/ipd/wards/:id/beds`, PATCH/DELETE `/ipd/beds/:id` | ipd.read / ipd.configure |
| GET/POST `/ipd/admissions`, GET `/ipd/admissions/:id`, POST `/ipd/admissions/:id/transfer`, `/discharge` | ipd.read / ipd.write |
| GET/POST `/billing/bills`, GET/PATCH `/billing/bills/:id`, POST/DELETE `/billing/bills/:id/items[/:itemId]`, POST `/finalize`, `/payments`, `/cancel` | billing.read / billing.write |
| POST `/billing/bills/:id/refunds` | billing.refund |
| GET/POST/PUT/DELETE `/lab/tests[/:id]` | lab.read / lab.configure |
| GET/POST `/lab/orders`, GET `/lab/orders/:id`, POST `/status`, PUT `/results` | lab.read / lab.write |
| POST `/lab/orders/:id/verify` | lab.verify |
| GET/POST/PUT/DELETE `/pharmacy/medicines[/:id]`, `/pharmacy/suppliers[/:id]`, POST `/pharmacy/stock/adjust` | pharmacy.read / pharmacy.configure |
| POST `/pharmacy/stock/receive`, `/pharmacy/dispense`; GET `/pharmacy/alerts` | pharmacy.write / pharmacy.read |
| GET `/reports/summary`, GET `/reports/:key` (`.csv` for export) | reports.read / reports.export |
| DELETE `/hr/staff/:id`, `/hr/departments/:id`, `/users/:id`, `/admin/plans/:id`, `/admin/demo-requests/:id` | staff.write / departments.manage / users.manage / super_admin |

Deletion rules: master data (departments, beds, wards, tests, medicines, suppliers, unused staff/plans) can be deleted only when unused, otherwise `409 IN_USE` with advice to deactivate. Patients are archived, appointments/lab orders/bills are cancelled, finalised consultations and invoices are permanent.

## Laboratory extensions, payments register, expenses, analytics, backups (migration 005)

| Endpoint | Permission (feature) |
|---|---|
| GET `/lab/departments?all` (objects `{ id, name, sortOrder, isActive, testCount }`); GET `/lab/tests?q&department&departmentId&all`; GET `/lab/packages?q&all`; GET `/lab/packages/:id`; GET `/lab/referrals` | lab.read (laboratory) |
| POST/PUT/DELETE `/lab/tests[/:id]`, `/lab/packages[/:id]`, `/lab/referrals[/:id]` | lab.configure |
| GET `/lab/tests/:id/prices`, `/lab/packages/:id/prices` · POST same `{ price, reason }` | lab.read · lab.configure |
| POST `/lab/orders` `{ patientId, testIds[], packageIds[], referralDoctorId?, discount, addToBill, payment?{amount,method} }` → own finalised invoice + optional receipt (OPD-linked orders go on the patient's draft bill) | lab.write (+ billing.write for billing) |
| GET `/lab/orders?status=a,b&paymentStatus&q&referralDoctorId` → rows include `net, paid, balance, paymentStatus` | lab.read |
| GET `/lab/samples?status&q`; POST `/lab/samples/:id/collect|receive|reject` `{ reason? }` (order status follows its samples) | lab.read / lab.write |
| GET `/billing/payments?from&to&method&kind&q` (meta: payments, refunds, net) | billing.read (billing) |
| GET/POST `/expenses`, PUT/DELETE `/expenses/:id`; GET/POST `/expenses/categories`, PUT/DELETE `/expenses/categories/:id` | expenses.read / expenses.write (billing) |
| GET `/analytics?from&to` | reports.read (reports) |
| GET `/backups` (history), GET `/backups/export` (JSON download of this tenant's rows; secrets excluded; 3/min) | backups.manage (all plans; allowed while expired) |

## Messaging, 2-step sign-in, patient report links, GST (migration 006)

| Endpoint | Notes |
|---|---|
| POST `/auth/login` | Returns `{ mfaRequired: true, challengeId, sentTo, expiresInMinutes }` (no cookies) when Settings → 2-step sign-in is on and the user is owner/hospital_admin |
| POST `/auth/login/verify` `{ challengeId, code }` | 6-digit code; 10 min; 5 attempts; sets cookies |
| POST `/auth/admin/login/verify` | Same for Super Admin when `SUPERADMIN_MFA=true` |
| POST `/lab/orders/:id/share` `{ channel: whatsapp|email }` | lab.write; verified orders only; 7-day link |
| GET `/lab/orders/:id/shares`; POST `/lab/orders/:id/shares/:shareId/revoke` | lab.read / lab.write |
| GET `/public/reports/:token` · POST `/:token/otp` · POST `/:token/view { code }` | Public, rate-limited; report JSON only after OTP |
| GET `/message-log?channel=` | audit.read; masked recipients; `meta` = which providers are live |
| PUT `/settings` new keys | `gst.gstin`, `gst.sac_default`, `security.mfa_admins`, `notify.whatsapp`, `notify.daily_summary` (on/off) |
| POST `/billing/bills/:id/items` `hsnSac` · PATCH `/billing/bills/:id` `{ isInterState, buyerGstin }` | GET bill returns `gst { hospitalGstin, buyerGstin, isInterState, cgst, sgst, igst }` |
| POST `/patients/check-duplicates` | Phone matched on last 10 digits (any formatting) |

## Hospital messaging settings (migration 007)

| Endpoint | Notes |
|---|---|
| GET `/settings/messaging` | settings.read. Preview of From/Reply-To, own-account fields **without secrets** (`hasPassword`, `hasToken`) |
| PUT `/settings/messaging` `{ replyTo?, email?{enabled,host,port,secure,user,password?,fromEmail}, whatsapp?{enabled,phoneNumberId,token?} }` | settings.manage. `email`/`whatsapp` need plan feature `own_messaging` and server `MESSAGING_ENCRYPTION_KEY`; host must resolve to a public IP; ports 25/465/587/2525 |
| POST `/settings/messaging/test` `{ channel, to }` | settings.manage; 5 per 10 min; WhatsApp uses Meta's `hello_world` template |

## Free-for-now plans (migration 008)

- `POST /onboarding/checkout` on a free plan → `201 {"data":{"free":true,"provisioned":true,"slug":"…","plan":{…}}}`; the workspace is provisioned in the same request (same `provisionTenant()` as a paid sign-up, subscription `IsFree=1`, no payment/invoice) and the owner gets session cookies. `409 FREE_LIMIT` if the owner e-mail already has a free workspace; `409 SLUG_TAKEN` on a name race.
- `POST /subscription/renew` on a free plan → `200 {"data":{"free":true,"periodEnd":"…"}}` (no payment). Refused if a free period more than a month ahead is already running.
- A subscription with `IsFree=1` on a plan that is still free never lapses (`subscriptionState` → active); the scheduler also rolls such periods forward and skips their reminder e-mails.

## Contact rules, geo lists, invoices, hospital location (migrations 009–011)

- Every phone field (patients, emergency contact, staff, users, referral doctors, suppliers, hospital settings, sign-up, demo/contact forms, platform contact) is validated with libphonenumber-js for its country and stored as **E.164** (`+919876543210`). Numbers without `+` are read as Indian. Invalid → `400` with `details[].message = "Enter a valid phone number for the selected country…"`.
- E-mails: trimmed, lower-cased, stricter than RFC-lite (single `@`, no spaces, valid labels, alphabetic TLD).
- `country` (ISO-2) / `state` / `city`: state must belong to the country (canonical name stored). Sign-up requires all three (state only if the country has states). City is free text ≤100 (villages).
- `GET /geo/countries` → `[{code,name,flag}]`; `GET /geo/states?country=IN` → `[{code,name}]`; `GET /geo/cities?country=IN&state=MH` → `["Mumbai", …]`. Public, no DB, `Cache-Control: public, max-age=86400`.
- Invoices — see `documentation/07-super-admin-guide.md`. `PUT /admin/invoices/:id` requires `reason`; on issued invoices only `billTo`, `notes`, `dueDate`, `paymentMethod`, `paymentRef` are accepted (`409 INVOICE_LOCKED` otherwise). `DELETE` only for drafts (`409 NOT_DRAFT`). `POST /:id/void {reason}`.
- `PUT /settings/location {latitude, longitude, postalCode}` (settings.manage). Both coordinates or neither; PIN code checked for IN/US/GB.

## Phase 2 (migration 012)

All routes are tenant-scoped (TenantId from the session; composite foreign keys). Highlights:
- `POST /ipd/admissions/:id/vitals` → `201 { id, flags }` (`flags` e.g. `{ spo2: 'critical_low' }`); `400` if no reading, BP diastolic ≥ systolic, or time outside the last 7 days. `409 ADMISSION_CLOSED` after discharge.
- `POST /ipd/admissions/:id/notes { category: note|medication|intake_output|procedure|handover, note, medicineName?, dose?, route?, intakeMl?, outputMl?, correctsNoteId? }` — append-only.
- `POST /ipd/admissions/:id/bed-charges` → `{ daysAdded }`; idempotent (unique index on bed day).
- `PUT /ipd/admissions/:id/discharge-summary` (draft) · `POST …/finalize` (needs `ipd.discharge_summary`; requires final diagnosis + condition) → `409 RECORD_LOCKED` afterwards. `POST /ipd/admissions/:id/discharge { dischargeSummary?, chargeBedDays? }` — text optional when a signed summary exists.
- `POST /billing/deposits { patientId, amount, method, reference?, admissionId? }` → `{ receiptNumber: 'ADV-…', balance }` · `POST /billing/deposits/apply { billId, amount? }` (bill must be finalised) · `POST /billing/deposits/refund { patientId, amount, method, reason }` (`billing.refund`).
- `POST /billing/bills/:id/payment-link { channel: none|whatsapp|email }` → `{ url, expiresAt }`; `400` until Settings → *payment.upi_id* is set. Public `GET /public/pay/:token` → hospital, bill number, amounts, `upiUri` (no items, no diagnosis).
- `GET /billing/cash/current` (`cash.close`) → collections since the user's last closing · `POST /billing/cash/close { openingFloat, countedCash | denominations, notes? }` — note required when counted ≠ expected · `GET /billing/cash/closings` (own, or everyone's with `cash.read`).

## Phase 3 (migration 013)

Tenant-scoped like everything else; nested routers refuse requests without a hospital session.
- **Lab panels** — `GET|PUT /lab/tests/:id/parameters` (`lab.configure` to write; `{ parameters: [{ name, unit?, refLow?, refHigh?, refText?, sortOrder? }] }`). Orders snapshot parameters per item. `PUT /lab/orders/:id/items/:itemId/results` accepts `parameters: [{ id, value }]` → per-line flags, item flag = worst line.
- **Trends** — `GET /lab/patients/:id/trends` → numeric series per test/parameter (verified results only).
- **Home collection** — `POST /lab/orders` accepts `homeCollection { address, landmark?, contactPhone?, scheduledAt, charge?, notes? }` (charge added to the order). `GET /lab/home-collections?date&status&open` · `POST /lab/home-collections/:id/status { status: assigned|on_the_way|collected|scheduled|cancelled, collectorStaffId?, scheduledAt?, reason? }` (allowed moves only → `409 INVALID_TRANSITION`; `assigned` needs a collector; `collected` marks samples collected).
- **Barcode** — `barcode` on medicines (unique per hospital; EAN-13/UPC checksum validated when numeric) · `GET /pharmacy/medicines/by-barcode/:code`.
- **Purchase orders** — `GET /pharmacy/purchase-orders`, `GET …/suggestions` (below reorder level), `GET …/:id`, `POST` (draft), `PUT …/:id` (draft only), `POST …/:id/place`, `POST …/:id/receive { lines: [{ itemId, quantity, batchNumber, expiryDate, salePrice? }] }` (stock in via the normal ledger), `POST …/:id/cancel { reason }`.
- **Expired stock** — `POST /pharmacy/stock/expire-batch { batchId }` (`pharmacy.configure`; only past-expiry batches).
- **HR** — `GET|PUT /hr/attendance` (`{ date, entries: [{ staffId, status, checkIn?, checkOut? }] }`, no future dates) · `GET /hr/attendance/summary?month` · `GET|POST /hr/leaves`, `POST /hr/leaves/:id/decide { status: approved|rejected, note? }`, `POST /hr/leaves/:id/cancel` · `PUT /hr/staff/:id/salary` · `GET /hr/payroll?month`, `POST /hr/payroll/generate { month }`, `PUT /hr/payroll/:id { allowances, deductions, notes? }`, `POST /hr/payroll/:id/pay { method }` (creates a *Salaries* expense; `409 PAYROLL_STATE` once paid), `GET /hr/payroll/:id` (payslip).
- **Recurring expenses** — `GET|POST /expenses/recurring`, `PUT|DELETE /expenses/recurring/:id`, `POST /expenses/recurring/post-due`. Nightly job posts due dates; unique index (RecurringExpenseId, ExpenseDate) makes it idempotent.
- **Attachments** — `POST /attachments?entityType=expense|bill|patient|purchase_order&entityId=&fileName=&category=` with the raw file as body (≤ 5 MB; type from magic bytes: JPEG/PNG/WebP/PDF) · `GET /attachments?entityType&entityId` · `GET /attachments/:id/file[?download=1]` (nosniff; images get `CSP: sandbox`) · `DELETE /attachments/:id` (soft delete). Permission = the parent record's read/write permission and plan feature.
- **Reports** — new keys: `pharmacy_sales`, `expiry`, `purchases`, `home_collections`, `expenses_by_category`, `attendance`.

## Phase 4 (migration 014)

**Front desk**
- `GET /queue/board` (`queue.manage` or `appointments.read`) → today's queues with current/next/waiting/done, estimated wait, tokens (staff view). `POST /queue/tokens { queueKey?: 'doctor:<id>'|'reception'|'lab'|'pharmacy'|'billing', patientId?, appointmentId?, priority? }` → `{ id, number }` (201; 200 with the existing token for an appointment). `POST /queue/call-next { queueKey, counter? }` → called token or `data: null`. `POST /queue/tokens/:id/status { status: called(recall)|done|skipped|waiting|cancelled }` → `409 INVALID_TRANSITION` for final tokens. Checking an appointment in (`POST /appointments/:id/status`) returns `token`.
- `GET|POST /queue/screens`, `DELETE /queue/screens/:id` (create/remove also need `settings.manage`; the URL is returned once). Public `GET /public/display/:token` (120/min/IP) → hospital, queues (numbers, labels, rooms, counts), recent calls — no patient fields.
- `GET /appointments/calendar?from&to&doctorId&cancelled` (≤ 42 days).
- Public booking (only with `booking.enabled = on`): `GET /public/booking/:slug`, `GET /public/booking/:slug/slots?doctorId&date` (today … +30 days, from the weekly schedule minus appointments and pending requests, 30-minute lead time), `POST /public/booking/:slug { doctorId, date, time, name, phone, email?, gender?, age?, reason?, consent: true }` → `{ ref }` (5/hour/IP; max 3 pending per phone; `409 SLOT_TAKEN`). Staff: `GET /booking/requests?status`, `GET /booking/requests/:id/matches`, `POST /booking/requests/:id/confirm { patientId? }` (no id = register new patient), `POST /booking/requests/:id/reject { note }`.
- Patients: `abhaNumber` (14 digits, dashes allowed), `abhaAddress` (`name@abdm`) on create/PATCH (`409 ABHA_TAKEN`); `PUT /patients/:id/photo { attachmentId|null }` (an image attachment of that patient). Staff: `room`.

**Account**
- `GET /users/login-history?userId&result=ok|failed` (`users.read`) — this hospital only, 180 days, device name instead of raw user-agent.
- Support (`support.use`; works when lapsed/suspended): `GET|POST /support/tickets`, `GET /support/tickets/:id`, `POST /support/tickets/:id/messages { body }`, `POST /support/tickets/:id/close`.
- `GET /branches` (`branches.view`) → group, branches, per-branch figures where the same e-mail has an active account with `dashboard.view`, totals.
- Coupons & trials: `POST /onboarding/coupon-preview { planCode, interval, couponCode }`, `POST /onboarding/checkout { …, couponCode? | trial: true }` (trial → `{ trial: true, trialEndsAt }`, `409 TRIAL_USED`), `POST /subscription/coupon-preview`, `POST /subscription/renew { …, couponCode? }`. Public plans carry `trialDays`.

**Super Admin** (`/admin/*`, platform session; writes need `super_admin`)
- `GET|POST /admin/coupons`, `PUT|DELETE /admin/coupons/:id` (used coupons: no rename/delete).
- `GET /admin/revenue` (MRR, ARR, ARPA, by plan, 12 months), `GET /admin/monitoring`, `GET /admin/login-history?q&type&result&tenantId&page`.
- `GET /admin/support/tickets?status=waiting|…&q&page`, `GET /admin/support/tickets/:id`, `POST /admin/support/tickets/:id/messages { body, internal?, resolve? }`, `PATCH /admin/support/tickets/:id { status?, priority?, assignedToId? }`, `GET /admin/team`.
- `GET|POST /admin/groups`, `PUT|DELETE /admin/groups/:id`, `PUT /admin/tenants/:id/group { groupId|null, branchName? }` (`409 BRANCH_LIMIT`). Plans accept `trialDays` (0–90); settings accept `support.email`.

## Lab upgrade — chunk 2: master data (migration 015)

- **Departments** — `GET /lab/departments?all=true` (`lab.read`) → `[{ id, name, sortOrder, isActive, testCount }]` in report order. `POST /lab/departments { name, sortOrder?, isActive? }`, `PUT /lab/departments/:id` (same body; renaming also updates the department text on this hospital's tests), `DELETE /lab/departments/:id` (`409 IN_USE` while any test uses it — switch it off instead). Duplicate name → `409 DUPLICATE`. All `lab.configure`, audit-logged.
- **Test fields** — `POST|PUT /lab/tests[/:id]` also take `departmentId` (must be one of this hospital's active departments; `department` text is still accepted and matched by name), `method`, `instrument`, `interpretation` (≤ 2000), `inputType: numeric|text|option`, `options: string[]` (required for `option`, ≤ 30, no `|`, no duplicates), `decimals` (0–6), `tatHours` (1–2160), `sortOrder` (0–9999). `GET /lab/tests` returns them (`options` as an array).
- **Parameters** — `PUT /lab/tests/:id/parameters` rows also take `inputType`, `options`, `decimals`, `isHeading` (heading rows print a sub-heading and take no result; their unit/range are cleared).
- **CSV import** — `POST /lab/tests/import { rows: [{ code, name, department?, sampletype?, unit?, reflow?, refhigh?, reftext?, price?, inputtype?, options? (| or ;), decimals?, method?, instrument?, tathours?, interpretation? }], mode: skip|update, dryRun? }` (`lab.configure`, ≤ 500 rows). The browser parses the CSV. Dry run → `{ create, update, skip, newDepartments, errors: [{ line, code, message }] }`, nothing saved. A real import with any bad row → `400` with `details: [{ path: 'line N', message }]` and nothing saved; otherwise one transaction, missing departments created, price changes recorded in price history, one audit entry.
- **Orders & results** — each order line snapshots department name/order, method, instrument, interpretation, input type, options and decimals (parameters likewise), so later catalogue edits never change an order. `GET /lab/orders/:id` and the report return lines in report order with those fields. `PUT /lab/orders/:id/results` checks values against the snapshot: option results must be one of the choices (stored with the configured spelling, never range-flagged), heading rows refuse a value (`400`), only plain numbers are flagged against the range; a panel is complete when every non-heading parameter has a value.

## Lab upgrade — chunk 3: age / gender ranges and critical values (migration 016)

- **Ranges** — `GET /lab/tests/:id/ranges` (`lab.read`) → `{ test, parameters, ranges: [{ id, parameterId|null, gender: any|male|female, ageFrom, ageFromUnit: d|m|y, ageTo|null, ageToUnit, refLow, refHigh, refText, criticalLow, criticalHigh }] }`. `PUT /lab/tests/:id/ranges { ranges: [...] }` (`lab.configure`) replaces them (≤ 200; age band is [from, to); overlapping bands for the same parameter and gender → `400` with `details` per row; a parameter of another test/hospital → `400`). `GET /lab/tests` adds `criticalLow`, `criticalHigh`, `rangeCount`.
- **Default critical limits** — `criticalLow` / `criticalHigh` on `POST|PUT /lab/tests` and on each row of `PUT /lab/tests/:id/parameters` (critical low ≤ normal low, critical high ≥ normal high).
- **Ranges CSV** — `POST /lab/ranges/import { rows: [{ testcode, parameter?, gender?, agefrom?, agefromunit?, ageto?, agetounit?, low?, high?, text?, criticallow?, criticalhigh? }], dryRun? }` (`lab.configure`, ≤ 2000 rows). Replaces all ranges of every test named; codes are looked up in this hospital's catalogue only. Dry run → `{ tests, ranges, errors: [{ line, message }] }`; a real import with errors → `400`, nothing saved.
- **Orders** — when an order is placed, each line / parameter gets the range for the patient's gender and completed age (narrowest band, gender-specific before "any"); otherwise the test's default. Snapshot fields on `GET /lab/orders/:id` items and parameters: `refLow`, `refHigh`, `refText`, `criticalLow`, `criticalHigh`, `rangeLabel`, `criticalAt`, `criticalAckAt`, `criticalAckBy`; order adds `critical: { open, acknowledgedNote }`.
- **Flags** — `normal | low | high | abnormal | crit_low | crit_high` (critical = beyond the critical limit). A new or changed critical value creates a hospital notification (`lab_critical`, no patient name) and an audit entry; a value that is no longer critical clears it.
- **Critical workflow** — `GET /lab/critical` (`lab.read`) → open critical results of this hospital (≤ 100). `POST /lab/orders/:id/critical-ack { note }` (`lab.write`; note = who was informed, 3–300 chars) → `{ acknowledged }`, `409 NO_OPEN_CRITICAL` when nothing is open. `POST /lab/orders/:id/verify` → `409 CRITICAL_UNACKNOWLEDGED` while any critical result is open. The patient report link never includes the acknowledgement fields.
