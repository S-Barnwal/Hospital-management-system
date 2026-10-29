import { useState } from 'react';
import { Link, useNavigate, useSearchParams, Navigate } from 'react-router-dom';
import { LuShieldCheck } from 'react-icons/lu';
import { api } from '../../lib/api.js';
import { useForm } from '../../lib/hooks.js';
import { Alert, Button, Card, Input } from '../../components/ui.jsx';
import { LogoMark } from '../../components/Logo.jsx';
import { useTenantAuth, useAdminAuth } from '../../context/AuthContext.jsx';
import { BRAND } from '../../lib/format.js';

/** Tenant slug from the current hostname (green-valley.app.example.com / green-valley.localhost). */
function hostWorkspace() {
  const host = window.location.hostname;
  const parts = host.split('.');
  if (host.endsWith('localhost') && parts.length === 2) return parts[0];
  if (parts.length >= 4 && !['www', 'app', 'admin'].includes(parts[0])) return parts[0];
  return '';
}

function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="grid min-h-[80vh] place-items-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <LogoMark className="mx-auto h-12 w-12" />
          <h1 className="mt-4 font-display text-3xl font-semibold text-forest-950">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        </div>
        <Card className="p-6 sm:p-8">{children}</Card>
        {footer && <div className="mt-5 text-center text-sm text-muted">{footer}</div>}
      </div>
    </div>
  );
}

export function Login() {
  const navigate = useNavigate();
  const { me, refresh } = useTenantAuth();
  const fixedWorkspace = hostWorkspace();
  const [needWorkspace, setNeedWorkspace] = useState(Boolean(fixedWorkspace));
  const f = useForm({ email: '', password: '', workspace: fixedWorkspace });
  if (me) return <Navigate to="/app/dashboard" replace />;
  const onSubmit = f.submit(async (v) => {
    try {
      await api.post('/auth/login', { email: v.email, password: v.password, ...(v.workspace ? { workspace: v.workspace } : {}) });
    } catch (e) {
      if (e.code === 'WORKSPACE_REQUIRED') setNeedWorkspace(true);
      throw e;
    }
    await refresh();
    navigate('/app/dashboard', { replace: true });
  });
  return (
    <AuthShell title="Sign in to your hospital" subtitle={fixedWorkspace ? `Workspace: ${fixedWorkspace}` : `${BRAND} for hospital staff`}
      footer={<>New to {BRAND}? <Link to="/pricing" className="font-semibold text-forest-700">Choose a plan</Link></>}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Input label="E-mail" type="email" autoComplete="username" required {...f.bind('email')} error={f.errors.email} />
        <Input label="Password" type="password" autoComplete="current-password" required {...f.bind('password')} error={f.errors.password} />
        {needWorkspace && !fixedWorkspace && (
          <Input label="Hospital workspace" placeholder="e.g. green-valley" {...f.bind('workspace')} error={f.errors.workspace} hint="The name in your hospital’s address, before .app" />
        )}
        {f.formError && <Alert tone="error">{f.formError}</Alert>}
        <Button type="submit" className="w-full" size="lg" loading={f.submitting}>Sign in</Button>
        <div className="flex justify-between text-sm">
          {!needWorkspace ? <button type="button" className="text-forest-700 hover:underline" onClick={() => setNeedWorkspace(true)}>Use workspace name</button> : <span />}
          <Link to="/forgot-password" className="text-forest-700 hover:underline">Forgot password?</Link>
        </div>
      </form>
    </AuthShell>
  );
}

export function ForgotPassword() {
  const [msg, setMsg] = useState(null);
  const f = useForm({ email: '', workspace: hostWorkspace() });
  const onSubmit = f.submit(async (v) => {
    const res = await api.post('/auth/forgot-password', { email: v.email, ...(v.workspace ? { workspace: v.workspace } : {}) });
    setMsg(res.data.message);
  });
  return (
    <AuthShell title="Reset your password" subtitle="We’ll e-mail you a single-use link valid for 30 minutes." footer={<Link to="/login" className="font-semibold text-forest-700">Back to sign in</Link>}>
      {msg ? <Alert tone="success">{msg}</Alert> : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Input label="E-mail" type="email" required {...f.bind('email')} error={f.errors.email} />
          <Input label="Hospital workspace (optional)" {...f.bind('workspace')} />
          {f.formError && <Alert tone="error">{f.formError}</Alert>}
          <Button type="submit" className="w-full" loading={f.submitting}>Send reset link</Button>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const [done, setDone] = useState(false);
  const f = useForm({ password: '', confirm: '' });
  const onSubmit = f.submit(async (v) => {
    if (v.password !== v.confirm) { f.setErrors({ confirm: 'Passwords do not match.' }); return; }
    await api.post('/auth/reset-password', { token: params.get('token') || '', password: v.password });
    setDone(true);
  });
  return (
    <AuthShell title="Choose a new password" footer={<Link to="/login" className="font-semibold text-forest-700">Back to sign in</Link>}>
      {done ? <Alert tone="success">Password updated. You can now sign in.</Alert> : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Input label="New password" type="password" autoComplete="new-password" required {...f.bind('password')} error={f.errors.password} hint="10+ characters with letters and numbers." />
          <Input label="Confirm password" type="password" autoComplete="new-password" required {...f.bind('confirm')} error={f.errors.confirm} />
          {f.formError && <Alert tone="error">{f.formError}</Alert>}
          <Button type="submit" className="w-full" loading={f.submitting}>Update password</Button>
        </form>
      )}
    </AuthShell>
  );
}

export function AdminLogin() {
  const navigate = useNavigate();
  const { admin, refresh } = useAdminAuth();
  const f = useForm({ email: '', password: '' });
  if (admin) return <Navigate to="/admin/dashboard" replace />;
  const onSubmit = f.submit(async (v) => {
    await api.post('/auth/admin/login', v);
    await refresh();
    navigate('/admin/dashboard', { replace: true });
  });
  return (
    <div className="min-h-screen bg-forest-950">
      <AuthShell title={<span className="text-white">Platform administration</span>} subtitle={<span className="flex items-center justify-center gap-1 text-forest-200"><LuShieldCheck aria-hidden /> Super Admin access only</span>}>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Input label="E-mail" type="email" autoComplete="username" required {...f.bind('email')} error={f.errors.email} />
          <Input label="Password" type="password" autoComplete="current-password" required {...f.bind('password')} error={f.errors.password} />
          {f.formError && <Alert tone="error">{f.formError}</Alert>}
          <Button type="submit" className="w-full" size="lg" loading={f.submitting}>Sign in</Button>
        </form>
      </AuthShell>
    </div>
  );
}
