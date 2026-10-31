// Phone number with a searchable country-code picker (every country, flag + dialling code).
// The value it gives the form is the international number, e.g. "+919876543210"; the server checks it again.
// Works with useForm: <PhoneInput label="Phone" {...f.bind('phone')} error={f.errors.phone} />
import { useEffect, useId, useState } from 'react';
import Combobox from './Combobox.jsx';
import { cx } from './ui.jsx';
import { PHONE_COUNTRIES, DEFAULT_COUNTRY, splitPhone, joinPhone, isValidPhone, countryName } from '../lib/contact.js';

export default function PhoneInput({
  label, value, onChange, name, error, hint, required, className, defaultCountry = DEFAULT_COUNTRY, disabled, placeholder,
}) {
  const id = useId();
  const [country, setCountry] = useState(() => splitPhone(value, defaultCountry).country);
  const [national, setNational] = useState(() => splitPhone(value, defaultCountry).national);
  const [touched, setTouched] = useState(false);

  // Follow outside changes (form reset, record loaded for editing).
  useEffect(() => {
    if ((value || '') === joinPhone(country, national)) return;
    const s = splitPhone(value, defaultCountry);
    setCountry(s.country);
    setNational(s.national);
    setTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const emit = (c, n) => onChange?.({ target: { name, value: joinPhone(c, n), type: 'tel' } });
  const current = joinPhone(country, national);
  const localError = touched && national && !isValidPhone(current, country)
    ? `Not a valid ${countryName(country)} number. Check the digits and the country code.` : null;
  const shownError = error || localError;

  return (
    <div className={className}>
      {label && <label htmlFor={id} className="label">{label}{required && <span className="text-gold-700"> *</span>}</label>}
      <div className="flex gap-2">
        <div className="w-32 shrink-0">
          <Combobox compact ariaLabel="Country code" value={country} options={PHONE_COUNTRIES} disabled={disabled}
            selectedText={(o) => o.hint} placeholder="Code"
            onChange={(c) => { setCountry(c); emit(c, national); }} />
        </div>
        <input id={id} name={name} type="tel" inputMode="tel" autoComplete="tel-national" disabled={disabled} required={required}
          className={cx('input min-w-0 flex-1', shownError && 'border-red-400')}
          placeholder={placeholder ?? (country === 'IN' ? '98765 43210' : 'Phone number')}
          value={national}
          aria-invalid={shownError ? 'true' : undefined}
          aria-describedby={shownError || hint ? `${id}-d` : undefined}
          onChange={(e) => {
            let text = e.target.value;
            // Pasted a full international number? Take the country from it.
            if (text.trim().startsWith('+')) {
              const s = splitPhone(text, country);
              if (s.e164) { setCountry(s.country); setNational(s.national); emit(s.country, s.national); return; }
            }
            text = text.replace(/[^\d\s()-]/g, '').slice(0, 20);
            setNational(text); emit(country, text);
          }}
          onBlur={() => {
            setTouched(true);
            const s = splitPhone(current, country);
            if (s.valid) setNational(s.national); // tidy spacing, e.g. 98765 43210
          }} />
      </div>
      {(shownError || hint) && <p id={`${id}-d`} className={cx('mt-1 text-xs', shownError ? 'text-red-600' : 'text-muted')}>{shownError || hint}</p>}
    </div>
  );
}
