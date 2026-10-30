# 4. Hospital user guide — every screen explained

After logging in at `/login`, you see the **left menu** (sidebar). Menu items you are not allowed to use are **hidden**. Items marked **Upgrade** are not in your plan.

The menu is grouped like this:

| Group | Screens |
|-------|---------|
| Overview | Dashboard |
| Front office | Patients · Appointments · Doctors & staff |
| Clinical | OPD · Admissions & beds · Pharmacy |
| Laboratory | Lab orders · Samples · Results & reports · Tests · Packages · Referral doctors |
| Finance | Billing · Payments · Expenses |
| Insights | Reports · Analytics |
| Administration | Users & roles · Audit log · Backups · Settings · Subscription |

**Small helpers everywhere**

- Green / red pop-up messages in the top-right corner (*toasts*) confirm that something was saved — or tell you exactly what went wrong.
- Every list has a **search box** and filters, and shows 20 rows per page with page buttons below.
- Dates and times are shown in **your hospital's time zone** (set in Settings).

---

## Dashboard

A one-screen summary that refreshes when you open it:

- Today's appointments (and how many are checked in / completed)
- OPD visits completed today, doctors and staff count
- Occupied beds and occupancy %
- Money collected today and this month (after refunds), pending payments
- Low-stock medicines, pending lab orders and samples still to collect
- Expenses this month
- Appointment trend chart (last 14 days), upcoming appointments, recent activity
- **Alerts** (for example "2 medicines at or below reorder level") also pop up as messages once per session

You only see the boxes your role is allowed to see.

## Patients

- **Register patient** — name, gender, date of birth, phone, address, emergency contact. A patient number is created automatically (e.g. `GVH-000124`; prefix set in Settings).
- **Search** by name, phone or patient number.
- **Patient page** shows details plus their appointments, consultations, admissions, bills and lab orders.
- **Archive** instead of delete: an archived patient is hidden from lists but their medical and billing history is kept (law and audits require this). They can be restored.

## Appointments

- **Book**: choose patient, doctor, date and time. The system blocks double-booking the same doctor at the same time and respects the doctor's schedule.
- **Check in** when the patient arrives → they appear in the doctor's OPD queue.
- **Reschedule**, **cancel** (with reason) or mark **no-show**.
- Filter by date, doctor and status.

## Doctors & staff

- Add **doctors** (specialisation, consultation fee) and **other staff** (nurse, technician, etc.).
- **Departments** — e.g. General Medicine, Paediatrics. Add, rename, or delete if unused.
- **Doctor schedule** — which days and hours each doctor sees patients; used by the appointment booking.
- Staff with history (appointments, consultations) can't be deleted — mark them inactive instead.

> Doctors & staff are *records*. To let a person **log in**, create a user for them under **Users & roles**.

## OPD (out-patient consultations)

1. Open a **checked-in appointment** → *Start consultation*.
2. Write complaints, examination, diagnosis and advice; add **prescription** lines (medicine, dose, frequency, days).
3. From the consultation you can **order lab tests** directly.
4. **Save** as often as you like — every save keeps a version, so earlier versions are never lost.
5. **Finalise** — locks the consultation, marks the appointment completed, and (optionally) adds the consultation fee to the patient's bill.
6. **Print** the prescription.

## Admissions & beds (IPD)

- **Wards** (General, ICU, Private…) with a daily bed rate, and **beds** inside each ward.
- **Bed board** shows each bed: available, occupied (with patient name) or under maintenance.
- **Admit** a patient to a free bed. The system makes sure one bed can't hold two patients and one patient can't be admitted twice.
- **Transfer** to another bed, **Discharge** — optionally adding bed charges (days × rate) to the bill.

## Pharmacy

- **Medicines** — name, strength, form, sale price, reorder level.
- **Suppliers** — who you buy from.
- **Receive stock** — batch number, expiry date, quantity, cost price.
- **Dispense** — choose patient & quantity. The system automatically takes from the batch that **expires first** (FEFO) and never lets stock go below zero. Optionally adds the medicines to the bill.
- **Adjust stock** — for breakage, expiry write-off, or counting corrections (with reason).
- **Alerts** — low stock and medicines expiring soon.
- Every stock movement is recorded in a ledger, so you can always see why stock changed.

