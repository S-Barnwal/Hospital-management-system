/* =====================================================================
   001_platform.sql — SaaS platform tables (tenants, plans, billing, auth)
   Target: Microsoft SQL Server 2016+ / Azure SQL
   All timestamps are UTC (SYSUTCDATETIME). Money is DECIMAL(12,2).
   Applied by backend/src/db/migrate.js (tracked in hms.SchemaMigrations).
   All objects live in the [hms] schema so they never clash with other
   applications' tables (e.g. an existing dbo.Users / dbo.Payments).
   ===================================================================== */

IF SCHEMA_ID('hms') IS NULL EXEC('CREATE SCHEMA hms AUTHORIZATION dbo');
GO

/* ---------- Plans ---------- */
CREATE TABLE hms.Plans (
    PlanId            INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Plans PRIMARY KEY,
    Code              NVARCHAR(50)  NOT NULL CONSTRAINT UQ_Plans_Code UNIQUE,
    Name              NVARCHAR(100) NOT NULL,
    Tagline           NVARCHAR(200) NULL,
    Description       NVARCHAR(1000) NULL,
    MonthlyPrice      DECIMAL(12,2) NULL,      -- NULL = contact sales
    AnnualPrice       DECIMAL(12,2) NULL,
    Currency          CHAR(3)       NOT NULL CONSTRAINT DF_Plans_Currency DEFAULT ('INR'),
    TaxRatePercent    DECIMAL(5,2)  NOT NULL CONSTRAINT DF_Plans_Tax DEFAULT (18.00),
    MaxStaffUsers     INT NULL,                -- NULL = unlimited
    MaxBranches       INT NULL,
    MaxPatients       INT NULL,
    IsPopular         BIT NOT NULL CONSTRAINT DF_Plans_Popular DEFAULT (0),
    IsContactSales    BIT NOT NULL CONSTRAINT DF_Plans_ContactSales DEFAULT (0),
    SortOrder         INT NOT NULL CONSTRAINT DF_Plans_Sort DEFAULT (0),
    IsActive          BIT NOT NULL CONSTRAINT DF_Plans_Active DEFAULT (1),
    CreatedAt         DATETIME2(3) NOT NULL CONSTRAINT DF_Plans_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt         DATETIME2(3) NOT NULL CONSTRAINT DF_Plans_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT CK_Plans_Prices CHECK (
        (IsContactSales = 1) OR (MonthlyPrice IS NOT NULL AND MonthlyPrice >= 0 AND AnnualPrice IS NOT NULL AND AnnualPrice >= 0)),
    CONSTRAINT CK_Plans_Tax CHECK (TaxRatePercent >= 0 AND TaxRatePercent <= 100)
);

CREATE TABLE hms.PlanFeatures (
    PlanFeatureId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PlanFeatures PRIMARY KEY,
    PlanId        INT NOT NULL CONSTRAINT FK_PlanFeatures_Plans REFERENCES hms.Plans(PlanId) ON DELETE CASCADE,
    FeatureKey    NVARCHAR(60)  NOT NULL,      -- module key e.g. patients, appointments, billing
    Label         NVARCHAR(200) NOT NULL,
    IsIncluded    BIT NOT NULL CONSTRAINT DF_PlanFeatures_Included DEFAULT (1),
    SortOrder     INT NOT NULL CONSTRAINT DF_PlanFeatures_Sort DEFAULT (0),
    CONSTRAINT UQ_PlanFeatures UNIQUE (PlanId, FeatureKey)
);

