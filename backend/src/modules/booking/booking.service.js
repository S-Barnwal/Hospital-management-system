// Online appointment booking: free slots from the doctor's weekly schedule minus booked appointments and requests
// already waiting for confirmation.
import { db } from '../../db/pool.js';
import { localDayRangeUtc, localDateString } from '../../utils/time.js';
import { freeSlots } from '../appointments/appointments.logic.js';

/** Is online booking switched on for this hospital? */
export async function bookingEnabled(tenantId) {
  const r = await db.one(`SELECT SettingValue FROM hms.TenantSettings WHERE TenantId = @tid AND SettingKey = 'booking.enabled'`, { tid: tenantId });
  return r?.SettingValue === 'on';
}

/** Free start times ("09:15") for a doctor on a local date. Returns { slots, slotMinutes }. */
export async function slotsFor(tenantId, timezone, doctorId, date) {
  const { start, end } = localDayRangeUtc(timezone, date);
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  const [blocks, booked, pending] = await db.many(`
    SELECT CONVERT(CHAR(5), StartTime, 108) AS StartTime, CONVERT(CHAR(5), EndTime, 108) AS EndTime, SlotMinutes
      FROM hms.DoctorSchedules WHERE TenantId = @tid AND StaffId = @doc AND DayOfWeek = @dow ORDER BY StartTime;
    SELECT StartAt, EndAt FROM hms.Appointments
      WHERE TenantId = @tid AND DoctorId = @doc AND Status IN ('scheduled','checked_in') AND StartAt < @end AND EndAt > @start;
    SELECT StartAt, DATEADD(MINUTE, DurationMinutes, StartAt) AS EndAt FROM hms.OnlineBookingRequests
      WHERE TenantId = @tid AND DoctorId = @doc AND Status = 'pending' AND StartAt < @end AND StartAt >= @start;`,
  { tid: tenantId, doc: doctorId, dow, start, end });
  const toLocalMin = (d) => Math.round((new Date(d).getTime() - start.getTime()) / 60000);
  const today = localDateString(timezone);
  // Online patients cannot take a slot starting within the next 30 minutes (the desk needs time to confirm).
  const nowMinutes = date === today ? Math.round((Date.now() - start.getTime()) / 60000) + 30 : (date < today ? 24 * 60 : -1);
  const taken = [...booked, ...pending].map((b) => ({ start: toLocalMin(b.StartAt), end: toLocalMin(b.EndAt) }));
  return { slots: freeSlots(blocks, taken, { nowMinutes }), slotMinutes: blocks[0]?.SlotMinutes || 15, scheduled: blocks.length > 0 };
}
