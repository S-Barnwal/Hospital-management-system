# MediCore HMS — Feature Lists for the Lab Upgrade

## A. Available and working
- Patient registration with auto number, live duplicate warning, ABHA, photo, documents, history
- Lab test catalogue (code, name, department text, sample type, unit, range, price) with **price history**
- Panel (multi-parameter) tests with parameters snapshotted per order
- Test packages with proportional price split and savings
- Lab orders: many tests/packages per order, priority, referral doctor, discount, own GST invoice or OPD bill, pay at order time, Net/Paid/Balance/payment status
- Samples: one per sample type, numbered, Code 128 labels, collect / receive / reject / re-collect, order status follows samples
- Result entry with automatic low/high/abnormal flags (panel = worst line)
- Verification by users with `lab.verify`; results locked after verification
- Printable report; secure patient report link (hash-stored, 7-day expiry, OTP) via WhatsApp / e-mail; Message log
- Lab trends chart per patient; lab results inserted into discharge summary
- Referral doctors with commission %, referral business & TAT in Analytics
- Home sample collection (address, slot, collector, status flow, charge)
- Billing: GST invoice, discounts, refunds, deposits, UPI payment links, cash closing, payments register
- Expenses, recurring expenses, payroll → expenses, analytics profit, 13 CSV reports
- Roles & 46 permissions, audit log, sign-in history, 2-step sign-in
- Pharmacy inventory (batches, FEFO, PO, expiry alerts, barcode)
- SaaS: plans, trials, coupons, invoices, support tickets, MRR, monitoring, hospital groups

## B. Partially available — need improvement
| Feature | Current | Needed |
|---|---|---|
| Departments | Free-text on test | Department master (name, order on report, head/signatory) |
| Reference ranges | One range per test/parameter | Ranges by gender + age band, pregnancy optional; default range kept |
| Verification | Single step, order level | Per-test status; technician review → pathologist approval; signatures |
| Report output | Browser print, text letterhead | Server PDF; letterhead image, margins, with/without letterhead, signatures, QR, method/interpretation, previous value |
| Delivery | Manual link share (WhatsApp/e-mail) | Auto on approval, SMS, delivery timeline per order, resend, doctor copy |
| Bill QR | Staff-only QR | Patient QR → report status/download |
| Result entry UX | Form per order | Department worklist grid, keyboard-first, live flags |
| Patient report history | Visible through orders | "Lab reports" tab with re-print / re-send |
| Analytics | Lab KPIs, TAT, referral | Test-count, department & case-type analysis |
| Referral | Commission % and business | Commission statement + payout record, doctor portal |
| Home collection | Desk workflow | Phlebotomist mobile "my visits", cash collected at home |
| Audit | Action log | Old/new values for result amendments |
| Booking speed | Register patient, then order | Quick-register inside New lab order |

## C. Missing
1. **Age/gender reference ranges** (P0)
2. **Critical values** with alert and acknowledgement (P0)
3. **Formula / calculated parameters** engine with a lab-validated formula library (P0)
4. **Two-level approval with e-signatures** (P0)
5. Report amendment with version history (P1)
6. Server-generated PDF + report design settings (P1)
7. QR verification on report (P1)
8. SMS channel (welcome, bill, report ready) (P1)
9. Release report only when dues are cleared — configurable (P1)
10. Parameter input types (dropdown e.g. "Positive/Negative", text, numeric with decimals) (P1)
11. Interpretation, method and instrument per test (P1)
12. Narrative / rich-text report templates (histopathology, culture, radiology) (P2)
13. Edit order (add/remove tests) before results, with bill adjustment (P2)
14. Outsourced (send-out) tests (P2)
15. Thermal / A5 bill formats, insurance/TPA payment mode (P2)
16. Delta check (big change vs previous result) (P2)
17. Doctor (referral) portal (P3)
18. Expense budgets (P3)
19. IP/browser allow-list (P3)
20. Analyser interfacing (ASTM/HL7) (P3 — Labsmart doesn't document it either)
21. Lab reagent inventory with consumption per test (P3)

## D. Where MediCore can beat Labsmart
- **Full hospital** in one system: OPD, IPD, pharmacy, HR, queue/TV, online booking — lab results flow into consultations and discharge summaries.
- **Real sample tracking** (per-sample status, rejection, re-collection) — Labsmart documents only a bill barcode.
- **Critical-value workflow** and **two-level approval with amendment history** — not documented by Labsmart.
- **Secure report links** with OTP and expiry (Labsmart uses open QR/link).
- **True SaaS**: multi-tenant isolation, hospital groups / multi-branch, coupons, trials, MRR, monitoring, support desk.
- **Inventory** (pharmacy now, lab reagents next) — Labsmart lists none.
- **GST-compliant invoices**, deposits, UPI payment links, cash closing, payroll.
- **ABHA** fields and sign-in history.
