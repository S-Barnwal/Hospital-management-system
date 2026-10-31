import { Link } from 'react-router-dom';
import { LuPartyPopper, LuArrowRight } from 'react-icons/lu';

/** True when at least one plan on sale is in "free for now" mode (set by the Super Admin). */
export const anyFree = (plans) => Array.isArray(plans) && plans.some((p) => p.isFree);

/**
 * Site-wide announcement shown while the Super Admin has made plans free.
 * Disappears by itself the moment charging is switched back on (the /plans list no longer has isFree).
 */
export default function FreeBanner({ plans }) {
  if (!anyFree(plans)) return null;
  const free = plans.filter((p) => p.isFree);
  const which = free.length === plans.filter((p) => !p.contactSales).length ? 'All plans are' : `${free.map((p) => p.name).join(' & ')} ${free.length > 1 ? 'are' : 'is'}`;
  return (
    <div className="bg-gradient-to-r from-gold-500 via-gold-400 to-gold-500 text-forest-950" role="status">
      <div className="container-page flex flex-wrap items-center justify-center gap-x-3 gap-y-1 py-2 text-center text-sm font-semibold">
        <LuPartyPopper className="h-4 w-4 shrink-0" aria-hidden />
        <span>Hurray! {which} <strong>FREE</strong> for now — register your hospital and start using it today, no payment needed.</span>
        <Link to={`/register?plan=${free[0].code}&interval=monthly`} className="inline-flex items-center gap-1 rounded-full bg-forest-950 px-3 py-0.5 text-xs font-bold text-white hover:bg-forest-800">
          Register free <LuArrowRight aria-hidden />
        </Link>
      </div>
    </div>
  );
}
