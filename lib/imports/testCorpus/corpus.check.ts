// Ratchet for the multi-industry corpus benchmark (plan §18.7).
// Run: npx tsx lib/imports/testCorpus/corpus.check.ts — also picked up by `npm run check`.
//
// The numbers below are the classifier's MEASURED score on 2026-08-02, not
// targets and not a pass mark. 92/128 primitives and 5/11 entity names is a bad
// score; it is recorded here so that (a) it cannot silently get worse and (b)
// anyone who improves the classifier sees exactly how much they moved it.
//
// If you make the classifier better, this check tells you to RAISE the floor.
// If you make it worse, it tells you before the user does. Do not "fix" a
// failure here by editing the corpus — the corpus is the measurement.

import assert from 'node:assert';
import { CORPUS } from './corpus';
import { scoreCorpus, totalsOf } from './benchmark';

// ── the corpus itself must stay well-formed ─────────────────────────────────
assert.ok(CORPUS.length >= 8, `the corpus must cover at least 8 industries, has ${CORPUS.length}`);
assert.strictEqual(new Set(CORPUS.map(w => w.id)).size, CORPUS.length, 'workbook ids must be unique');
for (const w of CORPUS) {
  assert.strictEqual(
    w.columns.length, (w.aoa[w.headerRow] ?? []).length,
    `${w.id}: ground truth has ${w.columns.length} columns but the header row has ${(w.aoa[w.headerRow] ?? []).length}`,
  );
  if (w.nameColumn !== null) {
    assert.ok(w.columns[w.nameColumn], `${w.id}: nameColumn ${w.nameColumn} is out of range`);
  }
}
assert.ok(
  CORPUS.some(w => w.nameColumn === null),
  'the corpus must contain a sheet with NO entity name column — declining to name one is a required behaviour',
);

const results = scoreCorpus();
const t = totalsOf(results);

// ── the floor, as measured 2026-08-02 ───────────────────────────────────────
assert.strictEqual(t.files, 11, 'workbook count changed — re-measure the floor below before editing it');
assert.strictEqual(t.columns, 128, 'authored column count changed — re-measure the floor below before editing it');

assert.ok(t.primitivesOk >= 92, `primitives correct fell to ${t.primitivesOk}/128 (floor 92)`);
assert.ok(t.namesOk >= 5, `entity name correct fell to ${t.namesOk}/11 (floor 5)`);
assert.ok(t.dateWrong === 0, `a date column was read in the WRONG order (${t.dateWrong}) — silent per-row corruption`);
assert.ok(t.dropped <= 1, `columns silently dropped rose to ${t.dropped} (ceiling 1: the single-column sheet)`);
assert.ok(t.trapsCaught >= 2, `row-shape traps caught fell to ${t.trapsCaught} (floor 2)`);

// The two structural promises §18.5 makes are the ones that must never slip,
// so they are asserted as absolutes rather than as a floor.
for (const r of results) {
  if (r.fatal) continue; // the single-column sheet never reaches classification at all
  assert.strictEqual(
    r.dropped, 0,
    `${r.id}: ${r.dropped} column(s) neither mapped nor offered as a custom field (§18.5 #1)`,
  );
  assert.strictEqual(
    r.columnsGot, r.columnsExpected,
    `${r.id}: profiled ${r.columnsGot} columns, sheet has ${r.columnsExpected}`,
  );
}

console.log(
  `corpus.check.ts: all assertions passed — ${t.primitivesOk}/${t.columns} primitives, ` +
  `${t.namesOk}/${t.files} entity names, ${t.trapsCaught} of ${t.trapsCaught + t.trapsMissed} row traps caught. ` +
  `See docs/PROJECT_HIERARCHY_PLAN.md §18.7 for what the misses are.`,
);
