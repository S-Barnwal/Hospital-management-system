// Patient-facing bill payment page: shows the amount due and lets the patient pay by UPI (QR or "Pay with UPI app").
// Money goes straight to the hospital's UPI ID; the hospital records the receipt when it arrives.
import { useParams } from 'react-router-dom';
import { LuShieldCheck, LuSmartphone, LuCircleCheck } from 'react-icons/lu';
import { api } from '../../lib/api.js';
import { useApi } from '../../lib/hooks.js';
import { date, money } from '../../lib/format.js';
import { Alert, Button, Card, Skeleton } from '../../components/ui.jsx';
import QrCode from '../../components/QrCode.jsx';
import { LogoMark } from '../../components/Logo.jsx';

export default function PayView() {
  const { token } = useParams();
  const { data: p, loading, error } = useApi(() => api.get(`/public/pay/${encodeURIComponent(token)}`), [token]);
  const mobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad/i.test(navigator.userAgent);
  return (
    <div className="min-h-screen bg-ivory px-4 py-10">
      <div className="mx-auto max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2 text-sm text-muted"><LogoMark className="h-6 w-6" /> Secure payment page</div>
        {loading && <Skeleton className="h-80 w-full" />}
        {error && <Alert tone="error">{error.message}</Alert>}
        {p && (
          <Card className="p-6 text-center">
            <p className="font-display text-2xl font-semibold text-forest-950">{p.hospital}</p>
            {p.city && <p className="text-sm text-muted">{p.city}</p>}
            <p className="mt-4 text-sm">Bill <strong>{p.billNumber}</strong>{p.billDate ? ` · ${date(p.billDate)}` : ''} · {p.patientFirstName}</p>
            {p.status === 'paid' ? (
              <div className="mt-6"><LuCircleCheck className="mx-auto h-12 w-12 text-forest-600" aria-hidden /><p className="mt-2 text-lg font-semibold">This bill is fully paid. Thank you!</p></div>
            ) : (
              <>
                <p className="mt-4 text-sm text-muted">Amount due</p>
                <p className="font-display text-4xl font-semibold text-forest-950">{money(p.due)}</p>
                {p.upiUri ? (
                  <>
                    {mobile && <Button href={p.upiUri} size="lg" className="mt-6 w-full"><LuSmartphone aria-hidden /> Pay with UPI app</Button>}
                    <div className="mx-auto mt-6 flex justify-center"><QrCode value={p.upiUri} size={224} label="UPI payment QR code" /></div>
                    <p className="mt-2 text-xs text-muted">Scan with Google Pay, PhonePe, Paytm, BHIM or your bank app.</p>
                    <p className="mt-1 text-xs">Paying to <strong>{p.payee.name}</strong> · <span className="font-mono">{p.payee.upiId}</span></p>
                    <Alert tone="info" className="mt-5 text-left">After paying, keep the UPI reference (UTR) number. The hospital confirms the payment and sends your receipt.</Alert>
                  </>
                ) : <Alert tone="warning" className="mt-5">Online payment is not set up for this hospital. Please pay at the counter.</Alert>}
              </>
            )}
            <p className="mt-6 flex items-center justify-center gap-1 text-xs text-muted"><LuShieldCheck aria-hidden /> Link valid until {date(p.expiresAt)}. No medical details are shown on this page.</p>
          </Card>
        )}
      </div>
    </div>
  );
}
