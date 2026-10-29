import { Link } from 'react-router-dom';
import { BRAND } from '../lib/format.js';

/** Brand mark — the hospital cross with heartbeat (public/logo.png). */
export function LogoMark({ className = 'h-9 w-9' }) {
  return <img src="/logo.png" alt="" width="36" height="36" className={`${className} object-contain`} aria-hidden />;
}

export default function Logo({ to = '/', light = false, compact = false }) {
  const [first, ...rest] = BRAND.split(' ');
  return (
    <Link to={to} className="flex items-center gap-2.5" aria-label={`${BRAND} home`}>
      <LogoMark />
      {!compact && (
        <span className={`font-display text-xl font-semibold tracking-tight ${light ? 'text-white' : 'text-forest-950'}`}>
          {first}<span className={light ? 'text-gold-400' : 'text-gold-600'}> {rest.join(' ')}</span>
        </span>
      )}
    </Link>
  );
}
