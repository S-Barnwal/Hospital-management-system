// Shared pickers used across modules. All searches go through tenant-scoped APIs.
import { useState } from 'react';
import { LuSearch } from 'react-icons/lu';
import { api, qs } from '../lib/api.js';
import { useApi, useDebounced } from '../lib/hooks.js';
import { fullName } from '../lib/format.js';
import { Input, Select } from './ui.jsx';
import { formatPhone } from '../lib/contact.js';

/** Search-as-you-type patient selector. value = { id, label } | null */
export function PatientPicker({ value, onChange, error, label = 'Patient', required = true }) {
  const [q, setQ] = useState('');
  const search = useDebounced(q);
  const { data } = useApi(() => (search.length >= 2 ? api.get(`/patients${qs({ q: search, pageSize: 8 })}`) : Promise.resolve({ data: [] })), [search]);
  if (value) {
    return (
      <div>
        <p className="label">{label}</p>
        <div className="flex items-center justify-between gap-2 rounded-lg border border-forest-200 bg-forest-50 px-3 py-2 text-sm">
          <span className="min-w-0 truncate font-semibold">{value.label}</span>
          <button type="button" className="shrink-0 text-forest-700 underline" onClick={() => onChange(null)}>Change</button>
        </div>
      </div>
    );
  }
  return (
    <div className="relative">
      <Input label={label} required={required} placeholder="Type name, phone or patient no." value={q} onChange={(e) => setQ(e.target.value)} error={error} autoComplete="off" />
      <LuSearch className="pointer-events-none absolute right-3 top-[38px] text-muted" aria-hidden />
      {data?.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-line bg-white shadow-[var(--shadow-lift)]">
          {data.map((p) => (
            <li key={p.id}>
              <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-forest-50"
                onClick={() => { onChange({ id: p.id, label: `${p.patientNumber} — ${fullName(p.firstName, p.lastName)}` }); setQ(''); }}>
                <span className="font-mono text-xs text-forest-700">{p.patientNumber}</span> {fullName(p.firstName, p.lastName)} <span className="text-muted">{formatPhone(p.phone)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {search.length >= 2 && data?.length === 0 && <p className="mt-1 text-xs text-muted">No matching patient. Register them under Patients first.</p>}
    </div>
  );
}

/** Doctor dropdown (active doctors of this hospital). */
export function DoctorSelect({ value, onChange, label = 'Doctor', required, placeholder = 'Select doctor' }) {
  const { data, loading } = useApi(() => api.get('/hr/staff?type=doctor&pageSize=100'), []);
  return (
    <Select label={label} required={required} placeholder={loading ? 'Loading…' : placeholder} value={value ?? ''} onChange={(e) => onChange(e.target.value)}
      options={(data || []).filter((d) => d.isActive).map((d) => ({ value: String(d.id), label: `${d.fullName}${d.specialization ? ` — ${d.specialization}` : ''}` }))} />
  );
}

/** Any active staff member (optionally of one type), e.g. the lab technician who collects a home sample. */
export function StaffSelect({ value, onChange, label = 'Staff member', type, required, placeholder = 'Select…' }) {
  const { data, loading } = useApi(() => api.get(`/hr/staff?pageSize=100${type ? `&type=${type}` : ''}`), [type]);
  return (
    <Select label={label} required={required} placeholder={loading ? 'Loading…' : placeholder} value={value ?? ''} onChange={(e) => onChange(e.target.value)}
      options={(data || []).filter((d) => d.isActive).map((d) => ({ value: String(d.id), label: `${d.fullName}${d.designation ? ` — ${d.designation}` : d.staffType ? ` — ${d.staffType.replace('_', ' ')}` : ''}` }))} />
  );
}
