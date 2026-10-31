// Hospital Settings → "Location on map": place a pin (click, drag, use this device's location, or find from the address),
// add the PIN/postal code and save. The Super Admin sees these pins on the Hospital map.
import { useEffect, useState } from 'react';
import { LuCrosshair, LuSearch, LuMapPin, LuX } from 'react-icons/lu';
import { api } from '../lib/api.js';
import { notify } from '../lib/toast.js';
import { countryName } from '../lib/contact.js';
import { Alert, Button, Card, Input } from './ui.jsx';
import MapView from './MapView.jsx';

const round6 = (n) => Math.round(n * 1e6) / 1e6;

export default function HospitalLocation({ data, readOnly, onSaved }) {
  const [pin, setPin] = useState(null);
  const [postal, setPostal] = useState('');
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!data) return;
    setPin(data.Latitude != null && data.Longitude != null ? { lat: Number(data.Latitude), lng: Number(data.Longitude) } : null);
    setPostal(data.PostalCode || '');
    setDirty(false);
  }, [data]);
  // Arrived from the dashboard's "Add location" link → scroll here.
  useEffect(() => { if (data && window.location.hash === '#location') document.getElementById('location')?.scrollIntoView({ behavior: 'smooth' }); }, [data]);

  const place = (p) => { if (readOnly) return; setPin({ lat: round6(p.lat), lng: round6(p.lng) }); setDirty(true); setErr(null); };

  const useDevice = () => {
    if (!navigator.geolocation) { setErr('This browser cannot share its location.'); return; }
    setBusy('gps');
    navigator.geolocation.getCurrentPosition(
      (pos) => { place({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setBusy(null); notify.info('Pin placed at this device’s location — drag it if it is not exactly on the building.'); },
      (e) => { setBusy(null); setErr(e.code === 1 ? 'Location permission was denied. Allow it in the browser, or place the pin by clicking on the map.' : 'Could not get this device’s location. Place the pin on the map instead.'); },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const findAddress = async () => {
    const q = [data?.settings?.['hospital.address'], data?.City, data?.State, postal, data?.Country && countryName(data.Country)].filter(Boolean).join(', ');
    if (!q) { setErr('Add the address, city and state in the settings above first.'); return; }
    setBusy('find'); setErr(null);
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' } });
      const [hit] = r.ok ? await r.json() : [];
      if (!hit) setErr('Address not found on the map. Click on the map to place the pin yourself.');
      else { place({ lat: Number(hit.lat), lng: Number(hit.lon) }); notify.info('Pin placed from the address — check it and drag it onto the building.'); }
    } catch { setErr('Map search is not reachable right now. Click on the map to place the pin.'); } finally { setBusy(null); }
  };

  const save = async () => {
    setBusy('save'); setErr(null);
    try {
      await api.put('/settings/location', { latitude: pin?.lat ?? null, longitude: pin?.lng ?? null, postalCode: postal.trim() });
      notify.success('Location saved.');
      setDirty(false);
      onSaved?.();
    } catch (e) { setErr(e.details?.[0]?.message || e.message); } finally { setBusy(null); }
  };

  return (
    <Card className="mt-6 max-w-3xl p-6" id="location">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-forest-950"><LuMapPin aria-hidden /> Location on map</h2>
          <p className="text-sm text-muted">Click on the map (or drag the pin) to mark your building. Used for directions and shown to the platform team.</p>
        </div>
        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={useDevice} loading={busy === 'gps'}><LuCrosshair aria-hidden /> Use my current location</Button>
            <Button size="sm" variant="outline" onClick={findAddress} loading={busy === 'find'}><LuSearch aria-hidden /> Find from address</Button>
          </div>
        )}
      </div>
      <MapView pin={pin} onPick={place} editable={!readOnly} height={340} />
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Input label={data?.Country === 'IN' ? 'PIN code' : 'Postal code'} inputMode={data?.Country === 'IN' ? 'numeric' : 'text'} maxLength={12} disabled={readOnly}
          value={postal} onChange={(e) => { setPostal(e.target.value.toUpperCase()); setDirty(true); }} />
        <div className="sm:col-span-2">
          <p className="label">Coordinates</p>
          <p className="flex h-10 items-center gap-2 font-mono text-sm">
            {pin ? <>{pin.lat.toFixed(6)}, {pin.lng.toFixed(6)}
              <a className="ml-2 font-sans text-xs font-semibold text-forest-700 underline" target="_blank" rel="noopener noreferrer"
                href={`https://www.openstreetmap.org/?mlat=${pin.lat}&mlon=${pin.lng}#map=17/${pin.lat}/${pin.lng}`}>Open map</a>
              {!readOnly && <button type="button" className="ml-2 inline-flex items-center gap-1 font-sans text-xs text-red-600" onClick={() => { setPin(null); setDirty(true); }}><LuX aria-hidden /> Remove pin</button>}
            </> : <span className="font-sans text-muted">No pin yet</span>}
          </p>
        </div>
      </div>
      {err && <Alert tone="error" className="mt-3">{err}</Alert>}
      {!readOnly && <div className="mt-4 flex items-center gap-3"><Button onClick={save} loading={busy === 'save'} disabled={!dirty}>Save location</Button>{dirty && <span className="text-xs text-gold-700">Unsaved changes</span>}</div>}
    </Card>
  );
}
