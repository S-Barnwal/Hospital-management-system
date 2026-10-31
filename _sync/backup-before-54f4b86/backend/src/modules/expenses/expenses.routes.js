// Expenses: hospital running costs (salaries, rent, reagents…) with categories. Tenant-scoped.
// Used by Analytics to show profit = collections − refunds − expenses.
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requireTenant, requirePermission, requireFeature } from '../../middleware/auth.js';
import { asyncHandler, badRequest, conflict, notFound } from '../../utils/errors.js';
import { db, withTransaction, t } from '../../db/pool.js';
import { parseListQuery, pageMeta } from '../../utils/pagination.js';
import { idParam } from '../../utils/params.js';
import { auditTenant } from '../../utils/audit.js';
import { localDateString } from '../../utils/time.js';
import { nextSequence, formatNumber } from '../tenants/sequences.js';

const router = Router();
router.use(requireTenant, requireFeature('billing'));

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const like = (v) => (v ? `%${String(v).trim().slice(0, 100).replace(/[%_[\]]/g, (m) => `[${m}]`)}%` : null);

// ---------- Categories ----------
router.get('/categories', requirePermission('expenses.read'), asyncHandler(async (req, res) => {
  const rows = await db.query(`SELECT c.ExpenseCategoryId AS id, c.Name AS name, c.IsActive AS isActive,
                                      (SELECT COUNT(*) FROM hms.Expenses e WHERE e.TenantId = c.TenantId AND e.ExpenseCategoryId = c.ExpenseCategoryId) AS expenseCount
                               FROM hms.ExpenseCategories c WHERE c.TenantId = @tid AND (@all = 1 OR c.IsActive = 1) ORDER BY c.Name`,
  { tid: req.ctx.tenantId, all: req.query.all === 'true' });
  res.json({ data: rows });
}));

const categorySchema = z.object({ name: z.string().trim().min(2).max(80), isActive: z.boolean().optional() }).strict();

router.post('/categories', requirePermission('expenses.write'), validate(categorySchema), asyncHandler(async (req, res) => {
  const r = await db.one('INSERT INTO hms.ExpenseCategories (TenantId, Name, IsActive) OUTPUT INSERTED.ExpenseCategoryId VALUES (@tid, @name, @active)',
    { tid: req.ctx.tenantId, name: req.body.name, active: req.body.isActive ?? true });
  await auditTenant(req, 'expense_category.created', 'expense_category', r.ExpenseCategoryId, { name: req.body.name });
  res.status(201).json({ data: { id: r.ExpenseCategoryId } });
}));

router.put('/categories/:id', requirePermission('expenses.write'), validate(categorySchema), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const n = await db.exec('UPDATE hms.ExpenseCategories SET Name = @name, IsActive = @active WHERE TenantId = @tid AND ExpenseCategoryId = @id',
    { tid: req.ctx.tenantId, id, name: req.body.name, active: req.body.isActive ?? true });
  if (!n) throw notFound('Category not found.');
  await auditTenant(req, 'expense_category.updated', 'expense_category', id);
  res.json({ data: { ok: true } });
}));

router.delete('/categories/:id', requirePermission('expenses.write'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const used = await db.one('SELECT COUNT(*) AS n FROM hms.Expenses WHERE TenantId = @tid AND ExpenseCategoryId = @id', { tid: req.ctx.tenantId, id });
  if (used.n) throw conflict('This category has expenses. Mark it inactive instead.', 'IN_USE');
  const n = await db.exec('DELETE FROM hms.ExpenseCategories WHERE TenantId = @tid AND ExpenseCategoryId = @id', { tid: req.ctx.tenantId, id });
  if (!n) throw notFound('Category not found.');
  await auditTenant(req, 'expense_category.deleted', 'expense_category', id);
  res.json({ data: { ok: true } });
}));

