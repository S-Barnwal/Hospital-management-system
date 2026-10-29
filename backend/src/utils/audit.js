import { db } from '../db/pool.js';
import { sanitiseMetadata } from './sanitise.js';

export { sanitiseMetadata };

/**
 * Writes an audit record. Pass `runner` (a transaction) to make the log part of the same unit of work.
 * Failures are logged but never break the business operation when outside a transaction.
 */
export async function audit({ tenantId = null, actorType, actorId = null, action, entityType = null, entityId = null, metadata = null, ip = null }, runner = null) {
  const text = `INSERT INTO hms.AuditLogs (TenantId, ActorType, ActorId, Action, EntityType, EntityId, Metadata, IpAddress)
                VALUES (@tenantId, @actorType, @actorId, @action, @entityType, @entityId, @metadata, @ip)`;
  const params = {
    tenantId, actorType, actorId, action, entityType,
    entityId: entityId === null ? null : String(entityId),
    metadata: sanitiseMetadata(metadata), ip,
  };
  if (runner) return runner.exec(text, params);
  try {
    await db.exec(text, params);
  } catch (err) {
    console.error('[audit] failed to write audit log', action, err.message);
  }
}

/** Convenience: audit from a tenant request context. */
export const auditTenant = (req, action, entityType, entityId, metadata, runner) =>
  audit({ tenantId: req.ctx.tenantId, actorType: 'tenant', actorId: req.ctx.userId, action, entityType, entityId, metadata, ip: req.ip }, runner);

export const auditPlatform = (req, action, entityType, entityId, metadata, tenantId = null, runner = null) =>
  audit({ tenantId, actorType: 'platform', actorId: req.admin.platformUserId, action, entityType, entityId, metadata, ip: req.ip }, runner);
