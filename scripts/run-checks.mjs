#!/usr/bin/env node
// Runs every *.check.ts assert-script (plain node:assert, no test framework)
// via tsx. Keep these out of vitest's default *.test.ts glob -- see #154.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const IGNORE_DIRS = new Set(['node_modules', '.git', 'website', 'dist', '.expo']);

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
