# Database Gap Analysis — Lab Upgrade

MediCore uses **SQL Server** (schema `hms`), not MongoDB. All changes below are **additive SQL migrations** (`015_…`, `016_…`): new tables and nullable columns only, no renames, no drops, existing rows keep working. Every new hospital table follows the house rules: `TenantId` + `(TenantId, Id)` unique key + composite foreign keys + an index starting with `TenantId`. Clinical values remain **configurable data**, never hard-coded.

## 1. Existing tables — reuse or modify

| Area | Existing table(s) | Reuse? | Change |
|---|---|---|---|
| Patients | `Patients` (+ABHA, photo) | Reuse | none (age at order time computed from DOB; booking quick-register stores estimated DOB) |
| Tests | `LabTests` | Reuse | add `DepartmentId`, `Method`, `Instrument`, `Interpretation`, `InputType`, `Decimals`, `CriticalLow`, `CriticalHigh`, `TatHours`, `ReportFormat`, `IsOutsourced`, `SortOrder`; keep `Department` text for back-compat |
| Parameters | `LabTestParameters` | Reuse | add `InputType`, `Options`, `Decimals`, `Formula`, `IsCalculated`, `CriticalLow`, `CriticalHigh`, `IsHeading` |
| Ranges | *(only RefLow/RefHigh columns)* | — | **new** `LabReferenceRanges` |
| Departments | *(text only)* | — | **new** `LabDepartments` |
| Packages | `LabPackages`, `LabPackageTests` | Reuse | none |
| Orders | `LabOrders` | Reuse | add `ReportStatus` (`draft/partial/final/amended`), `ApprovedAt`, `DeliveryBlockedReason` |
| Order items | `LabOrderItems` | Reuse | add `ItemStatus` (`pending/entered/reviewed/approved/cancelled`), `ReviewedBy/At`, `ApprovedBy/At`, `Comment`, `CriticalNotifiedAt`, `CriticalAckBy/At`, `PrevValue`, `RangeId`; widen `Flag` CHECK to add `critical_low`, `critical_high` |
| Parameter results | `LabResultValues` | Reuse | add `IsCalculated`, `CriticalLow/High` snapshot, `PrevValue`; widen `Flag` CHECK |
| Samples / barcode | `LabSamples` | Reuse | add `Container` (tube colour/type); barcode = `SampleNumber` (already unique) |
| Billing / payments | `Bills`, `BillItems`, bill `Payments`, `PatientDeposits` | Reuse | payment method CHECK: add `insurance`; add `TpaName`, `ClaimNumber` on payment |
| Report links | `ReportShares` | Reuse | add `Channel`, `MessageLogId` |
| Delivery | `MessageLog` | Reuse | link via `RelatedType='lab_order'` (already supported) |
| Report revisions | — | — | **new** `LabReportRevisions` |
| Signatories | `StaffMembers` / `Users` | Reuse | **new** `LabSignatories` (signature image → `Attachments`) |
| Report design | `TenantSettings` | Reuse | keys `labreport.*` (letterhead attachment id, margins, font size, show flags) |
| Referral | `ReferralDoctors` | Reuse | **new** `ReferralPayouts`; optional `ReferralPortalTokens` |
| Outsourcing | — | — | **new** `OutsourceLabs`; `LabOrderItems.OutsourceLabId`, `OutsourceCost` |
| Audit | `AuditLogs` | Reuse | metadata carries old/new values (sanitiser already strips secrets) |
| Notifications | `Notifications` | Reuse | type `lab_critical` |
| Inventory | `Medicines`, `StockBatches`, `StockMovements` | Reuse | add `ItemKind` (`medicine/reagent/consumable`); **new** `LabTestConsumables` (P3) |

## 2. Proposed SQL (migration 015 — lab reporting engine, sketch)

