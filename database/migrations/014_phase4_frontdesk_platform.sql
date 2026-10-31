/* 014 — Phase 4.
   Hospital side: OPD token queue + public TV display screens, online appointment booking requests, doctor room,
   patient photo + ABHA (Ayushman Bharat Health Account) number/address.
   Platform side: sign-in history, background-job health, coupons, free trials, support tickets, hospital groups
   (multi-branch).
   Same multi-tenant rules: TenantId on every hospital row, (TenantId, Id) unique keys, composite foreign keys.
   Schema: hms. */

/* ───────── Front desk: token queue ───────── */
ALTER TABLE hms.StaffMembers ADD Room NVARCHAR(30) NULL;   -- consultation room / cabin shown on the TV screen
GO

CREATE TABLE hms.QueueTokens (
    TokenId         BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_QueueTokens PRIMARY KEY,
    TenantId        INT NOT NULL CONSTRAINT FK_QueueTokens_Tenants REFERENCES hms.Tenants(TenantId),
    TokenDate       DATE NOT NULL,                 -- hospital-local date; numbering restarts every day
    QueueKey        NVARCHAR(40) NOT NULL,         -- 'doctor:<StaffId>' | 'reception' | 'lab' | 'pharmacy' | 'billing'
    DoctorId        BIGINT NULL,
    TokenNumber     INT NOT NULL,
    PatientId       BIGINT NULL,
    AppointmentId   BIGINT NULL,
    Priority        BIT NOT NULL CONSTRAINT DF_QueueTokens_Priority DEFAULT (0),   -- senior citizen / emergency: called first
    Status          NVARCHAR(12) NOT NULL CONSTRAINT DF_QueueTokens_Status DEFAULT ('waiting'),
    Counter         NVARCHAR(30) NULL,             -- room / counter where the token was called
    CalledAt        DATETIME2(3) NULL,
    CallCount       SMALLINT NOT NULL CONSTRAINT DF_QueueTokens_Calls DEFAULT (0),
    DoneAt          DATETIME2(3) NULL,
    CreatedByUserId BIGINT NULL,
    CreatedAt       DATETIME2(3) NOT NULL CONSTRAINT DF_QueueTokens_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_QueueTokens_Tenant_Id UNIQUE (TenantId, TokenId),
    CONSTRAINT UQ_QueueTokens_Number UNIQUE (TenantId, TokenDate, QueueKey, TokenNumber),
    CONSTRAINT FK_QueueTokens_Doctor FOREIGN KEY (TenantId, DoctorId) REFERENCES hms.StaffMembers (TenantId, StaffId),
    CONSTRAINT FK_QueueTokens_Patient FOREIGN KEY (TenantId, PatientId) REFERENCES hms.Patients (TenantId, PatientId),
    CONSTRAINT FK_QueueTokens_Appointment FOREIGN KEY (TenantId, AppointmentId) REFERENCES hms.Appointments (TenantId, AppointmentId),
    CONSTRAINT CK_QueueTokens_Status CHECK (Status IN ('waiting','called','done','skipped','cancelled')),
    CONSTRAINT CK_QueueTokens_Number CHECK (TokenNumber > 0)
);
CREATE INDEX IX_QueueTokens_Queue ON hms.QueueTokens (TenantId, TokenDate, QueueKey, Status) INCLUDE (TokenNumber, Priority, CalledAt);
CREATE UNIQUE INDEX UX_QueueTokens_Appointment ON hms.QueueTokens (TenantId, AppointmentId) WHERE AppointmentId IS NOT NULL;

