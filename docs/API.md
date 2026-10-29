# API (v1)

Base: `/api/v1`. JSON in/out. Errors: `{ "error": { "code", "message", "details?" } }`. Lists: `?page=&pageSize=(≤100)&sort=&order=asc|desc` → `{ data, meta: { page, pageSize, total, totalPages } }`.
State-changing requests need header `X-Requested-With` (CSRF guard). Auth is via HttpOnly cookies.

| Method & path | Auth / permission | Notes |
|---|---|---|
| GET `/plans` | public | prices incl. GST quote |
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
| GET/PUT/POST `/admin/plans` | platform (write: super_admin) | |
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