/* ---------- Tenants ---------- */
CREATE TABLE hms.Tenants (
    TenantId      INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Tenants PRIMARY KEY,
    Slug          NVARCHAR(63)  NOT NULL CONSTRAINT UQ_Tenants_Slug UNIQUE,
    Name          NVARCHAR(200) NOT NULL,
    Email         NVARCHAR(254) NULL,
    Phone         NVARCHAR(30)  NULL,
    City          NVARCHAR(100) NULL,
    State         NVARCHAR(100) NULL,
    Country       CHAR(2) NOT NULL CONSTRAINT DF_Tenants_Country DEFAULT ('IN'),
    FacilityType  NVARCHAR(40)  NULL,
    Status        NVARCHAR(20)  NOT NULL CONSTRAINT DF_Tenants_Status DEFAULT ('pending'),
    Timezone      NVARCHAR(64)  NOT NULL CONSTRAINT DF_Tenants_Tz DEFAULT ('Asia/Kolkata'),  -- IANA name
    Currency      CHAR(3)       NOT NULL CONSTRAINT DF_Tenants_Currency DEFAULT ('INR'),
    SuspendedReason NVARCHAR(500) NULL,
    CreatedAt     DATETIME2(3) NOT NULL CONSTRAINT DF_Tenants_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt     DATETIME2(3) NOT NULL CONSTRAINT DF_Tenants_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT CK_Tenants_Status CHECK (Status IN ('pending','active','suspended','deactivated')),
    CONSTRAINT CK_Tenants_Slug CHECK (Slug NOT LIKE '%[^a-z0-9-]%' AND LEN(Slug) >= 3)
);

CREATE TABLE hms.TenantDomains (
    TenantDomainId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_TenantDomains PRIMARY KEY,
    TenantId       INT NOT NULL CONSTRAINT FK_TenantDomains_Tenants REFERENCES hms.Tenants(TenantId),
    Hostname       NVARCHAR(253) NOT NULL CONSTRAINT UQ_TenantDomains_Host UNIQUE,
    IsPrimary      BIT NOT NULL CONSTRAINT DF_TenantDomains_Primary DEFAULT (0),
    IsVerified     BIT NOT NULL CONSTRAINT DF_TenantDomains_Verified DEFAULT (0),
    CreatedAt      DATETIME2(3) NOT NULL CONSTRAINT DF_TenantDomains_CreatedAt DEFAULT (SYSUTCDATETIME())
);

CREATE TABLE hms.TenantSettings (
    TenantId     INT NOT NULL CONSTRAINT FK_TenantSettings_Tenants REFERENCES hms.Tenants(TenantId),
    SettingKey   NVARCHAR(100) NOT NULL,
    SettingValue NVARCHAR(2000) NULL,
    UpdatedAt    DATETIME2(3) NOT NULL CONSTRAINT DF_TenantSettings_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_TenantSettings PRIMARY KEY (TenantId, SettingKey)
);

/* Per-tenant counters for patient numbers, appointment numbers, invoice numbers.
   Incremented inside a transaction with UPDLOCK so numbers are sequential and unique per tenant. */
CREATE TABLE hms.TenantSequences (
    TenantId    INT NOT NULL CONSTRAINT FK_TenantSequences_Tenants REFERENCES hms.Tenants(TenantId),
    SequenceKey NVARCHAR(40) NOT NULL,
    NextValue   BIGINT NOT NULL CONSTRAINT DF_TenantSequences_Next DEFAULT (1),
    CONSTRAINT PK_TenantSequences PRIMARY KEY (TenantId, SequenceKey)
);

/* ---------- RBAC ---------- */
CREATE TABLE hms.Permissions (
    PermissionId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Permissions PRIMARY KEY,
    Code         NVARCHAR(80)  NOT NULL CONSTRAINT UQ_Permissions_Code UNIQUE,
    Module       NVARCHAR(40)  NOT NULL,
    Description  NVARCHAR(300) NULL
);

/* Roles are tenant-owned: provisioning copies the default role templates into every tenant,
   so a hospital can customise its own roles without affecting others. */
