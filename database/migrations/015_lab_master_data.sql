/* 015 — Lab upgrade, chunk 2: lab master data.
   - LabDepartments: a real department master per hospital (name, report order, on/off) instead of free text.
   - LabTests: department link, method, instrument, interpretation, result input type (numeric / text / option),
     dropdown options, decimals, turnaround time (TAT) and report order.
   - LabTestParameters: input type, options, decimals, heading rows (e.g. "DIFFERENTIAL COUNT").
   - Snapshots of the same fields on LabOrderItems / LabResultValues, so editing the catalogue never changes an old report.
   Additive only: no column is renamed or dropped; LabTests.Department (text) is kept and stays in sync.
   Same multi-tenant rules as everywhere: TenantId on every row, (TenantId, Id) unique keys, composite foreign keys.

   Re-runnable: every step checks whether it is already done, so a database where this script was partly applied
   (for example run by hand, or interrupted on a slow connection) is completed instead of failing with
   "There is already an object named …". */

IF OBJECT_ID('hms.LabDepartments', 'U') IS NULL
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

IF COL_LENGTH('hms.LabTests', 'DepartmentId') IS NULL       ALTER TABLE hms.LabTests ADD DepartmentId INT NULL;
IF COL_LENGTH('hms.LabTests', 'Method') IS NULL             ALTER TABLE hms.LabTests ADD Method NVARCHAR(150) NULL;
IF COL_LENGTH('hms.LabTests', 'Instrument') IS NULL         ALTER TABLE hms.LabTests ADD Instrument NVARCHAR(150) NULL;
IF COL_LENGTH('hms.LabTests', 'Interpretation') IS NULL     ALTER TABLE hms.LabTests ADD Interpretation NVARCHAR(2000) NULL;
IF COL_LENGTH('hms.LabTests', 'InputType') IS NULL          ALTER TABLE hms.LabTests ADD InputType NVARCHAR(10) NOT NULL CONSTRAINT DF_LabTests_InputType DEFAULT ('numeric');
IF COL_LENGTH('hms.LabTests', 'Options') IS NULL            ALTER TABLE hms.LabTests ADD Options NVARCHAR(1000) NULL;   -- dropdown choices separated by "|"
IF COL_LENGTH('hms.LabTests', 'Decimals') IS NULL           ALTER TABLE hms.LabTests ADD Decimals TINYINT NULL;
IF COL_LENGTH('hms.LabTests', 'TatHours') IS NULL           ALTER TABLE hms.LabTests ADD TatHours SMALLINT NULL;
IF COL_LENGTH('hms.LabTests', 'SortOrder') IS NULL          ALTER TABLE hms.LabTests ADD SortOrder SMALLINT NULL;

IF COL_LENGTH('hms.LabTestParameters', 'InputType') IS NULL ALTER TABLE hms.LabTestParameters ADD InputType NVARCHAR(10) NOT NULL CONSTRAINT DF_LabTestParameters_InputType DEFAULT ('numeric');
IF COL_LENGTH('hms.LabTestParameters', 'Options') IS NULL   ALTER TABLE hms.LabTestParameters ADD Options NVARCHAR(1000) NULL;
IF COL_LENGTH('hms.LabTestParameters', 'Decimals') IS NULL  ALTER TABLE hms.LabTestParameters ADD Decimals TINYINT NULL;
IF COL_LENGTH('hms.LabTestParameters', 'IsHeading') IS NULL ALTER TABLE hms.LabTestParameters ADD IsHeading BIT NOT NULL CONSTRAINT DF_LabTestParameters_IsHeading DEFAULT (0);

IF COL_LENGTH('hms.LabOrderItems', 'DepartmentName') IS NULL ALTER TABLE hms.LabOrderItems ADD DepartmentName NVARCHAR(60) NULL;
IF COL_LENGTH('hms.LabOrderItems', 'DepartmentSort') IS NULL ALTER TABLE hms.LabOrderItems ADD DepartmentSort SMALLINT NULL;
IF COL_LENGTH('hms.LabOrderItems', 'Method') IS NULL         ALTER TABLE hms.LabOrderItems ADD Method NVARCHAR(150) NULL;
IF COL_LENGTH('hms.LabOrderItems', 'Instrument') IS NULL     ALTER TABLE hms.LabOrderItems ADD Instrument NVARCHAR(150) NULL;
IF COL_LENGTH('hms.LabOrderItems', 'Interpretation') IS NULL ALTER TABLE hms.LabOrderItems ADD Interpretation NVARCHAR(2000) NULL;
IF COL_LENGTH('hms.LabOrderItems', 'InputType') IS NULL      ALTER TABLE hms.LabOrderItems ADD InputType NVARCHAR(10) NULL;
IF COL_LENGTH('hms.LabOrderItems', 'Options') IS NULL        ALTER TABLE hms.LabOrderItems ADD Options NVARCHAR(1000) NULL;
IF COL_LENGTH('hms.LabOrderItems', 'Decimals') IS NULL       ALTER TABLE hms.LabOrderItems ADD Decimals TINYINT NULL;

