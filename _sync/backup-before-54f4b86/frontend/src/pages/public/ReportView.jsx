// Patient-facing page for a shared lab report: request a one-time code, enter it, then view / save as PDF.
// Nothing is stored in the browser; refreshing the page asks for a new code.
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { LuShieldCheck, LuPrinter, LuLock } from 'react-icons/lu';
import { api } from '../../lib/api.js';
import { useApi } from '../../lib/hooks.js';
import { age, dateTime, fullName, titleCase } from '../../lib/format.js';
import { Alert, Badge, Button, Card, Input, Skeleton, cx } from '../../components/ui.jsx';
import { LogoMark } from '../../components/Logo.jsx';

const FLAG_TONE = { normal: 'green', low: 'blue', high: 'red', abnormal: 'red' };

function Report({ r }) {
  const tz = r.hospital.timezone;
  const p = r.patient;
  const groups = r.items.reduce((acc, i) => { const k = i.packageName || i.department || 'Tests'; (acc[k] ||= []).push(i); return acc; }, {});
  return (
    <div className="mx-auto max-w-3xl bg-white p-6 text-sm print:p-0">
      <div className="mb-3 flex justify-end print:hidden"><Button onClick={() => window.print()}><LuPrinter aria-hidden /> Save as PDF / Print</Button></div>
      <p className="font-display text-2xl font-semibold">{r.hospital.name}</p>
      <p className="text-muted">{[r.hospital.address, r.hospital.phone].filter(Boolean).join(' · ')}</p>
      <p className="mt-4 text-center text-xs font-bold uppercase tracking-widest">Laboratory report</p>
      <table className="mt-3 w-full"><tbody>
        <tr><td className="py-0.5 pr-2 font-semibold">Patient</td><td>{fullName(p.firstName, p.lastName)} ({p.patientNumber})</td><td className="pr-2 font-semibold">Order</td><td>{r.order.number}</td></tr>
        <tr><td className="py-0.5 pr-2 font-semibold">Age / Sex</td><td>{[p.dateOfBirth && `${age(p.dateOfBirth)} yrs`, p.gender && titleCase(p.gender)].filter(Boolean).join(' / ') || '—'}</td><td className="pr-2 font-semibold">Reported</td><td>{dateTime(r.order.verifiedAt, tz)}</td></tr>
        <tr><td className="py-0.5 pr-2 font-semibold">Referred by</td><td>{r.order.referredBy || 'Self'}</td><td className="pr-2 font-semibold">Ordered</td><td>{dateTime(r.order.orderedAt, tz)}</td></tr>
      </tbody></table>
      <table className="table-base mt-4">
        <thead><tr><th>Test</th><th>Result</th><th>Unit</th><th>Reference range</th><th>Flag</th></tr></thead>
        {Object.entries(groups).map(([g, items]) => (
          <tbody key={g} className="divide-y divide-line">
            <tr><td colSpan={5} className="bg-ivory text-xs font-bold uppercase tracking-wider">{g}</td></tr>
            {items.map((i) => (
              <tr key={i.id}>
                <td className="font-medium">{i.testName}</td>
                <td className={cx('font-semibold', ['high', 'low', 'abnormal'].includes(i.flag) && 'text-red-700')}>{i.resultValue ?? '—'}</td>
                <td>{i.unit ?? ''}</td>
                <td className="text-xs">{i.refLow != null || i.refHigh != null ? `${i.refLow ?? ''} – ${i.refHigh ?? ''}` : i.refText ?? '—'}</td>
                <td>{i.flag ? <Badge tone={FLAG_TONE[i.flag]}>{i.flag}</Badge> : '—'}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
      <div className="mt-10 flex justify-end"><div className="text-center"><p className="font-semibold">{r.order.verifiedBy}</p><p className="border-t border-ink pt-1">Verified by (Pathologist)</p></div></div>
      <p className="mt-6 text-center text-xs text-muted">— End of report — · Please consult your doctor to interpret these results.</p>
    </div>
  );
}

export default function ReportView() {
  const { token } = useParams();
  const { data: info, loading, error } = useApi(() => api.get(`/public/reports/${encodeURIComponent(token)}`), [token]);
  const [sent, setSent] = useState(null);
  const [code, setCode] = useState('');
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const run = async (fn) => { setBusy(true); setMsg(null); try { await fn(); } catch (e) { setMsg(e.message); } finally { setBusy(false); } };
  const sendCode = () => run(async () => { const r = await api.post(`/public/reports/${encodeURIComponent(token)}/otp`); setSent(r.data); });
  const view = (e) => { e.preventDefault(); run(async () => { const r = await api.post(`/public/reports/${encodeURIComponent(token)}/view`, { code }); setReport(r.data); }); };

  if (report) return <Report r={report} />;
  return (
    <div className="grid min-h-screen place-items-center bg-[#f6f7f3] px-4 py-10">
      <Card className="w-full max-w-md p-6 sm:p-8">
        <LogoMark className="mx-auto h-10 w-10" />
        {loading ? <Skeleton className="mt-6 h-24 w-full" /> : error ? (
          <Alert tone="error" className="mt-6">{error.message}</Alert>
        ) : (
          <>
            <h1 className="mt-4 text-center font-display text-2xl font-semibold">Your lab report</h1>
            <p className="mt-1 text-center text-sm text-muted">from <strong>{info.hospital}</strong></p>
            <p className="mt-5 flex items-start gap-2 rounded-lg bg-forest-50 p-3 text-sm text-forest-900"><LuLock className="mt-0.5 shrink-0" aria-hidden />
              <span>For your privacy we will send a one-time code to your {info.channel === 'email' ? 'e-mail' : 'WhatsApp'} <strong>{info.sentTo}</strong>.</span></p>
            {!sent ? (
              <Button className="mt-5 w-full" size="lg" loading={busy} onClick={sendCode}>Send me the code</Button>
            ) : (
              <form onSubmit={view} className="mt-5 space-y-3" noValidate>
                <Input label={`Enter the 6-digit code sent to ${sent.sentTo}`} inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus
                  value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
                <Button type="submit" className="w-full" size="lg" loading={busy} disabled={code.length !== 6}>Open report</Button>
                <button type="button" className="w-full text-sm text-forest-700 hover:underline" disabled={busy} onClick={sendCode}>Send a new code</button>
              </form>
            )}
            {msg && <Alert tone="error" className="mt-4">{msg}</Alert>}
            <p className="mt-6 flex items-center justify-center gap-1 text-xs text-muted"><LuShieldCheck aria-hidden /> Secure link · do not forward it to others</p>
          </>
        )}
      </Card>
    </div>
  );
}
