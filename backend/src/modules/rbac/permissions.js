// Single source of truth for permission codes and default role templates.
// `npm run db:seed` upserts PERMISSIONS into hms.Permissions; provisioning copies ROLE_TEMPLATES into each new tenant.

export const PERMISSIONS = [
  // implemented (Phase 5)
  ['dashboard.view', 'dashboard', 'View hospital dashboard'],
  ['patients.read', 'patients', 'View patients'],
  ['patients.write', 'patients', 'Register and edit patients'],
  ['patients.archive', 'patients', 'Archive / restore patients'],
  ['appointments.read', 'appointments', 'View appointments'],
  ['appointments.write', 'appointments', 'Book, reschedule, check-in and cancel appointments'],
  ['staff.read', 'staff', 'View doctors and staff'],
  ['staff.write', 'staff', 'Add and edit doctors, staff and schedules'],
  ['departments.manage', 'staff', 'Manage departments'],
  ['users.read', 'users', 'View user accounts'],
  ['users.manage', 'users', 'Create, disable and assign roles to users'],
  ['roles.manage', 'users', 'Customise role permissions'],
  ['settings.read', 'settings', 'View hospital settings'],
  ['settings.manage', 'settings', 'Change hospital settings'],
  ['subscription.read', 'subscription', 'View subscription and invoices'],
  ['subscription.manage', 'subscription', 'Renew or change the subscription'],
  ['audit.read', 'audit', 'View the hospital audit log'],
  // clinical & finance modules
  ['opd.read', 'opd', 'View consultation records'],
  ['opd.write', 'opd', 'Write consultation records and prescriptions'],
  ['ipd.read', 'ipd', 'View admissions and beds'],
  ['ipd.write', 'ipd', 'Admit, transfer and discharge patients'],
  ['billing.read', 'billing', 'View bills and payments'],
  ['billing.write', 'billing', 'Create bills and post payments'],
  ['billing.refund', 'billing', 'Cancel bills and issue refunds'],
  ['lab.read', 'laboratory', 'View lab orders and results'],
  ['lab.write', 'laboratory', 'Enter lab results'],
  ['lab.verify', 'laboratory', 'Verify lab results'],
  ['pharmacy.read', 'pharmacy', 'View pharmacy stock'],
  ['pharmacy.write', 'pharmacy', 'Dispense and receive stock'],
  ['ipd.configure', 'ipd', 'Configure wards and beds'],
  ['lab.configure', 'laboratory', 'Manage the lab test catalogue'],
  ['pharmacy.configure', 'pharmacy', 'Manage medicines and suppliers'],
  ['reports.read', 'reports', 'View reports'],
  ['reports.export', 'reports', 'Export reports as CSV'],
];

export const ALL_CODES = PERMISSIONS.map(([code]) => code);

const pick = (...prefixes) => ALL_CODES.filter((c) => prefixes.some((p) => c === p || c.startsWith(`${p}.`)));

export const ROLE_TEMPLATES = [
  { code: 'owner', name: 'Hospital Owner', description: 'Full control of this hospital, including subscription.', permissions: ALL_CODES },
  {
    code: 'hospital_admin', name: 'Hospital Admin', description: 'Administers users, staff and settings.',
    permissions: ALL_CODES.filter((c) => c !== 'subscription.manage'),
  },
  { code: 'manager', name: 'Hospital Manager', description: 'Operational oversight and reports.',
    permissions: [...pick('dashboard', 'reports', 'audit'), 'patients.read', 'appointments.read', 'staff.read', 'ipd.read', 'billing.read', 'subscription.read'] },
  { code: 'receptionist', name: 'Receptionist', description: 'Front desk: registration and appointments.',
    permissions: ['dashboard.view', 'patients.read', 'patients.write', 'appointments.read', 'appointments.write', 'staff.read', 'ipd.read', 'billing.read', 'billing.write'] },
  { code: 'doctor', name: 'Doctor', description: 'Consultations and clinical records.',
    permissions: ['dashboard.view', 'patients.read', 'appointments.read', 'appointments.write', 'staff.read', 'opd.read', 'opd.write', 'ipd.read', 'ipd.write', 'lab.read', 'lab.write', 'lab.verify', 'pharmacy.read'] },
  { code: 'nurse', name: 'Nurse', description: 'Care and admission workflows.',
    permissions: ['dashboard.view', 'patients.read', 'appointments.read', 'staff.read', 'opd.read', 'ipd.read', 'ipd.write', 'lab.read'] },
  { code: 'lab_technician', name: 'Lab Technician', description: 'Lab orders and results.',
    permissions: ['dashboard.view', 'patients.read', 'lab.read', 'lab.write'] },
  { code: 'pharmacist', name: 'Pharmacist', description: 'Pharmacy and stock.',
    permissions: ['dashboard.view', 'patients.read', 'pharmacy.read', 'pharmacy.write', 'pharmacy.configure', 'billing.read'] },
  { code: 'accountant', name: 'Accountant', description: 'Bills, payments and financial reports.',
    permissions: ['dashboard.view', 'patients.read', 'billing.read', 'billing.write', 'billing.refund', 'reports.read', 'reports.export', 'subscription.read'] },
];
