#!/usr/bin/env node
// Runs every *.check.ts assert-script (plain node:assert, no test framework)
// via tsx. Keep these out of vitest's default *.test.ts glob -- see #154.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// `.claude` holds git worktrees — 36 of them at time of writing, several with
// their own node_modules. Without it here the runner walks every sibling
// checkout, so `npm run check` from this repo reported 531 checks and 16
// failures that all lived in OTHER branches. The count became meaningless as
// evidence: the same suite reported 23/23 from inside a worktree and 515/531
// from the repo root, and neither number described the code being changed.
const IGNORE_DIRS = new Set(['node_modules', '.git', 'website', 'dist', '.expo', '.claude']);

function findCheckFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findCheckFiles(full));
    else if (entry.name.endsWith('.check.ts')) out.push(full);
  }
  return out;
}

const files = findCheckFiles(process.cwd()).sort();

if (files.length === 0) {
  console.log('No *.check.ts files found.');
  process.exit(0);
}

let failed = 0;
for (const file of files) {
  const result = spawnSync('npx', ['tsx', file], { stdio: 'inherit', shell: true });
  if (result.status !== 0) failed++;
}

console.log(`\n${files.length - failed}/${files.length} checks passed`);
process.exit(failed > 0 ? 1 : 0);
