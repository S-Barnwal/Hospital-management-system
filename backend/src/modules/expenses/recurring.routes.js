// Expenses → Recurring: monthly rent, internet, AMC… posted automatically on their due date (scheduler) or with "Post due now".
// Nested inside expenses.routes.js (hospital session and plan already checked). Every query is scoped by TenantId.
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/auth.js';
import { asyncHandler, badRequest, notFound, unauthorized } from '../../utils/errors.js';
import { db, t } from '../../db/pool.js';
import { idParam } from '../../utils/params.js';
import { auditTenant } from '../../utils/audit.js';
import { localDateString } from '../../utils/time.js';
import { postDueRecurringExpenses } from './recurring.service.js';

const router = Router();
router.use((req, _res, next) => (req.ctx?.tenantId ? next() : next(unauthorized())));

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date');
const schema = z.object({
  title: z.string().trim().min(2).max(150), categoryId: z.coerce.number().int().positive({ message: 'Choose a category' }),
  amount: z.coerce.number().positive('Amount must be more than 0').max(1e9), method: z.enum(['cash', 'card', 'upi', 'bank', 'other']),
  paidTo: z.string().trim().max(150).nullable().optional(), frequency: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']),
  nextDueDate: ymd, endDate: ymd.nullable().optional(), isActive: z.boolean().optional(),
}).strict().refine((v) => !v.endDate || v.endDate >= v.nextDueDate, { message: 'End date must be after the next due date.', path: ['endDate'] });

const params = (req) => ({
  tid: req.ctx.tenantId, title: req.body.title, cat: req.body.categoryId, amt: t.money(Number(req.body.amount).toFixed(2)), m: req.body.method,
  to: req.body.paidTo || null, f: req.body.frequency, next: req.body.nextDueDate, end: req.body.endDate || null, active: req.body.isActive ?? true,
});
async function checkCategory(req) {
  if (!(await db.one('SELECT 1 AS ok FROM hms.ExpenseCategories WHERE TenantId = @tid AND ExpenseCategoryId = @id', { tid: req.ctx.tenantId, id: req.body.categoryId }))) throw badRequest('Category not found.');
}

router.get('/recurring', requirePermission('expenses.read'), asyncHandler(async (req, res) => {
  const rows = await db.query(`
    SELECT r.RecurringExpenseId AS id, r.Title AS title, r.ExpenseCategoryId AS categoryId, c.Name AS category, r.Amount AS amount, r.Method AS method, r.PaidTo AS paidTo,
           r.Frequency AS frequency, CONVERT(CHAR(10), r.NextDueDate, 23) AS nextDueDate, CONVERT(CHAR(10), r.EndDate, 23) AS endDate,
           CONVERT(CHAR(10), r.LastPostedDate, 23) AS lastPostedDate, r.IsActive AS isActive,
           (SELECT COUNT(*) FROM hms.Expenses e WHERE e.TenantId = r.TenantId AND e.RecurringExpenseId = r.RecurringExpenseId) AS postedCount
    FROM hms.RecurringExpenses r JOIN hms.ExpenseCategories c ON c.TenantId = r.TenantId AND c.ExpenseCategoryId = r.ExpenseCategoryId
    WHERE r.TenantId = @tid ORDER BY r.IsActive DESC, r.NextDueDate`, { tid: req.ctx.tenantId });
  res.json({ data: rows });
}));

router.post('/recurring', requirePermission('expenses.write'), validate(schema), asyncHandler(async (req, res) => {
  await checkCategory(req);
  const r = await db.one(`INSERT INTO hms.RecurringExpenses (TenantId, Title, ExpenseCategoryId, Amount, Method, PaidTo, Frequency, NextDueDate, EndDate, IsActive, CreatedByUserId)
                          OUTPUT INSERTED.RecurringExpenseId VALUES (@tid, @title, @cat, @amt, @m, @to, @f, CAST(@next AS DATE), CAST(@end AS DATE), @active, @uid)`,
  { ...params(req), uid: req.ctx.userId });
  await auditTenant(req, 'recurring_expense.created', 'recurring_expense', r.RecurringExpenseId, { title: req.body.title });
  res.status(201).json({ data: { id: r.RecurringExpenseId } });
}));

router.put('/recurring/:id', requirePermission('expenses.write'), validate(schema), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  await checkCategory(req);
  const n = await db.exec(`UPDATE hms.RecurringExpenses SET Title = @title, ExpenseCategoryId = @cat, Amount = @amt, Method = @m, PaidTo = @to, Frequency = @f,
                             NextDueDate = CAST(@next AS DATE), EndDate = CAST(@end AS DATE), IsActive = @active WHERE TenantId = @tid AND RecurringExpenseId = @id`, { ...params(req), id });
  if (!n) throw notFound('Recurring expense not found.');
  await auditTenant(req, 'recurring_expense.updated', 'recurring_expense', id);
  res.json({ data: { ok: true } });
}));

/** Stops a template. Expenses it already posted stay (delete them from the expense list if needed). */
router.delete('/recurring/:id', requirePermission('expenses.write'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const used = await db.one('SELECT COUNT(*) AS n FROM hms.Expenses WHERE TenantId = @tid AND RecurringExpenseId = @id', { tid: req.ctx.tenantId, id });
  const n = used.n
    ? await db.exec('UPDATE hms.RecurringExpenses SET IsActive = 0 WHERE TenantId = @tid AND RecurringExpenseId = @id', { tid: req.ctx.tenantId, id })
    : await db.exec('DELETE FROM hms.RecurringExpenses WHERE TenantId = @tid AND RecurringExpenseId = @id', { tid: req.ctx.tenantId, id });
  if (!n) throw notFound('Recurring expense not found.');
  await auditTenant(req, used.n ? 'recurring_expense.stopped' : 'recurring_expense.deleted', 'recurring_expense', id);
  res.json({ data: { ok: true, stopped: Boolean(used.n) } });
}));

router.post('/recurring/post-due', requirePermission('expenses.write'), asyncHandler(async (req, res) => {
  const posted = await postDueRecurringExpenses(req.ctx.tenantId);
  await auditTenant(req, 'recurring_expense.posted', 'recurring_expense', null, { posted, date: localDateString(req.ctx.timezone) });
  res.json({ data: { posted } });
}));

export default router;
