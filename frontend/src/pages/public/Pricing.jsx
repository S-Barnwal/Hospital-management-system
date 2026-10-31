import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LuCheck, LuMinus, LuCrown } from 'react-icons/lu';
import { useApi } from '../../lib/hooks.js';
import { api } from '../../lib/api.js';
import { money, titleCase } from '../../lib/format.js';
import { Alert, Button, Skeleton, cx } from '../../components/ui.jsx';
import Reveal from '../../components/Reveal.jsx';
import { PageHero } from './InfoPages.jsx';
import { anyFree } from '../../components/FreeBanner.jsx';

export default function Pricing() {
  const [interval, setBilling] = useState('monthly');
  const { data: plans, loading, error } = useApi(() => api.get('/plans'), []);
  const navigate = useNavigate();

  const featureRows = plans?.[0]?.features?.map((f) => ({ key: f.key, label: f.label })) ?? [];

  return (
    <>
      <PageHero eyebrow="Pricing" title={anyFree(plans) ? 'Hurray! Plans are free for now' : 'Simple plans for every size of hospital'}>
        {anyFree(plans)
          ? 'Register your hospital today at no cost — you get your own secure workspace straight away. We will e-mail you well before charging starts.'
          : 'Prices exclude GST, which is shown before you pay. Cancel or change plans at renewal.'}
      </PageHero>

      <section className="container-page py-14">
        <div className="mx-auto mb-10 flex w-fit items-center rounded-full border border-line bg-white p-1 shadow-sm" role="radiogroup" aria-label="Billing interval">
          {['monthly', 'annual'].map((i) => (
            <button key={i} role="radio" aria-checked={interval === i} onClick={() => setBilling(i)}
              className={cx('rounded-full px-5 py-2 text-sm font-semibold transition', interval === i ? 'bg-forest-900 text-white' : 'text-forest-800 hover:bg-forest-50')}>
              {titleCase(i)}{i === 'annual' && <span className={cx('ml-2 rounded-full px-2 py-0.5 text-[11px]', interval === i ? 'bg-gold-500 text-forest-950' : 'bg-gold-100 text-gold-700')}>2 months free</span>}
            </button>
          ))}
        </div>

        {error && <Alert tone="error" className="mx-auto max-w-xl">Plans could not be loaded: {error.message}</Alert>}

        <div className="grid gap-6 lg:grid-cols-3">
          {loading && [0, 1, 2].map((i) => <div key={i} className="card p-8"><Skeleton className="h-6 w-32" /><Skeleton className="mt-6 h-10 w-40" /><Skeleton className="mt-8 h-40 w-full" /></div>)}
          {plans?.map((p, i) => {
            const q = p[interval];
            return (
              <Reveal key={p.code} delay={i * 0.07}
                className={cx('relative flex flex-col rounded-2xl border bg-white p-8 shadow-[var(--shadow-soft)]',
                  p.popular ? 'border-gold-400 ring-4 ring-gold-100 lg:-translate-y-3' : 'border-line')}>
                {p.popular && (
                  <span className="absolute -top-3.5 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-gold-500 px-3 py-1 text-xs font-bold text-forest-950">
                    <LuCrown aria-hidden /> Most popular
                  </span>
                )}
                <h2 className="font-display text-2xl font-semibold text-forest-950">{p.name}</h2>
                <p className="mt-1 text-sm text-muted">{p.tagline}</p>
                <div className="mt-6 min-h-20">
                  {p.contactSales ? (
                    <><p className="font-display text-4xl font-semibold text-forest-950">Custom</p><p className="mt-1 text-sm text-muted">Tailored to your hospital</p></>
                  ) : p.isFree ? (
                    <>
                      <p className="font-display text-4xl font-semibold text-forest-950">Free <span className="ml-1 align-middle rounded-full bg-gold-100 px-2 py-0.5 font-sans text-xs font-bold text-gold-700">for now</span></p>
                      <p className="mt-1 text-xs text-muted">Normally <s>{money(q.subtotal, p.currency)} / {interval === 'monthly' ? 'month' : 'year'}</s> · no payment needed today</p>
                    </>
                  ) : (
                    <>
                      <p className="font-display text-4xl font-semibold text-forest-950">{money(q.subtotal, p.currency)}<span className="font-sans text-base font-medium text-muted"> / {interval === 'monthly' ? 'month' : 'year'}</span></p>
                      <p className="mt-1 text-xs text-muted">+ {p.taxRatePercent}% GST ({money(q.tax, p.currency)}) · <span className="font-semibold text-forest-900">{money(q.total, p.currency)} payable</span></p>
                    </>
                  )}
                </div>
                <ul className="mt-6 space-y-2 text-sm text-forest-900">
                  <li className="flex gap-2"><LuCheck className="mt-0.5 shrink-0 text-gold-600" aria-hidden />{p.limits.staffUsers ? `Up to ${p.limits.staffUsers} staff users` : 'Unlimited staff users'}</li>
                  <li className="flex gap-2"><LuCheck className="mt-0.5 shrink-0 text-gold-600" aria-hidden />{p.limits.branches ? `${p.limits.branches} branch` : 'Multiple branches'}</li>
                  {p.features.filter((f) => f.included).slice(0, 6).map((f) => (
                    <li key={f.key} className="flex gap-2"><LuCheck className="mt-0.5 shrink-0 text-gold-600" aria-hidden />{f.label}</li>
                  ))}
                </ul>
                <div className="mt-auto pt-8">
                  {p.contactSales
                    ? <Button variant="outline" className="w-full" to="/book-demo">Contact sales</Button>
                    : <>
                      <Button variant={p.popular ? 'gold' : 'primary'} className="w-full" onClick={() => navigate(`/register?plan=${p.code}&interval=${interval}`)}>{p.isFree ? `Register free — ${p.name}` : `Choose ${p.name}`}</Button>
                      {p.trialDays > 0 && <button type="button" className="mt-2 w-full text-sm font-semibold text-forest-700 underline-offset-2 hover:underline" onClick={() => navigate(`/register?plan=${p.code}&interval=${interval}&trial=1`)}>or start a {p.trialDays}-day free trial</button>}
                    </>}
                </div>
              </Reveal>
            );
          })}
        </div>

        {featureRows.length > 0 && (
          <div className="mt-20">
            <h2 className="text-center font-display text-2xl font-semibold text-forest-950">Compare features</h2>
            <div className="card mt-8 overflow-x-auto">
              <table className="table-base">
                <thead><tr><th scope="col">Feature</th>{plans.map((p) => <th key={p.code} scope="col" className="text-center">{p.name}</th>)}</tr></thead>
                <tbody className="divide-y divide-line">
                  {featureRows.map((row) => (
                    <tr key={row.key}>
                      <td className="font-medium text-forest-950">{row.label}</td>
                      {plans.map((p) => {
                        const inc = p.features.find((f) => f.key === row.key)?.included;
                        return <td key={p.code} className="text-center">{inc ? <LuCheck className="mx-auto text-forest-600" aria-label="Included" /> : <LuMinus className="mx-auto text-slate-300" aria-label="Not included" />}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-center text-xs text-muted">Some modules are on the roadmap; see Features for what is available today.</p>
          </div>
        )}
      </section>
    </>
  );
}
