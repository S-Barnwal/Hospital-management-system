/* =====================================================================
   003_seed_plans.sql — default subscription plans and platform settings.
   Prices are starting values only: the Super Admin edits them in
   /admin/plans and the app always reads them from this table.
   Inserted only when missing, so re-running never overwrites edits.
   ===================================================================== */

IF NOT EXISTS (SELECT 1 FROM hms.Plans WHERE Code = 'starter')
INSERT INTO hms.Plans (Code, Name, Tagline, Description, MonthlyPrice, AnnualPrice, Currency, TaxRatePercent, MaxStaffUsers, MaxBranches, MaxPatients, IsPopular, IsContactSales, SortOrder)
VALUES ('starter', 'Starter', 'For clinics and single-doctor practices',
        'Everything a small clinic needs to go paperless: registration, appointments and staff.',
        999.00, 9990.00, 'INR', 18.00, 5, 1, NULL, 0, 0, 1);

IF NOT EXISTS (SELECT 1 FROM hms.Plans WHERE Code = 'professional')
INSERT INTO hms.Plans (Code, Name, Tagline, Description, MonthlyPrice, AnnualPrice, Currency, TaxRatePercent, MaxStaffUsers, MaxBranches, MaxPatients, IsPopular, IsContactSales, SortOrder)
VALUES ('professional', 'Professional', 'For growing clinics and small hospitals',
        'All core modules with more staff accounts and reporting.',
        2999.00, 29990.00, 'INR', 18.00, 20, 1, NULL, 1, 0, 2);

IF NOT EXISTS (SELECT 1 FROM hms.Plans WHERE Code = 'enterprise')
INSERT INTO hms.Plans (Code, Name, Tagline, Description, MonthlyPrice, AnnualPrice, Currency, TaxRatePercent, MaxStaffUsers, MaxBranches, MaxPatients, IsPopular, IsContactSales, SortOrder)
VALUES ('enterprise', 'Enterprise', 'For multi-specialty and multi-branch hospitals',
        'Custom limits, multi-branch rollout and priority support. Priced on consultation.',
        NULL, NULL, 'INR', 18.00, NULL, NULL, NULL, 0, 1, 3);

/* Feature matrix. FeatureKey values match module keys used by the backend. */
DECLARE @features TABLE (FeatureKey NVARCHAR(60), Label NVARCHAR(200), SortOrder INT, Starter BIT, Pro BIT, Ent BIT);
INSERT INTO @features VALUES
 ('patients',      N'Patient registration & records', 1, 1, 1, 1),
 ('appointments',  N'Appointment scheduling',         2, 1, 1, 1),
 ('staff',         N'Doctor & staff management',      3, 1, 1, 1),
 ('rbac',          N'Role-based access & audit log',  4, 1, 1, 1),
 ('opd',           N'OPD consultations & prescriptions', 5, 1, 1, 1),
 ('billing',       N'Billing, receipts & refunds',    6, 0, 1, 1),
 ('ipd',           N'IPD, wards & bed management',    7, 0, 1, 1),
 ('laboratory',    N'Laboratory & diagnostics',       8, 0, 1, 1),
 ('pharmacy',      N'Pharmacy & inventory',           9, 0, 1, 1),
 ('reports',       N'Reports & CSV export',          10, 0, 1, 1),
 ('multi_branch',  N'Multi-branch management',       11, 0, 0, 1),
 ('priority_support', N'Priority support',           12, 0, 0, 1);

INSERT INTO hms.PlanFeatures (PlanId, FeatureKey, Label, IsIncluded, SortOrder)
SELECT p.PlanId, f.FeatureKey, f.Label,
       CASE p.Code WHEN 'starter' THEN f.Starter WHEN 'professional' THEN f.Pro ELSE f.Ent END,
       f.SortOrder
FROM hms.Plans p CROSS JOIN @features f
WHERE p.Code IN ('starter','professional','enterprise')
  AND NOT EXISTS (SELECT 1 FROM hms.PlanFeatures pf WHERE pf.PlanId = p.PlanId AND pf.FeatureKey = f.FeatureKey);

/* Public website contact details (editable by Super Admin). */
IF NOT EXISTS (SELECT 1 FROM hms.PlatformSettings WHERE SettingKey = 'contact.email')
    INSERT INTO hms.PlatformSettings (SettingKey, SettingValue) VALUES ('contact.email', 'hello@example.com');
IF NOT EXISTS (SELECT 1 FROM hms.PlatformSettings WHERE SettingKey = 'contact.phone')
    INSERT INTO hms.PlatformSettings (SettingKey, SettingValue) VALUES ('contact.phone', '+91 00000 00000');
IF NOT EXISTS (SELECT 1 FROM hms.PlatformSettings WHERE SettingKey = 'contact.address')
    INSERT INTO hms.PlatformSettings (SettingKey, SettingValue) VALUES ('contact.address', 'Update this address in Admin → Settings');
IF NOT EXISTS (SELECT 1 FROM hms.PlatformSettings WHERE SettingKey = 'brand.name')
    INSERT INTO hms.PlatformSettings (SettingKey, SettingValue) VALUES ('brand.name', 'MediCore HMS');
