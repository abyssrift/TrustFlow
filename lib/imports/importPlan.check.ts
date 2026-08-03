// Self-check for lib/imports/importPlan.ts — the decisions the confirmation
// step shows (plan §18.3/§18.5). Run: npx tsx lib/imports/importPlan.check.ts,
// also picked up by `npm run check`. Plain node:assert, no framework.
//
// Measured against the SAME anonymised engagement register the classifier
// check uses (./engagementRegister.fixture.ts) — §18.5 is explicit that this
// is judged on the real file's shape, not on a fixture written to pass.

import assert from 'node:assert';
import {
  profileColumns,
  proposeColumnMapping,
  classifyRowShapes,
  detectColumnRelations,
  parseMoneyCell,
  parseDateValue,
  type SheetCell,
} from './spreadsheetMapping';
import {
  buildColumnDecisions,
  customFieldPlans,
  distinctColumnValues,
  matchEnumValues,
  unresolvedEnumValues,
  summariseRowWarnings,
  addDays,
  isoDay,
  batchOffsetRange,
  resolveBatchStartDate,
  sampleProjectSchedule,
  batchSpan,
  detectSummaryRows,
  slugifyFieldKey,
  uniqueKey,
  fieldTypeForPrimitive,
  cellToFieldValue,
  type ExistingFieldDef,
} from './importPlan';
import { ENGAGEMENT_REGISTER, ENGAGEMENT_REGISTER_HEADER_ROW as HEADER } from './engagementRegister.fixture';

const profiles = profileColumns(ENGAGEMENT_REGISTER, HEADER);
const { mapping } = proposeColumnMapping(ENGAGEMENT_REGISTER[HEADER], ENGAGEMENT_REGISTER.slice(HEADER + 1));
const decisions = buildColumnDecisions(profiles, mapping, ENGAGEMENT_REGISTER, HEADER);

// ── 1. Every column has a decision, and NONE of them is "ignore" ────────────
// §18.5 #1 restated as a default rather than a promise: the user has to click
// to discard a column, and never has to click to keep one.
assert.strictEqual(decisions.length, 22, `expected 22 decisions, got ${decisions.length}`);
decisions.forEach((d, i) => {
  assert.strictEqual(d.index, i, `decisions must be index-aligned; slot ${i} holds column ${d.index}`);
  assert.notStrictEqual(d.target.kind, 'ignore', `column ${i} ("${d.profile.header}") defaulted to ignore`);
});
{
  const mapped = decisions.filter(d => d.target.kind === 'field').length;
  const custom = decisions.filter(d => d.target.kind === 'custom').length;
  assert.strictEqual(mapped + custom, 22, 'every column must be a concept or a custom field');
  // Two SOURCE columns are claimed by the four concepts on this file: column 1
  // ("Company Name") carries both `name` and `client_ref`, and column 19
  // ("Expected date") carries `start_date`. One column, two concepts, one
  // decision row — the UI has to say so rather than showing "Project Name" and
  // silently dropping the fact that it is also the client.
  assert.strictEqual(mapped, 2, `expected 2 concept-claimed columns, got ${mapped}`);
  assert.strictEqual(mapping.name, 1);
  assert.strictEqual(mapping.client_ref, 1);
  assert.strictEqual(mapping.start_date, 19);
  assert.strictEqual(
    decisions[1].target.kind === 'field' ? decisions[1].target.field : null, 'name',
    'the shared column reports the most specific concept first',
  );
}

// ── 2. The regression guard, at the decision layer ──────────────────────────
// "Company Name" is the project name; "Name of focal Point " is a custom field,
// not the entity (§18.5 #2). Checked here too because the decision layer is
// what the UI actually renders — a correct proposal displayed wrong is the
// same bug to the user.
{
  const companyName = decisions[1];
  assert.strictEqual(companyName.target.kind, 'field', '"Company Name" must map to a concept');
  const focal = decisions[13];
  assert.strictEqual(focal.profile.header.trim(), 'Name of focal Point');
  assert.strictEqual(focal.target.kind, 'custom', '"Name of focal Point" must NOT be a mapped concept');
}

