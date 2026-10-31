/* 013 — Phase 3: multi-parameter lab tests (panels) + result values, home sample collection, pharmacy purchase
   orders and medicine barcodes, staff attendance / leave / payroll, recurring expenses and file attachments
   (bill & expense photos, later patient documents).
   Same multi-tenant rules as everywhere: TenantId on every row, (TenantId, Id) unique keys, composite foreign keys.
   Schema: hms. */

/* ───────── Lab: parameters of a test (e.g. CBC → Hb, WBC, Platelets …) ───────── */
CREATE TABLE hms.LabTestParameters (
    ParameterId  INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_LabTestParameters PRIMARY KEY,
    TenantId     INT NOT NULL CONSTRAINT FK_LabTestParameters_Tenants REFERENCES hms.Tenants(TenantId),
    LabTestId    INT NOT NULL,
    Name         NVARCHAR(100) NOT NULL,
    Unit         NVARCHAR(30)  NULL,
    RefLow       DECIMAL(12,4) NULL,
    RefHigh      DECIMAL(12,4) NULL,
    RefText      NVARCHAR(100) NULL,
    SortOrder    SMALLINT NOT NULL CONSTRAINT DF_LabTestParameters_Sort DEFAULT (0),
    IsActive     BIT NOT NULL CONSTRAINT DF_LabTestParameters_Active DEFAULT (1),
    CONSTRAINT UQ_LabTestParameters_Tenant_Id UNIQUE (TenantId, ParameterId),
    CONSTRAINT FK_LabTestParameters_Tests FOREIGN KEY (TenantId, LabTestId) REFERENCES hms.LabTests (TenantId, LabTestId),
    CONSTRAINT CK_LabTestParameters_Range CHECK (RefLow IS NULL OR RefHigh IS NULL OR RefHigh >= RefLow)
);
CREATE INDEX IX_LabTestParameters_Test ON hms.LabTestParameters (TenantId, LabTestId, SortOrder);

ALTER TABLE hms.LabOrderItems ADD CONSTRAINT UQ_LabOrderItems_Tenant_Id UNIQUE (TenantId, LabOrderItemId);
GO

/* One row per parameter of a panel test on an order — a snapshot of name/unit/range taken when the order is placed. */
CREATE TABLE hms.LabResultValues (
    ResultValueId   BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_LabResultValues PRIMARY KEY,
    TenantId        INT NOT NULL,
    LabOrderItemId  BIGINT NOT NULL,
    ParameterId     INT NULL,
    Name            NVARCHAR(100) NOT NULL,
    Unit            NVARCHAR(30)  NULL,
    RefLow          DECIMAL(12,4) NULL,
    RefHigh         DECIMAL(12,4) NULL,
    RefText         NVARCHAR(100) NULL,
    SortOrder       SMALLINT NOT NULL CONSTRAINT DF_LabResultValues_Sort DEFAULT (0),
    ResultValue     NVARCHAR(200) NULL,
    ResultNumeric   DECIMAL(12,4) NULL,
    Flag            NVARCHAR(10) NULL,
    EnteredByUserId BIGINT NULL,
    EnteredAt       DATETIME2(3) NULL,
    CONSTRAINT UQ_LabResultValues_Tenant_Id UNIQUE (TenantId, ResultValueId),
    CONSTRAINT FK_LabResultValues_Items FOREIGN KEY (TenantId, LabOrderItemId) REFERENCES hms.LabOrderItems (TenantId, LabOrderItemId),
    CONSTRAINT CK_LabResultValues_Flag CHECK (Flag IS NULL OR Flag IN ('normal','low','high','abnormal'))
);
CREATE INDEX IX_LabResultValues_Item ON hms.LabResultValues (TenantId, LabOrderItemId, SortOrder);

