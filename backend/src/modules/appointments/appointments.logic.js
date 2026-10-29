// Pure appointment rules (unit-tested without a database).

export const ACTIVE_STATUSES = ['scheduled', 'checked_in'];

const TRANSITIONS = {
  scheduled: ['checked_in', 'cancelled', 'no_show'],
  checked_in: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
  no_show: [],
};

export const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);

/** Half-open interval overlap: [aStart, aEnd) intersects [bStart, bEnd). */
export const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

const toMin = (hhmm) => {
  const [h, m] = String(hhmm).slice(0, 5).split(':').map(Number);
  return h * 60 + m;
};
const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/**
 * True when [startHHMM, startHHMM + duration) fits fully inside one of the doctor's schedule blocks
 * for that weekday. With no schedule configured the doctor is treated as available (configurable later).
 */
export function withinSchedule(blocks, startHHMM, durationMin) {
  if (!blocks || blocks.length === 0) return true;
  const s = toMin(startHHMM);
  const e = s + durationMin;
  return blocks.some((b) => s >= toMin(b.StartTime) && e <= toMin(b.EndTime));
}

/**
 * Generates free slots for a day. `booked` contains local minute ranges [{start, end}] already taken.
 * Returns ["09:00", "09:15", ...].
 */
export function freeSlots(blocks, booked, { nowMinutes = -1 } = {}) {
  const out = [];
  for (const b of blocks) {
    const step = b.SlotMinutes || 15;
    for (let m = toMin(b.StartTime); m + step <= toMin(b.EndTime); m += step) {
      if (m <= nowMinutes) continue;
      if (booked.some((x) => overlaps(m, m + step, x.start, x.end))) continue;
      out.push(toHHMM(m));
    }
  }
  return [...new Set(out)].sort();
}
