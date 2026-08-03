// Self-check for the Phase 9 content classifier in lib/imports/spreadsheetMapping.ts
// (plan §18). Run: npx tsx lib/imports/spreadsheetMapping.check.ts — also picked
// up by `npm run check`. Plain node:assert, no framework (ponytail, mirrors
// spreadsheetIntake.check.ts). Imports ONLY the pure module, so it runs under
// plain tsx with no react-native/xlsx in the graph.
//
// The fixture — an anonymised rebuild of that real 22-column file, every
// structural trap preserved — lives in ./engagementRegister.fixture.ts, shared
// with importPlan.check.ts so the two cannot drift apart.

import assert from 'node:assert';
import {
  profileColumns,
  profileColumn,
  proposeColumnMapping,
  buildIntakeRows,
  classifyRowShapes,
  detectColumnRelations,
  parseEmailCell,
  parseMoneyCell,
  parseDateValue,
  resolveDateOrder,
  normalizeMatchKey,
  looksLikePhoneCell,
  detectHeaderRow,
  type SheetCell,
  type ColumnPrimitive,
} from './spreadsheetMapping';

import { ENGAGEMENT_REGISTER } from './engagementRegister.fixture';

const HEADER = 0;
const profiles = profileColumns(ENGAGEMENT_REGISTER, HEADER);
const at = (i: number) => profiles[i];

// ── 0. The table is found, and it is 22 columns wide ─────────────────────────
assert.strictEqual(detectHeaderRow(ENGAGEMENT_REGISTER), HEADER, 'header row must be row 0');
assert.strictEqual(profiles.length, 22, `expected 22 profiled columns, got ${profiles.length}`);

// ── 1. ZERO columns silently discarded (plan §18.5 #1) ───────────────────────
// Structural, not a promise: the profile array is dense and index-aligned, so
// every column carries a primitive — 'empty' and 'unknown' included, both of
// which are explicit reports rather than an absence.
profiles.forEach((p, i) => {
  assert.strictEqual(p.index, i, `profiles must be index-aligned; slot ${i} holds column ${p.index}`);
  assert.ok(p.primitive, `column ${i} ("${p.header}") has no primitive`);
});
{
  const proposal = proposeColumnMapping(ENGAGEMENT_REGISTER[HEADER], ENGAGEMENT_REGISTER.slice(1));
  const mappedCols = new Set(Object.values(proposal.mapping));
  const accountedFor = new Set([...mappedCols, ...proposal.unmapped]);
  assert.strictEqual(
    accountedFor.size, 22,
    `every column must be mapped or offered as a custom field; ${22 - accountedFor.size} fell through`,
  );
}

// ── 2. THE REGRESSION: the project name is "Company Name", never the focal point
{
  const { mapping, confidence, nameReason } = proposeColumnMapping(
    ENGAGEMENT_REGISTER[HEADER],
    ENGAGEMENT_REGISTER.slice(1),
  );
  assert.strictEqual(
    mapping.name, 1,
    `name must resolve to col 1 "Company Name", got col ${mapping.name} ("${at(mapping.name ?? 0).header}")`,
  );
  assert.notStrictEqual(mapping.name, 13, 'name must NEVER be col 13 "Name of focal Point" (the §18.1 bug)');
  assert.strictEqual(mapping.client_ref, 1, '"Company Name" doubles as the client name');
  assert.ok(nameReason?.includes('unique'), `name choice must be explainable by content, got: ${nameReason}`);
  assert.ok((confidence.name ?? 0) > 0.5, 'name confidence must be reported and plausible');

  // Content, not the header, is what excludes col 13 — it repeats.
  assert.strictEqual(at(13).primitive !== 'unique_id', true, 'col 13 repeats, so it cannot be an identifier');
  assert.ok(at(13).distinct < at(13).filled, `col 13 must repeat: ${at(13).distinct} distinct of ${at(13).filled}`);
  assert.strictEqual(at(1).primitive, 'unique_id', 'col 1 "Company Name" is the identifier');
}

// ── 3. "Follow -up Status" is DATES despite its header (plan §18.5 #3) ───────
{
  const p = at(21);
  assert.strictEqual(p.primitive, 'date', `col 21 must classify as date, got ${p.primitive}`);
  assert.strictEqual(p.coverage, 1, `col 21 must be fully covered by dates, got ${p.coverage}`);
  assert.notStrictEqual(p.headerHint, 'date', 'the header must NOT be what nominated it — that is the point');
  assert.strictEqual(p.dateOrder, 'DMY', `col 21 resolves DD/MM from the 25s and 26s, got ${p.dateOrder}`);
  assert.strictEqual(p.needsConfirmation, false, 'a fully-covered, order-resolved date column needs no question');
}

