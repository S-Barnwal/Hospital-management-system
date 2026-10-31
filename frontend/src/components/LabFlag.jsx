// Result flag shown on lab screens and reports (critical results stand out).
import { Badge, cx } from './ui.jsx';

const FLAG = {
  normal: ['green', 'normal'], low: ['blue', 'low'], high: ['red', 'high'], abnormal: ['red', 'abnormal'],
  crit_low: ['red', 'CRITICAL LOW'], crit_high: ['red', 'CRITICAL HIGH'],
};
export const isCriticalFlag = (f) => f === 'crit_low' || f === 'crit_high';
export const isOutOfRange = (f) => ['high', 'low', 'abnormal', 'crit_low', 'crit_high'].includes(f);

export function LabFlag({ flag, empty = '—' }) {
  if (!flag) return empty;
  const [tone, label] = FLAG[flag] || ['gray', flag];
  return <Badge tone={tone} className={cx(isCriticalFlag(flag) && 'font-bold ring-1 ring-red-400')}>{label}</Badge>;
}