CREATE TABLE hms.Roles (
    RoleId      INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Roles PRIMARY KEY,
    TenantId    INT NOT NULL CONSTRAINT FK_Roles_Tenants REFERENCES hms.Tenants(TenantId),
    Code        NVARCHAR(50)  NOT NULL,
    Name        NVARCHAR(100) NOT NULL,
    Description NVARCHAR(300) NULL,
    IsSystem    BIT NOT NULL CONSTRAINT DF_Roles_System DEFAULT (0),
    CreatedAt   DATETIME2(3) NOT NULL CONSTRAINT DF_Roles_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_Roles_Tenant_Code UNIQUE (TenantId, Code),
    CONSTRAINT UQ_Roles_Tenant_Id UNIQUE (TenantId, RoleId)          -- target for composite FKs
);

CREATE TABLE hms.RolePermissions (
    RoleId       INT NOT NULL CONSTRAINT FK_RolePermissions_Roles REFERENCES hms.Roles(RoleId) ON DELETE CASCADE,
    PermissionId INT NOT NULL CONSTRAINT FK_RolePermissions_Permissions REFERENCES hms.Permissions(PermissionId),
    CONSTRAINT PK_RolePermissions PRIMARY KEY (RoleId, PermissionId)
);

/* Hospital (tenant) users. Platform super admins live in hms.PlatformUsers — deliberately separate. */
CREATE TABLE hms.Users (
    UserId           BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Users PRIMARY KEY,
    TenantId         INT NOT NULL CONSTRAINT FK_Users_Tenants REFERENCES hms.Tenants(TenantId),
    Email            NVARCHAR(254) NOT NULL,
    PasswordHash     NVARCHAR(200) NOT NULL,
    FullName         NVARCHAR(150) NOT NULL,
    Phone            NVARCHAR(30)  NULL,
    Status           NVARCHAR(20)  NOT NULL CONSTRAINT DF_Users_Status DEFAULT ('active'),
    IsOwner          BIT NOT NULL CONSTRAINT DF_Users_Owner DEFAULT (0),
    FailedLoginCount INT NOT NULL CONSTRAINT DF_Users_Failed DEFAULT (0),
    LockedUntil      DATETIME2(3) NULL,
    LastLoginAt      DATETIME2(3) NULL,
    CreatedAt        DATETIME2(3) NOT NULL CONSTRAINT DF_Users_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt        DATETIME2(3) NOT NULL CONSTRAINT DF_Users_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_Users_Tenant_Email UNIQUE (TenantId, Email),
    CONSTRAINT UQ_Users_Tenant_Id UNIQUE (TenantId, UserId),
    CONSTRAINT CK_Users_Status CHECK (Status IN ('active','invited','disabled'))
);
CREATE INDEX IX_Users_Email ON hms.Users (Email);

/* Composite FKs guarantee a user can only hold roles of their own tenant. */
CREATE TABLE hms.UserRoles (
    TenantId INT    NOT NULL,
    UserId   BIGINT NOT NULL,
    RoleId   INT    NOT NULL,
    CONSTRAINT PK_UserRoles PRIMARY KEY (TenantId, UserId, RoleId),
    CONSTRAINT FK_UserRoles_Users FOREIGN KEY (TenantId, UserId) REFERENCES hms.Users (TenantId, UserId) ON DELETE CASCADE,
    CONSTRAINT FK_UserRoles_Roles FOREIGN KEY (TenantId, RoleId) REFERENCES hms.Roles (TenantId, RoleId)
);

CREATE TABLE hms.PlatformUsers (
    PlatformUserId   INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PlatformUsers PRIMARY KEY,
    Email            NVARCHAR(254) NOT NULL CONSTRAINT UQ_PlatformUsers_Email UNIQUE,
    PasswordHash     NVARCHAR(200) NOT NULL,
    FullName         NVARCHAR(150) NOT NULL,
    Role             NVARCHAR(30)  NOT NULL CONSTRAINT DF_PlatformUsers_Role DEFAULT ('super_admin'),
    Status           NVARCHAR(20)  NOT NULL CONSTRAINT DF_PlatformUsers_Status DEFAULT ('active'),
    FailedLoginCount INT NOT NULL CONSTRAINT DF_PlatformUsers_Failed DEFAULT (0),
    LockedUntil      DATETIME2(3) NULL,
    LastLoginAt      DATETIME2(3) NULL,
    CreatedAt        DATETIME2(3) NOT NULL CONSTRAINT DF_PlatformUsers_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT CK_PlatformUsers_Role CHECK (Role IN ('super_admin','support')),
    CONSTRAINT CK_PlatformUsers_Status CHECK (Status IN ('active','disabled'))
);

