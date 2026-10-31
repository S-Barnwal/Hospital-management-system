// Builds the printable lab report (verified results only) for staff sharing and the public patient link.
import { db } from '../../db/pool.js';

/** Returns the report of a VERIFIED order of this tenant, or null. Contains no contact details. */
export async function loadVerifiedReport(tenantId, orderId) {
  const [orders, items] = await db.many(`
    SELECT o.LabOrderId, o.OrderNumber, o.OrderedAt, o.VerifiedAt, o.Status, p.PatientNumber, p.FirstName, p.LastName, p.Gender,
           CONVERT(CHAR(10), p.DateOfBirth, 23) AS DateOfBirth, rd.Name AS ReferralName, s.FullName AS DoctorName, v.FullName AS VerifiedBy,
           t.Name AS HospitalName, t.Phone AS HospitalPhone, t.Timezone,
           (SELECT SettingValue FROM hms.TenantSettings WHERE TenantId = o.TenantId AND SettingKey = 'hospital.address') AS HospitalAddress
    FROM hms.LabOrders o
    JOIN hms.Patients p ON p.TenantId = o.TenantId AND p.PatientId = o.PatientId
    JOIN hms.Tenants t ON t.TenantId = o.TenantId
    LEFT JOIN hms.ReferralDoctors rd ON rd.TenantId = o.TenantId AND rd.ReferralDoctorId = o.ReferralDoctorId
    LEFT JOIN hms.StaffMembers s ON s.TenantId = o.TenantId AND s.StaffId = o.DoctorId
    LEFT JOIN hms.Users v ON v.TenantId = o.TenantId AND v.UserId = o.VerifiedByUserId
    WHERE o.TenantId = @tid AND o.LabOrderId = @id;
    SELECT i.LabOrderItemId AS id, i.TestName AS testName, i.Unit AS unit, i.RefLow AS refLow, i.RefHigh AS refHigh, i.RefText AS refText,
           i.ResultValue AS resultValue, i.Flag AS flag, i.PackageName AS packageName, lt.Department AS department
    FROM hms.LabOrderItems i LEFT JOIN hms.LabTests lt ON lt.TenantId = i.TenantId AND lt.LabTestId = i.LabTestId
    WHERE i.TenantId = @tid AND i.LabOrderId = @id ORDER BY i.PackageName, i.LabOrderItemId;`, { tid: tenantId, id: orderId });
  const o = orders[0];
  if (!o || o.Status !== 'verified') return null;
  return {
    hospital: { name: o.HospitalName, address: o.HospitalAddress, phone: o.HospitalPhone, timezone: o.Timezone },
    order: { number: o.OrderNumber, orderedAt: o.OrderedAt, verifiedAt: o.VerifiedAt, verifiedBy: o.VerifiedBy, referredBy: o.ReferralName || o.DoctorName || null },
    patient: { patientNumber: o.PatientNumber, firstName: o.FirstName, lastName: o.LastName, gender: o.Gender, dateOfBirth: o.DateOfBirth },
    items,
  };
}
