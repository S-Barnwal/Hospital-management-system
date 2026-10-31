// Reference ranges: loading a hospital's ranges and choosing the one for a patient when an order is placed.
// Every query is scoped by the caller's tenant id.
import { t } from '../../db/pool.js';
import { ageOn, pickRange, rangeLabel } from '../clinical/labRanges.logic.js';

const toRange = (r) => ({
  id: r.RangeId, testId: r.LabTestId, parameterId: r.ParameterId ?? null, gender: r.Gender, ageFrom: r.AgeFrom, ageFromUnit: r.AgeFromUnit,
  ageTo: r.AgeTo ?? null, ageToUnit: r.AgeToUnit, refLow: r.RefLow ?? null, refHigh: r.RefHigh ?? null, refText: r.RefText ?? null,
  criticalLow: r.CriticalLow ?? null, criticalHigh: r.CriticalHigh ?? null, sortOrder: r.SortOrder,
});

export const RANGE_COLUMNS = `RangeId, LabTestId, ParameterId, Gender, AgeFrom, AgeFromUnit, AgeTo, AgeToUnit, RefLow, RefHigh, RefText,
  CriticalLow, CriticalHigh, SortOrder`;

/** All ranges of the given tests of one hospital, as API objects. */
export async function loadRanges(runner, tenantId, testIds) {
  if (!testIds.length) return [];
  const rows = await runner.query(`SELECT ${RANGE_COLUMNS} FROM hms.LabReferenceRanges
                                   WHERE TenantId = @tid AND LabTestId IN (SELECT CAST(value AS INT) FROM STRING_SPLIT(@ids, ','))
                                   ORDER BY LabTestId, ParameterId, SortOrder, RangeId`, { tid: tenantId, ids: [...new Set(testIds)].join(',') });
  return rows.map(toRange);
}

/**
 * Returns a chooser for one patient: choose(testId, parameterId, defaults) → the limits to snapshot on the order.
 * defaults = the test/parameter's own RefLow/RefHigh/RefText/CriticalLow/CriticalHigh (used when no range matches).
 */
export function rangeChooser(ranges, patient, on = new Date()) {
  const age = ageOn(patient.dateOfBirth, on);
  return (testId, parameterId, d) => {
    const own = ranges.filter((r) => r.testId === Number(testId) && r.parameterId === (parameterId == null ? null : Number(parameterId)));
    const r = own.length ? pickRange(own, { gender: patient.gender, age }) : null;
    const pick = r ? r : { refLow: d.RefLow ?? null, refHigh: d.RefHigh ?? null, refText: d.RefText ?? null, criticalLow: d.CriticalLow ?? null, criticalHigh: d.CriticalHigh ?? null };
    const dec = (v) => (v == null ? null : t.dec(v, 12, 4));
    return { lo: dec(pick.refLow), hi: dec(pick.refHigh), txt: pick.refText ?? null, cl: dec(pick.criticalLow), ch: dec(pick.criticalHigh), label: r ? rangeLabel(r) : null };
  };
}