IF COL_LENGTH('hms.LabResultValues', 'InputType') IS NULL    ALTER TABLE hms.LabResultValues ADD InputType NVARCHAR(10) NULL;
IF COL_LENGTH('hms.LabResultValues', 'Options') IS NULL      ALTER TABLE hms.LabResultValues ADD Options NVARCHAR(1000) NULL;
IF COL_LENGTH('hms.LabResultValues', 'Decimals') IS NULL     ALTER TABLE hms.LabResultValues ADD Decimals TINYINT NULL;
IF COL_LENGTH('hms.LabResultValues', 'IsHeading') IS NULL    ALTER TABLE hms.LabResultValues ADD IsHeading BIT NOT NULL CONSTRAINT DF_LabResultValues_IsHeading DEFAULT (0);
GO

IF OBJECT_ID('hms.FK_LabTests_Departments', 'F') IS NULL
    ALTER TABLE hms.LabTests ADD CONSTRAINT FK_LabTests_Departments FOREIGN KEY (TenantId, DepartmentId) REFERENCES hms.LabDepartments (TenantId, LabDepartmentId);
IF OBJECT_ID('hms.CK_LabTests_InputType', 'C') IS NULL
    ALTER TABLE hms.LabTests ADD CONSTRAINT CK_LabTests_InputType CHECK (InputType IN ('numeric','text','option'));
IF OBJECT_ID('hms.CK_LabTests_Decimals', 'C') IS NULL
    ALTER TABLE hms.LabTests ADD CONSTRAINT CK_LabTests_Decimals CHECK (Decimals IS NULL OR Decimals <= 6);
IF OBJECT_ID('hms.CK_LabTests_Tat', 'C') IS NULL
    ALTER TABLE hms.LabTests ADD CONSTRAINT CK_LabTests_Tat CHECK (TatHours IS NULL OR (TatHours > 0 AND TatHours <= 2160));
IF OBJECT_ID('hms.CK_LabTests_Options', 'C') IS NULL
    ALTER TABLE hms.LabTests ADD CONSTRAINT CK_LabTests_Options CHECK (InputType <> 'option' OR Options IS NOT NULL);
IF OBJECT_ID('hms.CK_LabTestParameters_InputType', 'C') IS NULL
    ALTER TABLE hms.LabTestParameters ADD CONSTRAINT CK_LabTestParameters_InputType CHECK (InputType IN ('numeric','text','option'));
IF OBJECT_ID('hms.CK_LabTestParameters_Decimals', 'C') IS NULL
    ALTER TABLE hms.LabTestParameters ADD CONSTRAINT CK_LabTestParameters_Decimals CHECK (Decimals IS NULL OR Decimals <= 6);
IF OBJECT_ID('hms.CK_LabTestParameters_Options', 'C') IS NULL
    ALTER TABLE hms.LabTestParameters ADD CONSTRAINT CK_LabTestParameters_Options CHECK (InputType <> 'option' OR Options IS NOT NULL OR IsHeading = 1);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LabTests_Department' AND object_id = OBJECT_ID('hms.LabTests'))
    CREATE INDEX IX_LabTests_Department ON hms.LabTests (TenantId, DepartmentId) INCLUDE (IsActive);

/* Back-fill (each step skips what is already there): every hospital gets the usual departments plus any department
   text already used on tests or packages. */
INSERT INTO hms.LabDepartments (TenantId, Name, SortOrder)
SELECT t.TenantId, d.Name, d.SortOrder
FROM hms.Tenants t
CROSS JOIN (VALUES (N'Haematology', 10), (N'Biochemistry', 20), (N'Clinical Pathology', 30), (N'Serology & Immunology', 40),
                   (N'Hormones', 50), (N'Microbiology', 60), (N'Histopathology', 70)) d(Name, SortOrder)
WHERE NOT EXISTS (SELECT 1 FROM hms.LabDepartments x WHERE x.TenantId = t.TenantId AND x.Name = d.Name);

INSERT INTO hms.LabDepartments (TenantId, Name, SortOrder)
SELECT u.TenantId, u.Name, 100
FROM (SELECT TenantId, LEFT(LTRIM(RTRIM(Department)), 60) AS Name FROM hms.LabTests WHERE Department IS NOT NULL AND LTRIM(RTRIM(Department)) <> ''
      UNION SELECT TenantId, LEFT(LTRIM(RTRIM(Department)), 60) FROM hms.LabPackages WHERE Department IS NOT NULL AND LTRIM(RTRIM(Department)) <> '') u
WHERE NOT EXISTS (SELECT 1 FROM hms.LabDepartments x WHERE x.TenantId = u.TenantId AND x.Name = u.Name);

UPDATE lt SET DepartmentId = d.LabDepartmentId
FROM hms.LabTests lt JOIN hms.LabDepartments d ON d.TenantId = lt.TenantId AND d.Name = LEFT(LTRIM(RTRIM(lt.Department)), 60)
WHERE lt.DepartmentId IS NULL;

/* Old order lines get the department name they were printed under, so reports group the same way as before. */
UPDATE i SET DepartmentName = LEFT(lt.Department, 60)
FROM hms.LabOrderItems i JOIN hms.LabTests lt ON lt.TenantId = i.TenantId AND lt.LabTestId = i.LabTestId
WHERE i.DepartmentName IS NULL AND lt.Department IS NOT NULL;
