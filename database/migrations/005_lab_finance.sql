/* 005 — Laboratory extensions (departments, packages, price history, referral doctors, samples,
   order amounts & payment link) + Expenses + tenant data-export log. Schema: hms.
   Every table carries TenantId and uses composite (TenantId, Id) foreign keys so a row can
   never reference another hospital's data. */

ALTER TABLE hms.LabTests ADD
    Department  NVARCHAR(60)  NULL,
    Description NVARCHAR(500) NULL;
GO

/* ───────── Referral doctors (external doctors who send patients to the lab) ───────── */
CREATE TABLE hms.ReferralDoctors (
    ReferralDoctorId  INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ReferralDoctors PRIMARY KEY,
    TenantId          INT NOT NULL CONSTRAINT FK_ReferralDoctors_Tenants REFERENCES hms.Tenants(TenantId),
    Name              NVARCHAR(150) NOT NULL,
    Qualification     NVARCHAR(100) NULL,
    Clinic            NVARCHAR(150) NULL,
    Phone             NVARCHAR(30)  NULL,
    Email             NVARCHAR(254) NULL,
    CommissionPercent DECIMAL(5,2)  NOT NULL CONSTRAINT DF_ReferralDoctors_Comm DEFAULT (0),
    IsActive          BIT NOT NULL CONSTRAINT DF_ReferralDoctors_Active DEFAULT (1),
    CreatedAt         DATETIME2(3) NOT NULL CONSTRAINT DF_ReferralDoctors_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_ReferralDoctors_Tenant_Id UNIQUE (TenantId, ReferralDoctorId),
    CONSTRAINT CK_ReferralDoctors_Comm CHECK (CommissionPercent BETWEEN 0 AND 100)
);

/* ───────── Test packages / profiles ───────── */
CREATE TABLE hms.LabPackages (
    LabPackageId  INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_LabPackages PRIMARY KEY,
    TenantId      INT NOT NULL CONSTRAINT FK_LabPackages_Tenants REFERENCES hms.Tenants(TenantId),
    Code          NVARCHAR(20)  NOT NULL,
    Name          NVARCHAR(150) NOT NULL,
    Department    NVARCHAR(60)  NULL,
    Description   NVARCHAR(500) NULL,
    Price         DECIMAL(12,2) NOT NULL,
    IsActive      BIT NOT NULL CONSTRAINT DF_LabPackages_Active DEFAULT (1),
    CreatedAt     DATETIME2(3) NOT NULL CONSTRAINT DF_LabPackages_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt     DATETIME2(3) NULL,
    CONSTRAINT UQ_LabPackages_Tenant_Id UNIQUE (TenantId, LabPackageId),
    CONSTRAINT UQ_LabPackages_Tenant_Code UNIQUE (TenantId, Code),
    CONSTRAINT CK_LabPackages_Price CHECK (Price >= 0)
);

CREATE TABLE hms.LabPackageTests (
    TenantId     INT NOT NULL,
    LabPackageId INT NOT NULL,
    LabTestId    INT NOT NULL,
    CONSTRAINT PK_LabPackageTests PRIMARY KEY (TenantId, LabPackageId, LabTestId),
    CONSTRAINT FK_LabPackageTests_Packages FOREIGN KEY (TenantId, LabPackageId) REFERENCES hms.LabPackages (TenantId, LabPackageId),
    CONSTRAINT FK_LabPackageTests_Tests FOREIGN KEY (TenantId, LabTestId) REFERENCES hms.LabTests (TenantId, LabTestId)
);

/* Append-only price timeline for tests and packages (latest row = current price). */
CREATE TABLE hms.LabPriceHistory (
    LabPriceHistoryId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_LabPriceHistory PRIMARY KEY,
    TenantId          INT NOT NULL CONSTRAINT FK_LabPriceHistory_Tenants REFERENCES hms.Tenants(TenantId),
    ItemType          NVARCHAR(10) NOT NULL,
    ItemId            INT NOT NULL,
    Price             DECIMAL(12,2) NOT NULL,
    Reason            NVARCHAR(200) NOT NULL,
    EffectiveAt       DATETIME2(3) NOT NULL CONSTRAINT DF_LabPriceHistory_At DEFAULT (SYSUTCDATETIME()),
    ChangedByUserId   BIGINT NULL,
    CONSTRAINT CK_LabPriceHistory_Type CHECK (ItemType IN ('test','package')),
    CONSTRAINT CK_LabPriceHistory_Price CHECK (Price >= 0)
);
CREATE INDEX IX_LabPriceHistory_Item ON hms.LabPriceHistory (TenantId, ItemType, ItemId, EffectiveAt DESC);

