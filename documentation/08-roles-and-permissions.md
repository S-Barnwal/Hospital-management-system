# 8. Roles & permissions — who can do what

## The idea

- A **permission** is one small right, e.g. *"View patients"* or *"Verify lab results"*.
- A **role** is a named bundle of permissions, e.g. *Receptionist*.
- Each **user** gets one or more roles. They can do everything their roles allow — nothing more.

Menu items a user is not allowed to use are **hidden**, and the server **also blocks** the action even if someone tries to call it directly. Hiding a button is only for convenience; the real lock is on the server.

## Ready-made roles (every new hospital gets these)

| Role | Typical person | Main rights |
|------|----------------|-------------|
| **Hospital Owner** | The person who bought the subscription | Everything, including subscription and renewal |
| **Hospital Admin** | Office manager / IT person | Everything except changing the subscription |
| **Hospital Manager** | Operations head | Dashboard, reports, analytics, audit log, view patients/appointments/staff/IPD/billing/lab/expenses |
| **Receptionist** | Front desk | Register patients, book & check-in appointments, view beds, create bills and take payments |
| **Doctor** | Consultant | Appointments, OPD notes & prescriptions, admissions, lab orders/results/verification, view pharmacy |
| **Nurse** | Ward / OPD nurse | View patients & OPD, admit/transfer/discharge, view lab |
| **Lab Technician** | Lab staff | Lab orders, samples, result entry |
| **Pharmacist** | Pharmacy counter | Medicines, suppliers, stock, dispensing, view billing |
| **Accountant** | Accounts | Bills, payments, refunds, expenses, reports & export, view lab and subscription |

## All permissions (plain meaning)

| Area | Permission | Meaning |
|------|-----------|---------|
| Dashboard | dashboard.view | See the dashboard |
| Patients | patients.read / write / archive | View · register & edit · archive & restore |
| Appointments | appointments.read / write | View · book, reschedule, check-in, cancel |
| Staff | staff.read / write, departments.manage | View doctors & staff · add/edit & schedules · manage departments |
| Users | users.read / users.manage / roles.manage | View users · create/disable users & assign roles · customise role permissions |
| Settings | settings.read / manage | View · change hospital settings |
| Subscription | subscription.read / manage | View plan & invoices · renew / change plan |
| Audit | audit.read | View the audit log |
| OPD | opd.read / write | View · write consultations & prescriptions |
| IPD | ipd.read / write / configure | View · admit/transfer/discharge · set up wards & beds |
| Billing | billing.read / write / refund | View · create bills & take payments · cancel bills & refund |
| Laboratory | lab.read / write / verify / configure | View · orders, samples & results · verify results · manage tests, packages, prices & referral doctors |
| Pharmacy | pharmacy.read / write / configure | View · dispense & receive stock · manage medicines & suppliers |
| Reports | reports.read / export | View reports & analytics · download CSV |
| Expenses | expenses.read / write | View · record, edit & delete expenses |
| Backups | backups.manage | Download a full data export |

## Safety rules built in

1. **Nobody can change their own role** (prevents giving yourself more power).
2. **You can't give a permission you don't have yourself.**
3. **The Owner role and the owner account are protected** — they can't be disabled or downgraded by other users.
4. **Plan limits apply on top of permissions** — if Laboratory is not in the plan, even the Owner can't use it (menu shows *Upgrade*).
5. Disabled users are logged out everywhere immediately.

## How to add a staff login (step by step)

1. **Users & roles → Users → Add user**.
2. Enter full name, e-mail (this is their login) and a temporary password.
3. Choose the role(s), e.g. *Lab Technician*.
4. Share the password privately. They can change it with *Forgot password* on the login page.

## After a software update

New features sometimes bring new permissions (e.g. *expenses.read*, *backups.manage*). Running `npm run db:seed` adds them to the ready-made roles of **all** hospitals automatically.

Next: [9. Plans, subscription & renewal →](09-plans-and-subscription.md)
