import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { TenantAuthProvider, AdminAuthProvider } from './context/AuthContext.jsx';
import PublicLayout from './layouts/PublicLayout.jsx';
import AppLayout, { RequirePerm } from './layouts/AppLayout.jsx';
import AdminLayout from './layouts/AdminLayout.jsx';
import Home from './pages/public/Home.jsx';
import Pricing from './pages/public/Pricing.jsx';
import Register from './pages/public/Register.jsx';
import { Features, About, Faq, Legal } from './pages/public/InfoPages.jsx';
import { BookDemo, Contact } from './pages/public/Forms.jsx';
import { Login, ForgotPassword, ResetPassword, AdminLogin } from './pages/public/AuthPages.jsx';
import Dashboard from './pages/app/Dashboard.jsx';
import Patients, { PatientDetail } from './pages/app/Patients.jsx';
import Appointments from './pages/app/Appointments.jsx';
import Staff from './pages/app/Staff.jsx';
import { UsersRoles, Settings, Subscription, AuditLog, ComingSoon } from './pages/app/AccountPages.jsx';
import {
  AdminDashboard, Tenants, TenantDetail, Plans, Subscriptions, Payments, DemoRequests, Messages, AuditLogs, AdminSettings,
} from './pages/admin/AdminPages.jsx';

const guard = (perm, el) => <RequirePerm perm={perm}>{el}</RequirePerm>;

const SOON = [
  ['opd', 'OPD & clinical records', 'Consultations, vitals, diagnoses and prescriptions with versioned history.', 'opd.read'],
  ['admissions', 'Admissions & beds', 'Admission, transfer, discharge and live bed occupancy.', 'ipd.read'],
  ['billing', 'Billing', 'Patient bills, receipts, refunds and outstanding balances.', 'billing.read'],
  ['laboratory', 'Laboratory', 'Test orders, samples, results and verification.', 'lab.read'],
  ['pharmacy', 'Pharmacy & inventory', 'Stock, batches, expiry and dispensing.', 'pharmacy.read'],
  ['reports', 'Reports', 'Operational and financial reports with CSV export.', 'reports.read'],
];

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<TenantAuthProvider><Outlet /></TenantAuthProvider>}>
          <Route element={<PublicLayout />}>
            <Route index element={<Home />} />
            <Route path="features" element={<Features />} />
            <Route path="pricing" element={<Pricing />} />
            <Route path="book-demo" element={<BookDemo />} />
            <Route path="contact" element={<Contact />} />
            <Route path="about" element={<About />} />
            <Route path="faq" element={<Faq />} />
            <Route path="terms" element={<Legal kind="terms" />} />
            <Route path="privacy" element={<Legal kind="privacy" />} />
            <Route path="cancellation" element={<Legal kind="cancellation" />} />
            <Route path="register" element={<Register />} />
            <Route path="login" element={<Login />} />
            <Route path="forgot-password" element={<ForgotPassword />} />
            <Route path="reset-password" element={<ResetPassword />} />
          </Route>
          <Route path="app" element={<AppLayout />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={guard('dashboard.view', <Dashboard />)} />
            <Route path="patients" element={guard('patients.read', <Patients />)} />
            <Route path="patients/:id" element={guard('patients.read', <PatientDetail />)} />
            <Route path="appointments" element={guard('appointments.read', <Appointments />)} />
            <Route path="staff" element={guard('staff.read', <Staff />)} />
            <Route path="doctors" element={<Navigate to="/app/staff" replace />} />
            <Route path="users-roles" element={guard('users.read', <UsersRoles />)} />
            <Route path="audit-log" element={guard('audit.read', <AuditLog />)} />
            <Route path="settings" element={guard('settings.read', <Settings />)} />
            <Route path="subscription" element={guard('subscription.read', <Subscription />)} />
            {SOON.map(([path, title, desc, perm]) => <Route key={path} path={path} element={guard(perm, <ComingSoon title={title} description={desc} />)} />)}
            <Route path="*" element={<Navigate to="dashboard" replace />} />
          </Route>
        </Route>

        <Route path="admin" element={<AdminAuthProvider><Outlet /></AdminAuthProvider>}>
          <Route path="login" element={<AdminLogin />} />
          <Route element={<AdminLayout />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<AdminDashboard />} />
            <Route path="tenants" element={<Tenants />} />
            <Route path="tenants/:id" element={<TenantDetail />} />
            <Route path="plans" element={<Plans />} />
            <Route path="subscriptions" element={<Subscriptions />} />
            <Route path="payments" element={<Payments />} />
            <Route path="demo-requests" element={<DemoRequests />} />
            <Route path="messages" element={<Messages />} />
            <Route path="audit-logs" element={<AuditLogs />} />
            <Route path="settings" element={<AdminSettings />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
