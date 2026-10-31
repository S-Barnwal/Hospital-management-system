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

- **Photo**: upload a photo under *Documents & photos* on the patient page, then tap the person icon on it to make it the profile photo.
- **ABHA**: the 14-digit ABHA number (e.g. 91-1234-5678-9012) and/or ABHA address (name@abdm) can be saved on the patient (Edit). Each is unique within your hospital. They are stored and shown; linking records with the national ABDM network needs your own ABDM registration and is not done automatically.

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

## Token queue (Front office → Token queue)

- **Issue token** — choose the queue (each doctor, Reception, Laboratory, Pharmacy, Billing), optionally the patient, tick **Priority** for senior citizens / pregnant women / emergencies (called first). A slip opens — **Print slip** prints just the slip (58/80 mm thermal printers work).
- **Checking in** an appointment gives the patient a token in that doctor's queue automatically (the toast shows the number).
- **Call next** — finishes the current token and calls the next one (priority first). Type the **Room / counter** once; it is remembered on that computer. On each token: ↻ *call again*, ✓ *done*, ⏭ *not here (skip)*; a skipped token can go *Back to queue*.
- Numbers restart at 1 every day; yesterday's unfinished tokens are closed automatically.
- **TV display screens** — *Add screen* (needs settings permission), pick the queues, copy the link (shown once) and open it on a smart TV / any browser in full screen. It shows *Now serving*, the next numbers and the room — never names — and flashes + announces each call (tap once to turn on sound; add `?lang=hi` to the link for Hindi announcements). Remove a screen to kill its link.

## Online booking (Settings → Online booking, Appointments → Online requests)

1. Settings → tick **Let patients request appointments online** (and an optional note) → Save. Your link is `…/book/<workspace>`; put it on your website, Google profile or WhatsApp.
2. Patients choose a doctor (only doctors with a weekly schedule), a day (up to 30 days ahead) and a free slot, enter name + mobile (e-mail, gender, age, reason optional) and get a reference like `K7PQ2MXA`.
3. **Appointments → Online requests**: *Confirm* — pick an existing patient with the same phone, find another, or register a new one — and the appointment is created (the patient gets the normal confirmation message). *Decline* with a reason (e-mailed if they gave an e-mail). Requests not handled before their time are closed automatically.

## Appointment calendar (Appointments → Calendar)

Day, week and month views, filter by doctor, colour by status (blue booked, gold checked-in, green completed). Click a day to open it; **+** books on that day. Phones open in day view.

## Doctors & staff

- Add **doctors** (specialisation, consultation fee) and **other staff** (nurse, technician, etc.).
- **Departments** — e.g. General Medicine, Paediatrics. Add, rename, or delete if unused.
- **Doctor schedule** — which days and hours each doctor sees patients; used by the appointment booking.
- Staff with history (appointments, consultations) can't be deleted — mark them inactive instead.
- **Room / cabin** (doctors) — shown on the token TV screen and used as the default counter when calling.

> Doctors & staff are *records*. To let a person **log in**, create a user for them under **Users & roles**.

## Attendance & payroll (Front office → Attendance & payroll)

Three tabs; each appears only if your role allows it.

| Tab | What you do | Who |
|-----|-------------|-----|
| **Attendance** | Pick a date, tap **P / A / ½ / L / W / H** for each person (present, absent, half day, leave, weekly off, holiday), optional check-in/out time, **Mark rest present**, **Save**. Future dates are blocked. Approved leave is pre-filled as **L**. | `hr.attendance` (view with `staff.read`) |
| **Leave** | **New leave request** (type casual/sick/earned/unpaid/other, dates or half day, reason). Approve ✓ or reject ✗; approving marks those days as leave in attendance. Overlapping requests are refused. | request: `hr.attendance` or `hr.leave` · decide: `hr.leave` |
| **Payroll** | Set each person's **monthly salary** (only payroll users ever see salaries). **Prepare payslips** for a month → pay = salary × paid days ÷ days in month. **Adjust** allowances/deductions, **Pay** (bank/UPI/cash…) — the amount is recorded automatically under **Expenses → Salaries**. 🖨 opens a printable **payslip**. | `hr.payroll` |