/* Refresh sessions (rotated on every refresh, revocable). Only SHA-256 hashes of tokens are stored. */
CREATE TABLE hms.UserSessions (
    SessionId        UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_UserSessions PRIMARY KEY,
    SubjectType      NVARCHAR(10) NOT NULL,     -- 'tenant' | 'platform'
    SubjectId        BIGINT NOT NULL,
    TenantId         INT NULL,
    RefreshTokenHash CHAR(64) NOT NULL CONSTRAINT UQ_UserSessions_Hash UNIQUE,
    ExpiresAt        DATETIME2(3) NOT NULL,
    RevokedAt        DATETIME2(3) NULL,
    UserAgent        NVARCHAR(300) NULL,
    IpAddress        NVARCHAR(64)  NULL,
    CreatedAt        DATETIME2(3) NOT NULL CONSTRAINT DF_UserSessions_CreatedAt DEFAULT (SYSUTCDATETIME()),
    LastUsedAt       DATETIME2(3) NULL,
    CONSTRAINT CK_UserSessions_Subject CHECK (SubjectType IN ('tenant','platform'))
);
CREATE INDEX IX_UserSessions_Subject ON hms.UserSessions (SubjectType, SubjectId) INCLUDE (RevokedAt, ExpiresAt);

CREATE TABLE hms.PasswordResetTokens (
    TokenId     BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PasswordResetTokens PRIMARY KEY,
    SubjectType NVARCHAR(10) NOT NULL,
    SubjectId   BIGINT NOT NULL,
    TokenHash   CHAR(64) NOT NULL CONSTRAINT UQ_PasswordResetTokens_Hash UNIQUE,
    ExpiresAt   DATETIME2(3) NOT NULL,
    UsedAt      DATETIME2(3) NULL,
    CreatedAt   DATETIME2(3) NOT NULL CONSTRAINT DF_PasswordResetTokens_CreatedAt DEFAULT (SYSUTCDATETIME())
);

/* ---------- Onboarding, subscriptions, payments ---------- */
CREATE TABLE hms.OnboardingRequests (
    OnboardingId      UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_OnboardingRequests PRIMARY KEY,
    PlanId            INT NOT NULL CONSTRAINT FK_Onboarding_Plans REFERENCES hms.Plans(PlanId),
    BillingInterval   NVARCHAR(10) NOT NULL,
    OrgName           NVARCHAR(200) NOT NULL,
    Slug              NVARCHAR(63)  NOT NULL,
    FacilityType      NVARCHAR(40)  NULL,
    City              NVARCHAR(100) NULL,
    Phone             NVARCHAR(30)  NULL,
    OwnerName         NVARCHAR(150) NOT NULL,
    OwnerEmail        NVARCHAR(254) NOT NULL,
    OwnerPasswordHash NVARCHAR(200) NOT NULL,   -- bcrypt hash only; never plaintext
    Subtotal          DECIMAL(12,2) NOT NULL,
    TaxAmount         DECIMAL(12,2) NOT NULL,
    TotalAmount       DECIMAL(12,2) NOT NULL,
    Currency          CHAR(3) NOT NULL,
    Status            NVARCHAR(20) NOT NULL CONSTRAINT DF_Onboarding_Status DEFAULT ('pending_payment'),
    TenantId          INT NULL CONSTRAINT FK_Onboarding_Tenants REFERENCES hms.Tenants(TenantId),
    FailureReason     NVARCHAR(500) NULL,
    ExpiresAt         DATETIME2(3) NOT NULL,
    CreatedAt         DATETIME2(3) NOT NULL CONSTRAINT DF_Onboarding_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt         DATETIME2(3) NOT NULL CONSTRAINT DF_Onboarding_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT CK_Onboarding_Interval CHECK (BillingInterval IN ('monthly','annual')),
    CONSTRAINT CK_Onboarding_Status CHECK (Status IN ('pending_payment','paid','provisioned','failed','cancelled','expired'))
);
CREATE INDEX IX_Onboarding_Slug ON hms.OnboardingRequests (Slug, Status);

