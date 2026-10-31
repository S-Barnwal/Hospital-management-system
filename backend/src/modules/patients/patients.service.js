// Patient creation shared by the Patients screen and online-booking confirmation (one numbering rule, one audit trail).
import { t } from '../../db/pool.js';
import { conflict } from '../../utils/errors.js';
import { auditTenant } from '../../utils/audit.js';
import { nextSequence, formatNumber } from '../tenants/sequences.js';

export const toPatientParams = (b) => ({
  first: b.firstName, last: b.lastName ?? null, gender: b.gender ?? null, dob: b.dateOfBirth ? t.date(new Date(`${b.dateOfBirth}T00:00:00Z`)) : null,
  phone: b.phone ?? null, email: b.email ?? null, addr: b.addressLine ?? null, city: b.city ?? null, state: b.state ?? null, country: b.country ?? null, blood: b.bloodGroup ?? null,
  ecName: b.emergencyContactName ?? null, ecPhone: b.emergencyContactPhone ?? null, abha: b.abhaNumber ?? null, abhaAddr: b.abhaAddress ?? null,
});

/** A clear 409 instead of a unique-index error when another patient of this hospital already has the ABHA number/address. */
export async function assertAbhaFree(tx, tenantId, { abhaNumber, abhaAddress }, exceptId = null) {
  if (!abhaNumber && !abhaAddress) return;
  const other = await tx.one(`SELECT TOP 1 PatientNumber, CASE WHEN AbhaNumber = @n THEN 'number' ELSE 'address' END AS what FROM hms.Patients
    WHERE TenantId = @tid AND (@id IS NULL OR PatientId <> @id) AND ((@n IS NOT NULL AND AbhaNumber = @n) OR (@a IS NOT NULL AND AbhaAddress = @a))`,
  { tid: tenantId, id: exceptId, n: abhaNumber ?? null, a: abhaAddress ?? null });
  if (other) throw conflict(`This ABHA ${other.what} is already on patient ${other.PatientNumber}.`, 'ABHA_TAKEN');
}

/** Creates a patient (number from the hospital's prefix + sequence). Returns { id, patientNumber }. */
export async function createPatientRecord(tx, req, body) {
  await assertAbhaFree(tx, req.ctx.tenantId, body);
  const prefix = (await tx.one(`SELECT SettingValue FROM hms.TenantSettings WHERE TenantId = @tid AND SettingKey = 'patient.number_prefix'`,
    { tid: req.ctx.tenantId }))?.SettingValue || 'PT';
  const n = await nextSequence(tx, req.ctx.tenantId, 'patient');
  const row = await tx.one(`
    INSERT INTO hms.Patients (TenantId, PatientNumber, FirstName, LastName, Gender, DateOfBirth, Phone, Email, AddressLine, City, State, Country, BloodGroup,
      EmergencyContactName, EmergencyContactPhone, AbhaNumber, AbhaAddress, CreatedByUserId)
    OUTPUT INSERTED.PatientId, INSERTED.PatientNumber
    VALUES (@tid, @num, @first, @last, @gender, @dob, @phone, @email, @addr, @city, @state, @country, @blood, @ecName, @ecPhone, @abha, @abhaAddr, @uid)`,
  { tid: req.ctx.tenantId, uid: req.ctx.userId, num: formatNumber(prefix, n), ...toPatientParams(body) });
  await auditTenant(req, 'patient.created', 'patient', row.PatientId, { patientNumber: row.PatientNumber, ...(body.dobIsEstimate ? { dobEstimated: true } : {}) }, tx);
  return { id: row.PatientId, patientNumber: row.PatientNumber };
}
