/* =====================================================================
   002_hospital_core.sql — tenant-owned hospital tables (Phase 5 modules)
   Every row carries TenantId. Child tables reference parents through
   COMPOSITE foreign keys (TenantId, ParentId) so the database itself
   refuses cross-tenant links (e.g. Hospital A appointment -> Hospital B patient).
   ===================================================================== */

CREATE TABLE hms.Departments (
    DepartmentId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Departments PRIMARY KEY,
    TenantId     INT NOT NULL CONSTRAINT FK_Departments_Tenants REFERENCES hms.Tenants(TenantId),
    Name         NVARCHAR(120) NOT NULL,
    Description  NVARCHAR(300) NULL,
    IsActive     BIT NOT NULL CONSTRAINT DF_Departments_Active DEFAULT (1),
    CreatedAt    DATETIME2(3) NOT NULL CONSTRAINT DF_Departments_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_Departments_Tenant_Name UNIQUE (TenantId, Name),
    CONSTRAINT UQ_Departments_Tenant_Id UNIQUE (TenantId, DepartmentId)
);

/* Doctors, nurses and other staff. A staff member may optionally be linked to a login (Users). */
CREATE TABLE hms.StaffMembers (
    StaffId            BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_StaffMembers PRIMARY KEY,
    TenantId           INT NOT NULL CONSTRAINT FK_StaffMembers_Tenants REFERENCES hms.Tenants(TenantId),
    UserId             BIGINT NULL,
    DepartmentId       INT NULL,
    StaffType          NVARCHAR(30) NOT NULL,
    FullName           NVARCHAR(150) NOT NULL,
    Designation        NVARCHAR(100) NULL,
    Specialization     NVARCHAR(150) NULL,
    RegistrationNumber NVARCHAR(60)  NULL,   -- medical council registration for doctors
    Phone              NVARCHAR(30)  NULL,
    Email              NVARCHAR(254) NULL,
    ConsultationFee    DECIMAL(12,2) NULL,
    IsActive           BIT NOT NULL CONSTRAINT DF_StaffMembers_Active DEFAULT (1),
    CreatedAt          DATETIME2(3) NOT NULL CONSTRAINT DF_StaffMembers_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt          DATETIME2(3) NOT NULL CONSTRAINT DF_StaffMembers_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_StaffMembers_Tenant_Id UNIQUE (TenantId, StaffId),
    CONSTRAINT FK_StaffMembers_Departments FOREIGN KEY (TenantId, DepartmentId) REFERENCES hms.Departments (TenantId, DepartmentId),
    CONSTRAINT FK_StaffMembers_Users FOREIGN KEY (TenantId, UserId) REFERENCES hms.Users (TenantId, UserId),
    CONSTRAINT CK_StaffMembers_Type CHECK (StaffType IN ('doctor','nurse','receptionist','lab_technician','pharmacist','accountant','admin','other')),
    CONSTRAINT CK_StaffMembers_Fee CHECK (ConsultationFee IS NULL OR ConsultationFee >= 0)
);
CREATE INDEX IX_StaffMembers_Tenant_Type ON hms.StaffMembers (TenantId, StaffType, IsActive) INCLUDE (FullName, DepartmentId);

/* Weekly availability. DayOfWeek: 0 = Sunday ... 6 = Saturday. Times are in the hospital's local timezone. */
CREATE TABLE hms.DoctorSchedules (
    ScheduleId  BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_DoctorSchedules PRIMARY KEY,
    TenantId    INT NOT NULL,
    StaffId     BIGINT NOT NULL,
    DayOfWeek   TINYINT NOT NULL,
    StartTime   TIME(0) NOT NULL,
    EndTime     TIME(0) NOT NULL,
    SlotMinutes SMALLINT NOT NULL CONSTRAINT DF_DoctorSchedules_Slot DEFAULT (15),
    CONSTRAINT FK_DoctorSchedules_Staff FOREIGN KEY (TenantId, StaffId) REFERENCES hms.StaffMembers (TenantId, StaffId) ON DELETE CASCADE,
    CONSTRAINT CK_DoctorSchedules_Day CHECK (DayOfWeek BETWEEN 0 AND 6),
    CONSTRAINT CK_DoctorSchedules_Time CHECK (EndTime > StartTime),
    CONSTRAINT CK_DoctorSchedules_Slot CHECK (SlotMinutes BETWEEN 5 AND 240)
);
CREATE INDEX IX_DoctorSchedules_Staff ON hms.DoctorSchedules (TenantId, StaffId, DayOfWeek);

