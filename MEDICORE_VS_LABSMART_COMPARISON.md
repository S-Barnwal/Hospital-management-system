# MediCore HMS vs Labsmart LIS — Comparison

Status labels: **Available · Partially Available · Missing · Needs Improvement · Cannot Verify**. Labsmart's column is based on its public website only (see `LABSMART_FEATURE_ANALYSIS.md`). Priority: **P0** clinical correctness / blocks lab use · **P1** competitive must-have · **P2** important · **P3** nice to have.

## 1. Summary table

| Feature | Labsmart LIS | MediCore HMS | Gap | Required Action | Priority |
|---|---|---|---|---|---|
| Patient registration with auto ID | Available | Available (prefix + sequence, ABHA, photo) | — | Keep | — |
| Duplicate patient detection | Cannot Verify (search only) | Available (live phone & name+DOB warning) | MediCore ahead | Keep | — |
| Patient history / repeat visit | Available | Available | Report list per patient missing | Add "Lab reports" tab on patient (re-print, re-send) | P2 |
| One-screen register + book + bill | Available | Partially Available (patient picker inside lab order; register separately) | Extra clicks at desk | "Quick register" inside New lab order | P1 |
| Test master (units, ranges, price) | Available (pre-loaded) | Available (10 seeded tests) | Small seed library | Configurable starter library (CSV import), lab must validate | P1 |
| Departments | Cannot Verify | Partially Available (free text) | No master, no ordering, no signatory per dept | Department master table | P1 |
| Panels / multi-parameter tests | Available | Available | — | Add input types (numeric/text/dropdown), decimals | P1 |
| Packages | Available | Available (price split, savings) | — | Keep | — |
| Age / gender reference ranges | Available | **Missing** (one range) | Wrong flags for children, women | Range table by gender + age band | **P0** |
| Critical values | Cannot Verify | **Missing** | Safety alert absent | Critical low/high + alert + acknowledgement | **P0** |
| Automatic calculations (formulas) | Available (CBC, KFT, LFT, lipid, iron, urine, PT/INR, eAG) | **Missing** | Manual maths errors | Safe formula engine + formula library (lab-validated) | **P0** |
| Abnormal flagging | Available | Available (low/high/abnormal, panel worst-line) | — | Add critical & range-by-patient | P0 (with ranges) |
| Per-test status in one order | Available (pending/in-progress/completed) | Partially Available (order-level) | Can't release one test early | Item status + partial report | P1 |
| Add/remove test after booking | Available | Missing | Rebook needed | Edit order (before results) with bill sync | P2 |
| Billing & invoice | Available | Available (GST invoice, discounts, refunds, deposits) | Bill sizes | A5 & 3-inch thermal layouts | P2 |
| Payment modes | Cash, UPI, card, insurance | Cash, UPI, card, bank, other, deposits, UPI links | Insurance/TPA | Add insurance mode + TPA name/claim no. | P2 |
| QR on bill → report | Available | Partially Available (bill QR is staff-only) | Patient can't self-serve | Patient QR (status + download when dues cleared) | P1 |
| Sample collection & tracking | Cannot Verify | Available (per sample type, collect/receive/reject/recollect) | MediCore ahead | Add tube colour, scan-to-receive | P2 |
| Barcode labels | Available (bill barcode) | Available (Code 128 sample labels) | — | Keep | — |
| Result entry speed | Available (flexible) | Needs Improvement (form per order) | Slower desk | Keyboard grid, worklist by department | P1 |
| Previous result on report (delta) | Cannot Verify | Partially Available (trend chart in app) | Not on printout | Previous-value column + delta check flag | P2 |
| Technician verification | Cannot Verify | Partially Available (entry → verify) | No review step | Item status `reviewed` by technician | P0 |
| Pathologist approval / sign-off | Available (e-signatures) | Partially Available (verify, no signature) | No signatures | Signatories + signature images + approve | **P0** |
| Report amendment after approval | Cannot Verify | Missing (locked) | Can't correct safely | Amend with reason + version history | P1 |
| PDF report | Available (letterhead, margins, fonts, show/hide) | Partially Available (browser print, text letterhead) | Not configurable, no server PDF | Report settings + server-side PDF | **P1** |
| Report templates / narrative reports | Available (+ USG/X-ray add-on) | Missing (no rich-text) | Histopathology/culture/radiology | Narrative template per test | P2 |
| Interpretation / method / instrument | Available | Missing (description only) | Report less professional | Fields on test, printed | P1 |
| QR on report | Available | Missing | Authenticity check | QR → verification page | P1 |
| WhatsApp delivery | Available | Available (link + OTP) | Manual only | Auto-send on approval (setting) | P1 |
| SMS | Available (welcome, bill, report ready) | **Missing** | No SMS channel | SMS provider adapter (DLT templates) | P1 |
| E-mail delivery | Available | Available | — | Attach PDF option | P2 |
| Delivery tracking | Cannot Verify | Partially Available (Message log, share views) | Not per order | Delivery timeline on order + resend | P2 |
| Release only after payment | Available (QR download needs no dues) | Missing | Revenue leakage | Setting: block share/download with dues | P1 |
| Referral doctors & business | Available | Available (commission %, business in analytics) | Statement/payout | Commission statement + payout record | P2 |
| Doctor portal | Available (Premium) | Missing | — | Read-only referral portal (magic link + OTP) | P3 |
| Home collection | Partially Available (mobile registration) | Available (address, slot, collector, status flow, charge) | MediCore ahead | Phlebotomist "my visits" mobile view, cash at home | P2 |
| Outsourced tests | Available (billing) | Missing | Send-out labs untracked | Outsource lab master, cost vs price, received report upload | P2 |
| Employees & permissions | Available | Available (46 permissions, custom roles) | — | Lab-specific splits (review/approve/amend/discount) | P1 |
| Activity tracking | Available | Available (audit log, sign-in history) | Before/after values | Store old/new result on amendment | P1 |
| Browser / device security | Available | Missing | — | Optional IP allow-list | P3 |
| Daily business accounting | Available | Available (payments register, cash closing, expenses, profit) | Single lab view | "Day book" screen for labs | P2 |
| Expenses with budgets | Available | Partially Available (no budgets) | — | Category budgets | P3 |
| Analytics / test count | Available | Partially Available (KPIs, TAT, referral) | Test-count, case-type | Test-count & department analysis | P2 |
| Inventory | Missing | Available (pharmacy stock, PO, expiry) | MediCore ahead | Lab reagents & consumption per test | P3 |
| Machine interfacing | Missing | Missing | Both | Later: ASTM/HL7 listener | P3 |
| Subscription, trial, coupons | Available | Available (plans, trials, coupons, invoices, MRR) | — | Optional bill-quota limits | P3 |
| Multi-branch | Missing | Available (groups) | MediCore ahead | — | — |
| Hospital modules (OPD, IPD, pharmacy, HR, queue, booking) | Missing | Available | MediCore ahead | Keep and integrate with lab | — |