/* A TV / display screen opens a public URL with a long random token; only its SHA-256 hash is stored. */
CREATE TABLE hms.DisplayScreens (
    ScreenId        INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_DisplayScreens PRIMARY KEY,
    TenantId        INT NOT NULL CONSTRAINT FK_DisplayScreens_Tenants REFERENCES hms.Tenants(TenantId),
    Name            NVARCHAR(80) NOT NULL,
    QueueKeys       NVARCHAR(400) NULL,            -- comma list; NULL = every queue
    TokenHash       CHAR(64) NOT NULL CONSTRAINT UQ_DisplayScreens_Token UNIQUE,
    LastSeenAt      DATETIME2(3) NULL,
    RevokedAt       DATETIME2(3) NULL,
    CreatedByUserId BIGINT NULL,
    CreatedAt       DATETIME2(3) NOT NULL CONSTRAINT DF_DisplayScreens_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_DisplayScreens_Tenant_Id UNIQUE (TenantId, ScreenId)
);

/* ───────── Online booking requests (public page → staff confirms) ───────── */
CREATE TABLE hms.OnlineBookingRequests (
    BookingRequestId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_OnlineBookingRequests PRIMARY KEY,
    TenantId         INT NOT NULL CONSTRAINT FK_OnlineBookingRequests_Tenants REFERENCES hms.Tenants(TenantId),
    RefCode          CHAR(8) NOT NULL,
    DoctorId         BIGINT NOT NULL,
    StartAt          DATETIME2(0) NOT NULL,        -- requested slot (UTC)
    DurationMinutes  SMALLINT NOT NULL,
    PatientName      NVARCHAR(150) NOT NULL,
    Phone            NVARCHAR(30) NOT NULL,
    Email            NVARCHAR(254) NULL,
    Gender           NVARCHAR(10) NULL,
    AgeYears         TINYINT NULL,
    Reason           NVARCHAR(300) NULL,
    Status           NVARCHAR(12) NOT NULL CONSTRAINT DF_OnlineBooking_Status DEFAULT ('pending'),
    PatientId        BIGINT NULL,
    AppointmentId    BIGINT NULL,
    DecisionNote     NVARCHAR(300) NULL,
    DecidedByUserId  BIGINT NULL,
    DecidedAt        DATETIME2(3) NULL,
    IpHash           CHAR(64) NULL,                -- for abuse limits only; the raw IP is not kept
    CreatedAt        DATETIME2(3) NOT NULL CONSTRAINT DF_OnlineBooking_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_OnlineBooking_Tenant_Id UNIQUE (TenantId, BookingRequestId),
    CONSTRAINT UQ_OnlineBooking_Ref UNIQUE (TenantId, RefCode),
    CONSTRAINT FK_OnlineBooking_Doctor FOREIGN KEY (TenantId, DoctorId) REFERENCES hms.StaffMembers (TenantId, StaffId),
    CONSTRAINT FK_OnlineBooking_Patient FOREIGN KEY (TenantId, PatientId) REFERENCES hms.Patients (TenantId, PatientId),
    CONSTRAINT FK_OnlineBooking_Appointment FOREIGN KEY (TenantId, AppointmentId) REFERENCES hms.Appointments (TenantId, AppointmentId),
    CONSTRAINT CK_OnlineBooking_Status CHECK (Status IN ('pending','confirmed','rejected','cancelled'))
);
CREATE INDEX IX_OnlineBooking_Status ON hms.OnlineBookingRequests (TenantId, Status, StartAt);
CREATE INDEX IX_OnlineBooking_Phone ON hms.OnlineBookingRequests (TenantId, Phone, Status);

/* ───────── Patients: photo + ABHA ───────── */
ALTER TABLE hms.Patients ADD
    PhotoAttachmentId BIGINT NULL,
    AbhaNumber        CHAR(14) NULL,               -- 14 digits, stored without dashes
    AbhaAddress       NVARCHAR(100) NULL;          -- e.g. name@abdm
