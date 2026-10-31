/* 015 — Lab upgrade, chunk 2: lab master data.
   - LabDepartments: a real department master per hospital (name, report order, on/off) instead of free text.
   - LabTests: department link, method, instrument, interpretation, result input type (numeric / text / option),
     dropdown options, decimals, turnaround time (TAT) and report order.
   - LabTestParameters: input type, options, decimals, heading rows (e.g. "DIFFERENTIAL COUNT").
   - Snapshots of the same fields on LabOrderItems / LabResultValues, so editing the catalogue never changes an old report.
   Additive only: no column is renamed or dropped; LabTests.Department (text) is kept and stays in sync.
   Same multi-tenant rules as everywhere: TenantId on every row, (TenantId, Id) unique keys, composite foreign keys. */

CREATE TABLE hms.LabDepartments (
    LabDepartmentId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_LabDepartments PRIMARY KEY,
    TenantId        INT NOT NULL CONSTRAINT FK_LabDepartments_Tenants REFERENCES hms.Tenants(TenantId),
    Name            NVARCHAR(60) NOT NULL,
    SortOrder       SMALLINT NOT NULL CONSTRAINT DF_LabDepartments_Sort DEFAULT (0),
    IsActive        BIT NOT NULL CONSTRAINT DF_LabDepartments_Active DEFAULT (1),
    CreatedAt       DATETIME2(3) NOT NULL CONSTRAINT DF_LabDepartments_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_LabDepartments_Tenant_Id UNIQUE (TenantId, LabDepartmentId),
    CONSTRAINT UQ_LabDepartments_Tenant_Name UNIQUE (TenantId, Name)
);

ALTER TABLE hms.LabTests ADD
    DepartmentId   INT NULL,
    Method         NVARCHAR(150) NULL,
    Instrument     NVARCHAR(150) NULL,
    Interpretation NVARCHAR(2000) NULL,
    InputType      NVARCHAR(10) NOT NULL CONSTRAINT DF_LabTests_InputType DEFAULT ('numeric'),
    Options        NVARCHAR(1000) NULL,          -- dropdown choices separated by "|" (InputType = 'option')
    Decimals       TINYINT NULL,
    TatHours       SMALLINT NULL,
    SortOrder      SMALLINT NULL;

ALTER TABLE hms.LabTestParameters ADD
    InputType NVARCHAR(10) NOT NULL CONSTRAINT DF_LabTestParameters_InputType DEFAULT ('numeric'),
    Options   NVARCHAR(1000) NULL,
    Decimals  TINYINT NULL,
    IsHeading BIT NOT NULL CONSTRAINT DF_LabTestParameters_IsHeading DEFAULT (0);

ALTER TABLE hms.LabOrderItems ADD
    DepartmentName NVARCHAR(60) NULL,
    DepartmentSort SMALLINT NULL,
    Method         NVARCHAR(150) NULL,
    Instrument     NVARCHAR(150) NULL,
    Interpretation NVARCHAR(2000) NULL,
    InputType      NVARCHAR(10) NULL,
    Options        NVARCHAR(1000) NULL,
    Decimals       TINYINT NULL;

ALTER TABLE hms.LabResultValues ADD
    InputType NVARCHAR(10) NULL,
    Options   NVARCHAR(1000) NULL,
    Decimals  TINYINT NULL,
    IsHeading BIT NOT NULL CONSTRAINT DF_LabResultValues_IsHeading DEFAULT (0);
GO

ALTER TABLE hms.LabTests ADD
    CONSTRAINT FK_LabTests_Departments FOREIGN KEY (TenantId, DepartmentId) REFERENCES hms.LabDepartments (TenantId, LabDepartmentId),
    CONSTRAINT CK_LabTests_InputType CHECK (InputType IN ('numeric','text','option')),
    CONSTRAINT CK_LabTests_Decimals CHECK (Decimals IS NULL OR Decimals <= 6),
    CONSTRAINT CK_LabTests_Tat CHECK (TatHours IS NULL OR (TatHours > 0 AND TatHours <= 2160)),
    CONSTRAINT CK_LabTests_Options CHECK (InputType <> 'option' OR Options IS NOT NULL);
ALTER TABLE hms.LabTestParameters ADD
    CONSTRAINT CK_LabTestParameters_InputType CHECK (InputType IN ('numeric','text','option')),
    CONSTRAINT CK_LabTestParameters_Decimals CHECK (Decimals IS NULL OR Decimals <= 6),
    CONSTRAINT CK_LabTestParameters_Options CHECK (InputType <> 'option' OR Options IS NOT NULL OR IsHeading = 1);
CREATE INDEX IX_LabTests_Department ON hms.LabTests (TenantId, DepartmentId) INCLUDE (IsActive);

/* Back-fill: every hospital gets the usual departments plus any department text already used on tests or packages. */
INSERT INTO hms.LabDepartments (TenantId, Name, SortOrder)
SELECT t.TenantId, d.Name, d.SortOrder
FROM hms.Tenants t
CROSS JOIN (VALUES (N'Haematology', 10), (N'Biochemistry', 20), (N'Clinical Pathology', 30), (N'Serology & Immunology', 40),
                   (N'Hormones', 50), (N'Microbiology', 60), (N'Histopathology', 70)) d(Name, SortOrder)
WHERE NOT EXISTS (SELECT 1 FROM hms.LabDepartments x WHERE x.TenantId = t.TenantId AND x.Name = d.Name);

INSERT INTO hms.LabDepartments (TenantId, Name, SortOrder)
SELECT u.TenantId, u.Name, 100
FROM (SELECT TenantId, LTRIM(RTRIM(Department)) AS Name FROM hms.LabTests WHERE Department IS NOT NULL AND LTRIM(RTRIM(Department)) <> ''
      UNION SELECT TenantId, LTRIM(RTRIM(Department)) FROM hms.LabPackages WHERE Department IS NOT NULL AND LTRIM(RTRIM(Department)) <> '') u
WHERE NOT EXISTS (SELECT 1 FROM hms.LabDepartments x WHERE x.TenantId = u.TenantId AND x.Name = u.Name);

UPDATE lt SET DepartmentId = d.LabDepartmentId
FROM hms.LabTests lt JOIN hms.LabDepartments d ON d.TenantId = lt.TenantId AND d.Name = LTRIM(RTRIM(lt.Department))
WHERE lt.DepartmentId IS NULL;

/* Old order lines get the department name they were printed under, so reports group the same way as before. */
UPDATE i SET DepartmentName = lt.Department
FROM hms.LabOrderItems i JOIN hms.LabTests lt ON lt.TenantId = i.TenantId AND lt.LabTestId = i.LabTestId
WHERE i.DepartmentName IS NULL;