Paid days = days in month − absences − ½ × half days − approved **unpaid** leave. Unmarked days count as paid, so you don't have to mark every day. A paid payslip is final; preparing again skips it.

## Files & photos (bills, expenses, purchase orders, patients)

Wherever you see **Add photo / PDF** you can attach files from a computer or straight from a phone camera: expense receipts (Expenses → 📎), bill photos (bill page, right side), supplier invoices (purchase order), patient documents (patient page → *Documents & photos*: ID proof, old reports, consent forms, insurance). JPEG, PNG, WebP or PDF, up to **5 MB** each, 30 per record. Files are stored inside your hospital's database, checked by their real content (renaming a file doesn't fool it), and only people allowed to see that record can open them.

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
- **Barcode** — give a medicine its pack barcode (EAN/UPC or your own code). In **Dispense**, click the *Scan barcode* box and scan: the medicine is picked instantly. Two medicines can't share a barcode.
- **Purchase orders** (Pharmacy → Purchase orders tab) — *Draft* (start from **Suggest low-stock items**) → **Place order** (gets `PO-000001`, print/send to supplier) → **Receive goods** line by line with batch, expiry and sale price; stock goes up and the order becomes *Partially received* / *Received*. Draft or placed orders can be cancelled with a reason. Attach the supplier's invoice to the order.
- **Alerts** — low stock, expiring soon, and **already expired** batches with a **Remove** button (writes the batch off with an "expired" entry in the ledger). Owners/admins also get a daily e-mail of low/expiring stock (Settings → Notifications → *Stock alerts*).
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
| **Home collections** | Orders booked with home sample collection: address, time slot, assigned collector; move *Scheduled → On the way → Collected* (or *Cancelled*) |

**Panels (multi-parameter tests)** — Tests → ☰ *Parameters* turns a test like CBC or LFT into a panel with its own lines (Haemoglobin, WBC…), each with unit and range. Results are typed per line, every line gets its own flag, and the printed report shows them as rows. **Lab trends** on the patient page charts any numeric result across visits.

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

- **Recurring** — rent, internet, AMC… set once (amount, category, every week/month/quarter/year, start and optional end date). The system posts each due expense automatically every night (marked *Recurring*), never twice for the same date; **Post due now** does it immediately.
- **📎 Files** — attach receipt photos or PDFs to any expense.
- Salary expenses created by **Payroll** are marked *Payroll* and can't be deleted here (they belong to a paid payslip).

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

## Help & support (Administration → Help & support)

Raise a ticket to the MediCore team (category, priority, description), follow the conversation and reply; you are e-mailed when support answers. Works even when your subscription has lapsed or the workspace is suspended. **Never include patient names, numbers or medical details** — describe the screen and steps instead.

## Branches (only for hospital groups)

If your organisation has several hospitals/clinics on MediCore and the platform has linked them, **Branches** shows each branch's appointments today, patients waiting, new patients, in-patients and collections, plus group totals — for the branches where you have an account. *Sign in to this branch* opens that workspace's login.

## Sign-in history (Users & roles → Sign-in history)

Every sign-in to your hospital's accounts in the last 180 days: who, when, device, IP and result (wrong password, locked, disabled). Use it to spot shared passwords or someone guessing.

## Subscription

Your current plan, start/end dates, days left, invoices, and the **Renew** button (pay online for the next month or year, or switch plan).

Every purchase, renewal and free plan has an **official invoice**. Click the invoice number (or **View / PDF**) → **Download PDF / Print** → choose *Save as PDF* in the print window.

Next: [5. Laboratory workflow →](05-laboratory-workflow.md)
