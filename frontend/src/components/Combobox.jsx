// Searchable dropdown: type to filter a long list (countries, states, thousands of cities), pick with mouse or keyboard.
// Accessible (ARIA combobox/listbox). Renders at most 100 matches at a time so very long lists stay fast.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { LuChevronDown, LuLoaderCircle, LuCheck } from 'react-icons/lu';
import { cx } from './ui.jsx';

const MAX_SHOWN = 100;
const fold = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Best matches first: exact → starts with → word starts with → contains. */
export function rankOptions(options, query) {
  const q = fold(query);
  if (!q) return options;
  const scored = [];
  for (const o of options) {
    const text = fold(`${o.label} ${o.keywords ?? ''}`);
    const label = fold(o.label);
    let score = -1;
    if (label === q) score = 0;
    else if (label.startsWith(q)) score = 1;
    else if (text.split(/[\s(),+-]+/).some((w) => w.startsWith(q))) score = 2;
    else if (text.includes(q)) score = 3;
    if (score >= 0) scored.push([score, o]);
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1].label.localeCompare(b[1].label)).map((x) => x[1]);
}

/**
 * options: [{ value, label, prefix?, hint?, keywords? }]
 * allowCustom: lets the user keep what they typed when it isn't in the list (e.g. a small village).
 */
export default function Combobox({
  label, value, onChange, options = [], placeholder = 'Search…', required, error, hint, className,
  allowCustom = false, customLabel = (q) => `Use “${q}”`, disabled, loading, emptyText = 'No matches', compact = false, ariaLabel,
  selectedText = (o) => o.label, inputClassName,
}) {
  const id = useId();
  const listId = `${id}-list`;
  const wrap = useRef(null);
  const input = useRef(null);
  const listRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const selected = options.find((o) => o.value === value) ?? (value ? { value, label: value } : null);
  const matches = useMemo(() => rankOptions(options, query), [options, query]);
  const shown = matches.slice(0, MAX_SHOWN);
  const q = query.trim();
  const showCustom = allowCustom && q && !matches.some((m) => fold(m.label) === fold(q));
  const items = showCustom ? [...shown, { value: q, label: customLabel(q), custom: true }] : shown;

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (!wrap.current?.contains(e.target)) close(); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  useEffect(() => { setActive(0); }, [query, open]);
  useEffect(() => { listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active]);

  function close() { setOpen(false); setQuery(''); }
  function pick(o) { onChange?.(o.value, o); close(); input.current?.blur(); }

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) setOpen(true); else setActive((a) => Math.min(a + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { if (open && items[active]) { e.preventDefault(); pick(items[active]); } }
    else if (e.key === 'Escape') { if (open) { e.preventDefault(); close(); } }
    else if (e.key === 'Tab') close();
  };

  const control = (
    <div ref={wrap} className="relative">
      <div className="relative">
        {selected?.prefix && !open && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base" aria-hidden>{selected.prefix}</span>}
        <input
          ref={input}
          id={id}
          className={cx('input pr-9', selected?.prefix && !open && 'pl-11', error && 'border-red-400', inputClassName)}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && items[active] ? `${id}-o${active}` : undefined}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error || hint ? `${id}-d` : undefined}
          aria-label={label ? undefined : ariaLabel}
          autoComplete="off"
          disabled={disabled}
          placeholder={selected ? selectedText(selected) : placeholder}
          value={open ? query : (selected ? selectedText(selected) : '')}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onKeyDown={onKey}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted">
          {loading ? <LuLoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <LuChevronDown className="h-4 w-4" aria-hidden />}
        </span>
      </div>
      {open && !disabled && (
        <ul ref={listRef} id={listId} role="listbox" aria-label={label || ariaLabel}
          className="absolute z-50 mt-1 max-h-64 w-full min-w-56 overflow-auto rounded-lg border border-line bg-white py-1 text-sm shadow-lg">
          {loading && <li className="px-3 py-2 text-muted">Loading…</li>}
          {!loading && items.length === 0 && <li className="px-3 py-2 text-muted">{emptyText}</li>}
          {!loading && items.map((o, i) => (
            <li key={`${o.custom ? 'custom:' : ''}${o.value}`} id={`${id}-o${i}`} data-i={i} role="option" aria-selected={o.value === value}
              onMouseDown={(e) => { e.preventDefault(); pick(o); }} onMouseEnter={() => setActive(i)}
              className={cx('flex cursor-pointer items-center gap-2 px-3 py-2', i === active && 'bg-forest-50', o.custom && 'border-t border-line font-medium text-forest-800')}>
              {o.prefix && <span className="shrink-0 text-base" aria-hidden>{o.prefix}</span>}
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.hint && <span className="shrink-0 text-xs text-muted">{o.hint}</span>}
              {o.value === value && !o.custom && <LuCheck className="shrink-0 text-forest-700" aria-hidden />}
            </li>
          ))}
          {!loading && matches.length > MAX_SHOWN && <li className="px-3 py-2 text-xs text-muted">Showing {MAX_SHOWN} of {matches.length} — type more to narrow down.</li>}
        </ul>
      )}
    </div>
  );

  if (compact) return control;
  return (
    <div className={className}>
      {label && <label htmlFor={id} className="label">{label}{required && <span className="text-gold-700"> *</span>}</label>}
      {control}
      {(error || hint) && <p id={`${id}-d`} className={cx('mt-1 text-xs', error ? 'text-red-600' : 'text-muted')}>{error || hint}</p>}
    </div>
  );
}