CREATE TABLE hms.Subscriptions (
    SubscriptionId     INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Subscriptions PRIMARY KEY,
    TenantId           INT NOT NULL CONSTRAINT FK_Subscriptions_Tenants REFERENCES hms.Tenants(TenantId),
    PlanId             INT NOT NULL CONSTRAINT FK_Subscriptions_Plans REFERENCES hms.Plans(PlanId),
    BillingInterval    NVARCHAR(10) NOT NULL,
    Status             NVARCHAR(20) NOT NULL,
    CurrentPeriodStart DATETIME2(3) NOT NULL,
    CurrentPeriodEnd   DATETIME2(3) NOT NULL,
    GraceDays          INT NOT NULL CONSTRAINT DF_Subscriptions_Grace DEFAULT (7),
    CancelAtPeriodEnd  BIT NOT NULL CONSTRAINT DF_Subscriptions_Cancel DEFAULT (0),
    CreatedAt          DATETIME2(3) NOT NULL CONSTRAINT DF_Subscriptions_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt          DATETIME2(3) NOT NULL CONSTRAINT DF_Subscriptions_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT CK_Subscriptions_Interval CHECK (BillingInterval IN ('monthly','annual')),
    CONSTRAINT CK_Subscriptions_Status CHECK (Status IN ('pending','active','past_due','expired','cancelled'))
);
CREATE INDEX IX_Subscriptions_Tenant ON hms.Subscriptions (TenantId, Status) INCLUDE (CurrentPeriodEnd);

CREATE TABLE hms.Payments (
    PaymentId         BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Payments PRIMARY KEY,
    TenantId          INT NULL CONSTRAINT FK_Payments_Tenants REFERENCES hms.Tenants(TenantId),
    OnboardingId      UNIQUEIDENTIFIER NULL CONSTRAINT FK_Payments_Onboarding REFERENCES hms.OnboardingRequests(OnboardingId),
    SubscriptionId    INT NULL CONSTRAINT FK_Payments_Subscriptions REFERENCES hms.Subscriptions(SubscriptionId),
    Purpose           NVARCHAR(20) NOT NULL,      -- 'onboarding' | 'renewal'
    PlanId            INT NULL CONSTRAINT FK_Payments_Plans REFERENCES hms.Plans(PlanId),
    BillingInterval   NVARCHAR(10) NULL,
    Provider          NVARCHAR(20) NOT NULL,      -- 'razorpay' | 'stripe' | 'sandbox'
    IsSandbox         BIT NOT NULL,
    ProviderOrderId   NVARCHAR(100) NOT NULL CONSTRAINT UQ_Payments_Order UNIQUE,
    ProviderPaymentId NVARCHAR(100) NULL,
    Subtotal          DECIMAL(12,2) NOT NULL,
    TaxAmount         DECIMAL(12,2) NOT NULL,
    Amount            DECIMAL(12,2) NOT NULL,     -- total charged = Subtotal + TaxAmount
    Currency          CHAR(3) NOT NULL,
    Status            NVARCHAR(20) NOT NULL CONSTRAINT DF_Payments_Status DEFAULT ('created'),
    FailureReason     NVARCHAR(500) NULL,
    CreatedAt         DATETIME2(3) NOT NULL CONSTRAINT DF_Payments_CreatedAt DEFAULT (SYSUTCDATETIME()),
    PaidAt            DATETIME2(3) NULL,
    UpdatedAt         DATETIME2(3) NOT NULL CONSTRAINT DF_Payments_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT CK_Payments_Status CHECK (Status IN ('created','paid','failed','cancelled','refunded','expired')),
    CONSTRAINT CK_Payments_Amount CHECK (Amount >= 0)
);
CREATE UNIQUE INDEX UX_Payments_ProviderPayment ON hms.Payments (Provider, ProviderPaymentId) WHERE ProviderPaymentId IS NOT NULL;
CREATE INDEX IX_Payments_Tenant ON hms.Payments (TenantId, CreatedAt DESC);

