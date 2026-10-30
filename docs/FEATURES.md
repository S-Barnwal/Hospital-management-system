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
| Multi-branch management | **Not implemented** | Enterprise roadmap |
| E-mail / SMS notifications | **Integration pending** | reset links printed to server log in development |
| File uploads | **Not implemented** | design in SECURITY.md |
| MFA for privileged accounts | **Not implemented** | |
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