GO
ALTER TABLE hms.Patients ADD CONSTRAINT FK_Patients_Photo FOREIGN KEY (TenantId, PhotoAttachmentId) REFERENCES hms.Attachments (TenantId, AttachmentId);
ALTER TABLE hms.Patients ADD CONSTRAINT CK_Patients_Abha CHECK (AbhaNumber IS NULL OR AbhaNumber NOT LIKE '%[^0-9]%' AND LEN(AbhaNumber) = 14);
CREATE UNIQUE INDEX UX_Patients_Abha ON hms.Patients (TenantId, AbhaNumber) WHERE AbhaNumber IS NOT NULL;
CREATE UNIQUE INDEX UX_Patients_AbhaAddress ON hms.Patients (TenantId, AbhaAddress) WHERE AbhaAddress IS NOT NULL;

/* ───────── Sign-in history (hospital users and Super Admins) ───────── */
CREATE TABLE hms.LoginEvents (
    LoginEventId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_LoginEvents PRIMARY KEY,
    SubjectType  NVARCHAR(10) NOT NULL,             -- 'tenant' | 'platform'
    TenantId     INT NULL CONSTRAINT FK_LoginEvents_Tenants REFERENCES hms.Tenants(TenantId),
    UserId       BIGINT NULL,                       -- Users.UserId or PlatformUsers.PlatformUserId
    Email        NVARCHAR(254) NULL,
    Success      BIT NOT NULL,
    Reason       NVARCHAR(40) NULL,                 -- ok | bad_password | locked | disabled | otp_sent | otp_failed | tenant_inactive
    Ip           NVARCHAR(64) NULL,
    UserAgent    NVARCHAR(300) NULL,
    CreatedAt    DATETIME2(3) NOT NULL CONSTRAINT DF_LoginEvents_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT CK_LoginEvents_Subject CHECK (SubjectType IN ('tenant','platform'))
);
CREATE INDEX IX_LoginEvents_Tenant ON hms.LoginEvents (TenantId, CreatedAt DESC) INCLUDE (Success);
CREATE INDEX IX_LoginEvents_Created ON hms.LoginEvents (CreatedAt DESC) INCLUDE (SubjectType, Success);

/* ───────── Background job health (one row per job) ───────── */
CREATE TABLE hms.JobRuns (
    JobName        NVARCHAR(60) NOT NULL CONSTRAINT PK_JobRuns PRIMARY KEY,
    LastStartedAt  DATETIME2(3) NULL,
    LastFinishedAt DATETIME2(3) NULL,
    LastOk         BIT NULL,
    LastError      NVARCHAR(500) NULL,
    LastDurationMs INT NULL,
    RunCount       INT NOT NULL CONSTRAINT DF_JobRuns_Runs DEFAULT (0),
    FailCount      INT NOT NULL CONSTRAINT DF_JobRuns_Fails DEFAULT (0)
);

/* ───────── Coupons ───────── */
CREATE TABLE hms.Coupons (
    CouponId       INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Coupons PRIMARY KEY,
    Code           NVARCHAR(30) NOT NULL CONSTRAINT UQ_Coupons_Code UNIQUE,   -- stored upper-case
    Description    NVARCHAR(200) NULL,
    PercentOff     DECIMAL(5,2) NULL,
    AmountOff      DECIMAL(12,2) NULL,
    PlanCodes      NVARCHAR(300) NULL,             -- comma list; NULL = every plan
    Intervals      NVARCHAR(20) NULL,              -- 'monthly' | 'annual' | NULL = both
    AppliesTo      NVARCHAR(12) NOT NULL CONSTRAINT DF_Coupons_AppliesTo DEFAULT ('both'),
    ValidFrom      DATETIME2(0) NULL,
    ValidUntil     DATETIME2(0) NULL,
    MaxRedemptions INT NULL,
    Redeemed       INT NOT NULL CONSTRAINT DF_Coupons_Redeemed DEFAULT (0),
    OncePerHospital BIT NOT NULL CONSTRAINT DF_Coupons_Once DEFAULT (1),
    IsActive       BIT NOT NULL CONSTRAINT DF_Coupons_Active DEFAULT (1),
    CreatedAt      DATETIME2(3) NOT NULL CONSTRAINT DF_Coupons_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt      DATETIME2(3) NOT NULL CONSTRAINT DF_Coupons_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT CK_Coupons_Kind CHECK ((PercentOff IS NULL AND AmountOff IS NOT NULL) OR (PercentOff IS NOT NULL AND AmountOff IS NULL)),
    CONSTRAINT CK_Coupons_Percent CHECK (PercentOff IS NULL OR (PercentOff > 0 AND PercentOff <= 95)),
    CONSTRAINT CK_Coupons_Amount CHECK (AmountOff IS NULL OR AmountOff > 0),
    CONSTRAINT CK_Coupons_AppliesTo CHECK (AppliesTo IN ('signup','renewal','both')),
    CONSTRAINT CK_Coupons_Intervals CHECK (Intervals IS NULL OR Intervals IN ('monthly','annual'))
);

