// Lab reference ranges by age & gender and critical values (chunk 3). The numbers below are made-up test data, not
// clinical guidance — real ranges are entered by each hospital's lab.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ageOn, ageMatches, pickRange, rangeLabel, flagFor, panelFlagWithCritical, checkRanges, isCritical } from '../../src/modules/clinical/labRanges.logic.js';

describe('age', () => {
  test('completed days, months and years like a birthday', () => {
    assert.deepEqual(ageOn('2026-01-15', '2026-02-14'), { d: 30, m: 0, y: 0 });
    assert.deepEqual(ageOn('2026-01-15', '2026-02-15'), { d: 31, m: 1, y: 0 });
    assert.equal(ageOn('2008-11-02', '2026-11-01').y, 17, 'day before the 18th birthday');
    assert.equal(ageOn('2008-11-01', '2026-11-01').y, 18);
    assert.equal(ageOn(null), null);
    assert.equal(ageOn('2030-01-01', '2026-01-01'), null, 'future date of birth');
  });
  test('age bands are [from, to) in their own units; unknown age only matches all-ages bands', () => {
    const child = { ageFrom: 1, ageFromUnit: 'y', ageTo: 12, ageToUnit: 'y' };
    assert.ok(ageMatches(child, ageOn('2020-01-01', '2026-01-01')));
    assert.ok(!ageMatches(child, ageOn('2014-01-01', '2026-01-01')), '12 is outside [1, 12)');
    assert.ok(!ageMatches(child, null));
    assert.ok(ageMatches({ ageFrom: 0, ageTo: null }, null));
  });
});

describe('pickRange', () => {
  const R = [
    { id: 'any-adult', gender: 'any', ageFrom: 18, ageFromUnit: 'y', ageTo: null },
    { id: 'male-adult', gender: 'male', ageFrom: 18, ageFromUnit: 'y', ageTo: null },
    { id: 'female-adult', gender: 'female', ageFrom: 18, ageFromUnit: 'y', ageTo: null },
    { id: 'child', gender: 'any', ageFrom: 1, ageFromUnit: 'y', ageTo: 18, ageToUnit: 'y' },
    { id: 'newborn', gender: 'any', ageFrom: 0, ageTo: 30, ageToUnit: 'd' },
    { id: 'infant', gender: 'any', ageFrom: 0, ageTo: 1, ageToUnit: 'y' },
  ];
  const on = '2026-11-01';
  const pick = (dob, gender) => pickRange(R, { gender, age: ageOn(dob, on) })?.id ?? null;
  test('newborn → narrowest band wins over infant', () => assert.equal(pick('2026-10-20', 'female'), 'newborn'));
  test('infant', () => assert.equal(pick('2026-05-01', 'male'), 'infant'));
  test('child', () => assert.equal(pick('2019-06-01', 'female'), 'child'));
  test('adult female / male prefer their own range', () => {
    assert.equal(pick('1990-01-01', 'female'), 'female-adult');
    assert.equal(pick('1990-01-01', 'male'), 'male-adult');
  });
  test('other / unknown gender falls back to the all-gender range', () => {
    assert.equal(pick('1990-01-01', 'other'), 'any-adult');
    assert.equal(pick('1990-01-01', null), 'any-adult');
  });
  test('no match (no date of birth) → null, the default range stays', () => assert.equal(pick(null, 'male'), null));
  test('labels', () => {
    assert.equal(rangeLabel(R[2]), 'Female · 18 y +');
    assert.equal(rangeLabel(R[4]), 'All · up to 30 d');
    assert.equal(rangeLabel(R[3]), 'All · 1 y – 18 y');
  });
});

describe('flags', () => {
  const lim = { refLow: 3.5, refHigh: 5.1, criticalLow: 2.5, criticalHigh: 6.5 };
  test('critical beyond the critical limits, low/high outside normal', () => {
    assert.equal(flagFor('2.4', lim), 'crit_low');
    assert.equal(flagFor('2.5', lim), 'low', 'at the critical limit is not critical');
    assert.equal(flagFor('4', lim), 'normal');
    assert.equal(flagFor('5.2', lim), 'high');
    assert.equal(flagFor('7', lim), 'crit_high');
    assert.equal(flagFor('<0.5', lim), null, 'not a plain number');
    assert.equal(flagFor('3', {}), null, 'no limits');
    assert.equal(flagFor('9', { criticalHigh: 8 }), 'crit_high', 'critical limits without a normal range');
    assert.ok(isCritical('crit_low') && !isCritical('low'));
  });
  test('panel summary: critical beats abnormal beats normal', () => {
    assert.equal(panelFlagWithCritical(['normal', 'high', 'crit_low']), 'crit_low');
    assert.equal(panelFlagWithCritical(['crit_low', 'crit_high']), 'crit_high');
    assert.equal(panelFlagWithCritical(['normal', 'low']), 'abnormal');
    assert.equal(panelFlagWithCritical(['normal', null]), 'normal');
    assert.equal(panelFlagWithCritical([null]), null);
  });
});

describe('checkRanges', () => {
  test('valid rows are normalised', () => {
    const { ranges, errors } = checkRanges([{ gender: 'Female', ageFrom: '18', ageFromUnit: 'y', refLow: '12', refHigh: '15', criticalLow: '7' }]);
    assert.deepEqual(errors, []);
    assert.equal(ranges[0].gender, 'female');
    assert.equal(ranges[0].ageTo, null);
    assert.equal(ranges[0].criticalLow, 7);
  });
  test('problems are reported per row', () => {
    const { errors } = checkRanges([
      { gender: 'x', refLow: 1 },
      { ageFrom: 10, ageTo: 5, refLow: 1 },
      { refLow: 5, refHigh: 1 },
      { refLow: 3, refHigh: 5, criticalLow: 4 },
      {},
      { parameterId: 99, refLow: 1 },
    ], { parameterIds: [1] });
    assert.deepEqual(errors.map((e) => e.index), [0, 1, 2, 3, 4, 5]);
    assert.match(errors[3].message, /critical low/);
  });
  test('overlapping bands for the same gender and parameter are refused; different genders may overlap', () => {
    const base = { refLow: 1, refHigh: 2 };
    assert.equal(checkRanges([{ ...base, ageFrom: 0, ageTo: 18 }, { ...base, ageFrom: 12, ageTo: null }]).errors.length, 1);
    assert.equal(checkRanges([{ ...base, ageFrom: 0, ageTo: 18 }, { ...base, ageFrom: 18 }]).errors.length, 0, 'touching bands are fine');
    assert.equal(checkRanges([{ ...base, gender: 'male' }, { ...base, gender: 'female' }, { ...base, gender: 'any' }]).errors.length, 0);
    assert.equal(checkRanges([{ ...base, ageTo: 30, ageToUnit: 'd' }, { ...base, ageFrom: 1, ageFromUnit: 'm', ageTo: 1, ageToUnit: 'y' }]).errors.length, 0);
    assert.equal(checkRanges([{ ...base }, { ...base, parameterId: 1 }], { parameterIds: [1] }).errors.length, 0, 'test vs parameter are separate');
  });
});
