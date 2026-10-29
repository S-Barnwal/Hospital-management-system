/* =====================================================================
   004_clinical_modules.sql — OPD, IPD (wards/beds/admissions), Billing,
   Laboratory, Pharmacy & Inventory. Schema: hms.
   Every table carries TenantId; children reference parents through
   composite (TenantId, Id) foreign keys so cross-hospital links are
   impossible at the database level.
   ===================================================================== */

/* ───────────────────────── OPD / consultations ───────────────────────── */
CREATE TABLE hms.Consultations (
    ConsultationId  BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Consultations PRIMARY KEY,
    TenantId        INT NOT NULL CONSTRAINT FK_Consultations_Tenants REFERENCES hms.Tenants(TenantId),
    ConsultationNumber NVARCHAR(30) NOT NULL,
    PatientId       BIGINT NOT NULL,
    DoctorId        BIGINT NOT NULL,
    AppointmentId   BIGINT NULL,
    Status          NVARCHAR(10) NOT NULL CONSTRAINT DF_Consultations_Status DEFAULT ('draft'),
    Version         INT NOT NULL CONSTRAINT DF_Consultations_Version DEFAULT (1),
    ChiefComplaint  NVARCHAR(500) NULL,
    Symptoms        NVARCHAR(2000) NULL,
    TemperatureC    DECIMAL(4,1) NULL,
    PulseBpm        SMALLINT NULL,
    BpSystolic      SMALLINT NULL,
    BpDiastolic     SMALLINT NULL,
    RespiratoryRate SMALLINT NULL,
    SpO2            SMALLINT NULL,
    WeightKg        DECIMAL(5,1) NULL,
    HeightCm        DECIMAL(5,1) NULL,
    Examination     NVARCHAR(2000) NULL,
    Diagnosis       NVARCHAR(1000) NULL,
    Advice          NVARCHAR(2000) NULL,
    FollowUpDate    DATE NULL,
    CreatedByUserId BIGINT NULL,
    CreatedAt       DATETIME2(3) NOT NULL CONSTRAINT DF_Consultations_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt       DATETIME2(3) NOT NULL CONSTRAINT DF_Consultations_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    FinalizedAt     DATETIME2(3) NULL,
    CONSTRAINT UQ_Consultations_Tenant_Id UNIQUE (TenantId, ConsultationId),
    CONSTRAINT UQ_Consultations_Tenant_Number UNIQUE (TenantId, ConsultationNumber),
    CONSTRAINT FK_Consultations_Patients FOREIGN KEY (TenantId, PatientId) REFERENCES hms.Patients (TenantId, PatientId),
    CONSTRAINT FK_Consultations_Doctors FOREIGN KEY (TenantId, DoctorId) REFERENCES hms.StaffMembers (TenantId, StaffId),
    CONSTRAINT FK_Consultations_Appointments FOREIGN KEY (TenantId, AppointmentId) REFERENCES hms.Appointments (TenantId, AppointmentId),
    CONSTRAINT CK_Consultations_Status CHECK (Status IN ('draft','final'))
);
CREATE INDEX IX_Consultations_Tenant_Created ON hms.Consultations (TenantId, CreatedAt DESC);
CREATE INDEX IX_Consultations_Patient ON hms.Consultations (TenantId, PatientId, CreatedAt DESC);

/* Every save keeps the previous version — clinical records are never silently overwritten. */
CREATE TABLE hms.ConsultationVersions (
    ConsultationVersionId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ConsultationVersions PRIMARY KEY,
    TenantId        INT NOT NULL,
    ConsultationId  BIGINT NOT NULL,
    Version         INT NOT NULL,
    Snapshot        NVARCHAR(MAX) NOT NULL,
    ChangedByUserId BIGINT NULL,
    ChangedAt       DATETIME2(3) NOT NULL CONSTRAINT DF_ConsultationVersions_ChangedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT FK_ConsultationVersions_Consultations FOREIGN KEY (TenantId, ConsultationId) REFERENCES hms.Consultations (TenantId, ConsultationId),
    CONSTRAINT UQ_ConsultationVersions UNIQUE (TenantId, ConsultationId, Version)
);