## 2. Workflow comparisons (key modules)

### Patient registration
- **Labsmart:** one screen registers the patient and creates the bill; search by name/phone/case ID; history and repeat cases; welcome SMS; case number locked.
- **MediCore today:** Patients → Register (name, gender, DOB, phone with country code, e-mail, address with country/state/city, blood group, emergency contact, ABHA, photo), auto number, live duplicate warning; the lab order then picks the patient.
- **Improve:** "Quick register" (name, gender, age *or* DOB, phone) inside *New lab order*; age stored as DOB-estimate; welcome message optional; patient "Lab reports" tab.

### Test master & reference ranges
- **Labsmart:** pre-loaded tests with units, ranges by age & gender, interpretations, built-in formulas.
- **MediCore today:** test (code, name, department text, sample type, unit, one low/high or text range, price, description), panel parameters each with one range.
- **Improve:** department master; per-test/parameter range rows (gender, age from/to with unit days/months/years, low, high, critical low/high, text); method, instrument, interpretation; parameter input type and decimals; formula per parameter. Existing `RefLow/RefHigh` stay as the default range so nothing breaks.

### Booking, billing, payment
- **Labsmart:** rate list, discount, balance, payment modes incl. insurance, thermal/A5 bills, QR & barcode on bill; edit tests on the bill updates the report.
- **MediCore today:** order with tests/packages, referral, priority, discount, own GST invoice or OPD bill, pay now, Net/Paid/Balance, refunds, deposits, UPI link, cash closing.
- **Improve:** thermal/A5 print; insurance mode; patient QR on bill; edit order before results with automatic bill adjustment; discount permission/limit.