CREATE TABLE hms.CouponRedemptions (
    RedemptionId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CouponRedemptions PRIMARY KEY,
    CouponId     INT NOT NULL CONSTRAINT FK_CouponRedemptions_Coupons REFERENCES hms.Coupons(CouponId),
    TenantId     INT NULL CONSTRAINT FK_CouponRedemptions_Tenants REFERENCES hms.Tenants(TenantId),
    PaymentId    BIGINT NOT NULL CONSTRAINT FK_CouponRedemptions_Payments REFERENCES hms.Payments(PaymentId),
    Discount     DECIMAL(12,2) NOT NULL,
    RedeemedAt   DATETIME2(3) NOT NULL CONSTRAINT DF_CouponRedemptions_At DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_CouponRedemptions_Payment UNIQUE (PaymentId)
);
CREATE INDEX IX_CouponRedemptions_Tenant ON hms.CouponRedemptions (CouponId, TenantId);

ALTER TABLE hms.Payments ADD CouponId INT NULL CONSTRAINT FK_Payments_Coupons REFERENCES hms.Coupons(CouponId),
                             DiscountAmount DECIMAL(12,2) NOT NULL CONSTRAINT DF_Payments_Discount DEFAULT (0);
ALTER TABLE hms.OnboardingRequests ADD CouponId INT NULL, DiscountAmount DECIMAL(12,2) NOT NULL CONSTRAINT DF_Onboarding_Discount DEFAULT (0),
                                       IsTrial BIT NOT NULL CONSTRAINT DF_Onboarding_Trial DEFAULT (0);

/* ───────── Free trials ───────── */
ALTER TABLE hms.Plans ADD TrialDays INT NOT NULL CONSTRAINT DF_Plans_TrialDays DEFAULT (0)
    CONSTRAINT CK_Plans_TrialDays CHECK (TrialDays >= 0 AND TrialDays <= 90);
ALTER TABLE hms.Subscriptions ADD IsTrial BIT NOT NULL CONSTRAINT DF_Subscriptions_Trial DEFAULT (0);
GO