CREATE TABLE hms.PrescriptionItems (
    PrescriptionItemId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PrescriptionItems PRIMARY KEY,
    TenantId        INT NOT NULL,
    ConsultationId  BIGINT NOT NULL,
    MedicineName    NVARCHAR(200) NOT NULL,
    Dosage          NVARCHAR(100) NULL,
    Frequency       NVARCHAR(100) NULL,
    DurationDays    SMALLINT NULL,
    Instructions    NVARCHAR(300) NULL,
    SortOrder       SMALLINT NOT NULL CONSTRAINT DF_PrescriptionItems_Sort DEFAULT (0),
    CONSTRAINT FK_PrescriptionItems_Consultations FOREIGN KEY (TenantId, ConsultationId) REFERENCES hms.Consultations (TenantId, ConsultationId) ON DELETE CASCADE,
    CONSTRAINT CK_PrescriptionItems_Duration CHECK (DurationDays IS NULL OR DurationDays BETWEEN 1 AND 3650)
);
CREATE INDEX IX_PrescriptionItems_Consultation ON hms.PrescriptionItems (TenantId, ConsultationId);

/* ───────────────────────── IPD: wards, beds, admissions ───────────────────────── */
CREATE TABLE hms.Wards (
    WardId      INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Wards PRIMARY KEY,
    TenantId    INT NOT NULL CONSTRAINT FK_Wards_Tenants REFERENCES hms.Tenants(TenantId),
    Name        NVARCHAR(100) NOT NULL,
    WardType    NVARCHAR(30) NOT NULL CONSTRAINT DF_Wards_Type DEFAULT ('general'),
    DailyRate   DECIMAL(12,2) NOT NULL CONSTRAINT DF_Wards_Rate DEFAULT (0),
    IsActive    BIT NOT NULL CONSTRAINT DF_Wards_Active DEFAULT (1),
    CreatedAt   DATETIME2(3) NOT NULL CONSTRAINT DF_Wards_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_Wards_Tenant_Id UNIQUE (TenantId, WardId),
    CONSTRAINT UQ_Wards_Tenant_Name UNIQUE (TenantId, Name),
    CONSTRAINT CK_Wards_Type CHECK (WardType IN ('general','semi_private','private','icu','nicu','emergency','other')),
    CONSTRAINT CK_Wards_Rate CHECK (DailyRate >= 0)
);

CREATE TABLE hms.Beds (
    BedId       INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Beds PRIMARY KEY,
    TenantId    INT NOT NULL,
    WardId      INT NOT NULL,
    BedNumber   NVARCHAR(20) NOT NULL,
    Status      NVARCHAR(15) NOT NULL CONSTRAINT DF_Beds_Status DEFAULT ('available'),
    CONSTRAINT UQ_Beds_Tenant_Id UNIQUE (TenantId, BedId),
    CONSTRAINT UQ_Beds_Ward_Number UNIQUE (TenantId, WardId, BedNumber),
    CONSTRAINT FK_Beds_Wards FOREIGN KEY (TenantId, WardId) REFERENCES hms.Wards (TenantId, WardId),
    CONSTRAINT CK_Beds_Status CHECK (Status IN ('available','occupied','maintenance'))
);

