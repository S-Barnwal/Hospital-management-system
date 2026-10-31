/* 011 — Hospital location: postal code + map pin (latitude/longitude) set by the hospital in Settings,
   shown to the Super Admin on the "Hospital map". Business information only — no patient data. Schema: hms. */

ALTER TABLE hms.Tenants ADD
    PostalCode        NVARCHAR(12)  NULL,
    Latitude          DECIMAL(9,6)  NULL,
    Longitude         DECIMAL(9,6)  NULL,
    LocationUpdatedAt DATETIME2(3)  NULL;
GO

ALTER TABLE hms.Tenants ADD CONSTRAINT CK_Tenants_LatLng CHECK (
    (Latitude IS NULL AND Longitude IS NULL) OR
    (Latitude BETWEEN -90 AND 90 AND Longitude BETWEEN -180 AND 180));