/* ───────── Lab: home sample collection ───────── */
CREATE TABLE hms.LabHomeCollections (
    HomeCollectionId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_LabHomeCollections PRIMARY KEY,
    TenantId         INT NOT NULL CONSTRAINT FK_LabHomeCollections_Tenants REFERENCES hms.Tenants(TenantId),
    LabOrderId       BIGINT NOT NULL,
    Address          NVARCHAR(400) NOT NULL,
    Landmark         NVARCHAR(150) NULL,
    ContactPhone     NVARCHAR(30)  NULL,
    ScheduledAt      DATETIME2(3) NOT NULL,
    CollectorStaffId BIGINT NULL,
    Status           NVARCHAR(12) NOT NULL CONSTRAINT DF_LabHomeCollections_Status DEFAULT ('scheduled'),
    Charge           DECIMAL(12,2) NOT NULL CONSTRAINT DF_LabHomeCollections_Charge DEFAULT (0),
    Notes            NVARCHAR(300) NULL,
    CollectedAt      DATETIME2(3) NULL,
    CancelReason     NVARCHAR(300) NULL,
    CreatedAt        DATETIME2(3) NOT NULL CONSTRAINT DF_LabHomeCollections_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt        DATETIME2(3) NULL,
    CONSTRAINT UQ_LabHomeCollections_Tenant_Id UNIQUE (TenantId, HomeCollectionId),
    CONSTRAINT UQ_LabHomeCollections_Order UNIQUE (TenantId, LabOrderId),
    CONSTRAINT FK_LabHomeCollections_Orders FOREIGN KEY (TenantId, LabOrderId) REFERENCES hms.LabOrders (TenantId, LabOrderId),
    CONSTRAINT FK_LabHomeCollections_Staff FOREIGN KEY (TenantId, CollectorStaffId) REFERENCES hms.StaffMembers (TenantId, StaffId),
    CONSTRAINT CK_LabHomeCollections_Status CHECK (Status IN ('scheduled','assigned','on_the_way','collected','cancelled')),
    CONSTRAINT CK_LabHomeCollections_Charge CHECK (Charge >= 0)
);
CREATE INDEX IX_LabHomeCollections_Day ON hms.LabHomeCollections (TenantId, ScheduledAt);

/* ───────── Pharmacy: barcodes and purchase orders ───────── */
ALTER TABLE hms.Medicines ADD Barcode NVARCHAR(64) NULL;
GO
CREATE UNIQUE INDEX UX_Medicines_Barcode ON hms.Medicines (TenantId, Barcode) WHERE Barcode IS NOT NULL;

CREATE TABLE hms.PurchaseOrders (
    PurchaseOrderId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PurchaseOrders PRIMARY KEY,
    TenantId        INT NOT NULL CONSTRAINT FK_PurchaseOrders_Tenants REFERENCES hms.Tenants(TenantId),
    PoNumber        NVARCHAR(30) NOT NULL,
    SupplierId      INT NOT NULL,
    Status          NVARCHAR(20) NOT NULL CONSTRAINT DF_PurchaseOrders_Status DEFAULT ('draft'),
    OrderDate       DATE NULL,
    ExpectedDate    DATE NULL,
    Notes           NVARCHAR(500) NULL,
    TotalAmount     DECIMAL(12,2) NOT NULL CONSTRAINT DF_PurchaseOrders_Total DEFAULT (0),
    CreatedByUserId BIGINT NULL,
    CreatedAt       DATETIME2(3) NOT NULL CONSTRAINT DF_PurchaseOrders_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt       DATETIME2(3) NULL,
    CancelReason    NVARCHAR(300) NULL,
    CONSTRAINT UQ_PurchaseOrders_Tenant_Id UNIQUE (TenantId, PurchaseOrderId),
    CONSTRAINT UQ_PurchaseOrders_Tenant_Number UNIQUE (TenantId, PoNumber),
    CONSTRAINT FK_PurchaseOrders_Suppliers FOREIGN KEY (TenantId, SupplierId) REFERENCES hms.Suppliers (TenantId, SupplierId),
    CONSTRAINT CK_PurchaseOrders_Status CHECK (Status IN ('draft','ordered','partially_received','received','cancelled'))
);

CREATE TABLE hms.PurchaseOrderItems (
    PurchaseOrderItemId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PurchaseOrderItems PRIMARY KEY,
    TenantId            INT NOT NULL,
    PurchaseOrderId     INT NOT NULL,
    MedicineId          INT NOT NULL,
    Quantity            INT NOT NULL,
    ReceivedQuantity    INT NOT NULL CONSTRAINT DF_PurchaseOrderItems_Received DEFAULT (0),
    UnitCost            DECIMAL(12,2) NOT NULL,
    CONSTRAINT UQ_PurchaseOrderItems_Tenant_Id UNIQUE (TenantId, PurchaseOrderItemId),
    CONSTRAINT UQ_PurchaseOrderItems_Line UNIQUE (TenantId, PurchaseOrderId, MedicineId),
    CONSTRAINT FK_PurchaseOrderItems_Orders FOREIGN KEY (TenantId, PurchaseOrderId) REFERENCES hms.PurchaseOrders (TenantId, PurchaseOrderId) ON DELETE CASCADE,
    CONSTRAINT FK_PurchaseOrderItems_Medicines FOREIGN KEY (TenantId, MedicineId) REFERENCES hms.Medicines (TenantId, MedicineId),
    CONSTRAINT CK_PurchaseOrderItems_Qty CHECK (Quantity > 0 AND ReceivedQuantity >= 0 AND UnitCost >= 0)
);