CREATE TABLE hms.Admissions (
    AdmissionId       BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Admissions PRIMARY KEY,
    TenantId          INT NOT NULL CONSTRAINT FK_Admissions_Tenants REFERENCES hms.Tenants(TenantId),
    AdmissionNumber   NVARCHAR(30) NOT NULL,
    PatientId         BIGINT NOT NULL,
    BedId             INT NOT NULL,
    AttendingDoctorId BIGINT NULL,
    Status            NVARCHAR(12) NOT NULL CONSTRAINT DF_Admissions_Status DEFAULT ('admitted'),
    Reason            NVARCHAR(500) NULL,
    AdmittedAt        DATETIME2(3) NOT NULL CONSTRAINT DF_Admissions_AdmittedAt DEFAULT (SYSUTCDATETIME()),
    DischargedAt      DATETIME2(3) NULL,
    DischargeSummary  NVARCHAR(4000) NULL,
    CreatedByUserId   BIGINT NULL,
    CONSTRAINT UQ_Admissions_Tenant_Id UNIQUE (TenantId, AdmissionId),
    CONSTRAINT UQ_Admissions_Tenant_Number UNIQUE (TenantId, AdmissionNumber),
    CONSTRAINT FK_Admissions_Patients FOREIGN KEY (TenantId, PatientId) REFERENCES hms.Patients (TenantId, PatientId),
    CONSTRAINT FK_Admissions_Beds FOREIGN KEY (TenantId, BedId) REFERENCES hms.Beds (TenantId, BedId),
    CONSTRAINT FK_Admissions_Doctors FOREIGN KEY (TenantId, AttendingDoctorId) REFERENCES hms.StaffMembers (TenantId, StaffId),
    CONSTRAINT CK_Admissions_Status CHECK (Status IN ('admitted','discharged')),
    CONSTRAINT CK_Admissions_Discharge CHECK ((Status = 'admitted' AND DischargedAt IS NULL) OR (Status = 'discharged' AND DischargedAt IS NOT NULL))
);
/* The database itself refuses two active admissions in one bed, or one patient admitted twice. */
CREATE UNIQUE INDEX UX_Admissions_ActiveBed ON hms.Admissions (TenantId, BedId) WHERE Status = 'admitted';
CREATE UNIQUE INDEX UX_Admissions_ActivePatient ON hms.Admissions (TenantId, PatientId) WHERE Status = 'admitted';
CREATE INDEX IX_Admissions_Tenant_Admitted ON hms.Admissions (TenantId, AdmittedAt DESC) INCLUDE (Status);

CREATE TABLE hms.BedTransfers (
    BedTransferId   BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_BedTransfers PRIMARY KEY,
    TenantId        INT NOT NULL,
    AdmissionId     BIGINT NOT NULL,
    FromBedId       INT NOT NULL,
    ToBedId         INT NOT NULL,
    TransferredAt   DATETIME2(3) NOT NULL CONSTRAINT DF_BedTransfers_At DEFAULT (SYSUTCDATETIME()),
    TransferredByUserId BIGINT NULL,
    CONSTRAINT FK_BedTransfers_Admissions FOREIGN KEY (TenantId, AdmissionId) REFERENCES hms.Admissions (TenantId, AdmissionId),
    CONSTRAINT FK_BedTransfers_From FOREIGN KEY (TenantId, FromBedId) REFERENCES hms.Beds (TenantId, BedId),
    CONSTRAINT FK_BedTransfers_To FOREIGN KEY (TenantId, ToBedId) REFERENCES hms.Beds (TenantId, BedId)
);

