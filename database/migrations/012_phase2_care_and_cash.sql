/* 012 — Phase 2: prescription templates, vitals charting, nursing notes, service-charge catalogue and daily bed
   charges, structured discharge summaries, patient advance deposits, UPI payment links and cash closing.
   Same multi-tenant rules as every other table: TenantId on every row, (TenantId, Id) unique keys and composite
   foreign keys, so nothing can point at another hospital's data. Schema: hms. */

/* ───────── OPD: prescription templates ("sets") ───────── */
CREATE TABLE hms.PrescriptionTemplates (
    TemplateId      INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PrescriptionTemplates PRIMARY KEY,
    TenantId        INT NOT NULL CONSTRAINT FK_PrescriptionTemplates_Tenants REFERENCES hms.Tenants(TenantId),
    Name            NVARCHAR(100) NOT NULL,
    DoctorId        BIGINT NULL,                 -- NULL = shared with every doctor of the hospital
    Diagnosis       NVARCHAR(1000) NULL,
    Advice          NVARCHAR(2000) NULL,
    IsActive        BIT NOT NULL CONSTRAINT DF_PrescriptionTemplates_Active DEFAULT (1),
    CreatedByUserId BIGINT NULL,
    CreatedAt       DATETIME2(3) NOT NULL CONSTRAINT DF_PrescriptionTemplates_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt       DATETIME2(3) NOT NULL CONSTRAINT DF_PrescriptionTemplates_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_PrescriptionTemplates_Tenant_Id UNIQUE (TenantId, TemplateId),
    CONSTRAINT FK_PrescriptionTemplates_Doctors FOREIGN KEY (TenantId, DoctorId) REFERENCES hms.StaffMembers (TenantId, StaffId)
);
CREATE UNIQUE INDEX UX_PrescriptionTemplates_Name ON hms.PrescriptionTemplates (TenantId, Name, DoctorId);

CREATE TABLE hms.PrescriptionTemplateItems (
    TemplateItemId  INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PrescriptionTemplateItems PRIMARY KEY,
    TenantId        INT NOT NULL,
    TemplateId      INT NOT NULL,
    MedicineName    NVARCHAR(200) NOT NULL,
    Dosage          NVARCHAR(100) NULL,
    Frequency       NVARCHAR(100) NULL,
    DurationDays    SMALLINT NULL,
    Instructions    NVARCHAR(300) NULL,
    SortOrder       SMALLINT NOT NULL CONSTRAINT DF_PrescriptionTemplateItems_Sort DEFAULT (0),
    CONSTRAINT FK_PrescriptionTemplateItems_Templates FOREIGN KEY (TenantId, TemplateId) REFERENCES hms.PrescriptionTemplates (TenantId, TemplateId) ON DELETE CASCADE,
    CONSTRAINT CK_PrescriptionTemplateItems_Duration CHECK (DurationDays IS NULL OR DurationDays BETWEEN 1 AND 3650)
);
CREATE INDEX IX_PrescriptionTemplateItems ON hms.PrescriptionTemplateItems (TenantId, TemplateId);

/* ───────── Vitals chart (IPD rounds, OPD triage) ───────── */
CREATE TABLE hms.PatientVitals (
    VitalId          BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PatientVitals PRIMARY KEY,
    TenantId         INT NOT NULL CONSTRAINT FK_PatientVitals_Tenants REFERENCES hms.Tenants(TenantId),
    PatientId        BIGINT NOT NULL,
    AdmissionId      BIGINT NULL,
    RecordedAt       DATETIME2(3) NOT NULL,
    TemperatureC     DECIMAL(4,1) NULL,
    PulseBpm         SMALLINT NULL,
    BpSystolic       SMALLINT NULL,
    BpDiastolic      SMALLINT NULL,
    RespiratoryRate  SMALLINT NULL,
    SpO2             SMALLINT NULL,
    BloodSugarMgdl   SMALLINT NULL,
    PainScore        TINYINT NULL,
    WeightKg         DECIMAL(5,1) NULL,
    Notes            NVARCHAR(500) NULL,
    RecordedByUserId BIGINT NULL,
    CreatedAt        DATETIME2(3) NOT NULL CONSTRAINT DF_PatientVitals_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT FK_PatientVitals_Patients FOREIGN KEY (TenantId, PatientId) REFERENCES hms.Patients (TenantId, PatientId),
    CONSTRAINT FK_PatientVitals_Admissions FOREIGN KEY (TenantId, AdmissionId) REFERENCES hms.Admissions (TenantId, AdmissionId),
    CONSTRAINT CK_PatientVitals_Pain CHECK (PainScore IS NULL OR PainScore BETWEEN 0 AND 10)
);
CREATE INDEX IX_PatientVitals_Patient ON hms.PatientVitals (TenantId, PatientId, RecordedAt DESC);
CREATE INDEX IX_PatientVitals_Admission ON hms.PatientVitals (TenantId, AdmissionId, RecordedAt DESC);

