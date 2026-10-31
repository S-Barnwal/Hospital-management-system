// Super Admin → Hospital map: where every hospital on the platform is. Business details only — no patient data.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { LuMapPin, LuMapPinOff } from 'react-icons/lu';
import { api } from '../../lib/api.js';
import { useApi } from '../../lib/hooks.js';
import { titleCase } from '../../lib/format.js';
import { countryName } from '../../lib/contact.js';
import { Alert, Card, PageHeader, StatCard, StatusBadge, cx } from '../../components/ui.jsx';
import MapView, { esc } from '../../components/MapView.jsx';

const place = (h) => [h.City, h.State, h.Country && countryName(h.Country)].filter(Boolean).join(', ');

export default function HospitalMap() {
  const { data, loading, error } = useApi(() => api.get('/admin/hospital-locations'), []);
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState(null);
  const all = data || [];
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? all.filter((h) => `${h.Name} ${h.Slug} ${place(h)} ${h.PostalCode || ''}`.toLowerCase().includes(s)) : all;
  }, [all, q]);
  const pinned = shown.filter((h) => h.Latitude != null);
  const markers = useMemo(() => (focus ? pinned.filter((h) => h.TenantId === focus) : pinned).map((h) => ({
    id: h.TenantId, lat: h.Latitude, lng: h.Longitude, title: h.Name, tone: h.Status === 'active' ? '#0f3d2e' : '#b91c1c',
    html: `<strong>${esc(h.Name)}</strong><br>${esc(h.Address || '')}${h.Address ? '<br>' : ''}${esc(place(h))} ${esc(h.PostalCode || '')}<br>`
      + `<span style="color:#64748b">${esc(h.PlanName || '')} · ${esc(titleCase(h.Status))}</span><br>`
      + `<a href="/admin/tenants/${Number(h.TenantId)}">Open hospital →</a>`,
  })), [pinned, focus]);
  const byState = useMemo(() => {
    const m = new Map();
    all.forEach((h) => { const k = h.State || 'Not set'; m.set(k, (m.get(k) || 0) + 1); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [all]);

  return (
    <>
      <PageHeader title="Hospital map" subtitle="Where each hospital on the platform is. Hospitals set their own pin in Settings → Location on map." />
      {error && <Alert tone="error">{error.message}</Alert>}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Hospitals" value={all.length} loading={loading} />
        <StatCard label="Pinned on map" value={all.filter((h) => h.Latitude != null).length} loading={loading} />
        <StatCard label="Top states" value={byState.map(([s, n]) => `${s} (${n})`).slice(0, 2).join(', ') || '—'} loading={loading} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <MapView markers={markers} height={560} />
          {focus && <button type="button" className="mt-2 text-sm font-semibold text-forest-700 underline" onClick={() => setFocus(null)}>Show all hospitals</button>}
        </div>
        <Card className="flex max-h-[600px] flex-col">
          <div className="border-b border-line p-3">
            <input className="input" placeholder="Search hospital, city, state, PIN" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search hospitals" />
          </div>
          <ul className="flex-1 divide-y divide-line overflow-auto">
            {shown.map((h) => (
              <li key={h.TenantId}>
                <button type="button" disabled={h.Latitude == null} onClick={() => setFocus(h.TenantId)}
                  className={cx('flex w-full items-start gap-3 px-4 py-3 text-left text-sm hover:bg-forest-50 disabled:cursor-default disabled:hover:bg-transparent', focus === h.TenantId && 'bg-forest-50')}>
                  {h.Latitude != null ? <LuMapPin className="mt-0.5 shrink-0 text-forest-700" aria-label="Pinned" /> : <LuMapPinOff className="mt-0.5 shrink-0 text-slate-400" aria-label="No pin" />}
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-ink">{h.Name}</span>
                    <span className="block text-xs text-muted">{place(h) || 'Location not set'}{h.PostalCode ? ` · ${h.PostalCode}` : ''}</span>
                  </span>
                  <StatusBadge status={h.Status} />
                </button>
                <Link to={`/admin/tenants/${h.TenantId}`} className="block px-4 pb-2 pl-11 text-xs font-semibold text-forest-700 hover:underline">Open</Link>
              </li>
            ))}
            {!loading && shown.length === 0 && <li className="p-4 text-sm text-muted">No hospitals match.</li>}
          </ul>
        </Card>
      </div>
    </>
  );
}