/* ───────────────────────── Billing ───────────────────────── */
CREATE TABLE hms.Bills (
    BillId          BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Bills PRIMARY KEY,
    TenantId        INT NOT NULL CONSTRAINT FK_Bills_Tenants REFERENCES hms.Tenants(TenantId),
    BillNumber      NVARCHAR(30) NULL,            -- assigned sequentially at finalisation
    PatientId       BIGINT NOT NULL,
    AdmissionId     BIGINT NULL,
    Status          NVARCHAR(12) NOT NULL CONSTRAINT DF_Bills_Status DEFAULT ('draft'),
    Subtotal        DECIMAL(12,2) NOT NULL CONSTRAINT DF_Bills_Subtotal DEFAULT (0),
    DiscountAmount  DECIMAL(12,2) NOT NULL CONSTRAINT DF_Bills_Discount DEFAULT (0),
    TaxAmount       DECIMAL(12,2) NOT NULL CONSTRAINT DF_Bills_Tax DEFAULT (0),
    Total           DECIMAL(12,2) NOT NULL CONSTRAINT DF_Bills_Total DEFAULT (0),
    PaidAmount      DECIMAL(12,2) NOT NULL CONSTRAINT DF_Bills_Paid DEFAULT (0),
    Notes           NVARCHAR(500) NULL,
    CancelReason    NVARCHAR(300) NULL,
    CreatedByUserId BIGINT NULL,
    CreatedAt       DATETIME2(3) NOT NULL CONSTRAINT DF_Bills_CreatedAt DEFAULT (SYSUTCDATETIME()),
    FinalizedAt     DATETIME2(3) NULL,
    CancelledAt     DATETIME2(3) NULL,
    CONSTRAINT UQ_Bills_Tenant_Id UNIQUE (TenantId, BillId),
    CONSTRAINT FK_Bills_Patients FOREIGN KEY (TenantId, PatientId) REFERENCES hms.Patients (TenantId, PatientId),
    CONSTRAINT FK_Bills_Admissions FOREIGN KEY (TenantId, AdmissionId) REFERENCES hms.Admissions (TenantId, AdmissionId),
    CONSTRAINT CK_Bills_Status CHECK (Status IN ('draft','finalized','cancelled')),
    CONSTRAINT CK_Bills_Amounts CHECK (Subtotal >= 0 AND DiscountAmount >= 0 AND TaxAmount >= 0 AND Total >= 0 AND PaidAmount >= 0 AND PaidAmount <= Total AND DiscountAmount <= Subtotal),
    CONSTRAINT CK_Bills_Number CHECK (Status = 'draft' OR BillNumber IS NOT NULL OR Status = 'cancelled')
);
CREATE UNIQUE INDEX UX_Bills_Tenant_Number ON hms.Bills (TenantId, BillNumber) WHERE BillNumber IS NOT NULL;
CREATE INDEX IX_Bills_Tenant_Created ON hms.Bills (TenantId, CreatedAt DESC) INCLUDE (Status, Total, PaidAmount);
CREATE INDEX IX_Bills_Patient ON hms.Bills (TenantId, PatientId);

CREATE TABLE hms.BillItems (
    BillItemId      BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_BillItems PRIMARY KEY,
    TenantId        INT NOT NULL,
    BillId          BIGINT NOT NULL,
    ItemType        NVARCHAR(15) NOT NULL,
    Description     NVARCHAR(200) NOT NULL,
    Quantity        DECIMAL(10,2) NOT NULL,
    UnitPrice       DECIMAL(12,2) NOT NULL,
    TaxRatePercent  DECIMAL(5,2) NOT NULL CONSTRAINT DF_BillItems_Tax DEFAULT (0),
    LineSubtotal    DECIMAL(12,2) NOT NULL,
    LineTax         DECIMAL(12,2) NOT NULL,
    ReferenceType   NVARCHAR(20) NULL,      -- e.g. lab_order, stock_movement, admission
    ReferenceId     BIGINT NULL,
    CreatedAt       DATETIME2(3) NOT NULL CONSTRAINT DF_BillItems_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT FK_BillItems_Bills FOREIGN KEY (TenantId, BillId) REFERENCES hms.Bills (TenantId, BillId),
    CONSTRAINT CK_BillItems_Type CHECK (ItemType IN ('consultation','lab','pharmacy','bed','procedure','other')),
    CONSTRAINT CK_BillItems_Values CHECK (Quantity > 0 AND UnitPrice >= 0 AND TaxRatePercent BETWEEN 0 AND 100)
);
CREATE INDEX IX_BillItems_Bill ON hms.BillItems (TenantId, BillId);