## Laboratory

The lab has six screens. The full flow is explained in [chapter 5](05-laboratory-workflow.md).

| Screen | Use it to… |
|--------|------------|
| **Lab orders** | Create a new order (tests and/or packages, discount, payment) and see every order with **Net, Paid, Balance, Payment status, Order status** |
| **Samples** | Collect, receive or reject samples (one sample per sample type, e.g. Blood, Urine) |
| **Results & reports** | Three tabs: *Awaiting results*, *Awaiting verification*, *Verified reports* (print from here) |
| **Tests** | The test menu: code, name, department, sample type, unit, reference range, price, active/inactive. 💲 button = price history |
| **Packages** | Bundles such as "Full body check-up": tests included, individual total, package price, savings. ✏️ edit, 💲 price history |
| **Referral doctors** | Outside doctors who send patients, with commission % and business generated |

## Billing

- A **bill** starts as a **draft**: add items (consultation, lab, pharmacy, bed, procedure, other), quantity, price and tax.
- Apply a **discount** on the whole bill.
- **Finalise** — the bill gets a permanent number like `INV2026-000045` and can no longer be edited.
- **Record payment** (cash, UPI, card, bank, other) → a receipt number `RCT-000123`.
- **Refund** (with reason) → `RFD-000124`. Payments and refunds are never edited or deleted; corrections are new entries.
- **Cancel** a bill (with reason) — only after refunding any payment.
- **Print** the invoice.

## Payments

One list of **every receipt and refund** across all bills (OPD, lab, IPD, pharmacy), with filters for date, method (cash/UPI/…) and type, and totals for **received**, **refunded** and **net**. Click a bill number to open the bill. See [chapter 6](06-money-billing-expenses.md).

## Expenses

Record money the hospital **spends**: date, category (Rent, Salaries, Electricity, Lab reagents…), amount, how it was paid, paid to whom, reference and notes. Categories can be added, deactivated, or deleted if unused. Expenses feed the **profit** figure in Analytics.

## Reports

Pick a date range and a report, view it on screen and (with permission) **download as CSV** to open in Excel:

registrations · appointments · admissions · collections · outstanding bills · lab · inventory.

## Analytics

A visual business overview for any date range (7 days, 30 days, 90 days, 1 year or custom):

- Net collections, expenses, **profit**, outstanding amount, new patients
- Lab orders, verified reports, average order value, **average turnaround time**
- Daily collections and daily expenses charts
- Collections by payment method, expenses by category
- Top tests, top packages, orders by status
- **Referral doctors — business and commission payable**

## Users & roles

- **Users** — create a login for a staff member (name, e-mail, temporary password, role). Disable a user who leaves (their history stays). The owner account is protected.
- **Roles** — see which role has which permission (a grid of ● / ○). Owners/admins can customise roles. Safety rules: you cannot change your own role, and you cannot give someone a permission you don't have yourself.

Details: [chapter 8](08-roles-and-permissions.md).

## Audit log

A permanent diary of important actions (entries cannot be edited or deleted from the app): who did what and when (e.g. *"Priya created patient GVH-000124"*, *"Lab order LAB-000014 verified"*, *"Backup downloaded"*). Useful for disputes and inspections.

## Backups

Download a **complete copy of your hospital's data** as one file, any time — even if the subscription has expired. Every download is logged. See [chapter 11](11-backups-and-data.md).

## Settings

Hospital name, e-mail, phone, address (printed on bills and lab reports), city/state, **time zone**, patient-number prefix and **facility type**.

**Facility type arranges the menu** for your kind of facility (your plan, permissions and data do not change):

| Facility type | Menu |
|---------------|------|
| Diagnostic centre | **Laboratory comes right after Dashboard**; OPD and Admissions & beds are hidden (and their dashboard cards) |
| Clinic | Admissions & beds is hidden |
| Hospital, Multi-specialty, Nursing home, Other | Everything is shown |

Change it any time here; the menu updates after saving.

## Subscription

Your current plan, start/end dates, days left, invoices, and the **Renew** button (pay online for the next month or year, or switch plan).

Next: [5. Laboratory workflow →](05-laboratory-workflow.md)