CREATE TABLE hms.Patients (
    PatientId             BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Patients PRIMARY KEY,
    TenantId              INT NOT NULL CONSTRAINT FK_Patients_Tenants REFERENCES hms.Tenants(TenantId),
    PatientNumber         NVARCHAR(30) NOT NULL,         -- unique per hospital, e.g. GV-000123
    FirstName             NVARCHAR(100) NOT NULL,
    LastName              NVARCHAR(100) NULL,
    Gender                NVARCHAR(10) NULL,
    DateOfBirth           DATE NULL,
    Phone                 NVARCHAR(30) NULL,
    Email                 NVARCHAR(254) NULL,
    AddressLine           NVARCHAR(300) NULL,
    City                  NVARCHAR(100) NULL,
    BloodGroup            NVARCHAR(5) NULL,
    EmergencyContactName  NVARCHAR(150) NULL,
    EmergencyContactPhone NVARCHAR(30) NULL,
    IsArchived            BIT NOT NULL CONSTRAINT DF_Patients_Archived DEFAULT (0),
    ArchivedAt            DATETIME2(3) NULL,
    CreatedByUserId       BIGINT NULL,
    CreatedAt             DATETIME2(3) NOT NULL CONSTRAINT DF_Patients_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt             DATETIME2(3) NOT NULL CONSTRAINT DF_Patients_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_Patients_Tenant_Number UNIQUE (TenantId, PatientNumber),
    CONSTRAINT UQ_Patients_Tenant_Id UNIQUE (TenantId, PatientId),
    CONSTRAINT CK_Patients_Gender CHECK (Gender IS NULL OR Gender IN ('male','female','other','unknown'))
);
CREATE INDEX IX_Patients_Tenant_Phone ON hms.Patients (TenantId, Phone) WHERE Phone IS NOT NULL;
CREATE INDEX IX_Patients_Tenant_Name ON hms.Patients (TenantId, FirstName, LastName);
CREATE INDEX IX_Patients_Tenant_Created ON hms.Patients (TenantId, CreatedAt DESC) INCLUDE (IsArchived);

CREATE TABLE hms.Appointments (
    AppointmentId     BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Appointments PRIMARY KEY,
    TenantId          INT NOT NULL CONSTRAINT FK_Appointments_Tenants REFERENCES hms.Tenants(TenantId),
    AppointmentNumber NVARCHAR(30) NOT NULL,
    PatientId         BIGINT NOT NULL,
    DoctorId          BIGINT NOT NULL,
    DepartmentId      INT NULL,
    StartAt           DATETIME2(0) NOT NULL,   -- UTC
    EndAt             DATETIME2(0) NOT NULL,   -- UTC
    Status            NVARCHAR(20) NOT NULL CONSTRAINT DF_Appointments_Status DEFAULT ('scheduled'),
    VisitType         NVARCHAR(20) NOT NULL CONSTRAINT DF_Appointments_VisitType DEFAULT ('opd'),
    Reason            NVARCHAR(500) NULL,
    CancelReason      NVARCHAR(300) NULL,
    CheckedInAt       DATETIME2(3) NULL,
    CreatedByUserId   BIGINT NULL,
    CreatedAt         DATETIME2(3) NOT NULL CONSTRAINT DF_Appointments_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt         DATETIME2(3) NOT NULL CONSTRAINT DF_Appointments_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_Appointments_Tenant_Number UNIQUE (TenantId, AppointmentNumber),
    CONSTRAINT UQ_Appointments_Tenant_Id UNIQUE (TenantId, AppointmentId),
    CONSTRAINT FK_Appointments_Patients FOREIGN KEY (TenantId, PatientId) REFERENCES hms.Patients (TenantId, PatientId),
    CONSTRAINT FK_Appointments_Doctors  FOREIGN KEY (TenantId, DoctorId)  REFERENCES hms.StaffMembers (TenantId, StaffId),
    CONSTRAINT FK_Appointments_Departments FOREIGN KEY (TenantId, DepartmentId) REFERENCES hms.Departments (TenantId, DepartmentId),
    CONSTRAINT CK_Appointments_Time CHECK (EndAt > StartAt),
    CONSTRAINT CK_Appointments_Status CHECK (Status IN ('scheduled','checked_in','completed','cancelled','no_show')),
    CONSTRAINT CK_Appointments_VisitType CHECK (VisitType IN ('opd','follow_up','teleconsult'))
);
/* Supports the overlap check (doctor + time window) and day views. */
CREATE INDEX IX_Appointments_Doctor_Time ON hms.Appointments (TenantId, DoctorId, StartAt, EndAt) INCLUDE (Status);
CREATE INDEX IX_Appointments_Tenant_Time ON hms.Appointments (TenantId, StartAt) INCLUDE (Status, DoctorId, PatientId);
CREATE INDEX IX_Appointments_Patient ON hms.Appointments (TenantId, PatientId, StartAt DESC);