/* Payments and refunds are append-only; a refund is a separate row, never an edit. */
CREATE TABLE hms.BillPayments (
    BillPaymentId   BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_BillPayments PRIMARY KEY,
    TenantId        INT NOT NULL,
    BillId          BIGINT NOT NULL,
    ReceiptNumber   NVARCHAR(30) NOT NULL,
    Kind            NVARCHAR(10) NOT NULL,
    Amount          DECIMAL(12,2) NOT NULL,
    Method          NVARCHAR(10) NOT NULL,
    Reference       NVARCHAR(100) NULL,
    Reason          NVARCHAR(300) NULL,
    ReceivedByUserId BIGINT NULL,
    ReceivedAt      DATETIME2(3) NOT NULL CONSTRAINT DF_BillPayments_At DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT FK_BillPayments_Bills FOREIGN KEY (TenantId, BillId) REFERENCES hms.Bills (TenantId, BillId),
    CONSTRAINT UQ_BillPayments_Receipt UNIQUE (TenantId, ReceiptNumber),
    CONSTRAINT CK_BillPayments_Kind CHECK (Kind IN ('payment','refund')),
    CONSTRAINT CK_BillPayments_Amount CHECK (Amount > 0),
    CONSTRAINT CK_BillPayments_Method CHECK (Method IN ('cash','card','upi','bank','other'))
);
CREATE INDEX IX_BillPayments_Tenant_At ON hms.BillPayments (TenantId, ReceivedAt DESC) INCLUDE (Kind, Amount, Method);

/* ───────────────────────── Laboratory ───────────────────────── */
CREATE TABLE hms.LabTests (
    LabTestId     INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_LabTests PRIMARY KEY,
    TenantId      INT NOT NULL CONSTRAINT FK_LabTests_Tenants REFERENCES hms.Tenants(TenantId),
    Code          NVARCHAR(20) NOT NULL,
    Name          NVARCHAR(150) NOT NULL,
    SampleType    NVARCHAR(40) NULL,
    Unit          NVARCHAR(30) NULL,
    RefLow        DECIMAL(12,4) NULL,
    RefHigh       DECIMAL(12,4) NULL,
    RefText       NVARCHAR(100) NULL,
    Price         DECIMAL(12,2) NOT NULL CONSTRAINT DF_LabTests_Price DEFAULT (0),
    IsActive      BIT NOT NULL CONSTRAINT DF_LabTests_Active DEFAULT (1),
    CONSTRAINT UQ_LabTests_Tenant_Id UNIQUE (TenantId, LabTestId),
    CONSTRAINT UQ_LabTests_Tenant_Code UNIQUE (TenantId, Code),
    CONSTRAINT CK_LabTests_Price CHECK (Price >= 0),
    CONSTRAINT CK_LabTests_Range CHECK (RefLow IS NULL OR RefHigh IS NULL OR RefHigh >= RefLow)
);

CREATE TABLE hms.LabOrders (
    LabOrderId      BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_LabOrders PRIMARY KEY,
    TenantId        INT NOT NULL CONSTRAINT FK_LabOrders_Tenants REFERENCES hms.Tenants(TenantId),
    OrderNumber     NVARCHAR(30) NOT NULL,
    PatientId       BIGINT NOT NULL,
    DoctorId        BIGINT NULL,
    ConsultationId  BIGINT NULL,
    Status          NVARCHAR(20) NOT NULL CONSTRAINT DF_LabOrders_Status DEFAULT ('ordered'),
    Priority        NVARCHAR(10) NOT NULL CONSTRAINT DF_LabOrders_Priority DEFAULT ('routine'),
    Notes           NVARCHAR(500) NULL,
    OrderedByUserId BIGINT NULL,
    OrderedAt       DATETIME2(3) NOT NULL CONSTRAINT DF_LabOrders_OrderedAt DEFAULT (SYSUTCDATETIME()),
    SampleCollectedAt DATETIME2(3) NULL,
    CompletedAt     DATETIME2(3) NULL,
    VerifiedAt      DATETIME2(3) NULL,
    VerifiedByUserId BIGINT NULL,
    CancelReason    NVARCHAR(300) NULL,
    CONSTRAINT UQ_LabOrders_Tenant_Id UNIQUE (TenantId, LabOrderId),
    CONSTRAINT UQ_LabOrders_Tenant_Number UNIQUE (TenantId, OrderNumber),
    CONSTRAINT FK_LabOrders_Patients FOREIGN KEY (TenantId, PatientId) REFERENCES hms.Patients (TenantId, PatientId),
    CONSTRAINT FK_LabOrders_Doctors FOREIGN KEY (TenantId, DoctorId) REFERENCES hms.StaffMembers (TenantId, StaffId),
    CONSTRAINT FK_LabOrders_Consultations FOREIGN KEY (TenantId, ConsultationId) REFERENCES hms.Consultations (TenantId, ConsultationId),
    CONSTRAINT CK_LabOrders_Status CHECK (Status IN ('ordered','sample_collected','completed','verified','cancelled')),
    CONSTRAINT CK_LabOrders_Priority CHECK (Priority IN ('routine','urgent'))
);
CREATE INDEX IX_LabOrders_Tenant_Ordered ON hms.LabOrders (TenantId, OrderedAt DESC) INCLUDE (Status);

