/* 006 — Outgoing message log, login OTP challenges, secure lab-report share links, GST fields. Schema: hms. */

/* Every e-mail / WhatsApp the system sends (or would send in "log" mode). Recipients are stored MASKED
   (e.g. 98******10) so this table never becomes a list of patient phone numbers.
   DedupeKey makes scheduled messages (reminders, summaries) send at most once, even with several servers. */
CREATE TABLE hms.MessageLog (
    MessageId         BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_MessageLog PRIMARY KEY,
    TenantId          INT NULL CONSTRAINT FK_MessageLog_Tenants REFERENCES hms.Tenants(TenantId),
    Channel           NVARCHAR(10) NOT NULL,
    RecipientMasked   NVARCHAR(100) NOT NULL,
    Template          NVARCHAR(60) NOT NULL,
    Subject           NVARCHAR(200) NULL,
    Status            NVARCHAR(10) NOT NULL CONSTRAINT DF_MessageLog_Status DEFAULT ('pending'),
    Error             NVARCHAR(400) NULL,
    ProviderMessageId NVARCHAR(200) NULL,
    RelatedType       NVARCHAR(30) NULL,
    RelatedId         NVARCHAR(50) NULL,
    DedupeKey         NVARCHAR(200) NULL,
    CreatedAt         DATETIME2(3) NOT NULL CONSTRAINT DF_MessageLog_CreatedAt DEFAULT (SYSUTCDATETIME()),
    SentAt            DATETIME2(3) NULL,
    CONSTRAINT CK_MessageLog_Channel CHECK (Channel IN ('email','whatsapp')),
    CONSTRAINT CK_MessageLog_Status CHECK (Status IN ('pending','sent','logged','failed','skipped'))
);
CREATE UNIQUE INDEX UX_MessageLog_Dedupe ON hms.MessageLog (DedupeKey) WHERE DedupeKey IS NOT NULL;
CREATE INDEX IX_MessageLog_Tenant ON hms.MessageLog (TenantId, CreatedAt DESC);

/* One-time codes for 2-step login. Only a hash of the code is stored. */
CREATE TABLE hms.LoginChallenges (
    ChallengeId  UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_LoginChallenges PRIMARY KEY CONSTRAINT DF_LoginChallenges_Id DEFAULT (NEWID()),
    SubjectType  NVARCHAR(10) NOT NULL,
    SubjectId    BIGINT NOT NULL,
    TenantId     INT NULL,
    CodeHash     CHAR(64) NOT NULL,
    ExpiresAt    DATETIME2(3) NOT NULL,
    Attempts     INT NOT NULL CONSTRAINT DF_LoginChallenges_Attempts DEFAULT (0),
    ConsumedAt   DATETIME2(3) NULL,
    IpAddress    NVARCHAR(64) NULL,
    CreatedAt    DATETIME2(3) NOT NULL CONSTRAINT DF_LoginChallenges_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT CK_LoginChallenges_Subject CHECK (SubjectType IN ('tenant','platform'))
);
CREATE INDEX IX_LoginChallenges_Subject ON hms.LoginChallenges (SubjectType, SubjectId, CreatedAt DESC);

/* Secure links that let a patient download a VERIFIED lab report after entering an OTP.
   The link token and OTP are stored only as SHA-256 hashes; links expire and can be revoked. */
CREATE TABLE hms.ReportShares (
    ShareId          BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ReportShares PRIMARY KEY,
    TenantId         INT NOT NULL,
    LabOrderId       BIGINT NOT NULL,
    TokenHash        CHAR(64) NOT NULL,
    Channel          NVARCHAR(10) NOT NULL,
    ExpiresAt        DATETIME2(3) NOT NULL,
    OtpHash          CHAR(64) NULL,
    OtpExpiresAt     DATETIME2(3) NULL,
    OtpAttempts      INT NOT NULL CONSTRAINT DF_ReportShares_OtpAttempts DEFAULT (0),
    OtpSends         INT NOT NULL CONSTRAINT DF_ReportShares_OtpSends DEFAULT (0),
    AccessCount      INT NOT NULL CONSTRAINT DF_ReportShares_Access DEFAULT (0),
    LastAccessAt     DATETIME2(3) NULL,
    RevokedAt        DATETIME2(3) NULL,
    CreatedByUserId  BIGINT NULL,
    CreatedAt        DATETIME2(3) NOT NULL CONSTRAINT DF_ReportShares_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_ReportShares_Token UNIQUE (TokenHash),
    CONSTRAINT FK_ReportShares_Orders FOREIGN KEY (TenantId, LabOrderId) REFERENCES hms.LabOrders (TenantId, LabOrderId),
    CONSTRAINT CK_ReportShares_Channel CHECK (Channel IN ('email','whatsapp'))
);
CREATE INDEX IX_ReportShares_Order ON hms.ReportShares (TenantId, LabOrderId);

/* GST: HSN/SAC per bill line (medicines already carry HsnCode), inter-state flag and buyer GSTIN per bill. */
ALTER TABLE hms.BillItems ADD HsnSac NVARCHAR(10) NULL;
ALTER TABLE hms.Bills ADD
    IsInterState BIT NOT NULL CONSTRAINT DF_Bills_InterState DEFAULT (0),
    BuyerGstin   NVARCHAR(15) NULL;
