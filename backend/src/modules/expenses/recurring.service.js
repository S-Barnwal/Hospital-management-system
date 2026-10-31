// Posts due recurring expenses (rent, internet, AMC…) as normal expenses. Idempotent: a unique index on
// (TenantId, RecurringExpenseId, ExpenseDate) makes a second run — or a second server — a no-op.
import { db, withTransaction, t } from '../../db/pool.js';
import { localDateString } from '../../utils/time.js';
import { nextSequence, formatNumber } from '../tenants/sequences.js';
import { dueDatesUpTo } from '../clinical/phase3.logic.js';

export async function postDueRecurringExpenses(tenantId = null) {
  const rows = await db.query(`
    /* tenant-safe: platform job when @tid is NULL; each row carries its own TenantId */
    SELECT r.RecurringExpenseId, r.TenantId, r.Title, r.ExpenseCategoryId, r.Amount, r.Method, r.PaidTo, r.Frequency,
           CONVERT(CHAR(10), r.NextDueDate, 23) AS NextDueDate, CONVERT(CHAR(10), r.EndDate, 23) AS EndDate, t.Timezone
    FROM hms.RecurringExpenses r JOIN hms.Tenants t ON t.TenantId = r.TenantId AND t.Status = 'active'
    WHERE r.IsActive = 1 AND (@tid IS NULL OR r.TenantId = @tid) AND r.NextDueDate <= CAST(DATEADD(DAY, 1, SYSUTCDATETIME()) AS DATE)`, { tid: tenantId });
  let posted = 0;
  for (const r of rows) {
    const today = localDateString(r.Timezone);
    const { due, next } = dueDatesUpTo(r.NextDueDate, today, r.Frequency, r.EndDate);
    if (!due.length) continue;
    await withTransaction(async (tx) => {
      for (const d of due) {
        const exists = await tx.one('SELECT 1 AS x FROM hms.Expenses WITH (UPDLOCK, HOLDLOCK) WHERE TenantId = @tid AND RecurringExpenseId = @rid AND ExpenseDate = CAST(@d AS DATE)',
          { tid: r.TenantId, rid: r.RecurringExpenseId, d });
        if (exists) continue;
        const number = formatNumber('EXP', await nextSequence(tx, r.TenantId, 'expense'));
        await tx.exec(`INSERT INTO hms.Expenses (TenantId, ExpenseNumber, ExpenseDate, ExpenseCategoryId, Amount, Method, PaidTo, Notes, RecurringExpenseId)
                       VALUES (@tid, @num, CAST(@d AS DATE), @cat, @amt, @m, @to, @notes, @rid)`,
        { tid: r.TenantId, num: number, d, cat: r.ExpenseCategoryId, amt: t.money(Number(r.Amount).toFixed(2)), m: r.Method, to: r.PaidTo, notes: `${r.Title} (recurring)`, rid: r.RecurringExpenseId });
        posted += 1;
      }
      const ended = r.EndDate && next > r.EndDate;
      await tx.exec(`UPDATE hms.RecurringExpenses SET NextDueDate = CAST(@next AS DATE), LastPostedDate = CAST(@last AS DATE), IsActive = CASE WHEN @ended = 1 THEN 0 ELSE IsActive END
                     WHERE TenantId = @tid AND RecurringExpenseId = @rid`, { tid: r.TenantId, rid: r.RecurringExpenseId, next, last: due[due.length - 1], ended: Boolean(ended) });
    });
  }
  return posted;
}
