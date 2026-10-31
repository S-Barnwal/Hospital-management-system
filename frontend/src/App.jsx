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
import { UsersRoles, Settings, Subscription, AuditLog, MessageLog } from './pages/app/AccountPages.jsx';
import { SampleLabels, PatientCard, SubscriptionInvoice, DischargeSummaryPrint } from './pages/app/PrintPages.jsx';
import AdmissionDetail from './pages/app/AdmissionDetail.jsx';
import { HomeCollections } from './pages/app/LabExtras.jsx';
import { RxTemplates, FollowUps } from './pages/app/OpdExtras.jsx';
import { Deposits, CashClosing, CashClosingSlip } from './pages/app/CashPages.jsx';
import PayView from './pages/public/PayView.jsx';
import ReportView from './pages/public/ReportView.jsx';
import Opd, { ConsultationDetail } from './pages/app/Opd.jsx';
import Ipd from './pages/app/Ipd.jsx';
import Billing, { BillDetail } from './pages/app/Billing.jsx';
import Lab, { LabOrderDetail } from './pages/app/Lab.jsx';
import Pharmacy from './pages/app/Pharmacy.jsx';
import Reports from './pages/app/Reports.jsx';
import { LabTests, LabPackages, PackageForm, PriceHistory, LabSamples, LabResults, ReferralDoctors } from './pages/app/LabPages.jsx';
import { Payments as HospitalPayments, Expenses } from './pages/app/FinancePages.jsx';
import Analytics from './pages/app/Analytics.jsx';
import Backups from './pages/app/Backups.jsx';
import Hr, { Payslip } from './pages/app/Hr.jsx';
import Queue from './pages/app/FrontDesk.jsx';
import { Support, SupportTicket, Branches } from './pages/app/AccountExtras.jsx';
import TvDisplay from './pages/public/TvDisplay.jsx';
import BookOnline from './pages/public/BookOnline.jsx';
import {
  AdminDashboard, Tenants, TenantDetail, Plans, Subscriptions, Payments, DemoRequests, Messages, AuditLogs, AdminSettings,
} from './pages/admin/AdminPages.jsx';
import { Invoices, InvoiceDetail } from './pages/admin/Invoices.jsx';
import HospitalMap from './pages/admin/HospitalMap.jsx';
import { Revenue, Monitoring, Coupons, LoginHistory, SupportQueue, SupportTicketAdmin, Groups } from './pages/admin/PlatformPages.jsx';