/* Webhook idempotency: each provider event is processed at most once. */
CREATE TABLE hms.PaymentEvents (
    PaymentEventId  BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PaymentEvents PRIMARY KEY,
    Provider        NVARCHAR(20)  NOT NULL,
    ProviderEventId NVARCHAR(150) NOT NULL,
    EventType       NVARCHAR(100) NOT NULL,
    ProviderOrderId NVARCHAR(100) NULL,
    ReceivedAt      DATETIME2(3) NOT NULL CONSTRAINT DF_PaymentEvents_ReceivedAt DEFAULT (SYSUTCDATETIME()),
    ProcessedAt     DATETIME2(3) NULL,
    Outcome         NVARCHAR(200) NULL,
    CONSTRAINT UQ_PaymentEvents UNIQUE (Provider, ProviderEventId)
);

CREATE TABLE hms.Invoices (
    InvoiceId     BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Invoices PRIMARY KEY,
    TenantId      INT NOT NULL CONSTRAINT FK_Invoices_Tenants REFERENCES hms.Tenants(TenantId),
    PaymentId     BIGINT NOT NULL CONSTRAINT FK_Invoices_Payments REFERENCES hms.Payments(PaymentId),
    InvoiceNumber NVARCHAR(40) NOT NULL CONSTRAINT UQ_Invoices_Number UNIQUE,
    Description   NVARCHAR(300) NOT NULL,
    Subtotal      DECIMAL(12,2) NOT NULL,
    TaxAmount     DECIMAL(12,2) NOT NULL,
    Total         DECIMAL(12,2) NOT NULL,
    Currency      CHAR(3) NOT NULL,
    IsSandbox     BIT NOT NULL,
    IssuedAt      DATETIME2(3) NOT NULL CONSTRAINT DF_Invoices_IssuedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_Invoices_Payment UNIQUE (PaymentId)
);

/* ---------- Sales / support ---------- */
CREATE TABLE hms.DemoRequests (
    DemoRequestId   INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_DemoRequests PRIMARY KEY,
    OrgName         NVARCHAR(200) NOT NULL,
    ContactName     NVARCHAR(150) NOT NULL,
    Email           NVARCHAR(254) NOT NULL,
    Phone           NVARCHAR(30)  NOT NULL,
    City            NVARCHAR(100) NULL,
    FacilityType    NVARCHAR(40)  NULL,
    ExpectedUsers   INT NULL,
    PreferredAt     DATETIME2(3) NULL,
    Message         NVARCHAR(2000) NULL,
    Status          NVARCHAR(20) NOT NULL CONSTRAINT DF_DemoRequests_Status DEFAULT ('new'),
    AssignedTo      INT NULL CONSTRAINT FK_DemoRequests_PlatformUsers REFERENCES hms.PlatformUsers(PlatformUserId),
    SourceIp        NVARCHAR(64) NULL,
    CreatedAt       DATETIME2(3) NOT NULL CONSTRAINT DF_DemoRequests_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt       DATETIME2(3) NOT NULL CONSTRAINT DF_DemoRequests_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT CK_DemoRequests_Status CHECK (Status IN ('new','contacted','scheduled','completed','closed'))
);
CREATE INDEX IX_DemoRequests_Status ON hms.DemoRequests (Status, CreatedAt DESC);