/* ───────── Orders: referral, amounts, link to bill ───────── */
ALTER TABLE hms.LabOrders ADD
    ReferralDoctorId INT NULL,
    BillId           BIGINT NULL,
    OwnBill          BIT NOT NULL CONSTRAINT DF_LabOrders_OwnBill DEFAULT (0),
    GrossAmount      DECIMAL(12,2) NOT NULL CONSTRAINT DF_LabOrders_Gross DEFAULT (0),
    DiscountAmount   DECIMAL(12,2) NOT NULL CONSTRAINT DF_LabOrders_Discount DEFAULT (0),
    NetAmount        DECIMAL(12,2) NOT NULL CONSTRAINT DF_LabOrders_Net DEFAULT (0);
GO
ALTER TABLE hms.LabOrders ADD
    CONSTRAINT FK_LabOrders_Referral FOREIGN KEY (TenantId, ReferralDoctorId) REFERENCES hms.ReferralDoctors (TenantId, ReferralDoctorId),
    CONSTRAINT FK_LabOrders_Bills FOREIGN KEY (TenantId, BillId) REFERENCES hms.Bills (TenantId, BillId),
    CONSTRAINT CK_LabOrders_Amounts CHECK (GrossAmount >= 0 AND DiscountAmount >= 0 AND DiscountAmount <= GrossAmount AND NetAmount = GrossAmount - DiscountAmount);

ALTER TABLE hms.LabOrderItems ADD
    LabPackageId INT NULL,
    PackageName  NVARCHAR(150) NULL;
GO
ALTER TABLE hms.LabOrderItems ADD
    CONSTRAINT FK_LabOrderItems_Packages FOREIGN KEY (TenantId, LabPackageId) REFERENCES hms.LabPackages (TenantId, LabPackageId);

/* Back-fill amounts for orders created before this migration. */
UPDATE o SET GrossAmount = x.Total, NetAmount = x.Total
FROM hms.LabOrders o
CROSS APPLY (SELECT ISNULL(SUM(i.Price), 0) AS Total FROM hms.LabOrderItems i WHERE i.TenantId = o.TenantId AND i.LabOrderId = o.LabOrderId) x;

/* ───────── Samples (one per sample type per order) ───────── */
CREATE TABLE hms.LabSamples (
    LabSampleId       BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_LabSamples PRIMARY KEY,
    TenantId          INT NOT NULL,
    SampleNumber      NVARCHAR(40) NOT NULL,
    LabOrderId        BIGINT NOT NULL,
    SampleType        NVARCHAR(40) NOT NULL,
    Status            NVARCHAR(12) NOT NULL CONSTRAINT DF_LabSamples_Status DEFAULT ('pending'),
    CollectedAt       DATETIME2(3) NULL,
    CollectedByUserId BIGINT NULL,
    ReceivedAt        DATETIME2(3) NULL,
    ReceivedByUserId  BIGINT NULL,
    RejectedAt        DATETIME2(3) NULL,
    RejectReason      NVARCHAR(300) NULL,
    CreatedAt         DATETIME2(3) NOT NULL CONSTRAINT DF_LabSamples_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_LabSamples_Tenant_Id UNIQUE (TenantId, LabSampleId),
    CONSTRAINT UQ_LabSamples_Tenant_Number UNIQUE (TenantId, SampleNumber),
    CONSTRAINT UQ_LabSamples_Order_Type UNIQUE (TenantId, LabOrderId, SampleType),
    CONSTRAINT FK_LabSamples_Orders FOREIGN KEY (TenantId, LabOrderId) REFERENCES hms.LabOrders (TenantId, LabOrderId),
    CONSTRAINT CK_LabSamples_Status CHECK (Status IN ('pending','collected','received','rejected'))
);
CREATE INDEX IX_LabSamples_Tenant_Status ON hms.LabSamples (TenantId, Status, CreatedAt DESC);

/* Back-fill samples for existing, non-cancelled orders. */
INSERT INTO hms.LabSamples (TenantId, SampleNumber, LabOrderId, SampleType, Status, CollectedAt)
SELECT s.TenantId, CONCAT('SMP-', s.OrderNumber, '-', s.rn), s.LabOrderId, s.SampleType,
       CASE WHEN s.OrderStatus = 'ordered' THEN 'pending' ELSE 'collected' END,
       CASE WHEN s.OrderStatus = 'ordered' THEN NULL ELSE ISNULL(s.SampleCollectedAt, s.OrderedAt) END