/* ───────── Nursing notes (append-only; a correction is a new note pointing at the old one) ───────── */
CREATE TABLE hms.NursingNotes (
    NoteId           BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_NursingNotes PRIMARY KEY,
    TenantId         INT NOT NULL CONSTRAINT FK_NursingNotes_Tenants REFERENCES hms.Tenants(TenantId),
    AdmissionId      BIGINT NOT NULL,
    Category         NVARCHAR(20) NOT NULL,
    Note             NVARCHAR(2000) NOT NULL,
    MedicineName     NVARCHAR(200) NULL,
    Dose             NVARCHAR(100) NULL,
    Route            NVARCHAR(30) NULL,
    IntakeMl         INT NULL,
    OutputMl         INT NULL,
    CorrectsNoteId   BIGINT NULL,
    RecordedByUserId BIGINT NULL,
    RecordedAt       DATETIME2(3) NOT NULL CONSTRAINT DF_NursingNotes_At DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_NursingNotes_Tenant_Id UNIQUE (TenantId, NoteId),
    CONSTRAINT FK_NursingNotes_Admissions FOREIGN KEY (TenantId, AdmissionId) REFERENCES hms.Admissions (TenantId, AdmissionId),
    CONSTRAINT FK_NursingNotes_Corrects FOREIGN KEY (TenantId, CorrectsNoteId) REFERENCES hms.NursingNotes (TenantId, NoteId),
    CONSTRAINT CK_NursingNotes_Category CHECK (Category IN ('note', 'medication', 'intake_output', 'procedure', 'handover')),
    CONSTRAINT CK_NursingNotes_IO CHECK ((IntakeMl IS NULL OR IntakeMl BETWEEN 0 AND 20000) AND (OutputMl IS NULL OR OutputMl BETWEEN 0 AND 20000))
);
CREATE INDEX IX_NursingNotes_Admission ON hms.NursingNotes (TenantId, AdmissionId, RecordedAt DESC);

/* ───────── Service-charge catalogue (procedures, doctor visits, nursing, consumables) ───────── */
CREATE TABLE hms.ServiceCharges (
    ChargeId        INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ServiceCharges PRIMARY KEY,
    TenantId        INT NOT NULL CONSTRAINT FK_ServiceCharges_Tenants REFERENCES hms.Tenants(TenantId),
    Name            NVARCHAR(150) NOT NULL,
    Category        NVARCHAR(20) NOT NULL,
    Price           DECIMAL(12,2) NOT NULL,
    TaxRatePercent  DECIMAL(5,2) NOT NULL CONSTRAINT DF_ServiceCharges_Tax DEFAULT (0),
    IsActive        BIT NOT NULL CONSTRAINT DF_ServiceCharges_Active DEFAULT (1),
    CreatedAt       DATETIME2(3) NOT NULL CONSTRAINT DF_ServiceCharges_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_ServiceCharges_Tenant_Id UNIQUE (TenantId, ChargeId),
    CONSTRAINT UQ_ServiceCharges_Tenant_Name UNIQUE (TenantId, Name),
    CONSTRAINT CK_ServiceCharges_Category CHECK (Category IN ('procedure', 'doctor_visit', 'nursing', 'consumable', 'other')),
    CONSTRAINT CK_ServiceCharges_Values CHECK (Price >= 0 AND TaxRatePercent BETWEEN 0 AND 28)
);

/* Daily bed charges: one bill line per admission per calendar day — the database refuses a second one. */
ALTER TABLE hms.BillItems ADD ChargeDate DATE NULL;
GO
CREATE UNIQUE INDEX UX_BillItems_BedDay ON hms.BillItems (TenantId, ReferenceId, ChargeDate) WHERE ReferenceType = 'bed_day';

