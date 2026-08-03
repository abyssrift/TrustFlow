// Self-check for lib/imports/spreadsheetMapping.ts (the pure core behind
// lib/imports/spreadsheetIntake.ts) — run: npx tsx lib/imports/spreadsheetIntake.check.ts
// No framework (ponytail, mirrors lib/starterTemplates.check.ts): plain
// asserts against a fixture shaped like a REAL messy file (banner, logo row,
// blank leading column, header on row 7, a few near-duplicate client names) —
// not a clean A1 fixture. Guards the two inferences most likely to silently
// regress: header-row detection and column mapping (issue #188 / plan §15.4
// acceptance #1). Imports ONLY the pure module (no lib/supabase, no xlsx
// loader) so this runs standalone under plain `npx tsx` — importing the I/O
// orchestration file here pulls in react-native transitively via
// lib/supabase and breaks esbuild (verified: that was the first cut of this
// file, before the pure/I-O split).

import assert from 'node:assert';
import {
  detectHeaderRow,
  proposeColumnMapping,
  buildIntakeRows,
  normalizeClientName,
  matchClientByName,
  resolveClientMatch,
  type SheetCell,
  type IntakeRow,
  type ExistingClient,
} from './spreadsheetMapping';

// ── Fixture: banner + logo row + blank row + blank leading column + header
// on row 7 (index 6) — exactly the shape plan §15.2 item 1 describes. ───────
const messyFile: SheetCell[][] = [
  ['TrustedGe LLC — Annual Client Portfolio'],                          // 0: title/banner (1 cell)
  ['Prepared for internal use only'],                                    // 1: subtitle banner (1 cell)
  [],                                                                     // 2: blank (logo row, no text extracted)
  [],                                                                     // 3: blank spacer
  ['', 'Office: Riyadh'],                                                 // 4: metadata, 2 cells but no data row below it at same density
  [],                                                                     // 5: blank spacer
  ['', 'Company Name', 'CR Number', 'Start Date', 'Notes'],               // 6: HEADER — blank leading column
  ['', 'Abdallah Group', 'CR-1001', '2026-09-01', 'renewal'],             // 7
  ['', 'Centro Trading', 'CR-1002', '2026-09-15', ''],                    // 8
  ['', 'Northgate LLC', '', '2026-10-01', 'new client'],                  // 9: no CR number
  ['', '', 'CR-1003', '2026-10-05', 'blank name row'],                    // 10: blank name — must be KEPT, not dropped
  [],                                                                     // 11: trailing blank
];

// ── 1. detectHeaderRow ───────────────────────────────────────────────────
{
  const idx = detectHeaderRow(messyFile);
  assert.strictEqual(idx, 6, `expected header row at index 6 (row 7), got ${idx}`);
}

// Empty / bannerless sheet -> -1, never guesses row 0.
{
  const idx = detectHeaderRow([['Only a banner'], [], []]);
  assert.strictEqual(idx, -1, 'a file with no real table must not detect a header');
}

// A one-row-of-data file (header immediately at 0, single data row below) is
// still detected — the "next row has data" check must not require 2+ rows.
{
  const idx = detectHeaderRow([['Name', 'Start Date'], ['Acme', '2026-01-01']]);
  assert.strictEqual(idx, 0, 'a clean 2-row file should still detect header at row 0');
}

// ── 2. proposeColumnMapping ──────────────────────────────────────────────
{
  const headerRow = messyFile[6];
  const sample = messyFile.slice(7, 11);
  const { mapping, confidence } = proposeColumnMapping(headerRow, sample);

  assert.strictEqual(mapping.client_ref, 1, '"Company Name" column must map to client_ref');
  assert.strictEqual(mapping.name, 1, 'name must mirror client_ref when there is one name-ish column (textarea convention)');
  assert.strictEqual(mapping.client_external_ref, 2, '"CR Number" must map to client_external_ref');
  assert.strictEqual(mapping.start_date, 3, '"Start Date" must map to start_date');
  assert.ok(mapping.name !== undefined, 'name must be mapped for the batch to proceed without user edits');

  // Confidence must be present and in [0,1] for every assigned field.
  for (const f of ['name', 'client_ref', 'client_external_ref', 'start_date'] as const) {
    const c = confidence[f];
    assert.ok(c !== undefined && c > 0 && c <= 1, `${f} confidence must be a plausible score, got ${c}`);
  }
}

