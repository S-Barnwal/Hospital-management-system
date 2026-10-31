// Lab master data rules (chunk 2): dropdown options, result checking by input type, decimals, report order, CSV import.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { packOptions, unpackOptions, checkResult, formatResult, panelComplete, reportOrder, checkImportRows } from '../../src/modules/clinical/labMaster.logic.js';

describe('dropdown options', () => {
  test('pack / unpack, trims and drops blanks', () => {
    assert.equal(packOptions([' Positive', 'Negative ', '']), 'Positive|Negative');
    assert.deepEqual(unpackOptions('Positive|Negative'), ['Positive', 'Negative']);
    assert.equal(packOptions([]), null);
    assert.equal(packOptions(null), null);
  });
  test('refuses separators, duplicates and too many', () => {
    assert.throws(() => packOptions(['A|B']), /cannot contain/);
    assert.throws(() => packOptions(['Reactive', 'reactive']), /twice/);
    assert.throws(() => packOptions(Array.from({ length: 31 }, (_, i) => `o${i}`)), /At most/);
  });
});

describe('result checking', () => {
  const opt = { inputType: 'option', options: 'Positive|Negative' };
  test('option results must be one of the choices and take the configured spelling', () => {
    assert.deepEqual(checkResult(opt, 'positive'), { value: 'Positive', numeric: null });
    assert.match(checkResult(opt, 'Maybe').error, /Choose one of: Positive, Negative/);
    assert.deepEqual(checkResult(opt, ''), { value: null, numeric: null });
  });
  test('numeric accepts lab notations but only plain numbers become numeric', () => {
    assert.deepEqual(checkResult({ inputType: 'numeric' }, '12.5'), { value: '12.5', numeric: 12.5 });
    assert.deepEqual(checkResult({ inputType: 'numeric' }, '<0.5'), { value: '<0.5', numeric: null });
    assert.deepEqual(checkResult({}, '7'), { value: '7', numeric: 7 }, 'legacy rows without a type behave as numeric');
  });
  test('text is free, headings never take values', () => {
    assert.deepEqual(checkResult({ inputType: 'text' }, ' Pale yellow '), { value: 'Pale yellow', numeric: null });
    assert.match(checkResult({ isHeading: true }, '5').error, /Heading/);
    assert.deepEqual(checkResult({ isHeading: true }, ''), { value: null, numeric: null });
  });
  test('decimals only change how plain numbers are shown', () => {
    assert.equal(formatResult('12.5', 2), '12.50');
    assert.equal(formatResult('12.456', 1), '12.5');
    assert.equal(formatResult('<0.5', 2), '<0.5');
    assert.equal(formatResult('9', null), '9');
  });
  test('panel completeness ignores heading rows', () => {
    assert.ok(panelComplete([{ isHeading: true, value: null }, { value: '5' }]));
    assert.ok(!panelComplete([{ value: '5' }, { value: '' }]));
  });
});

test('report order: department order, then name, package, entry order', () => {
  const rows = [
    { id: 3, department: 'Biochemistry', departmentSort: 20 },
    { id: 1, department: 'Haematology', departmentSort: 10 },
    { id: 4, department: null, departmentSort: null },
    { id: 2, department: 'Biochemistry', departmentSort: 20, packageName: 'Full body' },
  ];
  assert.deepEqual([...rows].sort(reportOrder).map((r) => r.id), [1, 3, 2, 4]);
});

describe('CSV import rows', () => {
  test('valid rows are normalised', () => {
    const { rows, errors } = checkImportRows([{ code: 'hb', name: 'Haemoglobin', department: 'Haematology', unit: 'g/dL', reflow: '13', refhigh: '17', price: '150', decimals: '1' }]);
    assert.deepEqual(errors, []);
    assert.equal(rows[0].code, 'HB');
    assert.equal(rows[0].refLow, 13);
    assert.equal(rows[0].inputType, 'numeric');
    assert.equal(rows[0].decimals, 1);
  });
  test('every problem is reported with its line number', () => {
    const { rows, errors } = checkImportRows([
      { code: 'OK1', name: 'Fine test' },
      { code: 'bad code!', name: 'X' },
      { code: 'OK1', name: 'Duplicate' },
      { code: 'HIV', name: 'HIV screen', inputtype: 'option' },
      { code: 'RNG', name: 'Range', reflow: '10', refhigh: '5', price: 'abc' },
    ]);
    assert.equal(rows.length, 1);
    assert.deepEqual(errors.map((e) => e.line), [3, 4, 5, 6]);
    assert.match(errors[0].message, /code must be/);
    assert.match(errors[1].message, /appears twice/);
    assert.match(errors[2].message, /need options/);
    assert.match(errors[3].message, /refHigh must be|price must be a number/);
  });
  test('options can be separated by | or ;', () => {
    const { rows } = checkImportRows([{ code: 'HBSAG', name: 'HBsAg', inputtype: 'option', options: 'Reactive;Non-reactive' }]);
    assert.equal(rows[0].options, 'Reactive|Non-reactive');
  });
});