/* ───────── Structured discharge summary ───────── */
CREATE TABLE hms.DischargeSummaries (
    TenantId              INT NOT NULL,
    AdmissionId           BIGINT NOT NULL,
    Status                NVARCHAR(10) NOT NULL CONSTRAINT DF_DischargeSummaries_Status DEFAULT ('draft'),
    Version               INT NOT NULL CONSTRAINT DF_DischargeSummaries_Version DEFAULT (1),
    ProvisionalDiagnosis  NVARCHAR(1000) NULL,
    FinalDiagnosis        NVARCHAR(1000) NULL,
    PresentingComplaints  NVARCHAR(2000) NULL,
    CourseInHospital      NVARCHAR(4000) NULL,
    ProceduresDone        NVARCHAR(2000) NULL,
    Investigations        NVARCHAR(2000) NULL,
    ConditionAtDischarge  NVARCHAR(500) NULL,
    DischargeMedications  NVARCHAR(MAX) NULL,    -- JSON array: [{ medicineName, dosage, frequency, durationDays, instructions }]
    Advice                NVARCHAR(2000) NULL,
    FollowUpDate          DATE NULL,
    DischargeType         NVARCHAR(20) NOT NULL CONSTRAINT DF_DischargeSummaries_Type DEFAULT ('regular'),
    UpdatedByUserId       BIGINT NULL,
    UpdatedAt             DATETIME2(3) NOT NULL CONSTRAINT DF_DischargeSummaries_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    FinalizedByUserId     BIGINT NULL,
    FinalizedAt           DATETIME2(3) NULL,
    CONSTRAINT PK_DischargeSummaries PRIMARY KEY (TenantId, AdmissionId),
    CONSTRAINT FK_DischargeSummaries_Admissions FOREIGN KEY (TenantId, AdmissionId) REFERENCES hms.Admissions (TenantId, AdmissionId),
    CONSTRAINT CK_DischargeSummaries_Status CHECK (Status IN ('draft', 'final')),
    CONSTRAINT CK_DischargeSummaries_Type CHECK (DischargeType IN ('regular', 'lama', 'referred', 'death', 'absconded'))
);

/* ───────── Patient advance / deposit ledger ───────── */
ALTER TABLE hms.BillPayments DROP CONSTRAINT CK_BillPayments_Method;
ALTER TABLE hms.BillPayments ADD CONSTRAINT CK_BillPayments_Method CHECK (Method IN ('cash', 'card', 'upi', 'bank', 'other', 'deposit'));

CREATE TABLE hms.PatientDeposits (
    DepositId        BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PatientDeposits PRIMARY KEY,
    TenantId         INT NOT NULL CONSTRAINT FK_PatientDeposits_Tenants REFERENCES hms.Tenants(TenantId),
    PatientId        BIGINT NOT NULL,
    AdmissionId      BIGINT NULL,
    Kind             NVARCHAR(10) NOT NULL,      -- deposit (money in) | applied (used on a bill) | refund (money back)
    Amount           DECIMAL(12,2) NOT NULL,
    Method           NVARCHAR(10) NULL,          -- for deposit / refund
    Reference        NVARCHAR(100) NULL,
    ReceiptNumber    NVARCHAR(30) NOT NULL,
    BillId           BIGINT NULL,
    Reason           NVARCHAR(300) NULL,
    CreatedByUserId  BIGINT NULL,
    CreatedAt        DATETIME2(3) NOT NULL CONSTRAINT DF_PatientDeposits_At DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_PatientDeposits_Receipt UNIQUE (TenantId, ReceiptNumber),
    CONSTRAINT FK_PatientDeposits_Patients FOREIGN KEY (TenantId, PatientId) REFERENCES hms.Patients (TenantId, PatientId),
    CONSTRAINT FK_PatientDeposits_Admissions FOREIGN KEY (TenantId, AdmissionId) REFERENCES hms.Admissions (TenantId, AdmissionId),
    CONSTRAINT FK_PatientDeposits_Bills FOREIGN KEY (TenantId, BillId) REFERENCES hms.Bills (TenantId, BillId),
    CONSTRAINT CK_PatientDeposits_Kind CHECK (Kind IN ('deposit', 'applied', 'refund')),
    CONSTRAINT CK_PatientDeposits_Amount CHECK (Amount > 0),
    CONSTRAINT CK_PatientDeposits_Method CHECK (Method IS NULL OR Method IN ('cash', 'card', 'upi', 'bank', 'other')),
    CONSTRAINT CK_PatientDeposits_Applied CHECK ((Kind = 'applied' AND BillId IS NOT NULL) OR (Kind <> 'applied' AND Method IS NOT NULL))
);
CREATE INDEX IX_PatientDeposits_Patient ON hms.PatientDeposits (TenantId, PatientId, CreatedAt);
CREATE INDEX IX_PatientDeposits_At ON hms.PatientDeposits (TenantId, CreatedAt DESC) INCLUDE (Kind, Amount, Method, CreatedByUserId);

