// OPD token queue: numbering, calling and the public (no patient data) view used by TV screens.
import { db } from '../../db/pool.js';
import { badRequest } from '../../utils/errors.js';
import { localDateString } from '../../utils/time.js';
import { parseQueueKey, QUEUE_LABELS, FIXED_QUEUES, estimateWaitMinutes } from '../clinical/phase4.logic.js';

/** Checks a queue key belongs to this hospital (a doctor queue needs an active doctor). Returns { doctorId, label, room }. */
export async function resolveQueue(runner, tenantId, key) {
  const q = parseQueueKey(key);
  if (!q) throw badRequest('Unknown queue.');
  if (q.kind !== 'doctor') return { doctorId: null, label: QUEUE_LABELS[q.kind], room: null };
  const d = await runner.one(`SELECT StaffId, FullName, Room FROM hms.StaffMembers WHERE TenantId = @tid AND StaffId = @id AND StaffType = 'doctor' AND IsActive = 1`,
    { tid: tenantId, id: q.doctorId });
  if (!d) throw badRequest('Doctor not found or inactive.');
  return { doctorId: d.StaffId, label: d.FullName, room: d.Room };
}

/**
 * Issues the next token of a queue for the hospital's local date. Serialised per queue with UPDLOCK/HOLDLOCK on the
 * day's rows, so two desks issuing at once never get the same number (and the unique key backs it up).
 * An appointment gets at most one token (returned again if it already has one).
 */
export async function issueToken(tx, { tenantId, timezone, userId, queueKey, patientId = null, appointmentId = null, priority = false }) {
  const date = localDateString(timezone);
  if (appointmentId) {
    const existing = await tx.one('SELECT TokenId, TokenNumber, QueueKey FROM hms.QueueTokens WHERE TenantId = @tid AND AppointmentId = @a', { tid: tenantId, a: appointmentId });
    if (existing) return { id: existing.TokenId, number: existing.TokenNumber, queueKey: existing.QueueKey, date, existed: true };
  }
  const queue = await resolveQueue(tx, tenantId, queueKey);
  if (patientId && !(await tx.one('SELECT 1 AS x FROM hms.Patients WHERE TenantId = @tid AND PatientId = @p AND IsArchived = 0', { tid: tenantId, p: patientId }))) {
    throw badRequest('Patient not found.');
  }
  const last = await tx.one(`SELECT MAX(TokenNumber) AS n FROM hms.QueueTokens WITH (UPDLOCK, HOLDLOCK)
                             WHERE TenantId = @tid AND TokenDate = CAST(@d AS DATE) AND QueueKey = @k`, { tid: tenantId, d: date, k: queueKey });
  const number = (last?.n ?? 0) + 1;
  const row = await tx.one(`INSERT INTO hms.QueueTokens (TenantId, TokenDate, QueueKey, DoctorId, TokenNumber, PatientId, AppointmentId, Priority, CreatedByUserId)
                            OUTPUT INSERTED.TokenId VALUES (@tid, CAST(@d AS DATE), @k, @doc, @n, @p, @a, @pri, @uid)`,
  { tid: tenantId, d: date, k: queueKey, doc: queue.doctorId, n: number, p: patientId, a: appointmentId, pri: Boolean(priority), uid: userId ?? null });
  return { id: row.TokenId, number, queueKey, label: queue.label, room: queue.room, date, existed: false };
}

/**
 * Snapshot of every queue that has tokens today (plus, for staff, each active doctor). `publicView` strips everything
 * that could identify a patient: only token numbers, queue names, rooms and counts are returned.
 */
export async function queueBoard(tenantId, timezone, { keys = null, publicView = false } = {}) {
  const date = localDateString(timezone);
  const [tokens, doctors] = await db.many(`
    SELECT q.TokenId AS id, q.QueueKey AS queueKey, q.TokenNumber AS tokenNumber, q.Status AS status, q.Priority AS priority, q.Counter AS counter,
           q.CalledAt AS calledAt, q.CallCount AS callCount, q.CreatedAt AS createdAt, q.PatientId AS patientId, q.AppointmentId AS appointmentId,
           p.PatientNumber AS patientNumber, p.FirstName AS firstName, p.LastName AS lastName
    FROM hms.QueueTokens q LEFT JOIN hms.Patients p ON p.TenantId = q.TenantId AND p.PatientId = q.PatientId
    WHERE q.TenantId = @tid AND q.TokenDate = CAST(@d AS DATE) ORDER BY q.QueueKey, q.TokenNumber;
    SELECT StaffId AS id, FullName AS name, Room AS room FROM hms.StaffMembers WHERE TenantId = @tid AND StaffType = 'doctor' AND IsActive = 1 ORDER BY FullName;`,
  { tid: tenantId, d: date });
  const docBy = new Map(doctors.map((d) => [`doctor:${d.id}`, d]));
  const allKeys = new Set([...tokens.map((x) => x.queueKey), ...(publicView ? [] : [...doctors.map((d) => `doctor:${d.id}`), ...FIXED_QUEUES])]);
  const wanted = keys?.length ? [...allKeys].filter((k) => keys.includes(k)) : [...allKeys];
  const queues = wanted.map((key) => {
    const list = tokens.filter((x) => x.queueKey === key);
    const doc = docBy.get(key);
    const current = list.filter((x) => x.status === 'called').sort((a, b) => new Date(b.calledAt) - new Date(a.calledAt))[0] ?? null;
    const waiting = list.filter((x) => x.status === 'waiting').sort((a, b) => (Number(b.priority) - Number(a.priority)) || (a.tokenNumber - b.tokenNumber));
    const base = {
      key, label: doc ? doc.name : QUEUE_LABELS[key] ?? key, room: current?.counter || doc?.room || null,
      current: current ? { number: current.tokenNumber, counter: current.counter, calledAt: current.calledAt, callCount: current.callCount } : null,
      next: waiting.slice(0, 5).map((x) => x.tokenNumber), waiting: waiting.length, done: list.filter((x) => x.status === 'done').length,
      estimatedWaitMinutes: estimateWaitMinutes(list.filter((x) => x.calledAt).map((x) => x.calledAt), waiting.length),
    };
    if (publicView) return base;
    return { ...base, isDoctor: Boolean(doc), tokens: list.map((x) => ({ ...x, priority: Boolean(x.priority) })) };
  }).sort((a, b) => (a.key.startsWith('doctor:') === b.key.startsWith('doctor:') ? a.label.localeCompare(b.label) : a.key.startsWith('doctor:') ? -1 : 1));
  const recentCalls = tokens.filter((x) => x.calledAt && wanted.includes(x.queueKey))
    .sort((a, b) => new Date(b.calledAt) - new Date(a.calledAt)).slice(0, 6)
    .map((x) => ({ number: x.tokenNumber, queueKey: x.queueKey, label: docBy.get(x.queueKey)?.name ?? QUEUE_LABELS[x.queueKey] ?? x.queueKey,
      counter: x.counter || docBy.get(x.queueKey)?.room || null, calledAt: x.calledAt, callCount: x.callCount }));
  return { date, queues, recentCalls };
}
