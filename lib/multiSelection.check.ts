// Self-check for lib/multiSelection.ts — run: npx tsx lib/multiSelection.check.ts

import assert from 'node:assert';

import {
  addOrRemoveSelection,
  pruneSelection,
  reconcileMutationSelection,
  selectAllVisible,
  selectRange,
} from './multiSelection';

assert.deepStrictEqual(addOrRemoveSelection(['a', 'b'], 'b'), ['a']);
assert.deepStrictEqual(addOrRemoveSelection(['a'], 'c'), ['a', 'c']);

assert.deepStrictEqual(selectAllVisible(['outside'], ['a', 'b']), ['outside', 'a', 'b']);
assert.deepStrictEqual(selectAllVisible(['outside', 'a', 'b'], ['a', 'b']), ['outside']);
assert.deepStrictEqual(selectAllVisible(['outside', 'a'], ['a', 'a', 'b']), ['outside', 'a', 'b']);

assert.deepStrictEqual(pruneSelection(['a', 'missing', 'b'], ['a', 'b']), ['a', 'b']);
assert.deepStrictEqual(pruneSelection(['a', 'b'], ['a']), ['a']);

assert.deepStrictEqual(selectRange(['a', 'b', 'c', 'd'], 'b', 'd'), ['b', 'c', 'd']);
assert.deepStrictEqual(selectRange(['a', 'b', 'c', 'd'], 'd', 'b'), ['b', 'c', 'd']);
assert.deepStrictEqual(selectRange(['a', 'b', 'c'], 'missing', 'c'), ['c']);

assert.deepStrictEqual(
  reconcileMutationSelection(['a', 'b', 'c'], ['a', 'c']),
  ['b'],
);
assert.deepStrictEqual(
  reconcileMutationSelection(['a', 'b'], ['outside']),
  ['a', 'b'],
  'unsuccessful or unreported IDs remain selected',
);

console.log('lib/multiSelection.check.ts: ALL CHECKS PASSED');