/* ───────── Support tickets (hospital ↔ platform). Hospitals are asked not to put patient details here. ───────── */
CREATE TABLE hms.SupportTickets (
    TicketId          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_SupportTickets PRIMARY KEY,
    TenantId          INT NOT NULL CONSTRAINT FK_SupportTickets_Tenants REFERENCES hms.Tenants(TenantId),
    TicketNumber      NVARCHAR(20) NOT NULL CONSTRAINT UQ_SupportTickets_Number UNIQUE,
    Subject           NVARCHAR(200) NOT NULL,
    Category          NVARCHAR(20) NOT NULL,
    Priority          NVARCHAR(10) NOT NULL CONSTRAINT DF_SupportTickets_Priority DEFAULT ('normal'),
    Status            NVARCHAR(20) NOT NULL CONSTRAINT DF_SupportTickets_Status DEFAULT ('open'),
    CreatedByUserId   BIGINT NULL,
    AssignedToId      INT NULL CONSTRAINT FK_SupportTickets_Assignee REFERENCES hms.PlatformUsers(PlatformUserId),
    LastReplyBy       NVARCHAR(10) NULL,           -- 'hospital' | 'support'
    LastReplyAt       DATETIME2(3) NULL,
    ResolvedAt        DATETIME2(3) NULL,
    CreatedAt         DATETIME2(3) NOT NULL CONSTRAINT DF_SupportTickets_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt         DATETIME2(3) NOT NULL CONSTRAINT DF_SupportTickets_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_SupportTickets_Tenant_Id UNIQUE (TenantId, TicketId),
    CONSTRAINT CK_SupportTickets_Category CHECK (Category IN ('billing','technical','account','feature','other')),
    CONSTRAINT CK_SupportTickets_Priority CHECK (Priority IN ('low','normal','high','urgent')),
    CONSTRAINT CK_SupportTickets_Status CHECK (Status IN ('open','awaiting_support','awaiting_hospital','resolved','closed'))
);
CREATE INDEX IX_SupportTickets_Status ON hms.SupportTickets (Status, UpdatedAt DESC);
CREATE INDEX IX_SupportTickets_Tenant ON hms.SupportTickets (TenantId, UpdatedAt DESC);

CREATE TABLE hms.SupportTicketMessages (
    MessageId        BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_SupportTicketMessages PRIMARY KEY,
    TenantId         INT NOT NULL,
    TicketId         INT NOT NULL,
    AuthorType       NVARCHAR(10) NOT NULL,        -- 'hospital' | 'support'
    AuthorUserId     BIGINT NULL,
    AuthorPlatformId INT NULL,
    AuthorName       NVARCHAR(150) NOT NULL,
    Body             NVARCHAR(4000) NOT NULL,
    IsInternal       BIT NOT NULL CONSTRAINT DF_SupportTicketMessages_Internal DEFAULT (0),   -- support-team note, never shown to the hospital
    CreatedAt        DATETIME2(3) NOT NULL CONSTRAINT DF_SupportTicketMessages_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT FK_SupportTicketMessages_Ticket FOREIGN KEY (TenantId, TicketId) REFERENCES hms.SupportTickets (TenantId, TicketId),
    CONSTRAINT CK_SupportTicketMessages_Author CHECK (AuthorType IN ('hospital','support')),
    CONSTRAINT CK_SupportTicketMessages_Internal CHECK (IsInternal = 0 OR AuthorType = 'support')
);
CREATE INDEX IX_SupportTicketMessages_Ticket ON hms.SupportTicketMessages (TenantId, TicketId, CreatedAt);

/* ───────── Hospital groups (multi-branch). Each branch stays a fully separate hospital workspace. ───────── */
CREATE TABLE hms.TenantGroups (
    GroupId   INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_TenantGroups PRIMARY KEY,
    Name      NVARCHAR(150) NOT NULL,
    Notes     NVARCHAR(500) NULL,
    CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_TenantGroups_CreatedAt DEFAULT (SYSUTCDATETIME())
);
ALTER TABLE hms.Tenants ADD GroupId INT NULL CONSTRAINT FK_Tenants_Groups REFERENCES hms.TenantGroups(GroupId),
                            BranchName NVARCHAR(100) NULL;   -- e.g. "Andheri branch"
GO
CREATE INDEX IX_Tenants_Group ON hms.Tenants (GroupId) WHERE GroupId IS NOT NULL;

/* Settings with safe defaults for existing hospitals. */
INSERT INTO hms.TenantSettings (TenantId, SettingKey, SettingValue)
SELECT t.TenantId, 'booking.enabled', 'off' FROM hms.Tenants t
WHERE NOT EXISTS (SELECT 1 FROM hms.TenantSettings s WHERE s.TenantId = t.TenantId AND s.SettingKey = 'booking.enabled');
