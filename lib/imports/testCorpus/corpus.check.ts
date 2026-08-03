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
import { CORPUS_MESSY } from './corpusMessy';
import { scoreCorpus, totalsOf } from './benchmark';

const ALL = [...CORPUS, ...CORPUS_MESSY];

// ── the corpus itself must stay well-formed ─────────────────────────────────
assert.ok(CORPUS.length >= 8, `the corpus must cover at least 8 industries, has ${CORPUS.length}`);
assert.strictEqual(new Set(ALL.map(w => w.id)).size, ALL.length, 'workbook ids must be unique');
for (const w of ALL) {
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

// ── the floor on the ELEVEN, re-measured 2026-08-03 ─────────────────────────
// 92/128 and 5/11 were the 2026-08-02 numbers; the classifier fixes that
// followed took them to 127/128 and 10/11, and 9/12 traps became 12/12 when
// generate.ts was corrected to read with production's own `blankrows: true`.
assert.strictEqual(t.files, 11, 'workbook count changed — re-measure the floor below before editing it');
assert.strictEqual(t.columns, 128, 'authored column count changed — re-measure the floor below before editing it');

assert.ok(t.primitivesOk >= 127, `primitives correct fell to ${t.primitivesOk}/128 (floor 127)`);
assert.ok(t.namesOk >= 10, `entity name correct fell to ${t.namesOk}/11 (floor 10)`);
assert.ok(t.dateWrong === 0, `a date column was read in the WRONG order (${t.dateWrong}) — silent per-row corruption`);
assert.ok(t.dropped <= 1, `columns silently dropped rose to ${t.dropped} (ceiling 1: the single-column sheet)`);
assert.ok(t.trapsCaught >= 12, `row-shape traps caught fell to ${t.trapsCaught} (floor 12)`);
// The eleven were authored clean. An anomaly reported on any of them is a false
// positive, and a detector that cries wolf is worse than none — the user stops
// reading the one that matters. Asserted as ZERO, not as a ceiling.
assert.strictEqual(
  t.anomaliesSpurious, 0,
  `${t.anomaliesSpurious} §21 anomalies fired on the clean eleven — that is noise, not signal`,
);

// ── the floor on the FIVE messiness workbooks (plan §21.4), 2026-08-03 ──────
// Scored separately ON PURPOSE. Folded into one number, a gain here would hide
// a regression there, and the eleven are what every earlier measurement used.
{
  const m = totalsOf(scoreCorpus(CORPUS_MESSY));
  assert.strictEqual(m.files, 5, 'messiness workbook count changed — re-measure before editing the floor');
  assert.strictEqual(m.columns, 38, 'messiness column count changed — re-measure before editing the floor');
  assert.ok(m.primitivesOk >= 37, `messiness primitives fell to ${m.primitivesOk}/38 (floor 37)`);
  assert.ok(m.namesOk >= 4, `messiness entity names fell to ${m.namesOk}/5 (floor 4)`);
  assert.ok(m.dateWrong === 0, `a messiness date column was read in the WRONG order (${m.dateWrong})`);
  assert.ok(m.trapsCaught >= 4, `messiness row traps caught fell to ${m.trapsCaught} (floor 4)`);
  // The point of the whole exercise: every authored inconsistency is SURFACED,
  // and none is invented. Both directions, both absolutes.
  assert.strictEqual(m.anomaliesMissed, 0, `${m.anomaliesMissed} authored inconsistencies went unreported (§21.2)`);
  assert.strictEqual(m.anomaliesSpurious, 0, `${m.anomaliesSpurious} anomalies reported on columns authored clean`);
  assert.ok(m.anomaliesCaught >= 8, `anomalies surfaced fell to ${m.anomaliesCaught} (floor 8)`);
}

// The two structural promises §18.5 makes are the ones that must never slip,
// so they are asserted as absolutes rather than as a floor.
for (const r of [...results, ...scoreCorpus(CORPUS_MESSY)]) {
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
