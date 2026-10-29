import {
  LuUsers, LuCalendarClock, LuStethoscope, LuBedDouble, LuReceipt, LuFlaskConical, LuPill, LuChartBar,
  LuShieldCheck, LuUserCog, LuBuilding2, LuSettings,
} from 'react-icons/lu';

// status: 'live' = implemented in this release, 'soon' = on the roadmap (shown honestly on the site)
export const MODULES = [
  { key: 'patients', icon: LuUsers, title: 'Patient management', text: 'Registration with unique hospital IDs, demographics, emergency contacts, duplicate detection and full visit history.', status: 'live' },
  { key: 'appointments', icon: LuCalendarClock, title: 'Appointments', text: 'Doctor schedules, free-slot lookup, booking, rescheduling, check-in and cancellations — with double-booking prevention.', status: 'live' },
  { key: 'opd', icon: LuStethoscope, title: 'OPD & clinical notes', text: 'Consultations, vitals, diagnosis and prescriptions with versioned records.', status: 'live' },
  { key: 'ipd', icon: LuBedDouble, title: 'IPD, wards & beds', text: 'Admission, transfer and discharge with live bed occupancy.', status: 'live' },
  { key: 'billing', icon: LuReceipt, title: 'Billing & payments', text: 'GST-ready invoices, receipts, refunds and outstanding balances.', status: 'live' },
  { key: 'lab', icon: LuFlaskConical, title: 'Laboratory', text: 'Test catalogue, sample tracking, result entry and verification.', status: 'live' },
  { key: 'pharmacy', icon: LuPill, title: 'Pharmacy & inventory', text: 'Batches, expiry tracking, dispensing and low-stock alerts.', status: 'live' },
  { key: 'staff', icon: LuUserCog, title: 'Doctors & staff', text: 'Departments, designations, specialisations, consultation fees and weekly availability.', status: 'live' },
  { key: 'rbac', icon: LuShieldCheck, title: 'Roles & audit log', text: 'Nine ready-made roles, granular permissions enforced on the server, and an audit trail of sensitive actions.', status: 'live' },
  { key: 'reports', icon: LuChartBar, title: 'Reports & analytics', text: 'Registrations, appointments, occupancy and collections with CSV export.', status: 'live' },
  { key: 'branches', icon: LuBuilding2, title: 'Multi-branch', text: 'Run several locations under one organisation (Enterprise).', status: 'soon' },
  { key: 'settings', icon: LuSettings, title: 'Hospital settings', text: 'Timezone, numbering prefixes, contact details and subscription in one place.', status: 'live' },
];

export const FACILITIES = ['Single-doctor clinics', 'Polyclinics', 'Nursing homes', 'Multi-specialty hospitals', 'Diagnostic centres'];

export const FAQS = [
  ['Is our hospital data separate from other hospitals?', 'Yes. Every record is tagged with your hospital’s workspace, every request is checked on the server against your signed-in session, and the database itself rejects links between records of different hospitals. Staff of one hospital can never see another hospital’s patients.'],
  ['How does payment work?', 'Choose a plan, enter your hospital details and pay through Razorpay (UPI, cards, net banking). Your workspace is created only after the payment is verified on our server — never on the browser’s word alone.'],
  ['What happens if our subscription expires?', 'You get a grace period with reminders. After that the workspace becomes read-only until you renew. We never delete hospital data automatically.'],
  ['Can we try it before buying?', 'Book a demo and our team will walk you through the product using sample data and answer questions about your workflow.'],
  ['Which modules are available today?', 'Patients, appointments, OPD, IPD & beds, billing, laboratory, pharmacy & inventory, reports, staff, roles and subscriptions are all available. Multi-branch management for Enterprise customers is on the roadmap.'],
  ['Do you support GST invoices?', 'Yes. Patient bills apply GST per line item (for example on medicines), support discounts, and issue sequential invoice and receipt numbers for each hospital.'],
  ['Is this compliant with Indian health-data law?', 'The product includes security controls such as encryption in transit, access control and audit logs, but compliance (for example under the DPDP Act) also depends on your policies and contracts. We recommend a legal review before handling live patient data.'],
];
