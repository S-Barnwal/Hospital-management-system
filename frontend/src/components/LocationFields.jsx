// Country → State → City, each a searchable dropdown filled from the server's world list (/api/v1/geo).
// Works with useForm: <LocationFields form={f} /> reads/writes f.values.country / state / city and shows f.errors.
// A city that is not in the list (small town, village) can still be typed and kept.
import { useEffect, useMemo, useState } from 'react';
import Combobox from './Combobox.jsx';
import { api } from '../lib/api.js';
import { DEFAULT_COUNTRY, flagNode } from '../lib/contact.js';

// Lists are cached for the whole browser session — they never change while the app is open.
const cache = new Map();
function cached(path) {
  if (!cache.has(path)) cache.set(path, api.get(path).then((r) => r.data).catch((e) => { cache.delete(path); throw e; }));
  return cache.get(path);
}

function useList(path) {
  const [state, setState] = useState({ data: [], loading: Boolean(path), error: null });
  useEffect(() => {
    if (!path) { setState({ data: [], loading: false, error: null }); return undefined; }
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    cached(path).then((data) => live && setState({ data, loading: false, error: null }))
      .catch((error) => live && setState({ data: [], loading: false, error }));
    return () => { live = false; };
  }, [path]);
  return state;
}

export default function LocationFields({ form, required = false, defaultCountry = DEFAULT_COUNTRY, className = 'contents', disabled, showCountry = true }) {
  const { values, setValues, errors = {}, setErrors } = form;
  const country = values.country || '';
  const set = (patch) => {
    setValues((v) => ({ ...v, ...patch }));
    if (setErrors) setErrors((e) => ({ ...e, ...Object.fromEntries(Object.keys(patch).map((k) => [k, undefined])) }));
  };

  // New forms start in the hospital's own country.
  useEffect(() => { if (!values.country && defaultCountry) setValues((v) => (v.country ? v : { ...v, country: defaultCountry })); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [defaultCountry]);

  const countries = useList(showCountry ? '/geo/countries' : null);
  const states = useList(country ? `/geo/states?country=${encodeURIComponent(country)}` : null);
  const stateCode = useMemo(() => states.data.find((s) => s.name === values.state)?.code ?? '', [states.data, values.state]);
  const cities = useList(country && stateCode ? `/geo/cities?country=${encodeURIComponent(country)}&state=${encodeURIComponent(stateCode)}` : null);

  const countryOptions = useMemo(() => countries.data.map((c) => ({ value: c.code, label: c.name, prefix: flagNode(c.code), keywords: c.code })), [countries.data]);
  const stateOptions = useMemo(() => states.data.map((s) => ({ value: s.name, label: s.name, keywords: s.code })), [states.data]);
  const cityOptions = useMemo(() => cities.data.map((c) => ({ value: c, label: c })), [cities.data]);
  const noStates = country && !states.loading && !states.error && states.data.length === 0;

  return (
    <div className={className}>
      {showCountry && (
        <Combobox label="Country" required={required} value={country} options={countryOptions} loading={countries.loading} disabled={disabled}
          placeholder="Search country…" error={errors.country || (countries.error ? 'Could not load countries. Check your connection.' : undefined)}
          onChange={(c) => { if (c !== country) set({ country: c, state: '', city: '' }); }} />
      )}
      <Combobox label="State" required={required && !noStates} value={values.state || ''} options={stateOptions} loading={states.loading}
        disabled={disabled || !country} allowCustom={noStates}
        placeholder={country ? 'Search state…' : 'Choose a country first'} emptyText={noStates ? 'No states listed — type the region' : 'No matching state'}
        error={errors.state} onChange={(s) => { if (s !== values.state) set({ state: s, city: '' }); }} />
      <Combobox label="City" required={required} value={values.city || ''} options={cityOptions} loading={cities.loading}
        disabled={disabled || (!values.state && !noStates)} allowCustom customLabel={(q) => `Use “${q}” (not in list)`}
        placeholder={values.state || noStates ? 'Search or type city…' : 'Choose a state first'}
        hint={values.state && !cities.loading && cityOptions.length === 0 ? 'Type your city or town.' : undefined}
        error={errors.city} onChange={(c) => set({ city: c })} />
    </div>
  );
}
