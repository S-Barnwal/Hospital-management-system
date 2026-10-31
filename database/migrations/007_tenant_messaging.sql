/* 007 — Messages sent "on behalf of" each hospital, and optional per-hospital e-mail / WhatsApp accounts
   (Enterprise feature "own_messaging"). Secrets are stored ENCRYPTED (AES-256-GCM, key in the server's
   MESSAGING_ENCRYPTION_KEY) and are never returned by the API. Schema: hms. */

CREATE TABLE hms.TenantMessagingConfig (
    TenantId          INT NOT NULL CONSTRAINT PK_TenantMessagingConfig PRIMARY KEY
                      CONSTRAINT FK_TenantMessagingConfig_Tenants REFERENCES hms.Tenants(TenantId),
    EmailEnabled      BIT NOT NULL CONSTRAINT DF_TMC_EmailEnabled DEFAULT (0),
    SmtpHost          NVARCHAR(255) NULL,
    SmtpPort          INT NULL,
    SmtpSecure        BIT NOT NULL CONSTRAINT DF_TMC_SmtpSecure DEFAULT (0),
    SmtpUser          NVARCHAR(255) NULL,
    SmtpPassEnc       NVARCHAR(1000) NULL,
    FromEmail         NVARCHAR(254) NULL,
    WhatsAppEnabled   BIT NOT NULL CONSTRAINT DF_TMC_WaEnabled DEFAULT (0),
    WaPhoneNumberId   NVARCHAR(40) NULL,
    WaTokenEnc        NVARCHAR(2000) NULL,
    UpdatedByUserId   BIGINT NULL,
    UpdatedAt         DATETIME2(3) NOT NULL CONSTRAINT DF_TMC_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT CK_TMC_Port CHECK (SmtpPort IS NULL OR SmtpPort IN (25, 465, 587, 2525))
);

/* Which account sent each message: the platform's shared account or the hospital's own. */
ALTER TABLE hms.MessageLog ADD SentVia NVARCHAR(10) NULL;
GO

/* Plan feature: only Enterprise includes "own e-mail / WhatsApp account". */
INSERT INTO hms.PlanFeatures (PlanId, FeatureKey, Label, IsIncluded, SortOrder)
SELECT p.PlanId, 'own_messaging', N'Send from your own e-mail & WhatsApp number', CASE WHEN p.Code = 'enterprise' THEN 1 ELSE 0 END, 13
FROM hms.Plans p
WHERE NOT EXISTS (SELECT 1 FROM hms.PlanFeatures pf WHERE pf.PlanId = p.PlanId AND pf.FeatureKey = 'own_messaging');
