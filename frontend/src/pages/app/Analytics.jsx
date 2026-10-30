// Analytics: business overview for a date range — collections, expenses, profit, lab performance, referrals.
import { useState } from 'react';
import { LuWallet, LuTrendingUp, LuTrendingDown, LuFlaskConical, LuUsers, LuClock, LuReceipt } from 'react-icons/lu';
import { api, qs } from '../../lib/api.js';
import { useApi } from '../../lib/hooks.js';
import { useTenantAuth } from '../../context/AuthContext.jsx';
import { money, todayIn, titleCase } from '../../lib/format.js';
import { Alert, Card, Input, PageHeader, Skeleton, StatCard } from '../../components/ui.jsx';
import BarChart from '../../components/BarChart.jsx';

const daysAgo = (tz, n) => {
  const d = new Date(`${todayIn(tz)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

/** Horizontal bars for a ranked list. */
function Ranked({ rows, label, value, format = (v) => v, empty = 'No data in this period.' }) {
  const max = Math.max(1, ...rows.map((r) => Number(r[value])));
  if (!rows.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r[label]} className="text-sm">
          <div className="flex justify-between gap-2"><span className="truncate">{r[label]}</span><span className="shrink-0 font-semibold">{format(r[value])}</span></div>
          <div className="mt-1 h-2 rounded-full bg-forest-50"><div className="h-2 rounded-full bg-forest-600" style={{ width: `${(Number(r[value]) / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

export default function Analytics() {
  const { me } = useTenantAuth();
  const tz = me.tenant.timezone;
  const [range, setRange] = useState({ from: daysAgo(tz, 29), to: todayIn(tz) });
  const { data, loading, error } = useApi(() => api.get(`/analytics${qs(range)}`), [range.from, range.to]);
  const presets = [['7 days', 6], ['30 days', 29], ['90 days', 89], ['1 year', 364]];
  const fin = data?.finance; const lab = data?.lab;
  const net = (data?.dailyMoney || []).map((d) => ({ date: d.date, value: Math.max(0, d.collections) }));
  const exp = (data?.dailyMoney || []).map((d) => ({ date: d.date, value: d.expenses }));
  return (
    <>
      <PageHeader title="Analytics" subtitle="How the hospital is doing — money in, money out, and lab performance." />
      <Card className="mb-4 flex flex-wrap items-end gap-3 p-4">
        <Input label="From" type="date" value={range.from} max={range.to} onChange={(e) => setRange((s) => ({ ...s, from: e.target.value }))} />
        <Input label="To" type="date" value={range.to} min={range.from} max={todayIn(tz)} onChange={(e) => setRange((s) => ({ ...s, to: e.target.value }))} />
        <div className="flex flex-wrap gap-1">
          {presets.map(([l, n]) => <button key={l} type="button" onClick={() => setRange({ from: daysAgo(tz, n), to: todayIn(tz) })} className="rounded-md border border-line px-3 py-2 text-xs font-semibold hover:bg-forest-50">{l}</button>)}
        </div>
      </Card>
      {error && <Alert tone="error" className="mb-4">{error.message}</Alert>}
      {loading && !data ? <Skeleton className="h-72 w-full" /> : data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {fin && <StatCard label="Net collections" icon={LuWallet} value={money(fin.netCollections)} hint={`${money(fin.payments)} received · ${money(fin.refunds)} refunded`} />}
            {fin && <StatCard label="Expenses" icon={LuTrendingDown} value={money(fin.expenses)} />}
            {fin && <StatCard label="Profit (cash basis)" icon={LuTrendingUp} value={<span className={Number(fin.profit) < 0 ? 'text-red-700' : ''}>{money(fin.profit)}</span>} hint="Collections − refunds − expenses" />}
            {fin && <StatCard label="Outstanding (all time)" icon={LuReceipt} value={money(fin.outstanding)} hint="Unpaid balance on finalised bills" />}
            <StatCard label="New patients" icon={LuUsers} value={data.newPatients} />
            {lab && <StatCard label="Lab orders" icon={LuFlaskConical} value={lab.orders} hint={`${money(lab.revenue)} billed · avg ${money(lab.avgOrderValue)}`} />}
            {lab && <StatCard label="Reports verified" icon={LuFlaskConical} value={lab.verified} hint={lab.discounts !== '0.00' ? `${money(lab.discounts)} given as discount` : undefined} />}
            {lab && <StatCard label="Avg. turnaround" icon={LuClock} value={lab.avgTurnaroundHours == null ? '—' : `${lab.avgTurnaroundHours} h`} hint="Order to verified report" />}
          </div>

          {fin && (
            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <Card className="min-w-0 p-5"><p className="mb-3 font-semibold">Daily collections</p><BarChart data={net} valueKey="value" label="Net collections per day" lastLabel={range.to.slice(5)} /></Card>
              <Card className="min-w-0 p-5"><p className="mb-3 font-semibold">Daily expenses</p><BarChart data={exp} valueKey="value" label="Expenses per day" lastLabel={range.to.slice(5)} /></Card>
              <Card className="p-5"><p className="mb-3 font-semibold">Collections by payment method</p><Ranked rows={(data.byMethod || []).map((m) => ({ ...m, method: m.method.toUpperCase() }))} label="method" value="amount" format={money} /></Card>
              <Card className="p-5"><p className="mb-3 font-semibold">Expenses by category</p><Ranked rows={data.expenseByCategory || []} label="category" value="amount" format={money} /></Card>
            </div>
          )}

          {lab && (
            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <Card className="min-w-0 p-5 lg:col-span-2"><p className="mb-3 font-semibold">Lab orders per day</p><BarChart data={lab.daily} valueKey="orders" label="Lab orders per day" lastLabel={range.to.slice(5)} /></Card>
              <Card className="p-5"><p className="mb-3 font-semibold">Top tests</p><Ranked rows={lab.topTests} label="name" value="count" format={(v) => `${v} ordered`} /></Card>
              <Card className="p-5"><p className="mb-3 font-semibold">Top packages</p><Ranked rows={lab.topPackages} label="name" value="count" format={(v) => `${v} sold`} /></Card>
              <Card className="p-5"><p className="mb-3 font-semibold">Orders by status</p><Ranked rows={lab.byStatus.map((s) => ({ ...s, status: titleCase(s.status) }))} label="status" value="count" /></Card>
              <Card className="min-w-0 p-5">
                <p className="mb-3 font-semibold">Referral doctors — business & commission</p>
                {lab.referrals.length === 0 ? <p className="text-sm text-muted">No referred orders in this period.</p> : (
                  <div className="relative overflow-x-auto">
                    <table className="table-base">
                      <thead><tr><th>Doctor</th><th className="text-right">Orders</th><th className="text-right">Business</th><th className="text-right">Commission</th></tr></thead>
                      <tbody className="divide-y divide-line">
                        {lab.referrals.map((r) => <tr key={r.name}><td>{r.name} <span className="text-xs text-muted">({Number(r.commissionPercent)}%)</span></td><td className="text-right">{r.orders}</td><td className="text-right">{money(r.business)}</td><td className="text-right font-semibold">{money(r.commission)}</td></tr>)}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>
          )}
          {!fin && !lab && <Alert tone="info" className="mt-6">Billing and Laboratory analytics appear here when those modules are in your plan.</Alert>}
        </>
      )}
    </>
  );
}