// ── 3. Detected type pre-filled on the custom-field default (task #5) ───────
{
  const byHeader = (h: string) => decisions.find(d => d.profile.header.trim() === h)!;
  const t = (h: string) => {
    const d = byHeader(h);
    assert.strictEqual(d.target.kind, 'custom', `${h} should default to a custom field`);
    return d.target.kind === 'custom' ? d.target : null!;
  };
  assert.strictEqual(t('Inventory Count Needed').dataType, 'boolean', 'YES/NO is a Yes/No field, not a 2-value choice');
  assert.strictEqual(t('Follow -up Status').dataType, 'date', '"Follow -up Status" holds dates (§18.5 #3)');
  assert.strictEqual(t('Emails').dataType, 'text');
  assert.strictEqual(t('AUDIT 2025').dataType, 'number');
  assert.strictEqual(t('Year').dataType, 'number', 'a year is a number, not a date we invented a day for');
  const auditor = t('Planned auditor');
  assert.strictEqual(auditor.dataType, 'enum');
  assert.ok((auditor.enumOptions ?? []).length >= 1, 'an enum field must ship its options');
  // An empty column with a real header still becomes a field — the firm meant
  // to have it, and next year's file will fill it in.
  assert.strictEqual(t('Proposed fee').dataType, 'text');
}

// ── 4. Keys are legal for project_field_defs_key_ck, and unique ────────────
{
  const plans = customFieldPlans(decisions);
  const keyRe = /^[a-z0-9_]{1,64}$/;
  const seen = new Set<string>();
  for (const p of plans) {
    assert.ok(keyRe.test(p.key), `"${p.sourceColumn}" produced an illegal field key "${p.key}"`);
    assert.ok(!seen.has(p.key), `duplicate field key "${p.key}"`);
    seen.add(p.key);
    assert.ok(p.label.length > 0, `field for column ${p.columnIndex} has no label`);
    if (p.dataType === 'enum') assert.ok((p.enumOptions ?? []).length >= 1, `enum field "${p.key}" has no options`);
    else assert.strictEqual(p.enumOptions, null, `non-enum field "${p.key}" must not carry options`);
  }
  assert.strictEqual(slugifyFieldKey('Follow -up Status', 21), 'follow_up_status');
  assert.strictEqual(slugifyFieldKey('TOTAL A&T 2025', 10), 'total_a_t_2025');
  assert.strictEqual(slugifyFieldKey('   ', 4), 'column_5', 'an unheaded column still needs a legal key');
  assert.strictEqual(uniqueKey('status', new Set(['status'])), 'status_2');
}

// ── 5. Re-import reuses the existing def, it does not fork a second one ─────
// §18.5 #6 — matched on `source_column` verbatim, trailing space and all.
{
  const existing: ExistingFieldDef[] = [{
    id: 'def-1', key: 'inventory_count_needed', label: 'Inventory count',
    data_type: 'boolean', enum_options: null, source_column: 'Inventory Count Needed',
  }];
  const again = buildColumnDecisions(profiles, mapping, ENGAGEMENT_REGISTER, HEADER, existing);
  const d = again.find(x => x.profile.header.trim() === 'Inventory Count Needed')!;
  assert.strictEqual(d.target.kind, 'custom');
  if (d.target.kind === 'custom') {
    assert.strictEqual(d.target.defId, 'def-1', 'a saved mapping must bind to the existing def');
    assert.strictEqual(d.target.label, 'Inventory count', "and keep the user's label, not the header");
  }
}

// ── 6. Enum values: variants are SHOWN merging, unmatched is explicit ───────
// §18.5 #5 — "Fadi haddad" binds to "Fadi Haddad", and nothing is created
// without confirmation.
{
  const auditorCol = 6;
  const values = distinctColumnValues(ENGAGEMENT_REGISTER, HEADER, auditorCol);
  assert.strictEqual(values.length, 1, 'the two spellings must collapse to one value');
  assert.strictEqual(values[0].label, 'Fadi Haddad', 'the dominant spelling is the one shown');
  assert.deepStrictEqual(
    [...values[0].spellings].sort(), ['Fadi Haddad', 'Fadi haddad'],
    'both raw spellings must be visible — a silent merge is a silent data change',
  );

  // Against a catalogue that already holds the canonical name: matched, fuzzy.
  const known = matchEnumValues(values, ['Fadi Haddad']);
  assert.strictEqual(known[0].matched, 'Fadi Haddad');
  assert.strictEqual(known[0].fuzzy, false, 'the dominant spelling is an exact hit');
  assert.deepStrictEqual(unresolvedEnumValues(known, new Map()), [], 'a matched value needs no decision');

  // Case-only drift still matches, and is flagged as fuzzy so the UI can say so.
  const drifted = matchEnumValues([{ key: 'fadi haddad', label: 'Fadi haddad', count: 1, spellings: ['Fadi haddad'] }], ['Fadi Haddad']);
  assert.strictEqual(drifted[0].matched, 'Fadi Haddad');
  assert.strictEqual(drifted[0].fuzzy, true);

  // Against an EMPTY catalogue: unmatched, and it blocks until decided.
  const fresh = matchEnumValues(values, []);
  assert.strictEqual(fresh[0].matched, null, 'no catalogue entry means UNMATCHED, never an auto-create');
  assert.strictEqual(unresolvedEnumValues(fresh, new Map()).length, 1, 'an unmatched value must block');
  assert.strictEqual(
    unresolvedEnumValues(fresh, new Map([['fadi haddad', 'create' as const]])).length, 0,
    'an explicit decision unblocks it — and only an explicit one',
  );
}

