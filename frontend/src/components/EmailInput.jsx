// E-mail field that checks the address as soon as the user leaves the box (the server checks it again).
import { useState } from 'react';
import { Input } from './ui.jsx';
import { isValidEmail } from '../lib/contact.js';

export default function EmailInput({ error, onBlur, onChange, value, ...props }) {
  const [touched, setTouched] = useState(false);
  const bad = touched && value && !isValidEmail(value);
  return (
    <Input type="email" inputMode="email" autoComplete="email" spellCheck={false} {...props} value={value}
      onChange={(e) => { setTouched(false); onChange?.(e); }}
      onBlur={(e) => { setTouched(true); onBlur?.(e); }}
      error={error || (bad ? 'Enter a valid e-mail address, e.g. name@hospital.com.' : undefined)} />
  );
}