/* ───────── HR: salary, attendance, leave, payroll ───────── */
ALTER TABLE hms.StaffMembers ADD MonthlySalary DECIMAL(12,2) NULL;
GO
ALTER TABLE hms.StaffMembers ADD CONSTRAINT CK_StaffMembers_Salary CHECK (MonthlySalary IS NULL OR MonthlySalary >= 0);

CREATE TABLE hms.StaffAttendance (
    AttendanceId    BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_StaffAttendance PRIMARY KEY,
    TenantId        INT NOT NULL,
    StaffId         BIGINT NOT NULL,
    WorkDate        DATE NOT NULL,
    Status          NVARCHAR(10) NOT NULL,
    CheckIn         TIME(0) NULL,
    CheckOut        TIME(0) NULL,
    Notes           NVARCHAR(200) NULL,
    MarkedByUserId  BIGINT NULL,
    UpdatedAt       DATETIME2(3) NOT NULL CONSTRAINT DF_StaffAttendance_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_StaffAttendance_Day UNIQUE (TenantId, StaffId, WorkDate),
    CONSTRAINT FK_StaffAttendance_Staff FOREIGN KEY (TenantId, StaffId) REFERENCES hms.StaffMembers (TenantId, StaffId),
    CONSTRAINT CK_StaffAttendance_Status CHECK (Status IN ('present','absent','half_day','leave','holiday','week_off'))
);

CREATE TABLE hms.LeaveRequests (
    LeaveId          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_LeaveRequests PRIMARY KEY,
    TenantId         INT NOT NULL,
    StaffId          BIGINT NOT NULL,
    LeaveType        NVARCHAR(10) NOT NULL,
    FromDate         DATE NOT NULL,
    ToDate           DATE NOT NULL,
    Days             DECIMAL(5,1) NOT NULL,
    Reason           NVARCHAR(300) NULL,
    Status           NVARCHAR(10) NOT NULL CONSTRAINT DF_LeaveRequests_Status DEFAULT ('pending'),
    DecidedByUserId  BIGINT NULL,
    DecidedAt        DATETIME2(3) NULL,
    DecisionNote     NVARCHAR(300) NULL,
    CreatedByUserId  BIGINT NULL,
    CreatedAt        DATETIME2(3) NOT NULL CONSTRAINT DF_LeaveRequests_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_LeaveRequests_Tenant_Id UNIQUE (TenantId, LeaveId),
    CONSTRAINT FK_LeaveRequests_Staff FOREIGN KEY (TenantId, StaffId) REFERENCES hms.StaffMembers (TenantId, StaffId),
    CONSTRAINT CK_LeaveRequests_Type CHECK (LeaveType IN ('casual','sick','earned','unpaid','other')),
    CONSTRAINT CK_LeaveRequests_Status CHECK (Status IN ('pending','approved','rejected','cancelled')),
    CONSTRAINT CK_LeaveRequests_Dates CHECK (ToDate >= FromDate AND Days > 0)
);

/* ───────── Expenses: recurring templates + link back from posted expenses ───────── */
CREATE TABLE hms.RecurringExpenses (
    RecurringExpenseId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_RecurringExpenses PRIMARY KEY,
    TenantId           INT NOT NULL CONSTRAINT FK_RecurringExpenses_Tenants REFERENCES hms.Tenants(TenantId),
    Title              NVARCHAR(150) NOT NULL,
    ExpenseCategoryId  INT NOT NULL,
    Amount             DECIMAL(12,2) NOT NULL,
    Method             NVARCHAR(10) NOT NULL,
    PaidTo             NVARCHAR(150) NULL,
    Frequency          NVARCHAR(10) NOT NULL,
    NextDueDate        DATE NOT NULL,
    EndDate            DATE NULL,
    IsActive           BIT NOT NULL CONSTRAINT DF_RecurringExpenses_Active DEFAULT (1),
    LastPostedDate     DATE NULL,
    CreatedByUserId    BIGINT NULL,
    CreatedAt          DATETIME2(3) NOT NULL CONSTRAINT DF_RecurringExpenses_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_RecurringExpenses_Tenant_Id UNIQUE (TenantId, RecurringExpenseId),
    CONSTRAINT FK_RecurringExpenses_Categories FOREIGN KEY (TenantId, ExpenseCategoryId) REFERENCES hms.ExpenseCategories (TenantId, ExpenseCategoryId),
    CONSTRAINT CK_RecurringExpenses_Amount CHECK (Amount > 0),
    CONSTRAINT CK_RecurringExpenses_Frequency CHECK (Frequency IN ('weekly','monthly','quarterly','yearly'))
);

