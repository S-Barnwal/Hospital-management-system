# Feature completion matrix

Legend — **Tested here**: covered by unit tests that were run (36/36 passing). **Written, untested**: code complete but not executed against SQL Server / a browser with the real backend yet (this build environment could not reach your database or install npm packages). Run `npm test`, `npm run test:integration` and the acceptance checklist below to move items to "verified".

| Area | Status | Notes |
|---|---|---|
| SQL schema, migrations, seeds | Written, untested on SQL Server | 3 versioned scripts, migration runner with checksums |
| Config / connection-string parsing | Tested here | |
| Auth: login, refresh rotation, logout, lockout, reset | Written, untested | JWT signing/verification tested here |
| Tenant isolation decision logic | Tested here | session-derived tenant, subdomain mismatch, suspension, expiry |
| Tenant isolation over HTTP + DB composite FKs | Integration tests written | `npm run test:integration` |
| RBAC: 9 roles, 31 permissions, escalation rules | Tested here (rules) | enforcement middleware untested against DB |
| CSRF guard, sort allowlist, audit sanitising | Tested here | |
| Public website (Home, Features, Pricing, Demo, Contact, About, FAQ, Legal) | Rendered here (preview build, no JS errors, no mobile overflow) | real API calls untested |
| Plan purchase → sandbox payment → provisioning | Written, untested end-to-end | signature + idempotency logic tested |
| Razorpay adapter (orders, checkout signature, webhooks) | Tested here with fakes | needs your **test** API keys to verify live |
| Super Admin: tenants, suspend/reactivate, plans, subscriptions, payments, demo requests, messages, audit logs, website settings | Written, untested | |
| Hospital dashboard (live SQL aggregates, 14-day trend, alerts) | Written; UI rendered with mock data | |
| Patients (number sequence, search, duplicates, archive, history) | Written, untested | |
| Appointments (schedules, free slots, overlap prevention, transitions) | Written; rules tested here | |
| Doctors, staff, departments, weekly schedules | Written, untested | |
| Users & roles UI, role permission matrix | Written, untested | |
| Hospital settings, subscription renewal, invoices | Written, untested | |
| OPD: consultations, vitals, diagnosis, prescriptions, versioning, finalise lock, print | Written, untested against DB | draft can be discarded; final is permanent |
| IPD: wards, beds, bed board, admit / transfer / discharge, bed charges | Written; bed-day maths tested | double-booking blocked by filtered unique index |
| Billing: draft → finalise (sequential numbers), items, GST, discount, payments, refunds, cancel, print | Written; maths tested | finalised bills immutable; refunds are separate rows |
| Laboratory: catalogue, orders, sample → results → verification, flags, print | Written; flags & workflow tested | results locked after verification |
| Pharmacy: medicines, suppliers, batches/expiry, FEFO dispensing, adjustments, ledger, alerts | Written; FEFO tested | negative stock blocked by code + CHECK constraint |
| Reports: KPIs, 7 reports, CSV export (formula-injection safe) | Written; CSV escaping tested | |
| Plan gating (Starter has no billing/IPD/lab/pharmacy/reports) | Tested here (middleware) | UI shows "Upgrade" |
| Toast notifications (react-toastify) | Rendered here | hospital app + admin portal |
| Lab: departments, packages (proportional price split), price history with reasons, referral doctors & commission | Written; split maths tested | migration 005 |
| Lab: per-sample-type samples (collect/receive/reject/recollect), order status follows samples | Written; transitions tested | |
| Lab orders: discount, own invoice + payment at order time, Net/Paid/Balance/payment status | Written; status mapping tested | OPD-linked orders use the patient's draft bill |
| Payments register, Expenses (+ categories), Analytics (profit, TAT, referrals), Backups (JSON export + log) | Written; UI verified with mock data | needs run against SQL Server |
| Messaging: e-mail (SMTP) + WhatsApp Cloud API, masked Message log, send-once scheduled jobs | Written; helpers unit-tested | log mode by default |
| 2-step sign-in (e-mail OTP) for owners/admins and Super Admin; password-reset e-mails | Written | |
| Patient report link + OTP, revocable; sample barcode labels (Code 128); patient QR card | Written; UI verified with mock data | |
| GST invoice: HSN/SAC, CGST/SGST/IGST, GSTINs | Written; split unit-tested | |
| Live duplicate-patient warning (phone, any format) | Written | |
| "Free for now" plans: Super Admin switch, site banner, payment-free sign-up via the same provisioning, notice period when charging resumes | Written; state rule unit-tested, integration test added | migration 008 |
| Phone validation for every country (E.164), stricter e-mail checks, searchable country/state/city dropdowns (world data) on every form | Written; rules unit-tested with the real libraries | migration 009 |
| Platform invoices: automatic for paid + free plans, FY numbering, GST (CGST/SGST/IGST), Super Admin create/edit/issue/void/CSV, hospital PDF | Written; maths unit-tested | migration 010 |
| Hospital location pin (settings) + Super Admin hospital map (Leaflet + OpenStreetMap) | Written | migration 011 |
| Phase 2 — OPD: prescription templates (shared / per doctor, apply & save-as), follow-up list + day-before reminders | Written; unit + integration tests; UI walkthrough (mock API) | migration 012 |
| Phase 2 — IPD: admission page with vitals chart (flags, trends), append-only nursing notes (medication, I/O, corrections), service-charge catalogue, automatic daily bed charges, signed structured discharge summary + A4 print | Written; unit + integration tests; UI walkthrough (mock API) | |
| Phase 2 — Money: patient deposits (take / use on bill / refund), UPI payment links (public page), cash closing with denominations and slips; MoneyReceived view so deposits are counted once | Written; unit + integration tests; UI walkthrough (mock API) | |
| Phase 3 — Lab: multi-parameter panels (snapshotted per order), per-line flags, patient trend chart, home sample collection with status flow | Written; logic unit-tested; integration tests | migration 013 |
| Phase 3 — Pharmacy: purchase orders (draft → place → partial/complete receipt → stock), low-stock suggestions, barcode scan in dispense, expired-batch write-off, daily stock-alert e-mail | Written; logic unit-tested; integration tests | |
| Phase 3 — HR: attendance, leave with approval, salary, payroll from attendance, payslip print, salary → expense | Written; payroll maths unit-tested; integration tests; UI walkthrough (mock API, desktop + mobile) | |
| Phase 3 — Recurring expenses (nightly, idempotent), file attachments (receipts, bill photos, supplier invoices, patient documents; magic-byte checked, 5 MB, DB-stored), 6 new reports | Written; unit + integration tests; UI walkthrough | |
| Phase 4 — Front desk: token queue (per doctor/counter, priority, auto token on check-in, printable slip), TV display screens (public secret link, announcements, no patient data), online booking requests + staff confirmation, appointment calendar (day/week/month), doctor rooms | Written; logic unit-tested; integration tests; UI walkthrough (mock API, desktop + phone) | migration 014 |
| Phase 4 — Patients: profile photo, ABHA number/address (validated, unique per hospital; no ABDM gateway calls) | Written; unit + integration tests | |
| Phase 4 — Platform: sign-in history (hospital + admin), monitoring (jobs, errors, DB, sign-ins), coupons, free trials, support tickets (internal notes), MRR/ARR revenue, hospital groups (multi-branch, figures only where the user has an account) | Written; unit + integration tests; UI walkthrough | |
| Stripe | **Not implemented** | provider interface ready |

## Manual acceptance checklist
1. `GET /api/health` → `{"db":"ok"}`.
2. Pricing shows 3 plans from the DB; edit a price in /admin/plans → pricing page updates.
3. Register a hospital with the sandbox gateway → "Simulate failure" leaves nothing provisioned; "Simulate success" lands on the dashboard.
4. Same flow again with the same workspace name → "already taken".
5. Book a demo → appears in /admin/demo-requests; assign, change status, add a note.
6. In hospital A create a patient; sign in as hospital B (other browser) and open `/app/patients/<A's id>` → "Patient not found".
7. Book two overlapping appointments for one doctor → second is refused.
8. Create a Receptionist user → they cannot see Users & roles, Settings or Subscription; API returns 403.
9. Suspend the hospital in /admin → its users are signed out and cannot sign back in to make changes.
