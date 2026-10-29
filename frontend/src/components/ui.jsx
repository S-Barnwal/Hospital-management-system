import { useEffect, useId, useRef } from 'react';
import { Link } from 'react-router-dom';
import { LuLoaderCircle, LuX, LuInbox, LuChevronLeft, LuChevronRight, LuCircleAlert, LuCircleCheck, LuInfo, LuTriangleAlert } from 'react-icons/lu';

const cx = (...c) => c.filter(Boolean).join(' ');
export { cx };

const VARIANTS = {
  primary: 'bg-forest-800 text-white hover:bg-forest-900 shadow-sm',
  gold: 'bg-gold-500 text-forest-950 hover:bg-gold-400 shadow-sm',
  outline: 'border border-forest-200 bg-white text-forest-900 hover:border-forest-300 hover:bg-forest-50',
  ghost: 'text-forest-800 hover:bg-forest-50',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  light: 'bg-white/10 text-white ring-1 ring-white/25 hover:bg-white/15',
};
const SIZES = { sm: 'h-8 px-3 text-xs', md: 'h-10 px-4 text-sm', lg: 'h-12 px-6 text-base' };

export function Button({ variant = 'primary', size = 'md', loading, to, href, className, children, disabled, ...rest }) {
  const cls = cx('inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
    VARIANTS[variant], SIZES[size], className);
  const content = <>{loading && <LuLoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}{children}</>;
  if (to) return <Link to={to} className={cls} {...rest}>{content}</Link>;
  if (href) return <a href={href} className={cls} {...rest}>{content}</a>;
  return <button className={cls} disabled={disabled || loading} {...rest}>{content}</button>;
}

/** Label + control + hint/error, wired up with aria attributes. */
export function Field({ label, error, hint, required, children, className }) {
  const id = useId();
  const child = typeof children === 'function'
    ? children({ id, 'aria-describedby': error || hint ? `${id}-d` : undefined })
    : children;
  return (
    <div className={className}>
      {label && <label htmlFor={id} className="label">{label}{required && <span className="text-gold-700"> *</span>}</label>}
      {child}
      {(error || hint) && <p id={`${id}-d`} className={cx('mt-1 text-xs', error ? 'text-red-600' : 'text-muted')}>{error || hint}</p>}
    </div>
  );
}

export function Input({ label, error, hint, required, className, ...props }) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className}>
      {(a) => <input className="input" required={required} {...a} {...props} />}
    </Field>
  );
}

export function Select({ label, error, hint, required, className, options = [], placeholder, ...props }) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className}>
      {(a) => (
        <select className="input" required={required} {...a} {...props}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
    </Field>
  );
}

export function Textarea({ label, error, hint, required, className, ...props }) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className}>
      {(a) => <textarea className="input min-h-24" required={required} {...a} {...props} />}
    </Field>
  );
}

export function Card({ className, children, ...rest }) {
  return <div className={cx('card', className)} {...rest}>{children}</div>;
}

