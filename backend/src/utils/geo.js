// Countries, states and cities of the world (package "country-state-city", data bundled — no outside calls).
// The data set is large, so it is loaded once, on server start (server.js) or on the first /geo request,
// and then served from memory. Until it is loaded, validation of states is skipped (never blocks a request).
let data = null;
let loading = null;

export async function loadGeo() {
  if (data) return data;
  loading ??= import('country-state-city').then((m) => {
    const lib = m.Country ? m : m.default;
    data = { Country: lib.Country, State: lib.State, City: lib.City };
    return data;
  });
  return loading;
}

/** The loaded library, or null if not loaded yet. */
export const geoData = () => data;

/** 'IN' → '🇮🇳' (regional indicator letters; no image files needed). */
export const flagOf = (iso2) => String(iso2 || '').toUpperCase().replace(/[A-Z]/g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));

/** Best default time zone for a new hospital in this country (its first listed zone); India if unknown. */
export function timezoneFor(iso2) {
  const zone = data?.Country.getCountryByCode(String(iso2 || '').toUpperCase())?.timezones?.[0]?.zoneName;
  try { if (zone) { new Intl.DateTimeFormat('en', { timeZone: zone }); return zone; } } catch { /* unknown to this Node build */ }
  return 'Asia/Kolkata';
}
