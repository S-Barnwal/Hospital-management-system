/* 010 — Official platform invoices (MediCore → hospital) for every plan purchase, renewal and free sign-up,
   plus manual invoices raised by the Super Admin.

   Rules (GST-style):
   • A number is given only when an invoice is ISSUED; numbers run per financial year: INV/2627/000001 (≤16 chars).
     Sandbox (test-payment) invoices use their own series SBX/2627/000001 so they never mix with real ones.
   • Seller and buyer details are copied onto the invoice when it is issued, so later profile changes never alter
     an old invoice.
   • An issued invoice is never deleted. Amounts are locked; a wrong invoice is VOIDED (with reason) and a new one
     issued. Buyer details / notes may be corrected; every change bumps Revision and is written to the audit log.
   • Drafts (manual invoices not yet issued) can be edited freely or deleted.
   Schema: hms. */

-- Free and manual invoices have no payment row; drafts have no number yet.
ALTER TABLE hms.Invoices DROP CONSTRAINT UQ_Invoices_Payment;
ALTER TABLE hms.Invoices DROP CONSTRAINT UQ_Invoices_Number;
ALTER TABLE hms.Invoices ALTER COLUMN PaymentId BIGINT NULL;
ALTER TABLE hms.Invoices ALTER COLUMN InvoiceNumber NVARCHAR(40) NULL;
ALTER TABLE hms.Invoices ALTER COLUMN IssuedAt DATETIME2(3) NULL;
GO

CREATE UNIQUE INDEX UX_Invoices_Payment ON hms.Invoices (PaymentId) WHERE PaymentId IS NOT NULL;
CREATE UNIQUE INDEX UX_Invoices_Number  ON hms.Invoices (InvoiceNumber) WHERE InvoiceNumber IS NOT NULL;

ALTER TABLE hms.Invoices ADD
    Kind            NVARCHAR(20)  NOT NULL CONSTRAINT DF_Invoices_Kind DEFAULT ('subscription'), -- subscription | free | manual
    Status          NVARCHAR(10)  NOT NULL CONSTRAINT DF_Invoices_Status DEFAULT ('issued'),      -- draft | issued | void
    SubscriptionId  INT NULL CONSTRAINT FK_Invoices_Subscriptions REFERENCES hms.Subscriptions(SubscriptionId),
    PlanId          INT NULL CONSTRAINT FK_Invoices_Plans REFERENCES hms.Plans(PlanId),
    BillingInterval NVARCHAR(10)  NULL,
    PeriodStart     DATETIME2(3)  NULL,
    PeriodEnd       DATETIME2(3)  NULL,
    SacCode         NVARCHAR(10)  NULL,
    Quantity        INT NOT NULL CONSTRAINT DF_Invoices_Qty DEFAULT (1),
    DiscountAmount  DECIMAL(12,2) NOT NULL CONSTRAINT DF_Invoices_Discount DEFAULT (0),
    TaxRatePercent  DECIMAL(5,2)  NOT NULL CONSTRAINT DF_Invoices_TaxRate DEFAULT (0),
    IsInterState    BIT NOT NULL CONSTRAINT DF_Invoices_InterState DEFAULT (1),
    BillToName      NVARCHAR(200) NULL,
    BillToEmail     NVARCHAR(254) NULL,
    BillToPhone     NVARCHAR(30)  NULL,
    BillToAddress   NVARCHAR(300) NULL,
    BillToCity      NVARCHAR(100) NULL,
    BillToState     NVARCHAR(100) NULL,
    BillToCountry   CHAR(2) NULL,
    BillToGstin     NVARCHAR(15)  NULL,
    SellerJson      NVARCHAR(2000) NULL,   -- seller name, address, GSTIN, state… frozen at issue time
    PaymentMethod   NVARCHAR(40)  NULL,
    PaymentRef      NVARCHAR(100) NULL,
    Notes           NVARCHAR(1000) NULL,
    DueDate         DATE NULL,
    Revision        INT NOT NULL CONSTRAINT DF_Invoices_Revision DEFAULT (0),
    VoidReason      NVARCHAR(500) NULL,
    VoidedAt        DATETIME2(3) NULL,
    VoidedBy        INT NULL,
    CreatedBy       INT NULL,             -- platform user for manual invoices; NULL = system
    CreatedAt       DATETIME2(3) NOT NULL CONSTRAINT DF_Invoices_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt       DATETIME2(3) NULL;
GO

ALTER TABLE hms.Invoices ADD
    CONSTRAINT CK_Invoices_Kind   CHECK (Kind IN ('subscription', 'free', 'manual')),
    CONSTRAINT CK_Invoices_Status CHECK (Status IN ('draft', 'issued', 'void')),
    CONSTRAINT CK_Invoices_Issued CHECK (Status = 'draft' OR (InvoiceNumber IS NOT NULL AND IssuedAt IS NOT NULL)),
    CONSTRAINT CK_Invoices_Money  CHECK (Subtotal >= 0 AND DiscountAmount >= 0 AND DiscountAmount <= Subtotal AND TaxAmount >= 0 AND Total >= 0);
CREATE INDEX IX_Invoices_Tenant ON hms.Invoices (TenantId, CreatedAt DESC);
CREATE INDEX IX_Invoices_Status ON hms.Invoices (Status, IssuedAt DESC);

-- Back-fill old (paid) invoices with what we know.
UPDATE i SET Kind = 'subscription', Status = 'issued', CreatedAt = ISNULL(i.IssuedAt, SYSUTCDATETIME()),
       SubscriptionId = p.SubscriptionId, PlanId = p.PlanId, BillingInterval = p.BillingInterval,
       TaxRatePercent = CASE WHEN i.Subtotal > 0 THEN CAST(ROUND(i.TaxAmount * 100.0 / i.Subtotal, 2) AS DECIMAL(5,2)) ELSE 0 END,
       BillToName = t.Name, BillToEmail = t.Email, BillToPhone = t.Phone, BillToCity = t.City, BillToState = t.State, BillToCountry = t.Country
FROM hms.Invoices i
LEFT JOIN hms.Payments p ON p.PaymentId = i.PaymentId
JOIN hms.Tenants t ON t.TenantId = i.TenantId;

-- Financial-year invoice series (INV/SBX + FY), handed out under a row lock.
CREATE TABLE hms.PlatformSequences (
    SequenceKey NVARCHAR(40) NOT NULL CONSTRAINT PK_PlatformSequences PRIMARY KEY,
    NextValue   INT NOT NULL
);

-- Seller (platform) details printed on invoices — editable in Super Admin → Website settings.
INSERT INTO hms.PlatformSettings (SettingKey, SettingValue)
SELECT k, v FROM (VALUES
    (N'invoice.legal_name', NULL), (N'invoice.gstin', NULL), (N'invoice.state', NULL),
    (N'invoice.sac', N'997331'), (N'invoice.footer', N'This is a computer-generated invoice and does not require a signature.')
) AS s(k, v)
WHERE NOT EXISTS (SELECT 1 FROM hms.PlatformSettings ps WHERE ps.SettingKey = s.k);
