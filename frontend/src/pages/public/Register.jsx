// Plan purchase → payment → tenant provisioning.
// While a plan is "free for now" (Super Admin switch) the payment step is skipped: the server creates the workspace at once.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { LuCheck, LuShieldCheck, LuLoaderCircle, LuCircleCheck, LuCircleX } from 'react-icons/lu';
import { api } from '../../lib/api.js';
import { useApi, useDebounced, useForm } from '../../lib/hooks.js';
import { money, BRAND } from '../../lib/format.js';
import { openRazorpay } from '../../lib/payments.js';
import { Alert, Button, Card, Input, Select, Skeleton, cx } from '../../components/ui.jsx';
import SandboxGateway from '../../components/SandboxGateway.jsx';
import Logo from '../../components/Logo.jsx';
import { FACILITY_OPTIONS, planSuggestion } from '../../lib/facility.js';
import { useTenantAuth } from '../../context/AuthContext.jsx';
import PhoneInput from '../../components/PhoneInput.jsx';
import EmailInput from '../../components/EmailInput.jsx';
import LocationFields from '../../components/LocationFields.jsx';

const BASE_DOMAIN = import.meta.env?.VITE_APP_BASE_DOMAIN || '';
const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

function SlugStatus({ slug }) {
  const debounced = useDebounced(slug, 400);
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!debounced || debounced.length < 3) { setState(null); return; }
    let live = true;
    setState({ loading: true });
    api.get(`/onboarding/slug-availability?slug=${encodeURIComponent(debounced)}`)
      .then((r) => live && setState(r.data))
      .catch(() => live && setState(null));
    return () => { live = false; };
  }, [debounced]);
  if (!state) return null;
  if (state.loading) return <span className="flex items-center gap-1 text-xs text-muted"><LuLoaderCircle className="animate-spin" aria-hidden /> Checking…</span>;
  return state.available
    ? <span className="flex items-center gap-1 text-xs text-forest-700"><LuCircleCheck aria-hidden /> Available</span>
    : <span className="flex items-center gap-1 text-xs text-red-600"><LuCircleX aria-hidden /> {state.reason}</span>;
}