// ── 4. "Expected date" reports PARTIAL coverage (plan §18.5 #3) ──────────────
{
  const p = at(19);
  assert.strictEqual(p.primitive, 'date', `col 19 must still be offered as a date, got ${p.primitive}`);
  assert.ok(
    p.coverage > 0.4 && p.coverage < 0.8,
    `col 19 must report PARTIAL date coverage (~0.6), got ${p.coverage} — a boolean here is the failure`,
  );
  assert.ok(p.nonMatchingSamples.length > 0, 'the cells that are not dates must be shown, not nulled');
  assert.ok(
    p.nonMatchingSamples.includes('1st week of January') && p.nonMatchingSamples.includes('still pending'),
    `expected the prose cells to surface, got ${JSON.stringify(p.nonMatchingSamples)}`,
  );
  // 1/2/26, 8/2/26, 2/3/26, 3/2/26, 12/2/26 — nothing over 12 in first position.
  assert.strictEqual(p.dateOrder, 'ambiguous', `col 19 is genuinely ambiguous, got ${p.dateOrder}`);
  assert.strictEqual(p.needsConfirmation, true, 'an ambiguous date order must ask ONCE for the column');
}

// ── 5. The continuation row is flagged, not dropped and not imported ─────────
{
  const shapes = classifyRowShapes(ENGAGEMENT_REGISTER, HEADER, 1);
  const cont = shapes.filter(s => s.kind === 'continuation');
  assert.strictEqual(cont.length, 1, `expected exactly 1 continuation row, got ${cont.length}`);
  assert.strictEqual(cont[0].rowIndex, 7, `the continuation is AOA row 7, got ${cont[0].rowIndex}`);
  assert.strictEqual(cont[0].text, 'Contracting W.L.L.');
  assert.strictEqual(cont[0].continuesRowNumber, 7, 'it must point at the row it continues (1-based row 7)');

  const blanks = shapes.filter(s => s.kind === 'blank');
  assert.strictEqual(blanks.length, 1, `expected exactly 1 blank separator row, got ${blanks.length}`);
  assert.strictEqual(blanks[0].rowIndex, 20);

  // It survives into the rows array TAGGED — neither silently merged nor
  // silently turned into a project called "Contracting W.L.L.".
  const { mapping } = proposeColumnMapping(ENGAGEMENT_REGISTER[HEADER], ENGAGEMENT_REGISTER.slice(1));
  const rows = buildIntakeRows(ENGAGEMENT_REGISTER, HEADER, mapping, 'DMY');
  const junk = rows.find(r => r.name === 'Contracting W.L.L.');
  assert.ok(junk, 'the continuation row must NOT be dropped — a silent drop is the #182 failure');
  assert.strictEqual(junk!.shape, 'continuation', 'and it must NOT arrive looking like a normal project');
  assert.strictEqual(junk!.continuesRowNumber, 7);
  assert.strictEqual(
    rows.filter(r => r.shape === 'data').length, 21,
    'the other 21 data rows are untouched',
  );
  assert.strictEqual(rows.length, 22, 'blank separator dropped, continuation kept: 21 data + 1 continuation');
}

// ── 6. Case-variant values normalise to one match key (plan §18.3) ───────────
{
  assert.strictEqual(
    normalizeMatchKey('Fadi Haddad'), normalizeMatchKey('Fadi haddad'),
    'case variants must share a match key',
  );
  assert.strictEqual(
    normalizeMatchKey('Fadi  Haddad '), normalizeMatchKey('Fadi Haddad'),
    'whitespace variants must share a match key',
  );
  const p = at(6);
  assert.strictEqual(p.primitive, 'enum', `col 6 "Planned auditor" must be an enum, got ${p.primitive}`);
  assert.strictEqual(p.distinct, 1, `"Fadi Haddad"/"Fadi haddad" must collapse to 1 value, got ${p.distinct}`);
  // The ORIGINAL string survives — normalising for matching must not destroy it.
  assert.strictEqual(p.enumValues?.[0].label, 'Fadi Haddad', 'the original spelling is kept as the label');
  assert.strictEqual(p.enumValues?.[0].count, 21);
  assert.strictEqual(p.needsConfirmation, true, '§18.2 rule 2: an enum is always a question');
}