CREATE TABLE hms.LabOrderItems (
    LabOrderItemId  BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_LabOrderItems PRIMARY KEY,
    TenantId        INT NOT NULL,
    LabOrderId      BIGINT NOT NULL,
    LabTestId       INT NOT NULL,
    TestName        NVARCHAR(150) NOT NULL,     -- snapshot at order time
    Unit            NVARCHAR(30) NULL,
    RefLow          DECIMAL(12,4) NULL,
    RefHigh         DECIMAL(12,4) NULL,
    RefText         NVARCHAR(100) NULL,
    Price           DECIMAL(12,2) NOT NULL,
    ResultValue     NVARCHAR(200) NULL,
    ResultNumeric   DECIMAL(12,4) NULL,
    Flag            NVARCHAR(10) NULL,
    EnteredByUserId BIGINT NULL,
    EnteredAt       DATETIME2(3) NULL,
    CONSTRAINT FK_LabOrderItems_Orders FOREIGN KEY (TenantId, LabOrderId) REFERENCES hms.LabOrders (TenantId, LabOrderId),
    CONSTRAINT FK_LabOrderItems_Tests FOREIGN KEY (TenantId, LabTestId) REFERENCES hms.LabTests (TenantId, LabTestId),
    CONSTRAINT UQ_LabOrderItems UNIQUE (TenantId, LabOrderId, LabTestId),
    CONSTRAINT CK_LabOrderItems_Flag CHECK (Flag IS NULL OR Flag IN ('normal','low','high','abnormal'))
);

/* ───────────────────────── Pharmacy & inventory ───────────────────────── */
CREATE TABLE hms.Suppliers (
    SupplierId  INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Suppliers PRIMARY KEY,
    TenantId    INT NOT NULL CONSTRAINT FK_Suppliers_Tenants REFERENCES hms.Tenants(TenantId),
    Name        NVARCHAR(150) NOT NULL,
    Phone       NVARCHAR(30) NULL,
    Gstin       NVARCHAR(20) NULL,
    IsActive    BIT NOT NULL CONSTRAINT DF_Suppliers_Active DEFAULT (1),
    CONSTRAINT UQ_Suppliers_Tenant_Id UNIQUE (TenantId, SupplierId),
    CONSTRAINT UQ_Suppliers_Tenant_Name UNIQUE (TenantId, Name)
);

CREATE TABLE hms.Medicines (
    MedicineId      INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Medicines PRIMARY KEY,
    TenantId        INT NOT NULL CONSTRAINT FK_Medicines_Tenants REFERENCES hms.Tenants(TenantId),
    Name            NVARCHAR(150) NOT NULL,
    GenericName     NVARCHAR(150) NULL,
    Form            NVARCHAR(30) NULL,
    Strength        NVARCHAR(50) NULL,
    Unit            NVARCHAR(20) NOT NULL CONSTRAINT DF_Medicines_Unit DEFAULT ('unit'),
    HsnCode         NVARCHAR(12) NULL,
    TaxRatePercent  DECIMAL(5,2) NOT NULL CONSTRAINT DF_Medicines_Tax DEFAULT (12),
    SalePrice       DECIMAL(12,2) NOT NULL CONSTRAINT DF_Medicines_Price DEFAULT (0),
    ReorderLevel    INT NOT NULL CONSTRAINT DF_Medicines_Reorder DEFAULT (10),
    IsActive        BIT NOT NULL CONSTRAINT DF_Medicines_Active DEFAULT (1),
    CreatedAt       DATETIME2(3) NOT NULL CONSTRAINT DF_Medicines_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_Medicines_Tenant_Id UNIQUE (TenantId, MedicineId),
    CONSTRAINT UQ_Medicines_Tenant_Name UNIQUE (TenantId, Name, Strength),
    CONSTRAINT CK_Medicines_Values CHECK (SalePrice >= 0 AND ReorderLevel >= 0 AND TaxRatePercent BETWEEN 0 AND 100)
);

