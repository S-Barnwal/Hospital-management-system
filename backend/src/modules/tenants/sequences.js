/**
 * Returns the next value of a per-tenant counter. Must run inside a transaction: the UPDLOCK
 * serialises concurrent callers so numbers are gap-free and unique per hospital.
 */
export async function nextSequence(tx, tenantId, key) {
  const row = await tx.one(
    `UPDATE hms.TenantSequences WITH (UPDLOCK, ROWLOCK)
     SET NextValue = NextValue + 1
     OUTPUT DELETED.NextValue AS value
     WHERE TenantId = @tid AND SequenceKey = @key`, { tid: tenantId, key });
  if (row) return Number(row.value);
  await tx.exec('INSERT INTO hms.TenantSequences (TenantId, SequenceKey, NextValue) VALUES (@tid, @key, 2)', { tid: tenantId, key });
  return 1;
}

export const formatNumber = (prefix, n, width = 6) => `${prefix}-${String(n).padStart(width, '0')}`;