// ── 7. Money as text, and totals that do NOT reconcile ───────────────────────
{
  assert.strictEqual(parseMoneyCell('8,000'), 8000, '"8,000" must parse to 8000');
  assert.strictEqual(parseMoneyCell(' QAR 1,250.50 '), 1250.5);
  assert.strictEqual(parseMoneyCell('(2,000)'), -2000, 'accounting negatives');
  assert.strictEqual(parseMoneyCell('25/1/2026'), null, 'a date is not money');
  assert.strictEqual(parseMoneyCell('7470 6599'), null, 'a spaced phone is not money');
  assert.strictEqual(parseMoneyCell(''), null);

  for (const col of [7, 8, 9, 10]) {
    assert.strictEqual(at(col).primitive, 'money', `col ${col} "${at(col).header}" must be money`);
  }
  // Row 3: 4000 + 0 + 1000 = 5000, but the stated TOTAL is 3000. Both survive
  // verbatim. Nothing in this module recomputes a total (§18.4 / §13.9) — the
  // absence of a reconciliation helper is the feature.
  const r = ENGAGEMENT_REGISTER[3];
  const parts = [7, 8, 9].map(c => parseMoneyCell(r[c])!);
  const stated = parseMoneyCell(r[10])!;
  assert.deepStrictEqual(parts, [4000, 0, 1000]);
  assert.strictEqual(stated, 3000);
  assert.notStrictEqual(parts.reduce((a, b) => a + b, 0), stated, 'the fixture must keep a non-reconciling row');
}

// ── 8. Multi-valued emails, display-name form ────────────────────────────────
{
  const multi = parseEmailCell(ENGAGEMENT_REGISTER[5][16]);
  assert.strictEqual(multi.length, 2, `expected 2 addresses, got ${multi.length}`);
  assert.strictEqual(multi[0].address, 'administration@bayridgebuild.example');
  assert.strictEqual(multi[0].displayName, 'accounts& HR department Bay Ridge Building Co');
  assert.strictEqual(multi[1].address, 'sunder@bayridgebuild.example');
  assert.strictEqual(multi[1].displayName, 'Sunder Bay Ridge');

  assert.strictEqual(parseEmailCell("n.azzam@thematrix.example'")[0].address, 'n.azzam@thematrix.example',
    'a trailing apostrophe must not be swallowed into the address');
  assert.strictEqual(parseEmailCell(' Julia@pinnacleintl.example')[0].address, 'julia@pinnacleintl.example');
  assert.deepStrictEqual(parseEmailCell('Tarek Nasser'), [], 'a bare person name is not an email');

  const p = at(16);
  assert.strictEqual(p.primitive, 'email', `col 16 "Emails " must be email, got ${p.primitive}`);
  assert.strictEqual(p.coverage, 1);
}

// ── 9. Phones, and what must NOT be one ──────────────────────────────────────
{
  assert.strictEqual(looksLikePhoneCell(33506040), true, 'a bare 8-digit number');
  assert.strictEqual(looksLikePhoneCell('+974 5590 2695 / +974 3387 0057 '), true);
  assert.strictEqual(looksLikePhoneCell('Mob:+44 (0)7973 771 043'), true);
  assert.strictEqual(looksLikePhoneCell('7470 6599'), true);
  // BOTH sides of the label rule, together. Tightening one has already traded
  // away the other once: "reject any leading alpha" killed `2026-0114` as a
  // phone AND `Mob:+44 ...`, which is a real value from the source client file.
  assert.strictEqual(looksLikePhoneCell('Tel: 4432 9981'), true, 'a labelled number is still a number');
  assert.strictEqual(looksLikePhoneCell('Cell 55560156'), true, 'label with no colon');
  assert.strictEqual(looksLikePhoneCell('2026-0114'), false, 'a matter number is not a phone');
  assert.strictEqual(looksLikePhoneCell('L-2026-0033'), false, 'a lot code is not a phone');
  assert.strictEqual(looksLikePhoneCell('PO-88231'), false, 'a purchase order is not a phone');
  assert.strictEqual(looksLikePhoneCell(1188402), false, 'a 7-digit MLS number is not a phone');
  assert.strictEqual(looksLikePhoneCell(8000), false, 'money is not a phone');
  assert.strictEqual(looksLikePhoneCell(2025), false, 'a year is not a phone');
  assert.strictEqual(looksLikePhoneCell('25/1/2026'), false, 'a date has 7 digits too, and is not a phone');
  assert.strictEqual(looksLikePhoneCell('a@b.example'), false);
  assert.strictEqual(at(15).primitive, 'phone', `col 15 "Mobile number " must be phone, got ${at(15).primitive}`);
}