// ---------- Expenses ----------
router.get('/', requirePermission('expenses.read'), asyncHandler(async (req, res) => {
  const lq = parseListQuery(req.query, { date: 'e.ExpenseDate', amount: 'e.Amount' }, 'date');
  const params = {
    tid: req.ctx.tenantId, offset: lq.offset, size: lq.pageSize, q: like(req.query.q),
    from: isDate(req.query.from) ? req.query.from : null, to: isDate(req.query.to) ? req.query.to : null,
    cat: req.query.categoryId ? idParam(req.query.categoryId, 'categoryId') : null,
    method: ['cash', 'card', 'upi', 'bank', 'other'].includes(req.query.method) ? req.query.method : null,
  };
  const from = `FROM hms.Expenses e
    JOIN hms.ExpenseCategories c ON c.TenantId = e.TenantId AND c.ExpenseCategoryId = e.ExpenseCategoryId
    LEFT JOIN hms.Users u ON u.TenantId = e.TenantId AND u.UserId = e.CreatedByUserId`;
  const where = `WHERE e.TenantId = @tid AND (@from IS NULL OR e.ExpenseDate >= @from) AND (@to IS NULL OR e.ExpenseDate <= @to)
    AND (@cat IS NULL OR e.ExpenseCategoryId = @cat) AND (@method IS NULL OR e.Method = @method)
    AND (@q IS NULL OR e.ExpenseNumber LIKE @q OR e.PaidTo LIKE @q OR e.Reference LIKE @q OR e.Notes LIKE @q)`;
  const [rows, totals] = await db.many(`
    SELECT e.ExpenseId AS id, e.ExpenseNumber AS number, CONVERT(CHAR(10), e.ExpenseDate, 23) AS expenseDate, e.ExpenseCategoryId AS categoryId, c.Name AS category,
           e.Amount AS amount, e.Method AS method, e.PaidTo AS paidTo, e.Reference AS reference, e.Notes AS notes, e.CreatedAt AS createdAt, u.FullName AS createdBy
    ${from} ${where} ORDER BY ${lq.orderBy}, e.ExpenseId DESC OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY;
    SELECT COUNT(*) AS total, ISNULL(SUM(e.Amount), 0) AS amount ${from} ${where};`, params);
  res.json({ data: rows, meta: { ...pageMeta(lq, totals[0].total), totalAmount: totals[0].amount } });
}));

const expenseSchema = z.object({
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date'), categoryId: z.coerce.number().int().positive({ message: 'Choose a category' }),
  amount: z.coerce.number().positive('Amount must be more than 0').max(1e9),
  method: z.enum(['cash', 'card', 'upi', 'bank', 'other']),
  paidTo: z.string().trim().max(150).nullable().optional(), reference: z.string().trim().max(100).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
}).strict();

async function checkExpense(tx, req) {
  const b = req.body;
  if (b.expenseDate > localDateString(req.ctx.timezone)) throw badRequest('Expense date cannot be in the future.');
  const cat = await tx.one('SELECT 1 AS ok FROM hms.ExpenseCategories WHERE TenantId = @tid AND ExpenseCategoryId = @id', { tid: req.ctx.tenantId, id: b.categoryId });
  if (!cat) throw badRequest('Category not found.');
  return {
    date: b.expenseDate, cat: b.categoryId, amount: t.money(Number(b.amount).toFixed(2)), method: b.method,
    paidTo: b.paidTo || null, ref: b.reference || null, notes: b.notes || null,
  };
}

router.post('/', requirePermission('expenses.write'), validate(expenseSchema), asyncHandler(async (req, res) => {
  const out = await withTransaction(async (tx) => {
    const p = await checkExpense(tx, req);
    const number = formatNumber('EXP', await nextSequence(tx, req.ctx.tenantId, 'expense'));
    const r = await tx.one(`INSERT INTO hms.Expenses (TenantId, ExpenseNumber, ExpenseDate, ExpenseCategoryId, Amount, Method, PaidTo, Reference, Notes, CreatedByUserId)
                            OUTPUT INSERTED.ExpenseId VALUES (@tid, @number, CAST(@date AS DATE), @cat, @amount, @method, @paidTo, @ref, @notes, @uid)`,
    { tid: req.ctx.tenantId, number, uid: req.ctx.userId, ...p });
    await auditTenant(req, 'expense.created', 'expense', r.ExpenseId, { number, amount: req.body.amount }, tx);
    return { id: r.ExpenseId, number };
  });
  res.status(201).json({ data: out });
}));

router.put('/:id', requirePermission('expenses.write'), validate(expenseSchema), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  await withTransaction(async (tx) => {
    const p = await checkExpense(tx, req);
    const n = await tx.exec(`UPDATE hms.Expenses SET ExpenseDate = CAST(@date AS DATE), ExpenseCategoryId = @cat, Amount = @amount, Method = @method, PaidTo = @paidTo,
                               Reference = @ref, Notes = @notes, UpdatedAt = SYSUTCDATETIME() WHERE TenantId = @tid AND ExpenseId = @id`, { tid: req.ctx.tenantId, id, ...p });
    if (!n) throw notFound('Expense not found.');
    await auditTenant(req, 'expense.updated', 'expense', id, { amount: req.body.amount }, tx);
  });
  res.json({ data: { ok: true } });
}));

router.delete('/:id', requirePermission('expenses.write'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  await withTransaction(async (tx) => {
    const e = await tx.one('SELECT ExpenseNumber, Amount FROM hms.Expenses WHERE TenantId = @tid AND ExpenseId = @id', { tid: req.ctx.tenantId, id });
    if (!e) throw notFound('Expense not found.');
    await tx.exec('DELETE FROM hms.Expenses WHERE TenantId = @tid AND ExpenseId = @id', { tid: req.ctx.tenantId, id });
    await auditTenant(req, 'expense.deleted', 'expense', id, { number: e.ExpenseNumber, amount: e.Amount }, tx);
  });
  res.json({ data: { ok: true } });
}));

export default router;