// Distinct project-name vs client-name columns must NOT be collapsed.
{
  const headers: SheetCell[] = ['Project Name', 'Client Name', 'Start Date'];
  const sample: SheetCell[][] = [['Audit 2026', 'Abdallah Group', '2026-09-01']];
  const { mapping } = proposeColumnMapping(headers, sample);
  assert.strictEqual(mapping.name, 0, 'distinct "Project Name" column must win over mirroring');
  assert.strictEqual(mapping.client_ref, 1, 'distinct "Client Name" column must map separately');
}

// ── 3. buildIntakeRows — blank name kept (never silently dropped) ───────
{
  const { mapping } = proposeColumnMapping(messyFile[6], messyFile.slice(7, 11));
  const rows = buildIntakeRows(messyFile, 6, mapping);
  assert.strictEqual(rows.length, 4, `expected 4 data rows, got ${rows.length}`);
  assert.strictEqual(rows[0].name, 'Abdallah Group');
  assert.strictEqual(rows[0].client_external_ref, 'CR-1001');
  assert.ok(rows[0].start_date && rows[0].start_date.startsWith('2026-09-01'), 'start_date must parse to ISO');
  assert.strictEqual(rows[2].client_external_ref, null, 'Northgate has no CR number — must be null, not ""');
  assert.strictEqual(rows[3].name, '', 'the blank-name row must be KEPT as a row with name="" (surfaced, not dropped)');
  assert.strictEqual(rows[3].rowNumber, 11, 'rowNumber must be the 1-based spreadsheet row for user-facing messages');
}

// ── 4. Client resolution — ref first, name second, ambiguous is a question ─
const existing: ExistingClient[] = [
  { id: 'c1', name: 'Abdallah Group', external_ref: 'CR-1001' },
  { id: 'c2', name: 'Centro Trading LLC', external_ref: null },
  { id: 'c3', name: 'Fully Unrelated Co', external_ref: null },
];

{
  // Exact ref match wins even if the name differs.
  const row: IntakeRow = { rowNumber: 1, name: 'Abdallah Grp (renamed)', client_ref: 'Abdallah Grp (renamed)', client_external_ref: 'CR-1001', start_date: null, start_date_raw: null, shape: 'data' };
  const m = resolveClientMatch(row, existing);
  assert.strictEqual(m.kind, 'ref');
  if (m.kind === 'ref') assert.strictEqual(m.client.id, 'c1');
}

{
  // A ref that matches nothing is a NEW client, not ambiguous, not a name guess.
  const row: IntakeRow = { rowNumber: 2, name: 'Someone Else', client_ref: 'Someone Else', client_external_ref: 'CR-9999', start_date: null, start_date_raw: null, shape: 'data' };
  assert.strictEqual(resolveClientMatch(row, existing).kind, 'new');
}

{
  // Exact name match (no ref supplied).
  const row: IntakeRow = { rowNumber: 3, name: 'abdallah group', client_ref: 'abdallah group', client_external_ref: null, start_date: null, start_date_raw: null, shape: 'data' };
  const m = resolveClientMatch(row, existing);
  assert.strictEqual(m.kind, 'exact_name');
}

{
  // "Centro Trading" vs existing "Centro Trading LLC" — a near-miss must be
  // ambiguous (a question), never silently matched OR silently duplicated.
  const m = matchClientByName('Centro Trading', existing);
  assert.strictEqual(m.kind, 'ambiguous', `expected ambiguous, got ${m.kind}`);
  if (m.kind === 'ambiguous') assert.strictEqual(m.candidates[0].id, 'c2');
}

{
  // Genuinely new, unrelated name.
  const m = matchClientByName('Brand New Client Co', existing);
  assert.strictEqual(m.kind, 'new');
}

{
  // Blank name is its own kind — never silently treated as "new".
  const m = matchClientByName('   ', existing);
  assert.strictEqual(m.kind, 'blank');
}

{
  // normalizeClientName strips suffix noise so "LLC"/"Group" alone don't
  // dominate the comparison the way the raw string would.
  assert.strictEqual(normalizeClientName('Centro Trading LLC'), normalizeClientName('Centro Trading'));
  assert.notStrictEqual(normalizeClientName('Abdallah Group'), normalizeClientName('Northgate LLC'));
}

console.log('spreadsheetIntake.check.ts: all assertions passed');