// ── 10. Dates: per-column order, never per cell ──────────────────────────────
{
  assert.strictEqual(resolveDateOrder(['25/1/2026', '13/1/2026', '17/2/2026']), 'DMY');
  assert.strictEqual(resolveDateOrder(['1/25/2026', '2/13/2026']), 'MDY');
  assert.strictEqual(resolveDateOrder(['1/2/26', '8/2/26', '3/2/26']), 'ambiguous');
  assert.strictEqual(resolveDateOrder(['25/1/2026', '1/25/2026']), 'ambiguous', 'contradictory columns must not pick a side');
  assert.strictEqual(resolveDateOrder([46024, '2026-01-02']), undefined, 'no slash dates -> nothing to ask about');

  assert.strictEqual(parseDateValue('25/1/2026', 'DMY'), '2026-01-25');
  assert.strictEqual(parseDateValue('8/2/26', 'DMY'), '2026-02-08');
  assert.strictEqual(parseDateValue('8/2/26', 'MDY'), '2026-08-02', 'the same cell, the other column order');
  assert.strictEqual(parseDateValue(46024), '2026-01-02', 'Excel serial');
  assert.strictEqual(parseDateValue('2026-09-01'), '2026-09-01');
  assert.strictEqual(parseDateValue('5 Jan 2026'), '2026-01-05');
  assert.strictEqual(parseDateValue('1st week of January'), null);
  assert.strictEqual(parseDateValue('still pending'), null);
  assert.strictEqual(parseDateValue('started'), null);
  assert.strictEqual(parseDateValue(8000), null, 'a fee is not a date serial');
  assert.strictEqual(parseDateValue('32/1/2026', 'DMY'), null, 'day 32 is not a date');
}

// ── 11. The header may RAISE, never assign (plan §18.2 rule 1) ───────────────
{
  // "Proposed fee" nominates money and holds nothing at all. The nomination is
  // recorded and overruled — a header alone can never create a classification.
  const p = at(18);
  assert.strictEqual(p.headerHint, 'money', 'the header did nominate money');
  assert.strictEqual(p.primitive, 'empty', 'and it was overruled by an empty column');
  assert.strictEqual(p.filled, 0);

  // A date-nominating header over a column of prose gets nothing either.
  const prose = profileColumn('Expected date', ['still pending', 'started', 'on hold', 'tbc', 'next week']);
  assert.strictEqual(prose.headerHint, 'date');
  assert.notStrictEqual(prose.primitive, 'date', 'a header must not conjure dates out of prose');

  // And the reverse: content with a header that says nothing still classifies
  // (col 21, asserted above) — content is sufficient, the header never is.
}

// ── 12. 'unknown' is reachable and reported, not swallowed ──────────────────
{
  const junk = profileColumn('???', ['###', '%%', '@@@', '***', '&&']);
  assert.strictEqual(junk.primitive, 'unknown', `expected unknown, got ${junk.primitive}`);
  assert.strictEqual(junk.needsConfirmation, true);
  assert.strictEqual(junk.filled, 5, 'unknown still reports the data it could not read');
}

// ── 13. The full 22-column expectation, spelled out ─────────────────────────
// Anything that regresses this table changes what the user is offered, so the
// table is the spec. `freetext` is the honest answer for a column of prose —
// it carries the data as a text custom field (§18.2 rule 3).
{
  const EXPECTED: [number, string, ColumnPrimitive][] = [
    [0, 'SL No.', 'unique_id'],
    [1, 'Company Name', 'unique_id'],
    [2, 'Group / Individual ', 'enum'],
    [3, 'Year', 'year'],
    [4, 'Audit status', 'enum'],
    [5, 'Service ', 'enum'],
    [6, 'Planned auditor', 'enum'],
    [7, 'AUDIT 2025', 'money'],
    [8, 'ARABIC3 2025', 'money'],
    [9, 'TAX', 'money'],
    [10, 'TOTAL A&T 2025', 'money'],
    [11, 'Status', 'enum'],
    [12, 'EL Status 2025', 'enum'],
    [13, 'Name of focal Point ', 'freetext'],
    [14, 'Position ', 'freetext'],
    [15, 'Mobile number ', 'phone'],
    [16, 'Emails ', 'email'],
    [17, 'Inventory Count Needed', 'enum'],
    [18, 'Proposed fee', 'empty'],
    [19, 'Expected date', 'date'],
    [20, 'Comment', 'freetext'],
    [21, 'Follow -up Status', 'date'],
  ];
  const wrong: string[] = [];
  for (const [i, header, expected] of EXPECTED) {
    // profiles trim the header; the fixture keeps the source's trailing spaces
    assert.strictEqual(at(i).header, header.trim(), `col ${i} header drifted`);
    if (at(i).primitive !== expected) wrong.push(`${i} "${header}": expected ${expected}, got ${at(i).primitive}`);
  }
  assert.strictEqual(wrong.length, 0, `column classification regressions:\n  ${wrong.join('\n  ')}`);

  // Enum arities the plan names explicitly (§18.1).
  assert.strictEqual(at(2).distinct, 4, 'Group / Individual is ENUM(4)');
  assert.strictEqual(at(4).distinct, 2, 'Audit status is ENUM(2) — "Issued"/"issued" collapse');
  assert.strictEqual(at(5).distinct, 1, 'Service is ENUM(1)');
  assert.strictEqual(at(12).distinct, 2, 'EL Status 2025 is ENUM(2)');
  assert.strictEqual(at(17).distinct, 2, 'Inventory Count Needed is YES/NO');
}

