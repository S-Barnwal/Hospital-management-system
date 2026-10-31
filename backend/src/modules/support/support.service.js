// Support tickets between a hospital and the platform team. A hospital only ever sees its own tickets and never the
// support team's internal notes; the platform sees ticket text only (hospitals are asked not to include patient data).
import { db } from '../../db/pool.js';
import { config } from '../../config/env.js';
import { notFound } from '../../utils/errors.js';
import { deliver, templates } from '../../notify/index.js';

export async function nextTicketNumber(tx) {
  const row = await tx.one(
    `MERGE hms.PlatformSequences WITH (HOLDLOCK) AS tgt USING (SELECT N'TKT' AS SequenceKey) AS src ON tgt.SequenceKey = src.SequenceKey
     WHEN MATCHED THEN UPDATE SET NextValue = tgt.NextValue + 1
     WHEN NOT MATCHED THEN INSERT (SequenceKey, NextValue) VALUES (N'TKT', 2)
     OUTPUT INSERTED.NextValue - 1 AS n;`);
  return `TKT-${String(row.n).padStart(6, '0')}`;
}

export const TICKET_COLS = `k.TicketId AS id, k.TicketNumber AS number, k.Subject AS subject, k.Category AS category, k.Priority AS priority, k.Status AS status,
  k.LastReplyBy AS lastReplyBy, k.LastReplyAt AS lastReplyAt, k.ResolvedAt AS resolvedAt, k.CreatedAt AS createdAt, k.UpdatedAt AS updatedAt`;

/** Loads one ticket with its thread. `forHospital` hides internal notes and requires the ticket to belong to tenantId. */
export async function loadTicket({ ticketId, tenantId = null, forHospital }) {
  const [ticket, messages] = await db.many(`
    /* tenant-safe: @tid is required for hospital callers; the platform reads by id */
    SELECT ${TICKET_COLS}, k.TenantId AS tenantId, t.Name AS hospitalName, t.Slug AS hospitalSlug, u.FullName AS createdBy, u.Email AS createdByEmail,
           k.AssignedToId AS assignedToId, a.FullName AS assignedTo
    FROM hms.SupportTickets k JOIN hms.Tenants t ON t.TenantId = k.TenantId
    LEFT JOIN hms.Users u ON u.TenantId = k.TenantId AND u.UserId = k.CreatedByUserId
    LEFT JOIN hms.PlatformUsers a ON a.PlatformUserId = k.AssignedToId
    WHERE k.TicketId = @id AND (@tid IS NULL OR k.TenantId = @tid);
    SELECT m.MessageId AS id, m.AuthorType AS authorType, m.AuthorName AS authorName, m.Body AS body, m.IsInternal AS isInternal, m.CreatedAt AS createdAt
    FROM hms.SupportTicketMessages m JOIN hms.SupportTickets k ON k.TenantId = m.TenantId AND k.TicketId = m.TicketId
    WHERE m.TicketId = @id AND (@tid IS NULL OR m.TenantId = @tid) AND (@hosp = 0 OR m.IsInternal = 0)
    ORDER BY m.CreatedAt, m.MessageId;`, { id: ticketId, tid: forHospital ? tenantId : null, hosp: forHospital ? 1 : 0 });
  if (!ticket[0] || (forHospital && Number(ticket[0].tenantId) !== Number(tenantId))) throw notFound('Ticket not found.');
  const { createdByEmail, ...t } = ticket[0];
  return { ...(forHospital ? { ...t, assignedToId: undefined } : { ...t, createdByEmail }), messages: messages.map((m) => ({ ...m, isInternal: Boolean(m.isInternal) })) };
}

/** E-mail after a reply: to the platform support inbox (hospital wrote) or to the ticket's creator (support wrote). */
export async function notifyTicket({ ticketId, tenantId, toSupport, by, body }) {
  try {
    const k = await db.one(`SELECT k.TicketNumber, k.Subject, k.Status, u.Email FROM hms.SupportTickets k
                            LEFT JOIN hms.Users u ON u.TenantId = k.TenantId AND u.UserId = k.CreatedByUserId
                            WHERE k.TenantId = @tid AND k.TicketId = @id`, { tid: tenantId, id: ticketId });
    if (!k) return;
    const supportInbox = (await db.one(`SELECT SettingValue FROM hms.PlatformSettings WHERE SettingKey = 'support.email'`))?.SettingValue
      || (await db.one(`SELECT SettingValue FROM hms.PlatformSettings WHERE SettingKey = 'contact.email'`))?.SettingValue;
    const to = toSupport ? supportInbox : k.Email;
    if (!to) return;
    const link = toSupport ? `${config.publicAppUrl}/admin/support/${ticketId}` : `${config.publicAppUrl}/app/support/${ticketId}`;
    await deliver({ channel: 'email', to, template: 'support_update', tenantId: toSupport ? null : tenantId,
      content: templates.email.supportUpdate({ ticketNumber: k.TicketNumber, subject: k.Subject, by, status: k.Status, excerpt: String(body).slice(0, 400), link, toSupport }) });
  } catch (err) {
    console.error('[support] notification failed:', err.message);
  }
}
