/* 016 — Lab upgrade, chunk 3: reference ranges by age & gender, and critical values.
   - LabReferenceRanges: any number of ranges per test (or per panel parameter) for a gender (any / male / female) and an
     age band [from, to) in days, months or years, with normal low/high or text and critical low/high.
   - Default critical limits on tests and parameters (used when no age/gender range matches).
   - Order lines and parameter results keep a snapshot of the range used (low/high/text/critical + a label) and the
     critical-result acknowledgement (who and when).
   - Flags gain 'crit_low' and 'crit_high'.
   Multi-tenant like everything else: TenantId on every row, (TenantId, Id) unique key, composite foreign keys to the
   hospital's own test / parameter, so the database refuses a range pointing at another hospital's test.
   Re-runnable: every step checks first. Additive only. */

IF OBJECT_ID('hms.LabReferenceRanges', 'U') IS NULL
CREATE TABLE hms.LabReferenceRanges (
    RangeId       INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_LabReferenceRanges PRIMARY KEY,
    TenantId      INT NOT NULL CONSTRAINT FK_LabReferenceRanges_Tenants REFERENCES hms.Tenants(TenantId),
    LabTestId     INT NOT NULL,
    ParameterId   INT NULL,                         -- NULL = the test's own (single) result
    Gender        NVARCHAR(6) NOT NULL CONSTRAINT DF_LabReferenceRanges_Gender DEFAULT ('any'),
    AgeFrom       SMALLINT NOT NULL CONSTRAINT DF_LabReferenceRanges_AgeFrom DEFAULT (0),
    AgeFromUnit   CHAR(1) NOT NULL CONSTRAINT DF_LabReferenceRanges_AgeFromUnit DEFAULT ('y'),
    AgeTo         SMALLINT NULL,                    -- NULL = no upper limit; the band is [from, to)
    AgeToUnit     CHAR(1) NOT NULL CONSTRAINT DF_LabReferenceRanges_AgeToUnit DEFAULT ('y'),
    RefLow        DECIMAL(12,4) NULL,
    RefHigh       DECIMAL(12,4) NULL,
    RefText       NVARCHAR(100) NULL,
    CriticalLow   DECIMAL(12,4) NULL,
    CriticalHigh  DECIMAL(12,4) NULL,
    SortOrder     SMALLINT NOT NULL CONSTRAINT DF_LabReferenceRanges_Sort DEFAULT (0),
    CreatedAt     DATETIME2(3) NOT NULL CONSTRAINT DF_LabReferenceRanges_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_LabReferenceRanges_Tenant_Id UNIQUE (TenantId, RangeId),
    CONSTRAINT FK_LabReferenceRanges_Test FOREIGN KEY (TenantId, LabTestId) REFERENCES hms.LabTests (TenantId, LabTestId),
    CONSTRAINT FK_LabReferenceRanges_Param FOREIGN KEY (TenantId, ParameterId) REFERENCES hms.LabTestParameters (TenantId, ParameterId),
    CONSTRAINT CK_LabReferenceRanges_Gender CHECK (Gender IN ('any','male','female')),
    CONSTRAINT CK_LabReferenceRanges_Units CHECK (AgeFromUnit IN ('d','m','y') AND AgeToUnit IN ('d','m','y')),
    CONSTRAINT CK_LabReferenceRanges_Ages CHECK (AgeFrom >= 0 AND (AgeTo IS NULL OR AgeTo > 0)),
    CONSTRAINT CK_LabReferenceRanges_Range CHECK (RefLow IS NULL OR RefHigh IS NULL OR RefHigh >= RefLow),
    CONSTRAINT CK_LabReferenceRanges_Critical CHECK (CriticalLow IS NULL OR CriticalHigh IS NULL OR CriticalHigh > CriticalLow)
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LabReferenceRanges_Test' AND object_id = OBJECT_ID('hms.LabReferenceRanges'))
    CREATE INDEX IX_LabReferenceRanges_Test ON hms.LabReferenceRanges (TenantId, LabTestId, ParameterId);

IF COL_LENGTH('hms.LabTests', 'CriticalLow') IS NULL           ALTER TABLE hms.LabTests ADD CriticalLow DECIMAL(12,4) NULL;
IF COL_LENGTH('hms.LabTests', 'CriticalHigh') IS NULL          ALTER TABLE hms.LabTests ADD CriticalHigh DECIMAL(12,4) NULL;
IF COL_LENGTH('hms.LabTestParameters', 'CriticalLow') IS NULL  ALTER TABLE hms.LabTestParameters ADD CriticalLow DECIMAL(12,4) NULL;
IF COL_LENGTH('hms.LabTestParameters', 'CriticalHigh') IS NULL ALTER TABLE hms.LabTestParameters ADD CriticalHigh DECIMAL(12,4) NULL;

IF COL_LENGTH('hms.LabOrderItems', 'CriticalLow') IS NULL         ALTER TABLE hms.LabOrderItems ADD CriticalLow DECIMAL(12,4) NULL;
IF COL_LENGTH('hms.LabOrderItems', 'CriticalHigh') IS NULL        ALTER TABLE hms.LabOrderItems ADD CriticalHigh DECIMAL(12,4) NULL;
IF COL_LENGTH('hms.LabOrderItems', 'RangeLabel') IS NULL          ALTER TABLE hms.LabOrderItems ADD RangeLabel NVARCHAR(60) NULL;
IF COL_LENGTH('hms.LabOrderItems', 'CriticalAt') IS NULL          ALTER TABLE hms.LabOrderItems ADD CriticalAt DATETIME2(3) NULL;
IF COL_LENGTH('hms.LabOrderItems', 'CriticalAckByUserId') IS NULL ALTER TABLE hms.LabOrderItems ADD CriticalAckByUserId BIGINT NULL;
IF COL_LENGTH('hms.LabOrderItems', 'CriticalAckAt') IS NULL       ALTER TABLE hms.LabOrderItems ADD CriticalAckAt DATETIME2(3) NULL;
IF COL_LENGTH('hms.LabOrders', 'CriticalAckNote') IS NULL         ALTER TABLE hms.LabOrders ADD CriticalAckNote NVARCHAR(300) NULL;  -- who was informed (latest acknowledgement)

IF COL_LENGTH('hms.LabResultValues', 'CriticalLow') IS NULL         ALTER TABLE hms.LabResultValues ADD CriticalLow DECIMAL(12,4) NULL;
IF COL_LENGTH('hms.LabResultValues', 'CriticalHigh') IS NULL        ALTER TABLE hms.LabResultValues ADD CriticalHigh DECIMAL(12,4) NULL;
IF COL_LENGTH('hms.LabResultValues', 'RangeLabel') IS NULL          ALTER TABLE hms.LabResultValues ADD RangeLabel NVARCHAR(60) NULL;
IF COL_LENGTH('hms.LabResultValues', 'CriticalAt') IS NULL          ALTER TABLE hms.LabResultValues ADD CriticalAt DATETIME2(3) NULL;
IF COL_LENGTH('hms.LabResultValues', 'CriticalAckByUserId') IS NULL ALTER TABLE hms.LabResultValues ADD CriticalAckByUserId BIGINT NULL;
IF COL_LENGTH('hms.LabResultValues', 'CriticalAckAt') IS NULL       ALTER TABLE hms.LabResultValues ADD CriticalAckAt DATETIME2(3) NULL;
GO

/* Wider flag lists (drop and re-create the CHECKs; values stay within NVARCHAR(10)). */
IF OBJECT_ID('hms.CK_LabOrderItems_Flag', 'C') IS NOT NULL ALTER TABLE hms.LabOrderItems DROP CONSTRAINT CK_LabOrderItems_Flag;
ALTER TABLE hms.LabOrderItems ADD CONSTRAINT CK_LabOrderItems_Flag CHECK (Flag IS NULL OR Flag IN ('normal','low','high','abnormal','crit_low','crit_high'));
IF OBJECT_ID('hms.CK_LabResultValues_Flag', 'C') IS NOT NULL ALTER TABLE hms.LabResultValues DROP CONSTRAINT CK_LabResultValues_Flag;
ALTER TABLE hms.LabResultValues ADD CONSTRAINT CK_LabResultValues_Flag CHECK (Flag IS NULL OR Flag IN ('normal','low','high','abnormal','crit_low','crit_high'));

IF OBJECT_ID('hms.CK_LabTests_Critical', 'C') IS NULL
    ALTER TABLE hms.LabTests ADD CONSTRAINT CK_LabTests_Critical CHECK (CriticalLow IS NULL OR CriticalHigh IS NULL OR CriticalHigh > CriticalLow);
IF OBJECT_ID('hms.CK_LabTestParameters_Critical', 'C') IS NULL
    ALTER TABLE hms.LabTestParameters ADD CONSTRAINT CK_LabTestParameters_Critical CHECK (CriticalLow IS NULL OR CriticalHigh IS NULL OR CriticalHigh > CriticalLow);
IF OBJECT_ID('hms.FK_LabOrderItems_CriticalAckBy', 'F') IS NULL
    ALTER TABLE hms.LabOrderItems ADD CONSTRAINT FK_LabOrderItems_CriticalAckBy FOREIGN KEY (TenantId, CriticalAckByUserId) REFERENCES hms.Users (TenantId, UserId);
IF OBJECT_ID('hms.FK_LabResultValues_CriticalAckBy', 'F') IS NULL
    ALTER TABLE hms.LabResultValues ADD CONSTRAINT FK_LabResultValues_CriticalAckBy FOREIGN KEY (TenantId, CriticalAckByUserId) REFERENCES hms.Users (TenantId, UserId);

/* Open critical results (critical, not yet acknowledged) are listed per hospital. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LabOrderItems_OpenCritical' AND object_id = OBJECT_ID('hms.LabOrderItems'))
    CREATE INDEX IX_LabOrderItems_OpenCritical ON hms.LabOrderItems (TenantId, CriticalAt) WHERE CriticalAt IS NOT NULL AND CriticalAckAt IS NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LabResultValues_OpenCritical' AND object_id = OBJECT_ID('hms.LabResultValues'))
    CREATE INDEX IX_LabResultValues_OpenCritical ON hms.LabResultValues (TenantId, CriticalAt) WHERE CriticalAt IS NOT NULL AND CriticalAckAt IS NULL;