```sql
/* 015 — Lab reporting engine: departments, age/gender ranges, critical values, formulas, per-test approval,
   signatories, report revisions. Additive only. */

CREATE TABLE hms.LabDepartments (
    LabDepartmentId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_LabDepartments PRIMARY KEY,
    TenantId   INT NOT NULL CONSTRAINT FK_LabDepartments_Tenants REFERENCES hms.Tenants(TenantId),
    Name       NVARCHAR(80) NOT NULL,
    SortOrder  SMALLINT NOT NULL CONSTRAINT DF_LabDepartments_Sort DEFAULT (0),
    IsActive   BIT NOT NULL CONSTRAINT DF_LabDepartments_Active DEFAULT (1),
    CONSTRAINT UQ_LabDepartments_Tenant_Id UNIQUE (TenantId, LabDepartmentId),
    CONSTRAINT UQ_LabDepartments_Name UNIQUE (TenantId, Name)
);
-- back-fill: one row per distinct LabTests.Department / LabPackages.Department per tenant, then set DepartmentId

ALTER TABLE hms.LabTests ADD
    DepartmentId INT NULL, Method NVARCHAR(150) NULL, Instrument NVARCHAR(150) NULL, Interpretation NVARCHAR(MAX) NULL,
    InputType NVARCHAR(10) NOT NULL CONSTRAINT DF_LabTests_Input DEFAULT ('numeric'),   -- numeric|text|option|narrative
    Options NVARCHAR(500) NULL, Decimals TINYINT NULL, CriticalLow DECIMAL(12,4) NULL, CriticalHigh DECIMAL(12,4) NULL,
    TatHours SMALLINT NULL, IsOutsourced BIT NOT NULL CONSTRAINT DF_LabTests_Outsourced DEFAULT (0), SortOrder SMALLINT NULL;
-- FK (TenantId, DepartmentId) → LabDepartments

ALTER TABLE hms.LabTestParameters ADD
    InputType NVARCHAR(10) NOT NULL CONSTRAINT DF_LabTestParameters_Input DEFAULT ('numeric'), Options NVARCHAR(500) NULL,
    Decimals TINYINT NULL, Formula NVARCHAR(400) NULL, CriticalLow DECIMAL(12,4) NULL, CriticalHigh DECIMAL(12,4) NULL,
    IsHeading BIT NOT NULL CONSTRAINT DF_LabTestParameters_Heading DEFAULT (0);

/* One row per range; the most specific matching row wins (gender match > any, narrower age band > wider). */
CREATE TABLE hms.LabReferenceRanges (
    RangeId      INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_LabReferenceRanges PRIMARY KEY,
    TenantId     INT NOT NULL,
    LabTestId    INT NOT NULL,
    ParameterId  INT NULL,                       -- NULL = the test itself
    Gender       NVARCHAR(6) NOT NULL CONSTRAINT DF_LabReferenceRanges_Gender DEFAULT ('any'),   -- any|male|female
    AgeFromDays  INT NOT NULL CONSTRAINT DF_LabReferenceRanges_From DEFAULT (0),
    AgeToDays    INT NOT NULL CONSTRAINT DF_LabReferenceRanges_To DEFAULT (54750),  -- 150 years
    RefLow DECIMAL(12,4) NULL, RefHigh DECIMAL(12,4) NULL, RefText NVARCHAR(100) NULL,
    CriticalLow DECIMAL(12,4) NULL, CriticalHigh DECIMAL(12,4) NULL,
    CONSTRAINT UQ_LabReferenceRanges_Tenant_Id UNIQUE (TenantId, RangeId),
    CONSTRAINT FK_LabReferenceRanges_Test FOREIGN KEY (TenantId, LabTestId) REFERENCES hms.LabTests (TenantId, LabTestId),
    CONSTRAINT FK_LabReferenceRanges_Param FOREIGN KEY (TenantId, ParameterId) REFERENCES hms.LabTestParameters (TenantId, ParameterId),
    CONSTRAINT CK_LabReferenceRanges_Age CHECK (AgeToDays > AgeFromDays),
    CONSTRAINT CK_LabReferenceRanges_Gender CHECK (Gender IN ('any','male','female'))
);
CREATE INDEX IX_LabReferenceRanges_Test ON hms.LabReferenceRanges (TenantId, LabTestId, ParameterId);

ALTER TABLE hms.LabOrderItems ADD
    ItemStatus NVARCHAR(10) NOT NULL CONSTRAINT DF_LabOrderItems_Status DEFAULT ('pending'),
    ReviewedByUserId BIGINT NULL, ReviewedAt DATETIME2(3) NULL, ApprovedByUserId BIGINT NULL, ApprovedAt DATETIME2(3) NULL,
    Comment NVARCHAR(500) NULL, PrevValue NVARCHAR(200) NULL,
    CriticalNotifiedAt DATETIME2(3) NULL, CriticalAckByUserId BIGINT NULL, CriticalAckAt DATETIME2(3) NULL;
-- back-fill: verified orders → 'approved', items with a result → 'entered', others 'pending'
-- replace CK_LabOrderItems_Flag / CK_LabResultValues_Flag to allow 'critical_low','critical_high'

CREATE TABLE hms.LabSignatories (
    SignatoryId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_LabSignatories PRIMARY KEY,
    TenantId INT NOT NULL, UserId BIGINT NOT NULL, DisplayName NVARCHAR(150) NOT NULL,
    Qualification NVARCHAR(150) NULL, RegistrationNo NVARCHAR(60) NULL, Role NVARCHAR(12) NOT NULL,   -- technician|pathologist
    SignatureAttachmentId BIGINT NULL, LabDepartmentId INT NULL, IsActive BIT NOT NULL CONSTRAINT DF_LabSignatories_Active DEFAULT (1),
    CONSTRAINT UQ_LabSignatories_Tenant_Id UNIQUE (TenantId, SignatoryId),
    CONSTRAINT FK_LabSignatories_User FOREIGN KEY (TenantId, UserId) REFERENCES hms.Users (TenantId, UserId),
    CONSTRAINT FK_LabSignatories_Signature FOREIGN KEY (TenantId, SignatureAttachmentId) REFERENCES hms.Attachments (TenantId, AttachmentId)
);

CREATE TABLE hms.LabReportRevisions (           -- every amendment after approval keeps the previous values
    RevisionId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_LabReportRevisions PRIMARY KEY,
    TenantId INT NOT NULL, LabOrderId BIGINT NOT NULL, Version INT NOT NULL,
    Reason NVARCHAR(300) NOT NULL, Snapshot NVARCHAR(MAX) NOT NULL,   -- JSON of items + values before the change
    CreatedByUserId BIGINT NOT NULL, CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_LabReportRevisions_At DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_LabReportRevisions UNIQUE (TenantId, LabOrderId, Version),
    CONSTRAINT FK_LabReportRevisions_Order FOREIGN KEY (TenantId, LabOrderId) REFERENCES hms.LabOrders (TenantId, LabOrderId)
);
```

