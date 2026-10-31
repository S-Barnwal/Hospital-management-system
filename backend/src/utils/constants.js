export const FACILITY_TYPES = ['clinic', 'hospital', 'multi_specialty', 'diagnostic_centre', 'nursing_home', 'other'];
export const STAFF_TYPES = ['doctor', 'nurse', 'receptionist', 'lab_technician', 'pharmacist', 'accountant', 'admin', 'other'];

/** Indian GSTIN: 2-digit state code + PAN (10) + entity number + 'Z' + checksum character. */
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