export default function Register() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useTenantAuth();
  const planCode = params.get('plan') || 'professional';
  const interval = params.get('interval') === 'annual' ? 'annual' : 'monthly';
  const { data: plans, loading } = useApi(() => api.get('/plans'), []);
  const plan = useMemo(() => plans?.find((p) => p.code === planCode && !p.contactSales), [plans, planCode]);
  const [slugTouched, setSlugTouched] = useState(false);
  const [checkout, setCheckout] = useState(null);
  const [stage, setStage] = useState('form'); // form | paying | verifying | done
  const [payError, setPayError] = useState(null);

  const f = useForm({ orgName: '', slug: '', facilityType: 'hospital', country: 'IN', state: '', city: '', phone: '', ownerName: '', ownerEmail: '', password: '', acceptTerms: false });

  const isFree = Boolean(plan?.isFree);
  // Free trial: offered when the plan has trial days (?trial=1 from Pricing, or the toggle below).
  const trialDays = plan?.trialDays || 0;
  const [trial, setTrial] = useState(params.get('trial') === '1');
  const isTrial = Boolean(trialDays && trial && !isFree);
  const noPayment = isFree || isTrial;
  const [coupon, setCoupon] = useState({ code: params.get('coupon') || '', applied: null, error: null, busy: false });
  useEffect(() => setCoupon((c) => (c.applied ? { ...c, applied: null } : c)), [planCode, interval]);
  const price = coupon.applied?.amount ?? plan?.[interval];
  const applyCoupon = async () => {
    setCoupon((c) => ({ ...c, busy: true, error: null }));
    try {
      const r = await api.post('/onboarding/coupon-preview', { planCode, interval, couponCode: coupon.code.trim() });
      setCoupon((c) => ({ ...c, busy: false, applied: r.data }));
    } catch (e) { setCoupon((c) => ({ ...c, busy: false, applied: null, error: e.message })); }
  };
  const suggestion = useMemo(() => planSuggestion(plans, plan, f.values.facilityType), [plans, plan, f.values.facilityType]);

  useEffect(() => {
    if (!slugTouched) f.setValues((v) => ({ ...v, slug: slugify(v.orgName) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.values.orgName, slugTouched]);

  const verify = async (result, onboardingId) => {
    setStage('verifying');
    try {
      await api.post('/onboarding/verify', { onboardingId, ...result });
      setStage('done');
      await refresh();
      setTimeout(() => navigate('/app/dashboard', { replace: true }), 1200);
    } catch (e) {
      setStage('form');
      setPayError(e.message);
    }
  };

  const onSubmit = f.submit(async (v) => {
    setPayError(null);
    const res = await api.post('/onboarding/checkout', { ...v, planCode, interval, acceptTerms: v.acceptTerms === true,
      ...(isTrial ? { trial: true } : coupon.applied ? { couponCode: coupon.applied.code } : {}) });
    const co = res.data;
    if (co.free || co.trial) {
      // Free plan: workspace already created and the owner signed in by the server.
      setStage('done');
      await refresh();
      setTimeout(() => navigate('/app/dashboard', { replace: true }), 1200);
      return;
    }
    setCheckout(co);
    setStage('paying');
    if (co.payment.provider === 'razorpay') {
      try {
        const result = await openRazorpay(co.payment, { name: BRAND, description: `${co.plan.name} plan (${interval})` });
        await verify(result, co.onboardingId);
      } catch (e) {
        setStage('form');
        setPayError(e.message);
      }
    }
  });

  if (stage === 'verifying' || stage === 'done') {
    return (
      <div className="grid min-h-[70vh] place-items-center px-4">
        <Card className="max-w-md p-10 text-center">
          {stage === 'verifying'
            ? <><LuLoaderCircle className="mx-auto h-10 w-10 animate-spin text-forest-600" aria-hidden /><h1 className="mt-4 font-display text-2xl font-semibold">Verifying payment…</h1><p className="mt-2 text-sm text-muted">Setting up {f.values.orgName}. Please don’t close this tab.</p></>
            : <><LuCircleCheck className="mx-auto h-12 w-12 text-forest-600" aria-hidden /><h1 className="mt-4 font-display text-2xl font-semibold">Your hospital is ready</h1><p className="mt-2 text-sm text-muted">Taking you to your dashboard…</p></>}
        </Card>
      </div>
    );
  }

  return (
    <div className="container-page py-12">
      <div className="mb-8 flex items-center gap-3 text-sm text-muted">
        {(noPayment ? ['Plan', 'Hospital & account', 'Workspace ready'] : ['Plan', 'Hospital & account', 'Payment', 'Workspace ready']).map((s, i, all) => (
          <span key={s} className="flex items-center gap-2">
            <span className={cx('grid h-6 w-6 place-items-center rounded-full text-xs font-bold', i <= (stage === 'paying' ? 2 : 1) ? 'bg-forest-900 text-gold-400' : 'bg-forest-50 text-forest-800')}>{i + 1}</span>
            <span className="hidden sm:inline">{s}</span>{i < all.length - 1 && <span className="hidden h-px w-6 bg-line sm:block" />}
          </span>
        ))}
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card className="p-6 sm:p-8">
            <h1 className="font-display text-2xl font-semibold text-forest-950">Create your hospital workspace</h1>
            {isFree && (
              <Alert tone="success" className="mt-4" title="Hurray! This plan is free for now">
                No payment needed — your hospital gets its own secure workspace as soon as you submit. We will e-mail you well before charging starts.
              </Alert>
            )}
            {trialDays > 0 && !isFree && (
              <div className="mt-4 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="How to start">
                {[[true, `Start ${trialDays}-day free trial`, 'No payment now. Choose to pay before the trial ends.'], [false, 'Buy now', 'Pay today; your plan starts immediately.']].map(([v, t, d]) => (
                  <button key={String(v)} type="button" role="radio" aria-checked={trial === v} onClick={() => setTrial(v)}
                    className={cx('rounded-xl border p-3 text-left', trial === v ? 'border-forest-800 bg-forest-50 ring-2 ring-forest-200' : 'border-line')}>
                    <span className="block font-semibold">{t}</span><span className="text-xs text-muted">{d}</span></button>))}
              </div>
            )}
            <p className="mt-1 text-sm text-muted">Already registered? <Link to="/login" className="font-semibold text-forest-700 underline-offset-2 hover:underline">Sign in</Link></p>
            <form onSubmit={onSubmit} noValidate className="mt-6 grid gap-5 sm:grid-cols-2">
              <fieldset className="contents">
                <legend className="eyebrow sm:col-span-2">Hospital</legend>
                <Input label="Hospital / clinic name" required {...f.bind('orgName')} error={f.errors.orgName} className="sm:col-span-2" />
                <div className="sm:col-span-2">
                  <Input label="Workspace address" required {...f.bind('slug')} onChange={(e) => { setSlugTouched(true); f.setValues((s) => ({ ...s, slug: slugify(e.target.value) })); }}
                    error={f.errors.slug} hint={BASE_DOMAIN && BASE_DOMAIN !== 'localhost' ? `Your staff will sign in at ${f.values.slug || 'your-hospital'}.${BASE_DOMAIN}` : 'Your staff type this on the login page. Letters, numbers and dashes only.'} />
                  <div className="mt-1"><SlugStatus slug={f.values.slug} /></div>
                </div>
                <Select label="Facility type" options={FACILITY_OPTIONS} {...f.bind('facilityType')} error={f.errors.facilityType} />
                <LocationFields form={f} required />
                {suggestion && (
                  <Alert tone="warning" className="sm:col-span-2" title={`The ${plan.name} plan does not include: ${suggestion.missing.join(', ')}`}>
                    Most {FACILITY_OPTIONS.find((o) => o.value === f.values.facilityType)?.label.toLowerCase()}s need {suggestion.missing.length > 1 ? 'these modules' : 'this module'}.
                    {suggestion.plan ? (
                      <> <button type="button" className="font-semibold underline" onClick={() => setParams({ plan: suggestion.plan.code, interval })}>Switch to {suggestion.plan.name} ({suggestion.plan.isFree ? 'free for now' : `${money(suggestion.plan[interval].total, suggestion.plan.currency)}/${interval === 'annual' ? 'year' : 'month'}`})</button> or continue with {plan.name} — you can upgrade later.</>
                    ) : ' You can upgrade later from Subscription.'}
                  </Alert>
                )}
              </fieldset>
              <fieldset className="contents">
                <legend className="eyebrow mt-2 sm:col-span-2">Owner account</legend>
                <Input label="Your full name" required autoComplete="name" {...f.bind('ownerName')} error={f.errors.ownerName} />
                <PhoneInput label="Phone" required defaultCountry={f.values.country || 'IN'} {...f.bind('phone')} error={f.errors.phone} />
                <EmailInput label="Work e-mail" required {...f.bind('ownerEmail')} error={f.errors.ownerEmail} />
                <Input label="Password" type="password" required autoComplete="new-password" {...f.bind('password')} error={f.errors.password} hint="10+ characters with letters and numbers." />
              </fieldset>
              <label className="flex items-start gap-3 text-sm sm:col-span-2">
                <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-line accent-forest-800" checked={f.values.acceptTerms}
                  onChange={(e) => f.setValues((s) => ({ ...s, acceptTerms: e.target.checked }))} />
                <span>I agree to the <Link to="/terms" className="font-semibold text-forest-700 underline">Terms</Link>, <Link to="/privacy" className="font-semibold text-forest-700 underline">Privacy Policy</Link> and <Link to="/cancellation" className="font-semibold text-forest-700 underline">subscription policy</Link>.</span>
              </label>
              {f.errors.acceptTerms && <p className="-mt-3 text-xs text-red-600 sm:col-span-2">{f.errors.acceptTerms}</p>}
              {(f.formError || payError) && <Alert tone="error" className="sm:col-span-2">{payError || f.formError}</Alert>}
              <div className="sm:col-span-2">
                <Button type="submit" size="lg" loading={f.submitting || stage === 'paying'} disabled={!plan} className="w-full">
                  {!plan ? 'Select a plan' : isFree ? 'Create my free workspace' : isTrial ? `Start my ${trialDays}-day free trial` : `Continue to payment · ${money(price.total, plan.currency)}`}
                </Button>
                <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted"><LuShieldCheck className="text-forest-600" aria-hidden /> {noPayment ? 'Your data stays private to your hospital — only your staff can see it.' : 'Your workspace is created only after the payment is verified on our server.'}</p>
              </div>
            </form>
          </Card>
        </div>

        <aside>
          <Card className="sticky top-24 overflow-hidden">
            <div className="bg-forest-950 p-6 text-white">
              <Logo light compact />
              <p className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-gold-400">Order summary</p>
              {loading ? <Skeleton className="mt-3 h-8 w-40 bg-white/10" /> : plan
                ? <p className="mt-2 font-display text-2xl font-semibold">{plan.name} <span className="text-base font-normal text-forest-100/80">· {interval}</span></p>
                : <p className="mt-2 text-sm text-gold-200">This plan is not available online. <Link to="/pricing" className="underline">Choose another</Link>.</p>}
            </div>
            {plan && (
              <div className="space-y-3 p-6 text-sm">
                {isFree ? (
                  <>
                    <div className="flex justify-between"><span className="text-muted">Normal price</span><s className="text-muted">{money(plan[interval].total, plan.currency)}</s></div>
                    <div className="flex justify-between border-t border-line pt-3 font-semibold text-forest-950"><span>Payable today</span><span className="text-forest-700">Free</span></div>
                  </>
                ) : isTrial ? (
                  <>
                    <div className="flex justify-between"><span className="text-muted">After the trial</span><span>{money(plan[interval].total, plan.currency)} / {interval === 'annual' ? 'year' : 'month'}</span></div>
                    <div className="flex justify-between border-t border-line pt-3 font-semibold text-forest-950"><span>Payable today</span><span className="text-forest-700">₹0 · {trialDays}-day trial</span></div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between"><span className="text-muted">Subtotal</span><span>{money(price.subtotal, plan.currency)}</span></div>
                    {Number(price.discount) > 0 && <div className="flex justify-between text-forest-700"><span>Coupon {coupon.applied?.code}</span><span>− {money(price.discount, plan.currency)}</span></div>}
                    <div className="flex justify-between"><span className="text-muted">GST ({plan.taxRatePercent}%)</span><span>{money(price.tax, plan.currency)}</span></div>
                    <div className="flex justify-between border-t border-line pt-3 font-semibold text-forest-950"><span>Total payable</span><span>{money(price.total, plan.currency)}</span></div>
                    <div className="flex items-start gap-2 pt-1">
                      <div className="min-w-0 flex-1">
                        <input className="input py-1.5 text-xs uppercase" placeholder="Coupon code" maxLength={30} value={coupon.code} aria-label="Coupon code"
                          onChange={(e) => setCoupon({ code: e.target.value.toUpperCase(), applied: null, error: null, busy: false })} />
                        {coupon.error && <p className="mt-1 text-xs text-red-600">{coupon.error}</p>}
                        {coupon.applied?.description && <p className="mt-1 text-xs text-forest-700">{coupon.applied.description}</p>}
                      </div>
                      <Button type="button" size="sm" variant="outline" onClick={applyCoupon} loading={coupon.busy} disabled={coupon.code.trim().length < 3}>Apply</Button>
                    </div>
                  </>
                )}
                <div className="flex gap-2 pt-2">
                  {['monthly', 'annual'].map((i) => (
                    <button key={i} type="button" onClick={() => setParams({ plan: planCode, interval: i })}
                      className={cx('flex-1 rounded-md border px-2 py-1.5 text-xs font-semibold', interval === i ? 'border-forest-800 bg-forest-50 text-forest-900' : 'border-line text-muted')}>{i === 'monthly' ? 'Monthly' : 'Annual'}</button>
                  ))}
                </div>
                <ul className="space-y-1.5 border-t border-line pt-4">
                  {plan.features.filter((x) => x.included).slice(0, 5).map((x) => <li key={x.key} className="flex gap-2 text-forest-900"><LuCheck className="mt-0.5 text-gold-600" aria-hidden />{x.label}</li>)}
                </ul>
              </div>
            )}
          </Card>
        </aside>
      </div>

      {stage === 'paying' && checkout?.payment.provider === 'sandbox' && (
        <SandboxGateway payment={checkout.payment}
          onAuthorised={(r) => verify(r, checkout.onboardingId)}
          onFailed={(e) => { setStage('form'); setPayError(e.message); }}
          onClose={() => { setStage('form'); setPayError('Payment was cancelled. You can try again.'); }} />
      )}
    </div>
  );
}