// ── 7. Row warnings: the continuation and the separator are both surfaced ───
{
  const shapes = classifyRowShapes(ENGAGEMENT_REGISTER, HEADER, mapping.name);
  const w = summariseRowWarnings(shapes);
  assert.strictEqual(w.continuations.length, 1, 'the wrapped company name must be flagged');
  assert.strictEqual(w.continuations[0].text, 'Contracting W.L.L.');
  assert.strictEqual(w.continuations[0].rowNumber, 8);
  assert.strictEqual(w.continuations[0].continuesRowNumber, 7);
  assert.strictEqual(w.blankRowNumbers.length, 1, 'the separator row must be reported, not just skipped');
  assert.strictEqual(w.blankRowNumbers[0], 21);
}

// ── 7b. A footer TOTAL row is flagged, and a real client is not ─────────────
// The fixture has no total row (its TOTAL is a COLUMN), so one is appended —
// the shape every second real register ends with.
{
  const withFooter: SheetCell[][] = [
    ...ENGAGEMENT_REGISTER,
    ['', 'TOTAL', '', '', '', '', '', 76800, 3000, 21700, 101500, '', '', '', '', '', '', '', '', '', '', ''],
    ['', 'Total Solutions W.L.L.', 'Individual', 2025, 'Issued', 'Audit & Tax', 'Fadi Haddad', 4000, 0, 1000, 5000, 'Active', 'Signed by client', 'Nadia', '', '', 'nadia@totalsolutions.example', 'NO', '', '', '', ''],
  ];
  const found = detectSummaryRows(withFooter, HEADER, mapping.name);
  assert.strictEqual(found.length, 1, `expected exactly 1 total row, got ${found.map(f => f.text).join(' | ')}`);
  assert.strictEqual(found[0].text, 'TOTAL');
  assert.strictEqual(found[0].rowNumber, ENGAGEMENT_REGISTER.length + 1);
  // The anchored regex is what keeps a real company off this list — a footer
  // OPENS with the word, a client name merely contains it.
  assert.deepStrictEqual(detectSummaryRows(withFooter, HEADER, undefined), [], 'no name column means no claim either way');

  const w = summariseRowWarnings(classifyRowShapes(withFooter, HEADER, mapping.name), found);
  assert.strictEqual(w.summaries.length, 1, 'the total row must reach the UI through the warnings summary');
}

// ── 8. The non-reconciling TOTAL names its rows (task #3) ───────────────────
{
  const relations = detectColumnRelations(profiles, ENGAGEMENT_REGISTER, HEADER);
  const total = relations.find(r => r.kind === 'total_of');
  assert.ok(total && total.kind === 'total_of', 'the fee breakdown + TOTAL must be detected');
  assert.strictEqual(total.reconciles, false, 'row 4 disagrees with its stated TOTAL');
  assert.ok(total.mismatchRowNumbers.includes(4), `expected row 4 among ${total.mismatchRowNumbers.join(', ')}`);
  assert.ok(total.mismatchRowNumbers.length > 0, 'a non-reconciling total must name the disagreeing rows');
}

// ── 9. Partial coverage is flagged, and low confidence with it (task #1) ────
// "Expected date" is a date column at ~0.6 — the UI has to be able to show
// that a third of it is prose, so the flag has to exist on the decision.
{
  const expected = decisions.find(d => d.profile.header.trim() === 'Expected date')!;
  assert.strictEqual(expected.profile.primitive, 'date');
  assert.ok(expected.profile.coverage < 0.95, `expected partial coverage, got ${expected.profile.coverage}`);
  assert.strictEqual(expected.partial, true, 'partial coverage must be flagged');
  assert.strictEqual(expected.lowConfidence, true, 'and it must render as low-confidence');
  assert.ok(expected.profile.nonMatchingSamples.length > 0, 'and name the cells that did not parse');

  const emails = decisions.find(d => d.profile.header.trim() === 'Emails')!;
  assert.strictEqual(emails.partial, false, 'a clean column must NOT be flagged — the flag has to mean something');
}

