import { useState } from 'react';
import { LuDownload, LuUsers, LuCalendarClock, LuStethoscope, LuBedDouble, LuFlaskConical, LuIndianRupee, LuReceipt, LuChartBar } from 'react-icons/lu';
import { api, qs } from '../../lib/api.js';
import { useApi } from '../../lib/hooks.js';
import { useTenantAuth } from '../../context/AuthContext.jsx';
import { money, todayIn } from '../../lib/format.js';
import { Alert, Button, Card, DataTable, EmptyState, Input, PageHeader, StatCard, cx } from '../../components/ui.jsx';

const isMoney = (key) => ['payments', 'refunds', 'net', 'total', 'paid', 'balance', 'stockValueAtCost'].includes(key);

export default function Reports() {
  const { me, can } = useTenantAuth();
  const tz = me.tenant.timezone;
  const today = todayIn(tz);
  const monthAgo = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(Date.now() - 29 * 86400000));
  const [range, setRange] = useState({ from: monthAgo, to: today });
  const [applied, setApplied] = useState(range);
  const [selected, setSelected] = useState('registrations');
  const summary = useApi(() => api.get(`/reports/summary${qs(applied)}`), [applied.from, applied.to]);
  const report = useApi(() => api.get(`/reports/${selected}${qs(applied)}`), [selected, applied.from, applied.to]);
  const s = summary.data;
  const csvHref = `/api/v1/reports/${selected}.csv${qs(applied)}`;
  return (
    <>
      <PageHeader title="Reports" subtitle={`All figures come from recorded transactions in ${me.tenant.name}. Dates use ${tz}.`} />
      <Card className="mb-6 p-4">
        <form className="grid gap-3 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); setApplied(range); }}>
          <Input label="From" type="date" max={range.to} value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
          <Input label="To" type="date" min={range.from} max={today} value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
          <div className="flex items-end gap-2 sm:col-span-2">
            <Button type="submit">Apply</Button>
            {[['7 days', 6], ['30 days', 29], ['90 days', 89]].map(([l, d]) => (
              <Button key={l} type="button" variant="ghost" size="sm" onClick={() => { const r = { from: new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(Date.now() - d * 86400000)), to: today }; setRange(r); setApplied(r); }}>{l}</Button>
            ))}
          </div>
        </form>
      </Card>
      {summary.error && <Alert tone="error" className="mb-4">{summary.error.message}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="New patients" icon={LuUsers} loading={summary.loading} value={s?.registrations} />
        <StatCard label="Appointments" icon={LuCalendarClock} loading={summary.loading} value={s?.appointments} />
        <StatCard label="Consultations finalised" icon={LuStethoscope} loading={summary.loading} value={s?.consultations} />
        <StatCard label="Admissions" icon={LuBedDouble} loading={summary.loading} value={s?.admissions} hint={s ? `Bed occupancy now: ${s.occupancyPercent ?? '—'}% (${s.occupiedBeds}/${s.beds})` : undefined} />
        <StatCard label="Lab orders" icon={LuFlaskConical} loading={summary.loading} value={s?.labOrders} />
        <StatCard label="Billed (finalised)" icon={LuReceipt} loading={summary.loading} value={s ? money(s.billed) : ''} />
        <StatCard label="Net collections" icon={LuIndianRupee} loading={summary.loading} value={s ? money(s.netCollections) : ''} hint="Payments minus refunds" />
        <StatCard label="Outstanding (all time)" icon={LuReceipt} loading={summary.loading} value={s ? money(s.outstanding) : ''} />
      </div>

      <Card className="mt-6">
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex gap-1 overflow-x-auto" role="tablist">
            {(s?.reports || []).map((r) => (
              <button key={r.key} role="tab" aria-selected={selected === r.key} onClick={() => setSelected(r.key)}
                className={cx('whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-semibold', selected === r.key ? 'bg-forest-900 text-white' : 'text-forest-800 hover:bg-forest-50')}>{r.title.split(' (')[0]}</button>
            ))}
          </div>
          {can('reports.export') && <Button variant="outline" href={csvHref} download><LuDownload aria-hidden /> Export CSV</Button>}
        </div>
        {report.data && <p className="px-4 pt-3 text-sm font-semibold text-forest-950">{report.data.title}</p>}
        <DataTable rowKey="__i" loading={report.loading} error={report.error}
          rows={report.data?.rows?.map((r, i) => ({ ...r, __i: i }))}
          empty={<EmptyState icon={LuChartBar} title="No data for this period" />}
          columns={(report.data?.columns || []).map((c) => ({
            key: c.key, label: c.label,
            render: (row) => {
              const v = row[c.key];
              if (v === null || v === undefined) return '—';
              if (isMoney(c.key)) return money(v);
              if (/At$/.test(c.key)) return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: tz }).format(new Date(v));
              return String(v);
            },
          }))} />
        {report.data?.rows?.length === 1000 && <p className="p-4 text-xs text-muted">Showing the first 1,000 rows. Export CSV for the full report.</p>}
      </Card>
    </>
  );
}
