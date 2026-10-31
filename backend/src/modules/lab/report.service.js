// Builds the printable lab report (verified results only) for staff sharing and the public patient link.
import { db } from '../../db/pool.js';
import { PARAMS_SQL, attachParameters, itemsSql } from './lab.shared.js';

// Critical-alert bookkeeping (who acknowledged, when) is for staff only and never reaches the patient's report.
const STAFF_ONLY = new Set(['criticalAt', 'criticalAckAt', 'criticalAckBy']);
const withoutStaffFields = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !STAFF_ONLY.has(k)));

/** Returns the report of a VERIFIED order of this tenant, or null. Contains no contact details and no staff alert data. */
export async function loadVerifiedReport(tenantId, orderId) {
  const [orders, items, params] = await db.many(`
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
    ${itemsSql({ withPrice: false })}
    ${PARAMS_SQL}`, { tid: tenantId, id: orderId });
  const o = orders[0];
  if (!o || o.Status !== 'verified') return null;
  return {
    hospital: { name: o.HospitalName, address: o.HospitalAddress, phone: o.HospitalPhone, timezone: o.Timezone },
    order: { number: o.OrderNumber, orderedAt: o.OrderedAt, verifiedAt: o.VerifiedAt, verifiedBy: o.VerifiedBy, referredBy: o.ReferralName || o.DoctorName || null },
    patient: { patientNumber: o.PatientNumber, firstName: o.FirstName, lastName: o.LastName, gender: o.Gender, dateOfBirth: o.DateOfBirth },
    items: attachParameters(items, params).map((i) => ({ ...withoutStaffFields(i), parameters: i.parameters.map(withoutStaffFields) })),
  };
}
