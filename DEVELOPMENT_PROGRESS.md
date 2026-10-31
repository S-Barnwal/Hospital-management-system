# Development Progress — Lab Upgrade

| Chunk | Status | Date | Notes |
|---|---|---|---|
| 1 — Audit & comparison | ✅ Done (analysis only, no code changed) | 31 Oct 2026 | `MEDICORE_PROJECT_AUDIT.md`, `LABSMART_FEATURE_ANALYSIS.md`, `MEDICORE_VS_LABSMART_COMPARISON.md`, `MISSING_FEATURES.md`, `DATABASE_GAP_ANALYSIS.md`, `DEVELOPMENT_ROADMAP.md` |
| 2 — Lab master data | ✅ Done — tested on the development database | 31 Oct 2026 | Migration 015; departments CRUD; test method/instrument/interpretation/TAT/order; result input types (number/text/dropdown), decimals, heading rows; CSV import (dry run, all-or-nothing, ≤ 500 rows); order snapshots; report grouped by department |
| 3 — Age/gender ranges & critical values | ✅ Built — waiting for your test run & approval | 1 Nov 2026 | Migration 016; ranges editor + CSV import; range chosen per patient at order time and snapshotted; critical flags, alert, acknowledgement, verify blocked until acknowledged |
| 4 — Formula engine | Planned | | |
| 5 — Approval workflow & signatures | Planned | | |

## Chunk 2 — details

**Security & multi-tenancy**
- `LabDepartments` has `TenantId`, unique `(TenantId, Name)` and `(TenantId, Id)`; tests reference it with a composite foreign key `(TenantId, DepartmentId)`, so the database itself refuses another hospital's department.
- Every new query filters by `req.ctx.tenantId` (tenancy-guard unit test passes); request bodies are `.strict()` zod schemas, so a client cannot send a `tenantId`.
- CSV import: parsed in the browser, validated again on the server, max 500 rows, all-or-nothing transaction, audit-logged. The template download escapes formula-like cells (`= + - @`).
- No clinical values are hard-coded: departments are a per-hospital list, and ranges, units, options and interpretations come only from what the lab enters or imports.

**Verification done here**
- Unit: `tests/unit/labMaster.test.js` (options, result checks, decimals, report order, import rows) and tenancy guard — pass.
- Frontend bundle builds; UI walkthrough (mocked API, desktop + phone): tests list, new test with dropdown result, departments manager, CSV import with error lines, parameters with heading/dropdown rows, result entry (dropdown, headings skipped), report grouping, decimals — all pass, no console errors, no horizontal scroll at 390 px.
- Integration test written: `tests/integration/chunk2-lab-master.test.js` (two hospitals: department isolation, import isolation, snapshots, result checks). **Needs your database** — run `npm run test:e2e`.

**Also fixed:** the tenancy-guard unit test was failing on the migration probe list (`migrate.js`); the probes are now marked tenant-safe (they only check that tables exist).

**To run on your laptop:** `cd backend` → `npm run db:migrate` → `npm run db:seed` → `npm test` → `npm run test:e2e > e2e.log 2>&1`.


## Chunk 3 — details

**How a range is chosen:** when the order is placed, using the patient's gender and completed age (like a birthday, in the unit of the band). A range for the patient's own gender beats "any"; then the narrowest age band wins. No date of birth, or no matching band → the test's default range. The chosen range is copied onto the order, so later edits never change a report.

**Critical results:** a value below the critical low or above the critical high is flagged CRITICAL. The hospital gets a notification (order number and test only — no patient name), the order shows a red banner, and it cannot be verified until someone presses "Acknowledge critical" and writes who was informed (name + time recorded, audit-logged). A changed value that is still critical needs a new acknowledgement.

**Security & multi-tenancy**
- `LabReferenceRanges` has `TenantId`, a `(TenantId, RangeId)` unique key and composite foreign keys to the hospital's own test and parameter; acknowledgement user ids also use `(TenantId, UserId)` foreign keys.
- Every query is scoped by `req.ctx.tenantId` (tenancy guard passes); bodies are strict; B gets 404 for A's tests, orders and acknowledgements, and A's test codes are "not in your catalogue" for B's import.
- The patient report link strips the staff-only alert fields.
- No ranges or critical limits are hard-coded; the lab enters or imports its own.

**Verification done here:** unit tests `labRanges.test.js` (age, newborn / infant / child / adult female / adult male / unknown gender / no DOB, flags, overlaps); frontend build; UI walkthrough (ranges editor with overlap error, ranges CSV import, critical banner, verify disabled, critical list, acknowledge) on desktop and phone; chunk 2 walkthrough re-run. Integration test `tests/integration/chunk3-lab-ranges.test.js` needs your database.

**To run on your laptop (backend folder):** `npm run db:migrate` → `npm test` → `npm run test:e2e -- chunk3-lab-ranges chunk2-lab-master phase3 > c3.log 2>&1`.

**Known on the hosted development database:** the payment-idempotency test can time out (two parallel requests waiting on a lock longer than 30 s on a slow connection); it is not related to the lab work.
