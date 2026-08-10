// Self-check for lib/multiViewList.ts — run: npx tsx lib/multiViewList.check.ts
// No framework (ponytail, mirrors lib/imports/spreadsheetIntake.check.ts):
// plain asserts against the two branchy bits — mode validation/fallback and
// the column-count clamp math — the parts most likely to silently regress.

import assert from 'node:assert';
import { ALL_MULTIVIEW_MODES, clampMode, computeColumns, isMultiViewMode } from './multiViewList';

// ── isMultiViewMode ─────────────────────────────────────────────────────
assert.strictEqual(isMultiViewMode('large'), true);
assert.strictEqual(isMultiViewMode('medium'), true);
assert.strictEqual(isMultiViewMode('list'), true);
assert.strictEqual(isMultiViewMode('details'), true);
assert.strictEqual(isMultiViewMode('grid'), false, 'a renamed/removed mode string must not validate');
assert.strictEqual(isMultiViewMode(null), false, 'null (nothing ever stored) must not validate');
assert.strictEqual(isMultiViewMode(42), false, 'a non-string must not validate');

// ── clampMode ────────────────────────────────────────────────────────────
assert.strictEqual(
  clampMode('details', ALL_MULTIVIEW_MODES), 'details',
  'a mode already in the allowed set passes through unchanged',
);
assert.strictEqual(
  clampMode('details', ['large', 'list']), 'large',
  "a persisted mode outside this caller's allowed set falls back to the first allowed one",
);
assert.strictEqual(
  clampMode('large', []), 'list',
  'an empty allowed list still returns something renderable rather than throwing',
);

// ── computeColumns ───────────────────────────────────────────────────────
assert.strictEqual(computeColumns(1000, 260, 4), 3, '1000/260 floors to 3, under the max of 4');
assert.strictEqual(computeColumns(1200, 260, 4), 4, 'clamped at maxColumns even though 1200/260 = 4.6');
assert.strictEqual(computeColumns(200, 260, 4), 1, 'never fewer than 1 column, even narrower than one card');
assert.strictEqual(computeColumns(0, 260, 4), 1, 'a not-yet-measured (0) width must not divide-by-zero or return 0');
assert.strictEqual(computeColumns(-10, 260, 4), 1, 'a negative width is treated the same as unmeasured');
assert.strictEqual(computeColumns(900, 0, 4), 1, 'a zero minCardWidth must not divide-by-zero');

console.log('lib/multiViewList.check.ts: ALL CHECKS PASSED');
