import assert from 'node:assert/strict';

import { displayFormatForPrimitive } from './imports/importPlan';
import {
  fieldSortValue,
  fieldValueToInput,
  formatFieldValue,
  friendlyFieldError,
  type FieldDef,
} from './projectFields';

// The bug this file exists for: a Year column rendered "2,025".
//
// It was not a parser failure — spreadsheetMapping classifies `year` correctly
// at 0.9 confidence. It was that `fieldTypeForPrimitive` collapses year AND
// money to the storage type `number`, after which nothing downstream could tell
// them apart, and a number deserves thousands separators. So the two halves
// checked here are: the parser's primitive survives into a display format, and
// the formatter honours it.

const def = (data_type: FieldDef['data_type'], format: FieldDef['format'] = null): FieldDef => ({ data_type, format });

// ── the collapse that caused it, and the hint that survives it ──────────────
assert.equal(displayFormatForPrimitive('year'), 'year');
assert.equal(displayFormatForPrimitive('money'), 'money');
assert.equal(displayFormatForPrimitive('freetext'), null, 'only numeric primitives carry a display format');
assert.equal(displayFormatForPrimitive('date'), null, 'a date formats from its own data_type, not a hint');

// ── the actual regression ──────────────────────────────────────────────────
assert.equal(formatFieldValue(def('number', 'year'), 2025), '2025', 'THE bug: a year must never be group-separated');
assert.equal(formatFieldValue(def('number', 'year'), 2026), '2026');
assert.equal(formatFieldValue(def('number', 'money'), 4500), (4500).toLocaleString(), 'a fee still groups');
assert.equal(formatFieldValue(def('number'), 1500), (1500).toLocaleString(), 'an unhinted number still groups');
// A year is an integer label; a stray decimal from a spreadsheet must not
// render as "2025.5" in a column headed Year.
assert.equal(formatFieldValue(def('number', 'year'), 2025.4), '2025');
assert.equal(formatFieldValue(def('number', 'percent'), 12), '12%');

// ── everything the split must not have broken ──────────────────────────────
assert.equal(formatFieldValue(def('text'), null), '—');
assert.equal(formatFieldValue(def('text'), undefined), '—');
assert.equal(formatFieldValue(def('text'), ''), '—', 'an empty string is empty, not a blank cell with a value');
assert.equal(formatFieldValue(def('boolean'), true), 'Yes');
assert.equal(formatFieldValue(def('boolean'), false), 'No');
assert.equal(formatFieldValue(def('date'), '2026-01-11'), '11/01/2026', 'day-first, and NOT via new Date()');
assert.equal(formatFieldValue(def('date'), 'not-a-date'), 'not-a-date', 'unparseable passes through rather than throwing');
assert.equal(formatFieldValue(def('number'), 'abc' as any), 'abc', 'a non-numeric in a number column is shown, not NaN');

// Round-trip: what the inline editor puts in the input must parse back to the
// same value, and must NOT carry the separators the display adds — otherwise
// editing a fee and pressing Enter would re-save "4,500" as text.
assert.equal(fieldValueToInput(def('number'), 4500), '4500');
assert.equal(fieldValueToInput(def('number', 'year'), 2025), '2025');
assert.equal(fieldValueToInput(def('boolean'), true), 'true');
assert.equal(fieldValueToInput(def('boolean'), false), 'false');
assert.equal(fieldValueToInput(def('text'), null), '');
assert.equal(fieldValueToInput(def('date'), '2026-01-11'), '2026-01-11', 'the input round-trips ISO, not the display form');

// ── sorting is on the value, never on the rendered string ──────────────────
assert.equal(fieldSortValue(def('number', 'year'), 2025), 2025);
assert.equal(fieldSortValue(def('number'), null), -Infinity, 'empty numbers sort together at one end');
assert.equal(fieldSortValue(def('text'), 'Beta'), 'beta');
assert.equal(fieldSortValue(def('boolean'), true), 1);
assert.ok(
  fieldSortValue(def('number'), 10000) > fieldSortValue(def('number'), 9999),
  'sorting must not go through toLocaleString — "10,000" < "9,999" as text',
);

// ── error copy ─────────────────────────────────────────────────────────────
assert.match(friendlyFieldError('duplicate key value violates ...'), /already uses that key/);
assert.match(friendlyFieldError('Insufficient permissions to manage project fields.'), /do not have permission/);
assert.equal(
  friendlyFieldError('Cannot change custom field "year" from number to text while it has values. Delete the values first.'),
  'Cannot change custom field "year" from number to text while it has values. Delete the values first.',
  'the RPC already writes a readable sentence for the rules that bite — do not wrap it',
);
assert.match(friendlyFieldError(null), /Could not save/);

console.log('projectFields: all assertions passed (year renders bare, money and plain still group)');