/* ───────── UPI payment links for bills (token stored as a hash; nothing about the patient is in the link) ───────── */
CREATE TABLE hms.BillPaymentLinks (
    LinkId          BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_BillPaymentLinks PRIMARY KEY,
    TenantId        INT NOT NULL CONSTRAINT FK_BillPaymentLinks_Tenants REFERENCES hms.Tenants(TenantId),
    BillId          BIGINT NOT NULL,
    TokenHash       CHAR(64) NOT NULL CONSTRAINT UQ_BillPaymentLinks_Token UNIQUE,
    Channel         NVARCHAR(10) NULL,
    ExpiresAt       DATETIME2(3) NOT NULL,
    RevokedAt       DATETIME2(3) NULL,
    ViewCount       INT NOT NULL CONSTRAINT DF_BillPaymentLinks_Views DEFAULT (0),
    LastViewedAt    DATETIME2(3) NULL,
    CreatedByUserId BIGINT NULL,
    CreatedAt       DATETIME2(3) NOT NULL CONSTRAINT DF_BillPaymentLinks_At DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT FK_BillPaymentLinks_Bills FOREIGN KEY (TenantId, BillId) REFERENCES hms.Bills (TenantId, BillId)
);
CREATE INDEX IX_BillPaymentLinks_Bill ON hms.BillPaymentLinks (TenantId, BillId);

/* ───────── Cash closing (end of shift / day) ───────── */
CREATE TABLE hms.CashClosings (
    ClosingId       BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CashClosings PRIMARY KEY,
    TenantId        INT NOT NULL CONSTRAINT FK_CashClosings_Tenants REFERENCES hms.Tenants(TenantId),
    ClosingNumber   NVARCHAR(30) NOT NULL,
    UserId          BIGINT NOT NULL,
    PeriodStart     DATETIME2(3) NOT NULL,
    PeriodEnd       DATETIME2(3) NOT NULL,
    OpeningFloat    DECIMAL(12,2) NOT NULL CONSTRAINT DF_CashClosings_Float DEFAULT (0),
    ExpectedCash    DECIMAL(12,2) NOT NULL,
    CountedCash     DECIMAL(12,2) NOT NULL,
    Difference      DECIMAL(12,2) NOT NULL,
    Denominations   NVARCHAR(1000) NULL,         -- JSON { "500": 4, "200": 2, … }
    TotalsJson      NVARCHAR(2000) NOT NULL,     -- per-method collections in the period
    Notes           NVARCHAR(500) NULL,
    ClosedAt        DATETIME2(3) NOT NULL CONSTRAINT DF_CashClosings_At DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_CashClosings_Tenant_Number UNIQUE (TenantId, ClosingNumber),
    CONSTRAINT FK_CashClosings_Users FOREIGN KEY (TenantId, UserId) REFERENCES hms.Users (TenantId, UserId),
    CONSTRAINT CK_CashClosings_Period CHECK (PeriodEnd > PeriodStart),
    CONSTRAINT CK_CashClosings_Money CHECK (CountedCash >= 0 AND OpeningFloat >= 0)
);
CREATE INDEX IX_CashClosings_User ON hms.CashClosings (TenantId, UserId, PeriodEnd DESC);
GO

/* Money actually received or paid back, for dashboards, reports and analytics:
   bill payments/refunds (except payments made FROM a deposit — that money was already counted when the deposit was
   taken) + deposits taken + deposits refunded. Same columns as BillPayments so reports can use either. */
CREATE VIEW hms.MoneyReceived AS
SELECT TenantId, ReceivedAt, Kind, Amount, Method, ReceivedByUserId, N'bill' AS Source
FROM hms.BillPayments WHERE Method <> 'deposit'
UNION ALL
SELECT TenantId, CreatedAt AS ReceivedAt, CASE WHEN Kind = 'deposit' THEN N'payment' ELSE N'refund' END AS Kind, Amount, Method, CreatedByUserId AS ReceivedByUserId, N'deposit' AS Source
FROM hms.PatientDeposits WHERE Kind IN ('deposit', 'refund');
