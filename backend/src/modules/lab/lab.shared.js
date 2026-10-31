// Shared by lab routes, the printable report and the patient report link.

/** Parameter rows of every panel test on one order (@tid, @id = LabOrderId). */
export const PARAMS_SQL = `SELECT v.ResultValueId AS id, v.LabOrderItemId AS itemId, v.Name AS name, v.Unit AS unit, v.RefLow AS refLow, v.RefHigh AS refHigh,
           v.RefText AS refText, v.ResultValue AS resultValue, v.Flag AS flag, v.SortOrder AS sortOrder
    FROM hms.LabResultValues v JOIN hms.LabOrderItems i ON i.TenantId = v.TenantId AND i.LabOrderItemId = v.LabOrderItemId
    WHERE v.TenantId = @tid AND i.LabOrderId = @id ORDER BY v.LabOrderItemId, v.SortOrder, v.ResultValueId;`;
/** Puts each panel's parameters under its order line (`parameters: []` for single-value tests). */
export const attachParameters = (items, params) => items.map((i) => ({ ...i, parameters: params.filter((p) => Number(p.itemId) === Number(i.id)).map(({ itemId, ...p }) => p) }));