// ── 14. Column CONTEXT — the second pass over the sequence ──────────────────
// Sato's finding, without the neural net: four MONEY columns in isolation are a
// fee breakdown plus a total when read as a neighbourhood.
{
  const rel = detectColumnRelations(profiles, ENGAGEMENT_REGISTER, HEADER);

  const money = rel.find(r => r.kind === 'sibling_group' && r.primitive === 'money');
  assert.ok(money, 'cols 7-10 must be recognised as one money neighbourhood');
  assert.deepStrictEqual(
    money.kind === 'sibling_group' ? money.columns : [], [7, 8, 9, 10],
    'the fee breakdown and its total are adjacent siblings',
  );

  const total = rel.find(r => r.kind === 'total_of');
  assert.ok(total, '"TOTAL A&T 2025" must be identified as a sum of its siblings');
  if (total.kind === 'total_of') {
    assert.strictEqual(total.total, 10, 'col 10 is the total');
    assert.deepStrictEqual(total.components, [7, 8, 9], 'cols 7-9 are its components, not four peer fees');
    // §18.4: report the disagreement, NEVER compute a corrected total.
    assert.strictEqual(total.reconciles, false, 'this register does not reconcile');
    assert.ok(
      total.mismatchRowNumbers.includes(4),
      `row 4 (4000+0+1000 vs 3000) must be named, got ${JSON.stringify(total.mismatchRowNumbers)}`,
    );
    // The stated total is still exactly what the sheet said.
    assert.strictEqual(parseMoneyCell(ENGAGEMENT_REGISTER[3][10]), 3000, 'the wrong total is imported as-is');
  }

  const contact = rel.find(r => r.kind === 'contact_block');
  assert.ok(contact, 'focal point + position + mobile + email is one contact block');
  if (contact.kind === 'contact_block') {
    assert.deepStrictEqual(contact.columns, [13, 14, 15, 16]);
    assert.strictEqual(contact.anchor, 13, 'anchored on the person column, not the phone');
  }

  const period = rel.find(r => r.kind === 'single_period');
  assert.ok(period, 'Year=2025 beside "AUDIT 2025"/"TAX"/"TOTAL A&T 2025" is a single-period register');
  if (period.kind === 'single_period') {
    assert.strictEqual(period.year, '2025');
    assert.deepStrictEqual(period.columns, [3, 7, 8, 10, 12], 'the year column plus every header echoing it');
  }
}

// ── 15. The old header-only fixture still maps correctly ────────────────────
// A clean file with distinct "Project Name" / "Client Name" columns must not
// regress now that content leads: with one sample row content cannot separate
// them, and the header legitimately breaks the tie between two columns it
// already supports.
{
  const headers: SheetCell[] = ['Project Name', 'Client Name', 'Start Date'];
  const sample: SheetCell[][] = [['Audit 2026', 'Abdallah Group', '2026-09-01']];
  const { mapping } = proposeColumnMapping(headers, sample);
  assert.strictEqual(mapping.name, 0, 'distinct "Project Name" column wins');
  assert.strictEqual(mapping.client_ref, 1, 'distinct "Client Name" column maps separately');
  assert.strictEqual(mapping.start_date, 2);
}

console.log(`spreadsheetMapping.check.ts: all assertions passed (${profiles.length}/22 columns classified, 0 discarded)`);