CREATE TABLE hms.DemoRequestNotes (
    NoteId         INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_DemoRequestNotes PRIMARY KEY,
    DemoRequestId  INT NOT NULL CONSTRAINT FK_DemoRequestNotes_Demo REFERENCES hms.DemoRequests(DemoRequestId) ON DELETE CASCADE,
    PlatformUserId INT NOT NULL CONSTRAINT FK_DemoRequestNotes_User REFERENCES hms.PlatformUsers(PlatformUserId),
    Note           NVARCHAR(2000) NOT NULL,
    CreatedAt      DATETIME2(3) NOT NULL CONSTRAINT DF_DemoRequestNotes_CreatedAt DEFAULT (SYSUTCDATETIME())
);

CREATE TABLE hms.ContactMessages (
    ContactMessageId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ContactMessages PRIMARY KEY,
    Name      NVARCHAR(150) NOT NULL,
    Email     NVARCHAR(254) NOT NULL,
    Phone     NVARCHAR(30)  NULL,
    Subject   NVARCHAR(200) NULL,
    Message   NVARCHAR(4000) NOT NULL,
    Status    NVARCHAR(20) NOT NULL CONSTRAINT DF_ContactMessages_Status DEFAULT ('new'),
    SourceIp  NVARCHAR(64) NULL,
    CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_ContactMessages_CreatedAt DEFAULT (SYSUTCDATETIME())
);

CREATE TABLE hms.PlatformSettings (
    SettingKey   NVARCHAR(100) NOT NULL CONSTRAINT PK_PlatformSettings PRIMARY KEY,
    SettingValue NVARCHAR(4000) NULL,
    UpdatedAt    DATETIME2(3) NOT NULL CONSTRAINT DF_PlatformSettings_UpdatedAt DEFAULT (SYSUTCDATETIME())
);

/* ---------- Audit & notifications ---------- */
/* Never store passwords, tokens or clinical details in Metadata. */
CREATE TABLE hms.AuditLogs (
    AuditLogId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AuditLogs PRIMARY KEY,
    TenantId   INT NULL,                       -- NULL = platform-level event
    ActorType  NVARCHAR(10) NOT NULL,          -- 'tenant' | 'platform' | 'system' | 'public'
    ActorId    BIGINT NULL,
    Action     NVARCHAR(80) NOT NULL,
    EntityType NVARCHAR(50) NULL,
    EntityId   NVARCHAR(64) NULL,
    Metadata   NVARCHAR(2000) NULL,
    IpAddress  NVARCHAR(64) NULL,
    CreatedAt  DATETIME2(3) NOT NULL CONSTRAINT DF_AuditLogs_CreatedAt DEFAULT (SYSUTCDATETIME())
);
CREATE INDEX IX_AuditLogs_Tenant ON hms.AuditLogs (TenantId, CreatedAt DESC);
CREATE INDEX IX_AuditLogs_Action ON hms.AuditLogs (Action, CreatedAt DESC);

CREATE TABLE hms.Notifications (
    NotificationId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Notifications PRIMARY KEY,
    TenantId       INT NOT NULL CONSTRAINT FK_Notifications_Tenants REFERENCES hms.Tenants(TenantId),
    UserId         BIGINT NULL,
    Type           NVARCHAR(40) NOT NULL,
    Title          NVARCHAR(200) NOT NULL,
    Body           NVARCHAR(1000) NULL,
    IsRead         BIT NOT NULL CONSTRAINT DF_Notifications_Read DEFAULT (0),
    CreatedAt      DATETIME2(3) NOT NULL CONSTRAINT DF_Notifications_CreatedAt DEFAULT (SYSUTCDATETIME())
);
CREATE INDEX IX_Notifications_Tenant_User ON hms.Notifications (TenantId, UserId, IsRead, CreatedAt DESC);
