// Shared by lab routes, the printable report and the patient report link.
import { reportOrder, unpackOptions } from '../clinical/labMaster.logic.js';

/** Parameter rows of every panel test on one order (@tid, @id = LabOrderId). */
export const PARAMS_SQL = `SELECT v.ResultValueId AS id, v.LabOrderItemId AS itemId, v.Name AS name, v.Unit AS unit, v.RefLow AS refLow, v.RefHigh AS refHigh,
           v.RefText AS refText, v.ResultValue AS resultValue, v.Flag AS flag, v.SortOrder AS sortOrder,
           ISNULL(v.InputType, 'numeric') AS inputType, v.Options AS options, v.Decimals AS decimals, v.IsHeading AS isHeading
    FROM hms.LabResultValues v JOIN hms.LabOrderItems i ON i.TenantId = v.TenantId AND i.LabOrderItemId = v.LabOrderItemId
    WHERE v.TenantId = @tid AND i.LabOrderId = @id ORDER BY v.LabOrderItemId, v.SortOrder, v.ResultValueId;`;

/**
 * Order lines (@tid, @id). Department, method, interpretation, input type, options and decimals come from the snapshot
 * taken when the order was placed (older orders fall back to the test's current department text).
 */
export const itemsSql = ({ withPrice = true } = {}) => `SELECT i.LabOrderItemId AS id, i.TestName AS testName, i.Unit AS unit, i.RefLow AS refLow,
           i.RefHigh AS refHigh, i.RefText AS refText, ${withPrice ? 'i.Price AS price, i.EnteredAt AS enteredAt, ' : ''}i.ResultValue AS resultValue, i.Flag AS flag,
           i.PackageName AS packageName, ISNULL(i.DepartmentName, lt.Department) AS department, i.DepartmentSort AS departmentSort, lt.SampleType AS sampleType,
           i.Method AS method, i.Instrument AS instrument, i.Interpretation AS interpretation, ISNULL(i.InputType, 'numeric') AS inputType,
           i.Options AS options, i.Decimals AS decimals
    FROM hms.LabOrderItems i LEFT JOIN hms.LabTests lt ON lt.TenantId = i.TenantId AND lt.LabTestId = i.LabTestId
    WHERE i.TenantId = @tid AND i.LabOrderId = @id;`;

/** Puts each panel's parameters under its order line (`parameters: []` for single-value tests), in report order. */
export const attachParameters = (items, params) => [...items].sort(reportOrder).map((i) => ({
  ...i,
  options: unpackOptions(i.options),
  parameters: params.filter((p) => Number(p.itemId) === Number(i.id)).map(({ itemId, ...p }) => ({ ...p, options: unpackOptions(p.options), isHeading: Boolean(p.isHeading) })),
}));
