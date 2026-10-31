/* 009 — Proper addresses: country (ISO code) + state next to the existing city fields.
   Phone numbers keep their NVARCHAR(30) columns; new and edited numbers are stored in international
   E.164 form (+919876543210) after validation in the API. Schema: hms. */

ALTER TABLE hms.Patients ADD
    State   NVARCHAR(100) NULL,
    Country CHAR(2) NULL;

ALTER TABLE hms.OnboardingRequests ADD
    State   NVARCHAR(100) NULL,
    Country CHAR(2) NULL;

ALTER TABLE hms.DemoRequests ADD
    State   NVARCHAR(100) NULL,
    Country CHAR(2) NULL;