FROM (
    SELECT o.TenantId, o.LabOrderId, o.OrderNumber, o.Status AS OrderStatus, o.SampleCollectedAt, o.OrderedAt, st.SampleType,
           ROW_NUMBER() OVER (PARTITION BY o.TenantId, o.LabOrderId ORDER BY st.SampleType) AS rn
    FROM hms.LabOrders o
    CROSS APPLY (SELECT DISTINCT ISNULL(NULLIF(LTRIM(RTRIM(t.SampleType)), ''), 'Other') AS SampleType
                 FROM hms.LabOrderItems i JOIN hms.LabTests t ON t.TenantId = i.TenantId AND t.LabTestId = i.LabTestId
                 WHERE i.TenantId = o.TenantId AND i.LabOrderId = o.LabOrderId) st
    WHERE o.Status <> 'cancelled'
) s;

/* ───────── Expenses ───────── */
CREATE TABLE hms.ExpenseCategories (
    ExpenseCategoryId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ExpenseCategories PRIMARY KEY,
    TenantId          INT NOT NULL CONSTRAINT FK_ExpenseCategories_Tenants REFERENCES hms.Tenants(TenantId),
    Name              NVARCHAR(80) NOT NULL,
    IsActive          BIT NOT NULL CONSTRAINT DF_ExpenseCategories_Active DEFAULT (1),
    CONSTRAINT UQ_ExpenseCategories_Tenant_Id UNIQUE (TenantId, ExpenseCategoryId),
    CONSTRAINT UQ_ExpenseCategories_Tenant_Name UNIQUE (TenantId, Name)
);

CREATE TABLE hms.Expenses (
    ExpenseId         BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Expenses PRIMARY KEY,
    TenantId          INT NOT NULL,
    ExpenseNumber     NVARCHAR(30) NOT NULL,
    ExpenseDate       DATE NOT NULL,
    ExpenseCategoryId INT NOT NULL,
    Amount            DECIMAL(12,2) NOT NULL,
    Method            NVARCHAR(10) NOT NULL,
    PaidTo            NVARCHAR(150) NULL,
    Reference         NVARCHAR(100) NULL,
    Notes             NVARCHAR(500) NULL,
    CreatedByUserId   BIGINT NULL,
    CreatedAt         DATETIME2(3) NOT NULL CONSTRAINT DF_Expenses_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt         DATETIME2(3) NULL,
    CONSTRAINT UQ_Expenses_Tenant_Id UNIQUE (TenantId, ExpenseId),
    CONSTRAINT UQ_Expenses_Tenant_Number UNIQUE (TenantId, ExpenseNumber),
    CONSTRAINT FK_Expenses_Categories FOREIGN KEY (TenantId, ExpenseCategoryId) REFERENCES hms.ExpenseCategories (TenantId, ExpenseCategoryId),
    CONSTRAINT CK_Expenses_Amount CHECK (Amount > 0),
    CONSTRAINT CK_Expenses_Method CHECK (Method IN ('cash','card','upi','bank','other'))
);
CREATE INDEX IX_Expenses_Tenant_Date ON hms.Expenses (TenantId, ExpenseDate DESC) INCLUDE (Amount, ExpenseCategoryId);

INSERT INTO hms.ExpenseCategories (TenantId, Name)
SELECT t.TenantId, c.Name
FROM hms.Tenants t
CROSS JOIN (VALUES (N'Salaries'), (N'Rent'), (N'Electricity & utilities'), (N'Lab reagents & consumables'),
                   (N'Equipment maintenance'), (N'Medical supplies'), (N'Marketing'), (N'Miscellaneous')) c(Name)
WHERE NOT EXISTS (SELECT 1 FROM hms.ExpenseCategories e WHERE e.TenantId = t.TenantId AND e.Name = c.Name);

/* ───────── Data-export (backup) log ───────── */
CREATE TABLE hms.TenantBackups (
    TenantBackupId  BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_TenantBackups PRIMARY KEY,
    TenantId        INT NOT NULL CONSTRAINT FK_TenantBackups_Tenants REFERENCES hms.Tenants(TenantId),
    CreatedByUserId BIGINT NULL,
    CreatedAt       DATETIME2(3) NOT NULL CONSTRAINT DF_TenantBackups_CreatedAt DEFAULT (SYSUTCDATETIME()),
    TableCount      INT NOT NULL CONSTRAINT DF_TenantBackups_Tables DEFAULT (0),
    TotalRows       INT NOT NULL CONSTRAINT DF_TenantBackups_Rows DEFAULT (0),
    SizeBytes       BIGINT NOT NULL CONSTRAINT DF_TenantBackups_Size DEFAULT (0),
    Status          NVARCHAR(12) NOT NULL,
    CONSTRAINT CK_TenantBackups_Status CHECK (Status IN ('completed','failed'))
);
CREATE INDEX IX_TenantBackups_Tenant ON hms.TenantBackups (TenantId, CreatedAt DESC);
