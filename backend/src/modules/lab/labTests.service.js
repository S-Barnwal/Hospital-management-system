// Lab test catalogue writes shared by the test form (lab.routes.js) and the CSV import (labMaster.routes.js).
// Every statement is scoped by the caller's tenant; a department id from another hospital is refused.
import { z } from 'zod';
import { badRequest, notFound } from '../../utils/errors.js';
import { t } from '../../db/pool.js';
import { packOptions } from '../clinical/labMaster.logic.js';

const nullableNum = z.union([z.literal('').transform(() => null), z.null(), z.coerce.number()]).optional();
const optText = (max) => z.string().trim().max(max).nullable().optional();
const price = z.coerce.number().min(0).max(1e7);

/** Appends a row to the price timeline. */
export async function recordPrice(tx, ctx, type, itemId, value, reason) {
  await tx.exec(`INSERT INTO hms.LabPriceHistory (TenantId, ItemType, ItemId, Price, Reason, ChangedByUserId) VALUES (@tid, @type, @id, @price, @reason, @uid)`,
    { tid: ctx.tenantId, type, id: itemId, price: t.money(Number(value).toFixed(2)), reason: String(reason).slice(0, 200), uid: ctx.userId });
}

const optionList = z.array(z.string().max(60)).max(30).optional().nullable();
const smallInt = (max) => z.union([z.literal('').transform(() => null), z.null(), z.coerce.number().int().min(0).max(max)]).optional();
export const testSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,20}$/, 'Use letters, numbers, - or _ (max 20)'), name: z.string().trim().min(2).max(150),
  departmentId: z.coerce.number().int().positive().nullable().optional(), department: optText(60), description: optText(500),
  sampleType: optText(40), unit: optText(30), refLow: nullableNum, refHigh: nullableNum, refText: optText(100),
  price, isActive: z.boolean().optional(), priceReason: z.string().trim().max(200).optional(),
  method: optText(150), instrument: optText(150), interpretation: optText(2000),
  inputType: z.enum(['numeric', 'text', 'option']).default('numeric'), options: optionList,
  decimals: smallInt(6), tatHours: z.union([z.literal('').transform(() => null), z.null(), z.coerce.number().int().min(1).max(2160)]).optional(), sortOrder: smallInt(9999),
}).strict()
  .refine((v) => v.refLow == null || v.refHigh == null || v.refHigh >= v.refLow, { message: 'High limit must be ≥ low limit', path: ['refHigh'] })
  .transform((v, ctx) => {
    try {
      const options = packOptions(v.options ?? []);
      if (v.inputType === 'option' && !options) { ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'Add the choices for a dropdown result.' }); return z.NEVER; }
      return { ...v, options: v.inputType === 'option' ? options : null };
    } catch (e) { ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: e.message }); return z.NEVER; }
  });

/** The department must be one of THIS hospital's active departments; its name is also kept in the old text column. */
async function resolveDepartment(runner, tenantId, b) {
  if (b.departmentId) {
    const d = await runner.one('SELECT Name FROM hms.LabDepartments WHERE TenantId = @tid AND LabDepartmentId = @id AND IsActive = 1', { tid: tenantId, id: b.departmentId });
    if (!d) throw badRequest('Department not found.');
    return { deptId: b.departmentId, dept: d.Name };
  }
  if (b.department) {
    const d = await runner.one('SELECT LabDepartmentId FROM hms.LabDepartments WHERE TenantId = @tid AND Name = @n AND IsActive = 1', { tid: tenantId, n: b.department });
    if (!d) throw badRequest(`Department “${b.department}” not found. Add it under Departments first.`);
    return { deptId: d.LabDepartmentId, dept: b.department };
  }
  return { deptId: null, dept: null };
}

const testParams = (b) => ({
  code: b.code, name: b.name, descr: b.description || null, st: b.sampleType || null, unit: b.unit || null,
  lo: b.refLow == null ? null : t.dec(b.refLow, 12, 4), hi: b.refHigh == null ? null : t.dec(b.refHigh, 12, 4), txt: b.refText || null,
  price: t.money(Number(b.price).toFixed(2)), active: b.isActive ?? true,
  method: b.method || null, instr: b.instrument || null, interp: b.interpretation || null, itype: b.inputType, opts: b.options ?? null,
  decimals: b.decimals ?? null, tat: b.tatHours ?? null, sort: b.sortOrder ?? null,
});

export async function insertLabTest(tx, ctx, body) {
  const d = await resolveDepartment(tx, ctx.tenantId, body);
  const r = await tx.one(`INSERT INTO hms.LabTests (TenantId, Code, Name, Department, DepartmentId, Description, SampleType, Unit, RefLow, RefHigh, RefText, Price, IsActive,
                            Method, Instrument, Interpretation, InputType, Options, Decimals, TatHours, SortOrder)
                          OUTPUT INSERTED.LabTestId VALUES (@tid, @code, @name, @dept, @deptId, @descr, @st, @unit, @lo, @hi, @txt, @price, @active,
                            @method, @instr, @interp, @itype, @opts, @decimals, @tat, @sort)`,
  { tid: ctx.tenantId, ...testParams(body), ...d });
  await recordPrice(tx, ctx, 'test', r.LabTestId, body.price, 'Initial price');
  return r.LabTestId;
}

export async function updateLabTest(tx, ctx, id, body) {
  const old = await tx.one('SELECT Price FROM hms.LabTests WITH (UPDLOCK) WHERE TenantId = @tid AND LabTestId = @id', { tid: ctx.tenantId, id });
  if (!old) throw notFound('Test not found.');
  const d = await resolveDepartment(tx, ctx.tenantId, body);
  await tx.exec(`UPDATE hms.LabTests SET Code = @code, Name = @name, Department = @dept, DepartmentId = @deptId, Description = @descr, SampleType = @st, Unit = @unit,
                   RefLow = @lo, RefHigh = @hi, RefText = @txt, Price = @price, IsActive = @active, Method = @method, Instrument = @instr,
                   Interpretation = @interp, InputType = @itype, Options = @opts, Decimals = @decimals, TatHours = @tat, SortOrder = @sort
                 WHERE TenantId = @tid AND LabTestId = @id`,
  { tid: ctx.tenantId, id, ...testParams(body), ...d });
  if (Number(old.Price).toFixed(2) !== Number(body.price).toFixed(2)) {
    await recordPrice(tx, ctx, 'test', id, body.price, body.priceReason || 'Updated in test catalogue');
  }
}
