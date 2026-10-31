// Finance → Deposits (patient advances) and Cash closing (end of shift / day).
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LuPlus, LuWallet, LuUndo2, LuArrowLeft, LuPrinter, LuLock } from 'react-icons/lu';
import { api, qs } from '../../lib/api.js';
import { useApi } from '../../lib/hooks.js';
import { useTenantAuth } from '../../context/AuthContext.jsx';
import { notify } from '../../lib/toast.js';
import { dateTime, fullName, money, titleCase } from '../../lib/format.js';
import { Alert, Badge, Button, Card, DataTable, EmptyState, Input, PageHeader, Pagination, Skeleton, StatCard, Textarea, cx } from '../../components/ui.jsx';
import { PatientPicker } from '../../components/Pickers.jsx';
import { DepositModal, DepositRefundModal } from '../../components/MoneyModals.jsx';

// ---------- Deposits ----------
export function Deposits() {
  const { can } = useTenantAuth();
  const [patient, setPatient] = useState(null);
  const [taking, setTaking] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const { data: holders, meta: hMeta, loading: hLoading, reload: reloadHolders } = useApi(() => api.get('/billing/deposits'), []);
  const { data: ledger, meta: lMeta, loading: lLoading, reload: reloadLedger } = useApi(() => (patient ? api.get(`/billing/deposits?patientId=${patient.id}`) : Promise.resolve({ data: null })), [patient?.id]);
  const done = () => { setTaking(false); setRefunding(false); reloadHolders(); reloadLedger(); };
  return (
    <>
      <PageHeader title="Deposits & advances" subtitle="Money patients pay in advance (e.g. at admission). It stays on their account until used on a bill or refunded."
        actions={can('billing.write') && <Button onClick={() => setTaking(true)}><LuPlus aria-hidden /> Take deposit</Button>} />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <div className="border-b border-line p-4"><p className="font-semibold">Patients holding a deposit</p><p className="text-sm text-muted">Total held: <strong>{money(hMeta?.total ?? 0)}</strong></p></div>
          {hLoading ? <Skeleton className="m-4 h-32" /> : !holders?.length ? <EmptyState icon={LuWallet} title="No deposits held" /> : (
            <ul className="divide-y divide-line">
              {holders.map((h) => (
                <li key={h.patientId}>
                  <button type="button" onClick={() => setPatient({ id: h.patientId, label: `${h.patientNumber} — ${fullName(h.patientFirstName, h.patientLastName)}` })}
                    className={cx('flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm hover:bg-forest-50', patient?.id === h.patientId && 'bg-forest-50')}>
                    <span><span className="font-medium">{fullName(h.patientFirstName, h.patientLastName)}</span><span className="block font-mono text-xs text-muted">{h.patientNumber}</span></span>
                    <span className="font-semibold">{money(h.balance)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-5 lg:col-span-3">
          <PatientPicker label="Patient ledger" required={false} value={patient} onChange={setPatient} />
          {patient && (
            <div className="mt-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p>Balance: <strong className="text-lg">{money(lMeta?.balance ?? 0)}</strong></p>
                <div className="flex gap-2">
                  {can('billing.write') && <Button size="sm" variant="outline" onClick={() => setTaking(true)}><LuPlus aria-hidden /> Deposit</Button>}
                  {can('billing.refund') && Number(lMeta?.balance) > 0 && <Button size="sm" variant="outline" onClick={() => setRefunding(true)}><LuUndo2 aria-hidden /> Refund</Button>}
                </div>
              </div>
              {lLoading ? <Skeleton className="h-24" /> : !ledger?.length ? <p className="text-sm text-muted">No deposit activity.</p> : (
                <div className="overflow-x-auto"><table className="table-base text-sm">
                  <thead><tr><th>Date</th><th>Receipt</th><th>Type</th><th>Details</th><th className="text-right">Amount</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {ledger.map((r) => (
                      <tr key={r.id}>
                        <td className="whitespace-nowrap">{dateTime(r.createdAt)}</td>
                        <td className="font-mono text-xs">{r.receiptNumber}</td>
                        <td><Badge tone={r.kind === 'deposit' ? 'green' : r.kind === 'refund' ? 'red' : 'blue'}>{r.kind === 'applied' ? 'Used on bill' : titleCase(r.kind)}</Badge></td>
                        <td className="text-xs">{r.kind === 'applied' ? <Link className="text-forest-700 underline" to={`/app/billing/${r.billId}`}>{r.billNumber}</Link> : [r.method && titleCase(r.method), r.reference, r.reason].filter(Boolean).join(' · ')}<span className="block text-muted">{r.createdBy}</span></td>
                        <td className={cx('text-right font-medium', r.kind !== 'deposit' && 'text-red-700')}>{r.kind === 'deposit' ? '+' : '−'}{money(r.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )}
            </div>
          )}
        </Card>
      </div>
      <DepositModal open={taking} patient={patient} onClose={() => setTaking(false)} onDone={done} />
      {refunding && <DepositRefundModal open patient={patient} balance={lMeta?.balance ?? 0} onClose={() => setRefunding(false)} onDone={done} />}
    </>
  );
}

// ---------- Cash closing ----------
const DENOMS = ['500', '200', '100', '50', '20', '10', '5', '2', '1', '2000'];
const METHOD_LABEL = { cash: 'Cash', upi: 'UPI', card: 'Card', bank: 'Bank', other: 'Other', deposit: 'From deposit' };

export function CashClosing() {
  const { can } = useTenantAuth();
  const { data: cur, loading, reload } = useApi(() => (can('cash.close') ? api.get('/billing/cash/current') : Promise.resolve({ data: null })), []);
  const [page, setPage] = useState(1);
  const { data: hist, meta, loading: hLoading, reload: reloadHist } = useApi(() => api.get(`/billing/cash/closings${qs({ page })}`), [page]);
  const [float, setFloat] = useState('0');
  const [counts, setCounts] = useState({});
  const [manual, setManual] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const useDenoms = Object.values(counts).some((v) => Number(v) > 0);
  const counted = useMemo(() => (useDenoms ? Object.entries(counts).reduce((s, [d, n]) => s + Number(d) * Number(n || 0), 0) : Number(manual || 0)), [counts, manual, useDenoms]);
  const expected = cur ? Number(cur.expectedCash) + Number(float || 0) : 0;
  const diff = Number((counted - expected).toFixed(2));

  const close = async () => {
    setErr(null); setBusy(true);
    try {
      const body = { openingFloat: Number(float || 0), ...(useDenoms ? { denominations: Object.fromEntries(Object.entries(counts).filter(([, n]) => Number(n) > 0).map(([d, n]) => [d, Number(n)])) } : { countedCash: Number(manual || 0) }), ...(notes.trim() ? { notes: notes.trim() } : {}) };
      const r = await api.post('/billing/cash/close', body);
      notify.success(`Cash closed — ${r.data.number}.`);
      setCounts({}); setManual(''); setNotes(''); setFloat('0'); reload(); reloadHist();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="Cash closing" subtitle="At the end of your shift: count the cash in your drawer and close. The software compares it with what you collected." />
      {can('cash.close') && (
        loading || !cur ? <Skeleton className="h-48 w-full" /> : (
          <div className="mb-8 grid gap-6 lg:grid-cols-5">
            <Card className="p-5 lg:col-span-3">
              <p className="text-sm text-muted">My collections since {dateTime(cur.periodStart)} · {cur.transactions} transaction(s)</p>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {Object.entries(cur.totals).filter(([, v]) => Number(v.in) || Number(v.out)).map(([m, v]) => (
                  <div key={m} className="rounded-lg border border-line p-3 text-sm"><p className="text-muted">{METHOD_LABEL[m]}</p><p className="font-semibold">{money(v.net)}</p>{Number(v.out) > 0 && <p className="text-xs text-red-700">refunds {money(v.out)}</p>}</div>
                ))}
                {!cur.transactions && <p className="col-span-3 text-sm text-muted">No money received or paid out yet in this shift.</p>}
              </div>
              {cur.rows.length > 0 && (
                <details className="mt-4 text-sm"><summary className="cursor-pointer font-semibold text-forest-800">Show transactions</summary>
                  <ul className="mt-2 divide-y divide-line">{cur.rows.map((r) => <li key={r.receipt} className="flex justify-between gap-2 py-1.5"><span className="font-mono text-xs">{r.receipt}</span><span className="text-xs text-muted">{r.ref} · {METHOD_LABEL[r.method] || r.method}</span><span className={cx('font-medium', r.kind === 'refund' && 'text-red-700')}>{r.kind === 'refund' ? '−' : ''}{money(r.amount)}</span></li>)}</ul>
                </details>
              )}
            </Card>
            <Card className="space-y-3 p-5 lg:col-span-2">
              <Input label="Opening float (cash you started with)" type="number" min="0" step="1" value={float} onChange={(e) => setFloat(e.target.value)} />
              <p className="label">Count notes & coins</p>
              <div className="grid grid-cols-5 gap-2">
                {DENOMS.map((d) => <Input key={d} label={`₹${d}`} type="number" min="0" inputMode="numeric" value={counts[d] ?? ''} onChange={(e) => setCounts((c) => ({ ...c, [d]: e.target.value }))} />)}
              </div>
              {!useDenoms && <Input label="…or total cash counted (₹)" type="number" min="0" step="0.01" value={manual} onChange={(e) => setManual(e.target.value)} />}
              <div className="rounded-lg bg-ivory p-3 text-sm">
                <p className="flex justify-between"><span>Expected in drawer</span><strong>{money(expected)}</strong></p>
                <p className="flex justify-between"><span>Counted</span><strong>{money(counted)}</strong></p>
                <p className={cx('flex justify-between', diff === 0 ? 'text-forest-700' : 'text-red-700')}><span>{diff === 0 ? 'Matches' : diff > 0 ? 'Excess' : 'Short'}</span><strong>{money(Math.abs(diff))}</strong></p>
              </div>
              <Textarea label={diff !== 0 ? 'Explain the difference (required)' : 'Notes'} value={notes} onChange={(e) => setNotes(e.target.value)} />
              {err && <Alert tone="error">{err}</Alert>}
              <Button onClick={close} loading={busy} disabled={diff !== 0 && notes.trim().length < 3}><LuLock aria-hidden /> Close my cash</Button>
            </Card>
          </div>
        )
      )}
      <Card>
        <h2 className="border-b border-line px-5 py-4 font-display text-lg font-semibold">{can('cash.read') ? 'All closings' : 'My closings'}</h2>
        <DataTable loading={hLoading} rows={hist} empty={<EmptyState title="No closings yet" />}
          columns={[
            { key: 'number', label: 'Closing', render: (c) => <Link className="font-mono text-xs font-semibold text-forest-800 hover:underline" to={`/app/cash-closing/${c.id}`}>{c.number}</Link> },
            { key: 'userName', label: 'User' },
            { key: 'period', label: 'Period', render: (c) => <span className="text-xs">{dateTime(c.periodStart)} → {dateTime(c.periodEnd)}</span> },
            { key: 'expectedCash', label: 'Expected', className: 'text-right', render: (c) => money(Number(c.expectedCash)) },
            { key: 'countedCash', label: 'Counted', className: 'text-right', render: (c) => money(c.countedCash) },
            { key: 'difference', label: 'Difference', className: 'text-right', render: (c) => <span className={Number(c.difference) === 0 ? 'text-forest-700' : 'font-semibold text-red-700'}>{Number(c.difference) > 0 ? '+' : ''}{money(c.difference)}</span> },
          ]} />
        <Pagination meta={meta} onPage={setPage} />
      </Card>
    </>
  );
}

export function CashClosingSlip() {
  const { id } = useParams();
  const { me } = useTenantAuth();
  const { data: c, loading, error } = useApi(() => api.get(`/billing/cash/closings/${id}`), [id]);
  if (error) return <Alert tone="error">{error.status === 404 ? 'Closing not found.' : error.message}</Alert>;
  if (loading || !c) return <Skeleton className="h-64 w-full" />;
  return (
    <>
      <div className="print:hidden">
        <Link to="/app/cash-closing" className="mb-4 flex items-center gap-1 text-sm font-medium text-forest-700"><LuArrowLeft aria-hidden /> Cash closing</Link>
        <PageHeader title={`Cash closing ${c.number}`} actions={<Button onClick={() => window.print()}><LuPrinter aria-hidden /> Print</Button>} />
      </div>
      <Card className="mx-auto max-w-xl p-6 text-sm print:shadow-none print:ring-0">
        <p className="font-display text-xl font-semibold">{me.tenant.name}</p>
        <p className="text-muted">Cash closing {c.number} · {c.userName}</p>
        <p className="text-muted">{dateTime(c.periodStart, me.tenant.timezone)} → {dateTime(c.periodEnd, me.tenant.timezone)}</p>
        <div className="my-4 grid grid-cols-2 gap-3">
          <StatCard label="Expected cash" value={money(c.expectedCash)} hint={`incl. opening float ${money(c.openingFloat)}`} />
          <StatCard label="Counted" value={money(c.countedCash)} hint={Number(c.difference) === 0 ? 'Matches' : `${Number(c.difference) > 0 ? 'Excess' : 'Short'} ${money(Math.abs(Number(c.difference)))}`} />
        </div>
        {c.totals && <table className="table-base"><thead><tr><th>Method</th><th className="text-right">In</th><th className="text-right">Out</th><th className="text-right">Net</th></tr></thead>
          <tbody className="divide-y divide-line">{Object.entries(c.totals).filter(([, v]) => Number(v.in) || Number(v.out)).map(([m, v]) => <tr key={m}><td>{METHOD_LABEL[m] || m}</td><td className="text-right">{money(v.in)}</td><td className="text-right">{money(v.out)}</td><td className="text-right font-medium">{money(v.net)}</td></tr>)}</tbody></table>}
        {c.denominations && <p className="mt-3 text-xs">Notes & coins: {Object.entries(c.denominations).map(([d, n]) => `₹${d} × ${n}`).join(', ')}</p>}
        {c.notes && <p className="mt-3"><strong>Notes:</strong> {c.notes}</p>}
        <p className="mt-3 text-xs text-muted">{c.rows.length} transaction(s). Closed {dateTime(c.closedAt, me.tenant.timezone)}.</p>
        <div className="mt-10 flex justify-between text-xs"><span>Cashier signature</span><span>Checked by</span></div>
      </Card>
    </>
  );
}