Later migrations (sketch): `016` — `OutsourceLabs`, item outsource columns, payment `insurance` + TPA fields, `ReportShares.Channel`; `017` — `ReferralPayouts`, optional `ReferralPortalTokens`; `018` — inventory `ItemKind` + `LabTestConsumables`.

## 3. Rules for the new data
- **Formulas** are stored as text like `({HCT} * 10) / {RBC}` referencing parameter codes and evaluated by a small **whitelisted parser** (numbers, + − × ÷, parentheses, `min/max/round/pow/ln`, patient `age`, `isFemale`) — never `eval`. Results are marked *calculated* and recomputed when inputs change.
- **Range selection** happens when results are entered, using the patient's age on the sample date and gender; the chosen range is **snapshotted** on the item so old reports never change.
- **Critical value** → item flagged, in-app notification to `lab.verify` users, must be acknowledged (who/when) before approval.
- **Approval**: report becomes *final* only when every non-cancelled item is `approved`; amendment creates a revision row and sets report status `amended`.
- **Seed library** (CBC, LFT, KFT, lipid, thyroid…): shipped as an optional, editable import marked *"to be validated by your pathologist before use"*.

## 4. Indexes
`LabReferenceRanges (TenantId, LabTestId, ParameterId)` · `LabOrderItems (TenantId, ItemStatus) INCLUDE (LabOrderId)` for worklists · `LabOrderItems (TenantId, CriticalAckAt) WHERE Flag LIKE 'critical%'` · `LabReportRevisions (TenantId, LabOrderId)`.

## 5. Security & compatibility
- Same tenancy guard test covers every new query; composite FKs make cross-hospital links impossible at the database level.
- Signature images stored as `Attachments` (magic-byte checked, served only to signed-in staff; embedded into the PDF server-side).
- Backups: new tables are exported automatically; `Snapshot` JSON contains clinical data of the same hospital only.
- Nothing existing is renamed or dropped; screens keep working until the new UI ships.