### Samples
- **Labsmart:** barcode on bill; no public sample-tracking workflow.
- **MediCore today:** one numbered sample per sample type, labels, collect/receive/reject/re-collect, order status follows samples, home collection marks samples collected.
- **Improve:** tube colour/container per sample type, scan barcode to receive, rejection reason list. *(MediCore is already ahead.)*

### Result entry, calculations, flags
- **Labsmart:** enter base values, formulas fill calculated ones, abnormal checker.
- **MediCore today:** value per test or panel line, automatic low/high flag, worst-line panel flag, trends.
- **Improve:** formulas (safe expression evaluator, no `eval`), range chosen by patient age/gender at entry time, critical flag + alert, keyboard grid, previous value & delta flag, per-test comment.

### Verification & approval
- **Labsmart:** status new → in-progress → final → signed-off → printed; pathologist + technician e-signatures on sign-off.
- **MediCore today:** results entered → order *completed* → user with `lab.verify` verifies → locked.
- **Improve:** per-test status `pending → entered → reviewed (technician) → approved (pathologist)`; signatory profiles with signature images; partial approval; amendment after approval with reason and version history; report final only when all required approvals exist.

### Report output & delivery
- **Labsmart:** configurable PDF with letterhead, margins, signatures, QR, TAT dates; WhatsApp/SMS/e-mail; automatic report-ready SMS; QR download blocked while dues are pending.
- **MediCore today:** printable report page (browser PDF) with hospital name, verified by; secure patient link with OTP via WhatsApp/e-mail; Message log.
- **Improve:** report settings (letterhead image, margins, with/without letterhead, show/hide fields), server-generated PDF (same file for print, download, e-mail, WhatsApp), QR verification, auto delivery on approval, SMS adapter, delivery timeline, release-on-payment rule.

## 3. UI / UX comparison

| Area | Labsmart (public screenshots/claims) | MediCore today | What to improve |
|---|---|---|---|
| Dashboard | Simple counts & graphs | Hospital-wide KPIs, alerts, 14-day trend | Lab-specific worklist cards: to collect, to receive, to enter, to approve, critical, TAT breached |
| Sidebar | Lab-only menu | Grouped hospital menu; Laboratory has 7 items | "Lab desk" hub page with tabs instead of 7 menu items; facility type "Diagnostic lab" shows lab-first menu |
| Header | — | Breadcrumb, notifications, user | Global search (patient, order, sample no.) with barcode scan |
| Forms | Fast desk entry | Validated, accessible, mobile-friendly | Keyboard-first: Enter to next field, test search by code, quick-add packages |
| Tables | — | DataTable with filters, pagination | Sticky actions, saved filters, bulk print labels |
| Test selection | Rate list | Searchable picker with packages | Show price, sample type, TAT as you pick; recent/popular tests |
| Billing screen | One screen with registration | Order modal + bill detail | Single "New lab visit" screen: patient · tests · amount · payment · print |
| Sample tracking | — | Worklist by status | Scan-to-receive box, colour chips |
| Result entry | Grid with formulas | Form per order | Department worklist grid, auto-calculated rows greyed, flags live |
| Report preview | PDF preview | HTML print page | Side-by-side PDF preview before approval |
| Settings | Letterhead & e-sign page | General settings | "Lab report design" settings page with live preview |

Design rule: build MediCore's own look (forest/gold design system already in `components/ui.jsx`); do not copy Labsmart branding, text, images or layouts.
