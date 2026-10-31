# Development Roadmap — Lab Upgrade (Labsmart parity and beyond)

Your suggested 21 chunks are **adjusted to what MediCore already has**. Chunks for features that already work (packages, home collection, accounting, inventory, permissions, SaaS admin, multi-branch) are reduced to small improvements so nothing is rebuilt.

**Process for every chunk:** explain current code → gap → exact files → change → implement → unit + integration tests (multi-tenant included) → migration check → regression check of existing modules → checklist → update `DEVELOPMENT_PROGRESS.md` → **wait for your approval**.

## Priority-wise plan

| Order | Chunk | Priority | Why | Size* |
|---|---|---|---|---|
| ✅ 1 | Audit & comparison (this set of documents) | — | Done | — |
| 2 | **Lab master data**: department master, test fields (method, instrument, interpretation, input type, decimals, TAT, sort), parameter input types, CSV import of a starter library | P0 | Foundation for everything below | M |
| 3 | **Reference ranges by age/gender + critical values** | P0 | Correct flags for children/women; patient safety | M |
| 4 | **Formula engine** (safe parser, calculated parameters, starter formulas marked "validate before use") | P0 | Removes manual calculation errors | M |
| 5 | **Per-test status, technician review, pathologist approval, signatories & e-signatures, amendment with versions** | P0 | Reports can't become final without the right approvals | L |
| 6 | **Report design & server PDF**: letterhead image, margins, with/without letterhead, signatures, QR verification, method/interpretation, previous value, TAT dates | P1 | Professional reports, same file for print/WhatsApp/e-mail | L |
| 7 | **Delivery**: auto-send on approval, SMS adapter (DLT), delivery timeline per order, resend, doctor copy, release-only-when-paid setting, patient QR on bill | P1 | Labsmart's headline feature | M |
| 8 | **Lab desk UX**: "New lab visit" one screen (quick register + tests + bill + payment + labels), department worklist grid with keyboard entry, lab dashboard cards, global search/scan | P1 | Speed at the counter | L |
| 9 | Billing extras: thermal 3-inch & A5 bill, insurance/TPA mode, edit order before results with bill sync, discount permission/limit | P2 | Parity | M |
| 10 | Samples extras: container/tube colour, scan-to-receive, rejection reasons list | P2 | MediCore already ahead; polish | S |
| 11 | Outsourced tests (send-out lab, cost vs price, upload external report) | P2 | Common in Indian labs | M |
| 12 | Referral: commission statement & payout, (optional) read-only doctor portal | P2/P3 | Parity with Labsmart Premium | M |
| 13 | Analytics: test-count, department & case-type business, day-book screen, expense budgets | P2 | Parity | S |
| 14 | Narrative templates (histopathology, culture, USG/X-ray) with rich text | P2 | Diagnostic centres | M |
| 15 | Home collection: phlebotomist mobile "my visits", amount collected at home | P2 | Already working; mobile polish | S |
| 16 | Lab inventory: reagents/consumables, consumption per test, low-stock | P3 | MediCore advantage | M |
| 17 | Security extras: IP allow-list per hospital, old/new values in audit for amendments | P3 | Parity | S |
| 18 | Analyser interfacing (ASTM/HL7 listener) — only if you need it | P3 | Neither product has it | L |
| 19 | Full regression, load test, security review, deployment checklist | — | Release | M |

\*S ≈ 1 session, M ≈ 2–3 sessions, L ≈ 3–5 sessions.

## Chunk details (first four, ready to start)

### Chunk 2 — Lab master data
- **Files:** `database/migrations/015_lab_reporting_engine.sql` (departments + new test/parameter columns, back-fill), `backend/src/modules/lab/lab.routes.js` (tests CRUD), `labExtras.routes.js` (parameters), new `labMaster.routes.js` (departments, CSV import), `frontend/src/pages/app/LabPages.jsx` (Tests form), `LabExtras.jsx` (Parameters modal), docs chapter 5, `docs/API.md`.
- **Accept when:** departments CRUD + ordering; test form shows new fields; dropdown/text parameters; existing tests/orders unchanged; tenancy tests pass.

### Chunk 3 — Ranges & critical values
- **Files:** migration (`LabReferenceRanges`, flag CHECK widening), `clinical/lab.logic.js` (pure: `pickRange(ranges, {gender, ageDays})`, `flagFor(value, range)` incl. critical), results route, Ranges editor UI, critical alert notification + acknowledgement, report shows applied range.
- **Accept when:** unit tests for range selection (newborn / child / adult / female / male / no match → default); critical result notifies and blocks approval until acknowledged.

### Chunk 4 — Formula engine
- **Files:** `clinical/formula.js` (tokeniser + recursive-descent parser, whitelist, unit tests incl. division by zero and missing inputs), parameter form "Formula" with live test, result entry auto-fill (read-only calculated rows), seed formulas file `database/seed/lab-formulas.json` flagged "validate before use".
- **Accept when:** no `eval`/`Function`; injection attempts rejected; recalculation on edit; formulas per hospital.

### Chunk 5 — Approval workflow & signatures
- **Files:** migration (item status, signatories, revisions), permissions (`lab.review`, `lab.approve`, `lab.amend`), `lab.routes.js` (review/approve/amend endpoints), Results worklists by stage, signatory settings page, report shows signatures.
- **Accept when:** report cannot be final without approvals; partial approval prints only approved tests (configurable); amendment keeps previous version and reason; full audit trail.

## What we will NOT rebuild
Packages, sample tracking, home collection core, referral doctors, billing/GST invoices, deposits, cash closing, expenses/recurring/payroll, analytics base, pharmacy inventory, roles & permissions, audit, SaaS administration, multi-branch, queue/booking. They only receive the small improvements listed above.

## Clinical safety note
Reference ranges, critical limits, formulas and interpretations will ship as **editable configuration**. Any starter library is marked *"to be validated by your pathologist before use"*, and the app will show who last changed each range/formula. A qualified laboratory professional must validate them before production use.