// ── 10. Cell -> stored value, per the column's declared type ────────────────
{
  const num = (c: any) => parseMoneyCell(c);
  const date = (c: any) => parseDateValue(c, 'DMY');
  assert.strictEqual(cellToFieldValue('8,000', 'number', date, num), 8000);
  assert.strictEqual(cellToFieldValue('25/1/2026', 'date', date, num), '2026-01-25');
  assert.strictEqual(cellToFieldValue('YES', 'boolean', date, num), true);
  assert.strictEqual(cellToFieldValue('no', 'boolean', date, num), false);
  assert.strictEqual(cellToFieldValue('  ', 'text', date, num), null, 'a blank cell clears, it never stores ""');
  assert.strictEqual(cellToFieldValue('still pending', 'date', date, num), null, 'prose in a date column stores nothing');
  assert.strictEqual(cellToFieldValue('Issued', 'enum', date, num), 'Issued');
  assert.strictEqual(fieldTypeForPrimitive('unknown'), 'text');
}

// ── 11. The batch schedule preview mirrors the RPC's arithmetic (§19.2) ────
// These four functions exist to show ONE project worked out before commit, so
// the only thing that matters is that they agree with fn_batch_offset_range /
// fn_resolve_batch_start_date. A drift here would produce a confident wrong
// date, which is the exact failure class §19.4/§21 is about.
{
  const body = [
    { title: 'Planning', category: 'Admin', due_offset_days: 0 },
    { title: 'Fieldwork', category: 'Audit', due_offset_days: 14 },
    { title: 'Report', category: 'Review', due_offset_days: 30 },
    { title: 'Filing', category: 'Admin' }, // no offset at all -> day 0, like the SQL's COALESCE
  ];

  assert.deepStrictEqual(batchOffsetRange(body), { min: 0, max: 30 });
  assert.deepStrictEqual(batchOffsetRange([]), { min: 0, max: 0 }, 'an empty template is a zero-day span, not NaN');

  // direction 'start': the anchor IS the start date.
  assert.strictEqual(resolveBatchStartDate('2026-02-03', 'start', 30), '2026-02-03');
  // direction 'deadline': the anchor is the LAST task's due date, so start is
  // anchor - span. This is the half of "DUE BY" nobody could see.
  assert.strictEqual(resolveBatchStartDate('2026-02-03', 'deadline', 30), '2026-01-04');

  // Whole-day UTC arithmetic across a DST boundary in either hemisphere.
  assert.strictEqual(addDays('2026-03-28', 3), '2026-03-31', 'no DST off-by-one going forward');
  assert.strictEqual(addDays('2026-11-02', -3), '2026-10-30', 'nor going back');
  assert.strictEqual(isoDay('2026-02-08T00:00:00.000Z'), '2026-02-08', 'a full ISO timestamp is accepted');

  const starts = sampleProjectSchedule(body, '2026-02-03', 'start', null);
  assert.strictEqual(starts.length, 4);
  assert.strictEqual(starts[0].dueDay, '2026-02-03', 'day 0 lands on the anchor');
  assert.strictEqual(starts[3].dueDay, '2026-03-05', 'day 30 is 30 days later');
  assert.ok(starts.every((t, i) => i === 0 || t.offsetDays >= starts[i - 1].offsetDays), 'sorted by offset');

  const deadline = sampleProjectSchedule(body, '2026-02-03', 'deadline', null);
  assert.strictEqual(deadline[deadline.length - 1].dueDay, '2026-02-03', 'under DUE BY the last task lands ON the anchor');
  assert.strictEqual(deadline[0].dueDay, '2026-01-04', 'and everything else is worked backwards from it');

  // A row's own start date overrides the anchor — and carries the SAME
  // direction semantics, which is why a per-row date under DUE BY is that
  // row's deadline. Mirrors the CASE in the RPC exactly.
  const override = sampleProjectSchedule(body, '2026-02-03', 'deadline', '2026-05-01T00:00:00.000Z');
  assert.strictEqual(override[override.length - 1].dueDay, '2026-05-01');

  // batchSpan must reproduce the RPC's MIN(start)+min_offset / MAX(start)+max_offset.
  const span = batchSpan(body, '2026-02-03', 'start', [null, '2026-04-10', '2026-01-20']);
  assert.deepStrictEqual(span, { firstDay: '2026-01-20', lastDay: '2026-05-10' });
  assert.strictEqual(batchSpan(body, '2026-02-03', 'start', []), null, 'no rows means no span, not a bogus one');
}

console.log('importPlan.check.ts: all assertions passed (22/22 columns decided, 0 defaulted to ignore; batch schedule mirrors the RPC)');
