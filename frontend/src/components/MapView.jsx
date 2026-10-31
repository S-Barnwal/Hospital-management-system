// Small Leaflet wrapper (OpenStreetMap tiles, no API key). Pins are drawn with CSS — no image files.
//  • <MapView markers={[{ id, lat, lng, title, html }]} />                — read-only map (Super Admin hospital map)
//  • <MapView pin={{ lat, lng }} onPick={({ lat, lng }) => …} editable />   — click or drag to place one pin (hospital settings)
// Tile server can be changed with VITE_MAP_TILE_URL (OpenStreetMap's own servers are for light use only).
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const TILE_URL = import.meta.env?.VITE_MAP_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';
const INDIA = [22.5, 79];

const pinIcon = (tone = '#0f3d2e') => L.divIcon({
  className: '',
  html: `<svg width="28" height="38" viewBox="0 0 28 38" aria-hidden="true"><path d="M14 0C6.3 0 0 6.2 0 13.9 0 24.3 14 38 14 38s14-13.7 14-24.1C28 6.2 21.7 0 14 0z" fill="${tone}"/><circle cx="14" cy="14" r="5.5" fill="#d4a017"/></svg>`,
  iconSize: [28, 38], iconAnchor: [14, 38], popupAnchor: [0, -34],
});

export default function MapView({ markers = [], pin, onPick, editable = false, height = 360, className = '', zoom }) {
  const el = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const pinRef = useRef(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useEffect(() => {
    map.current = L.map(el.current, { scrollWheelZoom: false, worldCopyJump: true }).setView(INDIA, 4);
    L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    if (editable) {
      map.current.on('click', (e) => pickRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }));
    }
    map.current.on('focus', () => map.current.scrollWheelZoom.enable());
    map.current.on('blur', () => map.current.scrollWheelZoom.disable());
    return () => { map.current?.remove(); map.current = null; };
  }, [editable]);

  // Many markers (read-only).
  useEffect(() => {
    if (!map.current || !layer.current) return;
    layer.current.clearLayers();
    const pts = markers.filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng));
    pts.forEach((m) => {
      const mk = L.marker([m.lat, m.lng], { icon: pinIcon(m.tone), title: m.title, keyboard: true }).addTo(layer.current);
      if (m.html) mk.bindPopup(m.html); // caller passes escaped HTML only
      if (m.onClick) mk.on('click', m.onClick);
    });
    if (pts.length === 1) map.current.setView([pts[0].lat, pts[0].lng], zoom ?? 13);
    else if (pts.length > 1) map.current.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng])), { padding: [40, 40], maxZoom: 12 });
  }, [markers, zoom]);

  // One editable pin.
  useEffect(() => {
    if (!map.current || markers.length) return;
    if (pin && Number.isFinite(pin.lat) && Number.isFinite(pin.lng)) {
      if (!pinRef.current) {
        pinRef.current = L.marker([pin.lat, pin.lng], { icon: pinIcon(), draggable: editable, keyboard: true, title: 'Hospital location' }).addTo(map.current);
        pinRef.current.on('dragend', (e) => { const p = e.target.getLatLng(); pickRef.current?.({ lat: p.lat, lng: p.lng }); });
        map.current.setView([pin.lat, pin.lng], zoom ?? 15);
      } else {
        pinRef.current.setLatLng([pin.lat, pin.lng]);
        if (!map.current.getBounds().contains([pin.lat, pin.lng])) map.current.panTo([pin.lat, pin.lng]);
      }
    } else if (pinRef.current) {
      pinRef.current.remove();
      pinRef.current = null;
    }
  }, [pin?.lat, pin?.lng, editable, markers.length, zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} className={`relative z-0 overflow-hidden rounded-xl ring-1 ring-line ${className}`} style={{ height }} role="application" aria-label="Map" tabIndex={0} />;
}

/** Escapes text for marker pop-ups. */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