CREATE TABLE hms.StockBatches (
    BatchId         BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_StockBatches PRIMARY KEY,
    TenantId        INT NOT NULL,
    MedicineId      INT NOT NULL,
    BatchNumber     NVARCHAR(40) NOT NULL,
    ExpiryDate      DATE NOT NULL,
    QuantityOnHand  INT NOT NULL,
    PurchasePrice   DECIMAL(12,2) NOT NULL,
    SalePrice       DECIMAL(12,2) NOT NULL,
    SupplierId      INT NULL,
    ReceivedAt      DATETIME2(3) NOT NULL CONSTRAINT DF_StockBatches_At DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_StockBatches_Tenant_Id UNIQUE (TenantId, BatchId),
    CONSTRAINT UQ_StockBatches_Number UNIQUE (TenantId, MedicineId, BatchNumber),
    CONSTRAINT FK_StockBatches_Medicines FOREIGN KEY (TenantId, MedicineId) REFERENCES hms.Medicines (TenantId, MedicineId),
    CONSTRAINT FK_StockBatches_Suppliers FOREIGN KEY (TenantId, SupplierId) REFERENCES hms.Suppliers (TenantId, SupplierId),
    CONSTRAINT CK_StockBatches_Qty CHECK (QuantityOnHand >= 0),     -- negative stock is impossible
    CONSTRAINT CK_StockBatches_Prices CHECK (PurchasePrice >= 0 AND SalePrice >= 0)
);
CREATE INDEX IX_StockBatches_Medicine ON hms.StockBatches (TenantId, MedicineId, ExpiryDate) INCLUDE (QuantityOnHand);

/* Append-only ledger: every stock change is recorded with who and why. */
CREATE TABLE hms.StockMovements (
    StockMovementId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_StockMovements PRIMARY KEY,
    TenantId        INT NOT NULL,
    MedicineId      INT NOT NULL,
    BatchId         BIGINT NOT NULL,
    Kind            NVARCHAR(10) NOT NULL,
    Quantity        INT NOT NULL,           -- signed: + in, - out
    UnitPrice       DECIMAL(12,2) NULL,
    PatientId       BIGINT NULL,
    BillId          BIGINT NULL,
    Reference       NVARCHAR(200) NULL,
    CreatedByUserId BIGINT NULL,
    CreatedAt       DATETIME2(3) NOT NULL CONSTRAINT DF_StockMovements_At DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT FK_StockMovements_Medicines FOREIGN KEY (TenantId, MedicineId) REFERENCES hms.Medicines (TenantId, MedicineId),
    CONSTRAINT FK_StockMovements_Batches FOREIGN KEY (TenantId, BatchId) REFERENCES hms.StockBatches (TenantId, BatchId),
    CONSTRAINT FK_StockMovements_Patients FOREIGN KEY (TenantId, PatientId) REFERENCES hms.Patients (TenantId, PatientId),
    CONSTRAINT FK_StockMovements_Bills FOREIGN KEY (TenantId, BillId) REFERENCES hms.Bills (TenantId, BillId),
    CONSTRAINT CK_StockMovements_Kind CHECK (Kind IN ('receive','dispense','adjust','return')),
    CONSTRAINT CK_StockMovements_Qty CHECK (Quantity <> 0)
);
CREATE INDEX IX_StockMovements_Tenant_At ON hms.StockMovements (TenantId, CreatedAt DESC);