const guard = (perm, el, feature) => <RequirePerm perm={perm} feature={feature}>{el}</RequirePerm>;


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
          {/* Patient-facing secure report link: no site navigation, no login. */}
          <Route path="report/:token" element={<ReportView />} />
          <Route path="pay/:token" element={<PayView />} />
          <Route path="book/:slug" element={<BookOnline />} />
          <Route path="tv/:token" element={<TvDisplay />} />
          <Route path="app" element={<AppLayout />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={guard('dashboard.view', <Dashboard />)} />
            <Route path="patients" element={guard('patients.read', <Patients />)} />
            <Route path="patients/:id" element={guard('patients.read', <PatientDetail />)} />
            <Route path="appointments" element={guard('appointments.read', <Appointments />)} />
            <Route path="staff" element={guard('staff.read', <Staff />)} />
            <Route path="hr" element={guard(['staff.read', 'hr.attendance', 'hr.leave', 'hr.payroll'], <Hr />)} />
            <Route path="payslips/:id" element={guard('hr.payroll', <Payslip />)} />
            <Route path="queue" element={guard(['queue.manage', 'appointments.read'], <Queue />)} />
            <Route path="support" element={guard('support.use', <Support />)} />
            <Route path="support/:id" element={guard('support.use', <SupportTicket />)} />
            <Route path="branches" element={guard('branches.view', <Branches />)} />
            <Route path="doctors" element={<Navigate to="/app/staff" replace />} />
            <Route path="users-roles" element={guard('users.read', <UsersRoles />)} />
            <Route path="audit-log" element={guard('audit.read', <AuditLog />)} />
            <Route path="message-log" element={guard('audit.read', <MessageLog />)} />
            <Route path="patients/:id/card" element={guard('patients.read', <PatientCard />)} />
            <Route path="laboratory/:id/labels" element={guard('lab.read', <SampleLabels />, 'laboratory')} />
            <Route path="settings" element={guard('settings.read', <Settings />)} />
            <Route path="subscription" element={guard('subscription.read', <Subscription />)} />
            <Route path="subscription/invoices/:id" element={guard('subscription.read', <SubscriptionInvoice />)} />
            <Route path="opd" element={guard('opd.read', <Opd />, 'opd')} />
            <Route path="opd/:id" element={guard('opd.read', <ConsultationDetail />, 'opd')} />
            <Route path="admissions" element={guard('ipd.read', <Ipd />, 'ipd')} />
            <Route path="admissions/:id" element={guard('ipd.read', <AdmissionDetail />, 'ipd')} />
            <Route path="admissions/:id/discharge-summary" element={guard('ipd.read', <DischargeSummaryPrint />, 'ipd')} />
            <Route path="rx-templates" element={guard('opd.read', <RxTemplates />, 'opd')} />
            <Route path="follow-ups" element={guard('opd.read', <FollowUps />, 'opd')} />
            <Route path="deposits" element={guard('billing.read', <Deposits />, 'billing')} />
            <Route path="cash-closing" element={guard('billing.read', <CashClosing />, 'billing')} />
            <Route path="cash-closing/:id" element={guard('billing.read', <CashClosingSlip />, 'billing')} />
            <Route path="beds" element={<Navigate to="/app/admissions" replace />} />
            <Route path="billing" element={guard('billing.read', <Billing />, 'billing')} />
            <Route path="billing/:id" element={guard('billing.read', <BillDetail />, 'billing')} />
            <Route path="laboratory" element={guard('lab.read', <Lab />, 'laboratory')} />
            <Route path="laboratory/:id" element={guard('lab.read', <LabOrderDetail />, 'laboratory')} />
            <Route path="lab-tests" element={guard('lab.read', <LabTests />, 'laboratory')} />
            <Route path="home-collections" element={guard('lab.read', <HomeCollections />, 'laboratory')} />
            <Route path="lab-packages" element={guard('lab.read', <LabPackages />, 'laboratory')} />
            <Route path="lab-packages/new" element={guard('lab.configure', <PackageForm />, 'laboratory')} />
            <Route path="lab-packages/:id/edit" element={guard('lab.configure', <PackageForm />, 'laboratory')} />
            <Route path="lab-prices/:type/:id" element={guard('lab.read', <PriceHistory />, 'laboratory')} />
            <Route path="lab-samples" element={guard('lab.read', <LabSamples />, 'laboratory')} />
            <Route path="lab-results" element={guard('lab.read', <LabResults />, 'laboratory')} />
            <Route path="referral-doctors" element={guard('lab.read', <ReferralDoctors />, 'laboratory')} />
            <Route path="payments" element={guard('billing.read', <HospitalPayments />, 'billing')} />
            <Route path="expenses" element={guard('expenses.read', <Expenses />, 'billing')} />
            <Route path="analytics" element={guard('reports.read', <Analytics />, 'reports')} />
            <Route path="backups" element={guard('backups.manage', <Backups />)} />
            <Route path="pharmacy" element={guard('pharmacy.read', <Pharmacy />, 'pharmacy')} />
            <Route path="inventory" element={<Navigate to="/app/pharmacy" replace />} />
            <Route path="reports" element={guard('reports.read', <Reports />, 'reports')} />
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
            <Route path="invoices" element={<Invoices />} />
            <Route path="invoices/:id" element={<InvoiceDetail />} />
            <Route path="hospital-map" element={<HospitalMap />} />
            <Route path="demo-requests" element={<DemoRequests />} />
            <Route path="messages" element={<Messages />} />
            <Route path="audit-logs" element={<AuditLogs />} />
            <Route path="settings" element={<AdminSettings />} />
            <Route path="revenue" element={<Revenue />} />
            <Route path="monitoring" element={<Monitoring />} />
            <Route path="coupons" element={<Coupons />} />
            <Route path="login-history" element={<LoginHistory />} />
            <Route path="support" element={<SupportQueue />} />
            <Route path="support/:id" element={<SupportTicketAdmin />} />
            <Route path="groups" element={<Groups />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