ALTER TABLE hms.Expenses ADD RecurringExpenseId INT NULL, PayrollId INT NULL;
GO
/* A recurring template posts at most one expense per due date (safe if the job runs twice / on two servers). */
CREATE UNIQUE INDEX UX_Expenses_Recurring_Date ON hms.Expenses (TenantId, RecurringExpenseId, ExpenseDate) WHERE RecurringExpenseId IS NOT NULL;

CREATE TABLE hms.PayrollRuns (
    PayrollId       INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PayrollRuns PRIMARY KEY,
    TenantId        INT NOT NULL,
    StaffId         BIGINT NOT NULL,
    PayMonth        CHAR(7) NOT NULL,              -- YYYY-MM
    DaysInMonth     TINYINT NOT NULL,
    PaidDays        DECIMAL(5,1) NOT NULL,
    MonthlySalary   DECIMAL(12,2) NOT NULL,
    Gross           DECIMAL(12,2) NOT NULL,
    Allowances      DECIMAL(12,2) NOT NULL CONSTRAINT DF_PayrollRuns_Allow DEFAULT (0),
    Deductions      DECIMAL(12,2) NOT NULL CONSTRAINT DF_PayrollRuns_Ded DEFAULT (0),
    NetPay          DECIMAL(12,2) NOT NULL,
    Status          NVARCHAR(10) NOT NULL CONSTRAINT DF_PayrollRuns_Status DEFAULT ('draft'),
    PaidAt          DATETIME2(3) NULL,
    PaymentMethod   NVARCHAR(10) NULL,
    Notes           NVARCHAR(300) NULL,
    CreatedByUserId BIGINT NULL,
    CreatedAt       DATETIME2(3) NOT NULL CONSTRAINT DF_PayrollRuns_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_PayrollRuns_Tenant_Id UNIQUE (TenantId, PayrollId),
    CONSTRAINT UQ_PayrollRuns_Month UNIQUE (TenantId, StaffId, PayMonth),
    CONSTRAINT FK_PayrollRuns_Staff FOREIGN KEY (TenantId, StaffId) REFERENCES hms.StaffMembers (TenantId, StaffId),
    CONSTRAINT CK_PayrollRuns_Status CHECK (Status IN ('draft','paid')),
    CONSTRAINT CK_PayrollRuns_Money CHECK (Gross >= 0 AND Allowances >= 0 AND Deductions >= 0 AND NetPay >= 0)
);

/* ───────── Attachments (bill / expense photos, patient documents & photo) ─────────
   Files are stored in the database (no public file server): served only through the API after the same tenant and
   permission checks as the record they belong to. Type is checked by magic bytes, size ≤ 5 MB. */
CREATE TABLE hms.Attachments (
    AttachmentId    BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Attachments PRIMARY KEY,
    TenantId        INT NOT NULL CONSTRAINT FK_Attachments_Tenants REFERENCES hms.Tenants(TenantId),
    EntityType      NVARCHAR(20) NOT NULL,
    EntityId        BIGINT NOT NULL,
    Category        NVARCHAR(30) NULL,
    FileName        NVARCHAR(200) NOT NULL,
    ContentType     NVARCHAR(60) NOT NULL,
    SizeBytes       INT NOT NULL,
    Sha256          CHAR(64) NOT NULL,
    Content         VARBINARY(MAX) NOT NULL,
    UploadedByUserId BIGINT NULL,
    CreatedAt       DATETIME2(3) NOT NULL CONSTRAINT DF_Attachments_CreatedAt DEFAULT (SYSUTCDATETIME()),
    IsDeleted       BIT NOT NULL CONSTRAINT DF_Attachments_Deleted DEFAULT (0),
    CONSTRAINT UQ_Attachments_Tenant_Id UNIQUE (TenantId, AttachmentId),
    CONSTRAINT CK_Attachments_Entity CHECK (EntityType IN ('expense','bill','patient','purchase_order')),
    CONSTRAINT CK_Attachments_Size CHECK (SizeBytes BETWEEN 1 AND 5242880),
    CONSTRAINT CK_Attachments_Type CHECK (ContentType IN ('image/jpeg','image/png','image/webp','application/pdf'))
);
CREATE INDEX IX_Attachments_Entity ON hms.Attachments (TenantId, EntityType, EntityId) WHERE IsDeleted = 0;

/* Default "Salaries" category for hospitals that do not have one (used by payroll). */
INSERT INTO hms.ExpenseCategories (TenantId, Name)
SELECT t.TenantId, N'Salaries' FROM hms.Tenants t
WHERE NOT EXISTS (SELECT 1 FROM hms.ExpenseCategories c WHERE c.TenantId = t.TenantId AND c.Name = N'Salaries');
