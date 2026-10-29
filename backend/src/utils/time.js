// Timezone helpers. Storage is always UTC; hospitals configure an IANA timezone (e.g. Asia/Kolkata).

/** Offset in minutes of `timeZone` from UTC at instant `date` (e.g. +330 for Asia/Kolkata). */
export function tzOffsetMinutes(timeZone, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** Local calendar date (YYYY-MM-DD) in `timeZone` for instant `date`. */
export function localDateString(timeZone, date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/**
 * UTC [start, end) instants covering the local calendar day `ymd` (YYYY-MM-DD) in `timeZone`.
 * Handles DST transitions by computing the offset at each boundary.
 */
export function localDayRangeUtc(timeZone, ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const startGuess = new Date(Date.UTC(y, m - 1, d));
  const endGuess = new Date(Date.UTC(y, m - 1, d + 1));
  const start = new Date(startGuess.getTime() - tzOffsetMinutes(timeZone, startGuess) * 60000);
  const end = new Date(endGuess.getTime() - tzOffsetMinutes(timeZone, endGuess) * 60000);
  return { start, end };
}

/** Converts a local wall-clock date + time ("2026-10-30", "10:15") in `timeZone` to a UTC Date. */
export function localToUtc(timeZone, ymd, hhmm) {
  const [y, m, d] = ymd.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const first = new Date(guess.getTime() - tzOffsetMinutes(timeZone, guess) * 60000);
  // second pass corrects for offsets that differ between guess and the real instant (DST edges)
  return new Date(guess.getTime() - tzOffsetMinutes(timeZone, first) * 60000);
}

export function isValidTimeZone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}
