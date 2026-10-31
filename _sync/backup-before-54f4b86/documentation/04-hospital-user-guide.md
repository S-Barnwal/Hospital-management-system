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
- **Duplicate warning**: while you type a mobile number, the form shows *“Already registered: GVH-000124 …”* if that number exists (any format — spaces, +91, dashes). On save it also checks same name + date of birth.
- **Search** by name, phone or patient number.
- **Patient page** shows details plus their appointments, consultations, admissions, bills and lab orders.
- **Patient card** — on the patient page click *Patient card* to print a credit-card-size card with a **QR code** (scanning it opens this patient's file for signed-in staff only) and a barcode of the patient number.
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

### Prescription templates (OPD → Templates)

A template is a ready-made set of medicines (with an optional diagnosis and advice), e.g. *Viral fever — adult*. Make one under **OPD → Templates**, or press **Save as template** on a consultation you just wrote. Templates can be shared by all doctors or belong to one doctor.

In a consultation press **Apply template** → pick one → its medicines are added to the prescription (and diagnosis/advice filled if empty). Nothing is saved until the doctor reviews it and presses *Save draft*.

### Follow-ups (Clinical → Follow-ups)

When a doctor sets a **Follow-up date**, the patient appears here until they come back or book. Views: *Due ±7 days*, *Overdue*, *Today*, *All open*. **Book** opens a follow-up appointment with the patient, doctor and date already filled in.

The day before the date, the patient automatically gets a reminder (e-mail, or WhatsApp when switched on) — once. It is not sent if they already booked or came back. Switch off in **Settings → Follow-up reminders to patients**.

## Admissions & beds (IPD)

- **Wards** (General, ICU, Private…) with a daily bed rate, and **beds** inside each ward.
- **Bed board** shows each bed: available, occupied (with patient name) or under maintenance.
- **Admit** a patient to a free bed. The system makes sure one bed can't hold two patients and one patient can't be admitted twice.
- Click an occupied bed (or a row in *Admissions*) to open the **admission page**. It has five tabs:

| Tab | What you do there |
|-----|-------------------|
| **Overview** | Bed, doctor, reason, bed-transfer history |
| **Vitals** | Record temperature, pulse, BP, respiration, SpO₂, sugar, pain, weight. Out-of-range readings are highlighted (amber) and dangerous ones in red, with small trend lines. *Highlighting only draws attention — it is not a diagnosis.* |
| **Nursing notes** | Notes, **medication given** (medicine, dose, route), **intake/output** (ml, with running totals), procedures and shift handover. Notes are never edited: **Correct** adds a new note linked to the old one, which stays visible (crossed out). |
| **Charges & deposit** | Everything charged on this stay. **Bed charges are added automatically once a day** at the ward rate (never the same day twice); *Update bed charges* does it immediately. **Add a charge** from the *Service charges* list (doctor visit, dressing, ECG…). Shows charged / paid / due and the patient's **deposit balance**; **Take deposit** receives an advance. |
| **Discharge summary** | Provisional and final diagnosis, complaints, course in hospital, procedures, investigations (*Insert lab results from this stay* fills them in), condition at discharge, medicines on discharge, advice, follow-up date, type of discharge (regular, LAMA, referred, death, absconded). **Save draft** as often as needed; a doctor presses **Sign** — after that it is locked. **Print** gives an A4 summary (marked DRAFT until signed). |

- **Transfer bed** and **Discharge** are buttons at the top of the admission page. Discharge uses the signed summary (or a short typed note), frees the bed, and adds any bed days not yet charged.
- **Service charges** (tab, for admins): the price list for IPD services. New hospitals get a starter list at ₹0 — set your prices.
- Auto bed charges can be switched off in **Settings → Charge bed days automatically**.

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
- **GST**: each line shows its **HSN/SAC** code (services default to SAC 9993, medicines use their HSN). The total tax is split into **CGST + SGST**, or **IGST** if you tick *Inter-state supply*. Add a **Buyer GSTIN** for business customers. With the hospital's GSTIN set in Settings, the print says **TAX INVOICE** and shows the GSTIN.
- **Print** the invoice (it carries a QR code that opens the bill for staff).

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

## Message log

Every e-mail and WhatsApp message the system sent for your hospital — appointment confirmations and reminders, report links, codes, summaries — with status (*sent*, *logged* = test mode, *failed* with the reason, *skipped*). Recipients are partly hidden for privacy. Setup: [chapter 15](15-messaging-setup.md).

## Backups

Download a **complete copy of your hospital's data** as one file, any time — even if the subscription has expired. Every download is logged. See [chapter 11](11-backups-and-data.md).

## Settings

Hospital name, e-mail, phone, address (printed on bills and lab reports), country/state/city, **time zone**, patient-number prefix and **facility type**, plus:

- **GST** — hospital GSTIN and default SAC code for services.
- **2-step sign-in for owners and admins** — after the password, a 6-digit code is e-mailed (recommended once e-mail is set up).
- **WhatsApp messages to patients** — appointment confirmation, reminder and report links on/off.
- **Daily summary e-mail** to the owner on/off.

**Payments (UPI)** — your hospital's **UPI ID** and the name shown in UPI apps. Needed for bill *Payment links* (see chapter 6). Money goes straight to this UPI ID.

**Facility type arranges the menu** for your kind of facility (your plan, permissions and data do not change):

| Facility type | Menu |
|---------------|------|
| Diagnostic centre | **Laboratory comes right after Dashboard**; OPD and Admissions & beds are hidden (and their dashboard cards) |
| Clinic | Admissions & beds is hidden |
| Hospital, Multi-specialty, Nursing home, Other | Everything is shown |

Change it any time here; the menu updates after saving.

### Location on map

Below the settings is a map. Mark your building so patients get correct directions and the platform team knows where you are:

1. **Click on the map** where the hospital is (zoom in with + / −), or press **Use my current location** (when you are at the hospital), or **Find from address** (uses the address, city and state above).
2. **Drag the pin** onto the exact building if needed.
3. Type the **PIN code** (6 digits in India) and press **Save location**.

Until a pin is saved, owners and admins see a reminder on the Dashboard.

## Phone numbers, e-mails and addresses (all screens)

The same rules apply on every form — patients, staff, referral doctors, suppliers, settings, registration and the website forms:

| Field | How it works |
|-------|--------------|
| **Phone** | Pick the **country code** from the list (all countries, with flags — type "ind" or "+91" to search), then type the number. It is checked against that country's real numbering rules (India: 10-digit mobile or a valid landline). Wrong numbers show *"Not a valid India number"* immediately. Numbers are saved in international form, e.g. `+919876543210`, and shown as `+91 98765 43210`. Pasting a full number with `+` picks the country automatically. |
| **E-mail** | Checked when you leave the box: one `@`, no spaces, a real-looking domain (`name@hospital.com`). Saved in small letters. |
| **Country → State → City** | Three searchable dropdowns. Choose the country, then its state (full official list), then the city (every listed city of that state — type to search). If your town or village is not listed, type it and choose **Use "…" (not in list)**. |

The server checks everything again, so wrong data cannot be saved even from outside the screens.

## Subscription

Your current plan, start/end dates, days left, invoices, and the **Renew** button (pay online for the next month or year, or switch plan).

Every purchase, renewal and free plan has an **official invoice**. Click the invoice number (or **View / PDF**) → **Download PDF / Print** → choose *Save as PDF* in the print window.

Next: [5. Laboratory workflow →](05-laboratory-workflow.md)
