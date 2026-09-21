// `npx tsx components/projects/ProjectSelectionStyles.check.ts`
// Keeps project table/board multi-select feedback on semantic theme tokens.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const table = readFileSync('components/projects/ProjectsTable.tsx', 'utf8').replaceAll('\r\n', '\n');
const board = readFileSync('components/projects/ProjectBoard.tsx', 'utf8').replaceAll('\r\n', '\n');

function selectionButton(source: string, name: string): string {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf('\n}\n\n', start);
  assert.ok(start >= 0 && end > start, `${name} should exist`);
  return source.slice(start, end + 2);
}

function selectionBar(source: string, endMarker: string): string {
  const start = source.indexOf('const selectionBar =');
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, 'selection bar boundaries should exist');
  return source.slice(start, end);
}

for (const [source, buttonName] of [
  [table, 'ProjectSelectionButton'],
  [board, 'BoardSelectionButton'],
] as const) {
  const button = selectionButton(source, buttonName);
  assert.match(button, /hover:bg-brand-primary\/10/);
  assert.match(button, /active:bg-brand-primary\/20/);
  assert.match(button, /active \|\| selected \? 'bg-brand-primary\/10'/);
  assert.doesNotMatch(button, /opacity|text-white/);
}

for (const bar of [
  selectionBar(table, '// One row of quiet controls'),
  selectionBar(board, 'const advanceProject ='),
]) {
  assert.match(bar, /bg-state-danger\/10/);
  assert.match(bar, /hover:bg-state-danger\/20/);
  assert.match(bar, /active:bg-state-danger\/30/);
  assert.match(bar, /disabled:bg-surface-overlay/);
  assert.match(bar, /text-state-danger/);
  assert.match(bar, /text-typography-muted/);
  assert.doesNotMatch(bar, /opacity|text-white/);
}

console.log('ProjectSelectionStyles.check: ok');