const BADGE = {
  green: 'bg-forest-50 text-forest-800 ring-forest-200',
  gold: 'bg-gold-50 text-gold-700 ring-gold-200',
  gray: 'bg-slate-50 text-slate-700 ring-slate-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  blue: 'bg-sky-50 text-sky-800 ring-sky-200',
};
export function Badge({ tone = 'gray', children, className }) {
  return <span className={cx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset', BADGE[tone], className)}>{children}</span>;
}

export const STATUS_TONE = {
  active: 'green', scheduled: 'blue', checked_in: 'gold', completed: 'green', cancelled: 'red', no_show: 'gray',
  suspended: 'red', deactivated: 'gray', pending: 'gold', paid: 'green', failed: 'red', created: 'gray', refunded: 'gray',
  new: 'gold', contacted: 'blue', closed: 'gray', disabled: 'gray', expired: 'red', grace: 'gold', past_due: 'gold',
};
export const StatusBadge = ({ status }) => <Badge tone={STATUS_TONE[status] || 'gray'}>{String(status || '').replace(/_/g, ' ')}</Badge>;

const ALERT = {
  error: ['bg-red-50 text-red-800 ring-red-200', LuCircleAlert],
  success: ['bg-forest-50 text-forest-900 ring-forest-200', LuCircleCheck],
  info: ['bg-sky-50 text-sky-900 ring-sky-200', LuInfo],
  warning: ['bg-gold-50 text-gold-700 ring-gold-200', LuTriangleAlert],
};
export function Alert({ tone = 'info', title, children, className }) {
  const [cls, Icon] = ALERT[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx('flex gap-3 rounded-xl px-4 py-3 text-sm ring-1 ring-inset', cls, className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div>{title && <p className="font-semibold">{title}</p>}{children}</div>
    </div>
  );
}

export const Spinner = ({ className }) => <LuLoaderCircle className={cx('h-5 w-5 animate-spin text-forest-600', className)} aria-label="Loading" />;

export const Skeleton = ({ className }) => <div className={cx('animate-pulse rounded-md bg-forest-100/60', className)} aria-hidden />;

export function EmptyState({ icon: Icon = LuInbox, title, children, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-forest-50 text-forest-700"><Icon className="h-6 w-6" aria-hidden /></div>
      <p className="font-semibold text-ink">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.activeElement;
    ref.current?.querySelector('input, select, textarea, button')?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  const width = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl' }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-forest-950/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={cx('flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-[var(--shadow-lift)] sm:rounded-2xl', width)}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-display text-lg font-semibold text-forest-950">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-forest-50 hover:text-ink" aria-label="Close"><LuX className="h-5 w-5" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
        <h1 className="font-display text-2xl font-semibold text-forest-950 sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Pagination({ meta, onPage }) {
  if (!meta || meta.totalPages <= 1) return meta ? <p className="px-4 py-3 text-xs text-muted">{meta.total} record(s)</p> : null;
  return (
    <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm">
      <p className="text-muted">Page {meta.page} of {meta.totalPages} · {meta.total} records</p>
      <div className="flex gap-1">
        <Button variant="outline" size="sm" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)} aria-label="Previous page"><LuChevronLeft /></Button>
        <Button variant="outline" size="sm" disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)} aria-label="Next page"><LuChevronRight /></Button>
      </div>
    </div>
  );
}

/** Table shell with loading skeleton, error and empty states. */
export function DataTable({ columns, rows, loading, error, empty, onRowClick, rowKey = 'id' }) {
  if (error) return <div className="p-4"><Alert tone="error">{error.message}</Alert></div>;
  return (
    <div className="relative overflow-x-auto">
      <table className="table-base">
        <thead className="bg-forest-50/40"><tr>{columns.map((c) => <th key={c.key} scope="col" className={c.className}>{c.label}</th>)}</tr></thead>
        <tbody className="divide-y divide-line bg-white">
          {loading && !rows?.length && [0, 1, 2, 3].map((i) => (
            <tr key={i}>{columns.map((c) => <td key={c.key}><Skeleton className="h-4 w-full max-w-40" /></td>)}</tr>
          ))}
          {!loading && rows?.length === 0 && <tr><td colSpan={columns.length}>{empty}</td></tr>}
          {rows?.map((r) => (
            <tr key={r[rowKey]} onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={cx(onRowClick && 'cursor-pointer hover:bg-forest-50/50', loading && 'opacity-60')}>
              {columns.map((c) => <td key={c.key} className={c.className}>{c.render ? c.render(r) : r[c.key] ?? '—'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StatCard({ label, value, hint, icon: Icon, loading, unavailable }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-muted">{label}</p>
        {Icon && <span className="grid h-9 w-9 place-items-center rounded-lg bg-forest-50 text-forest-700"><Icon className="h-5 w-5" aria-hidden /></span>}
      </div>
      {loading ? <Skeleton className="mt-3 h-8 w-20" /> : (
        <p className={cx('mt-2 font-display text-3xl font-semibold', unavailable ? 'text-muted/60' : 'text-forest-950')}>{unavailable ? '—' : value}</p>
      )}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </Card>
  );
}
