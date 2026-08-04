import assert from 'node:assert/strict';

import { effectiveName, idsBySheetName } from './importConflicts';

// The failure this file exists to catch is silent. Every mapping below is used
// to decide which project a spreadsheet row's figures are written onto, so a
// wrong answer does not error — it overwrites the wrong project's numbers.

// ── effectiveName ───────────────────────────────────────────────────────────
assert.equal(effectiveName('Acme Audit', new Map()), 'Acme Audit', 'no rename means the sheet name');
assert.equal(effectiveName('Acme Audit', new Map([['Acme Audit', 'Acme Audit 2026']])), 'Acme Audit 2026');
assert.equal(effectiveName('Acme Audit', new Map([['Acme Audit', '  Acme 26  ']])), 'Acme 26', 'renames are trimmed');
assert.equal(effectiveName('Acme Audit', new Map([['Acme Audit', '   ']])), 'Acme Audit', 'a blank rename is not a rename');

// ── idsBySheetName ──────────────────────────────────────────────────────────
{
  // The realistic re-import: one row updated in place, one renamed so it lands
  // as a second project, one skipped, one ordinary new project.
  const sheetNames = ['Acme Audit', 'Beta Tax', 'Gamma Review', 'Delta Payroll'];
  const renames = new Map([['Beta Tax', 'Beta Tax 2026']]);
  const replacements = new Map([['Acme Audit', 'proj-existing-acme']]);
  const idByDbName = new Map([
    ['Beta Tax 2026', 'proj-new-beta'],
    ['Delta Payroll', 'proj-new-delta'],
  ]);

  const ids = idsBySheetName(sheetNames, renames, replacements, idByDbName);

  assert.equal(ids.get('Acme Audit'), 'proj-existing-acme', 'an updated row points at the project that already existed');
  assert.equal(ids.get('Beta Tax'), 'proj-new-beta', 'a renamed row is keyed by its SHEET name but resolves to the new project');
  assert.equal(ids.get('Delta Payroll'), 'proj-new-delta');
  assert.equal(ids.has('Gamma Review'), false, 'a skipped row gets no project at all');
  assert.equal(ids.size, 3);
}

{
  // The dangerous overlap: the user renamed one row TO the name of another row
  // they chose to update. 'Beta Tax' was removed from the payload (it is an
  // Update), so the project now called 'Beta Tax' in the portfolio belongs to
  // the renamed 'Acme Audit' row — and 'Beta Tax' must still resolve to the
  // pre-existing project, not to the newly created namesake.
  const ids = idsBySheetName(
    ['Acme Audit', 'Beta Tax'],
    new Map([['Acme Audit', 'Beta Tax']]),
    new Map([['Beta Tax', 'proj-existing-beta']]),
    new Map([['Beta Tax', 'proj-new-from-acme-row']]),
  );

  assert.equal(ids.get('Beta Tax'), 'proj-existing-beta', 'an Update is never overwritten by a same-named create');
  assert.equal(ids.get('Acme Audit'), 'proj-new-from-acme-row', 'the renamed row still finds the project it created');
}

{
  // Nothing came back from the portfolio (commit created nothing, or the
  // follow-up select failed): replacements must still map, so a pure
  // correction pass writes its columns.
  const ids = idsBySheetName(['Acme Audit'], new Map(), new Map([['Acme Audit', 'proj-existing']]), new Map());
  assert.equal(ids.get('Acme Audit'), 'proj-existing');
  assert.equal(ids.size, 1);
}

console.log('importConflicts: all assertions passed (updated, renamed, skipped and colliding rows each map to the right project)');
