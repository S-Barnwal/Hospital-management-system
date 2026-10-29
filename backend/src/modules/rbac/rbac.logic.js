// Pure privilege-escalation rules (unit-tested).

/** Returns the permission codes in `wanted` that the actor does not hold. */
export const missingPermissions = (actorPerms, wanted) => [...wanted].filter((p) => !actorPerms.has(p));

/**
 * Can `actor` assign `roles` (each { code, permissions:Set|Array }) to `targetUserId`?
 * Returns null when allowed, otherwise a human-readable reason.
 */
export function assignmentProblem({ actor, targetUserId, targetIsOwner, roles }) {
  if (actor.userId === targetUserId) return 'You cannot change your own roles.';
  if (targetIsOwner && !actor.isOwner) return 'Only the hospital owner can change the owner account.';
  for (const r of roles) {
    if (r.code === 'owner' && !actor.isOwner) return 'Only the hospital owner can grant the Owner role.';
    const missing = missingPermissions(actor.permissions, r.permissions);
    if (missing.length) return `You cannot grant role "${r.name ?? r.code}" because it includes permissions you do not hold (${missing.slice(0, 3).join(', ')}).`;
  }
  return null;
}

/** Can `actor` set `newPerms` on role `role`? */
export function roleEditProblem({ actor, role, newPerms }) {
  if (role.code === 'owner') return 'The Owner role cannot be modified.';
  if (actor.roles.includes(role.code)) return 'You cannot modify a role you hold yourself.';
  const missing = missingPermissions(actor.permissions, newPerms);
  if (missing.length) return `You cannot grant permissions you do not hold (${missing.slice(0, 3).join(', ')}).`;
  return null;
}
