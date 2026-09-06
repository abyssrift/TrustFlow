#!/usr/bin/env node
/** Deterministic, secret-free verification entry point for local and CI agents. */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { execPath } from 'node:process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
function run(label, command, args) {
  console.log(`\n== ${label} ==`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    // npm/npx are .cmd shims on Windows and require shell dispatch there.
    shell: process.platform === 'win32',
  });
  if (result.error) { console.error(result.error.message); return false; }
  return result.status === 0;
}

let ok = true;
ok = run('Self-checks', npm, ['run', 'check']) && ok;
ok = run('Unit tests', npm, ['test']) && ok;
function runTypeScript() {
  console.log('\n== TypeScript (checked baseline) ==');
  const result = spawnSync(npx, ['tsc', '--noEmit'], {
    encoding: 'utf8', shell: process.platform === 'win32',
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  process.stdout.write(output);
  if (result.error) { console.error(result.error.message); return false; }
  const expected = JSON.parse(readFileSync('.agents/skills/trustflow-verify/tsc-baseline.json', 'utf8'));
  const actual = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^(.+?)\((\d+),\d+\): error (TS\d+):/);
    if (!match) continue;
    const key = `${match[1].replaceAll('\\\\', '/')}#${match[3]}`;
    actual[key] = (actual[key] || 0) + 1;
  }
  const same = JSON.stringify(actual, Object.keys(actual).sort()) === JSON.stringify(expected, Object.keys(expected).sort());
  if (!same) {
    console.error('\nTypeScript diagnostics differ from the checked-in baseline.');
    console.error(`Expected: ${JSON.stringify(expected)}`);
    console.error(`Actual:   ${JSON.stringify(actual)}`);
    return false;
  }
  console.log(`TypeScript baseline matched (${Object.values(actual).reduce((a, b) => a + b, 0)} known diagnostics).`);
  return true;
}
ok = runTypeScript() && ok;

const pushBase = process.env.VERIFY_GIT_BASE;
const initialPush = !pushBase || /^0+$/.test(pushBase);
const base = !initialPush ? pushBase : process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'HEAD';
const sourceGlobs = ['*.ts', '*.tsx', '*.js', '*.jsx'];
const tracked = spawnSync('git', ['diff', '--name-only', base, '--', ...sourceGlobs], { encoding: 'utf8' });
const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '--', ...sourceGlobs], { encoding: 'utf8' });
const babelFiles = `${tracked.status === 0 ? tracked.stdout : ''}\n${untracked.status === 0 ? untracked.stdout : ''}`.split(/\r?\n/)
  .map(file => file.trim()).filter((file, index, all) => file && all.indexOf(file) === index && !file.startsWith('supabase/functions/'));
if (babelFiles.length) ok = run('Babel (changed Metro files)', execPath, ['scripts/babelcheck.mjs', ...babelFiles]) && ok;
else console.log('\n== Babel (changed Metro files) ==\nNo changed Metro files; skipped targeted check.');

ok = run('Web export', npm, ['run', 'build:web']) && ok;

// Only inspect an already-running local Docker database. Never use credentials,
// link a project, push migrations, or reset a database from this gate.
const docker = spawnSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
const localDb = docker.status === 0 && docker.stdout.split(/\r?\n/).some(name => /^supabase_db_/i.test(name.trim()));
if (localDb && existsSync('supabase/checks/migration_drift.js')) {
  ok = run('Supabase migration drift (local Docker only)', execPath, ['supabase/checks/migration_drift.js']) && ok;
  ok = run('Supabase lint (local Docker only)', npx, ['supabase', 'db', 'lint', '--local']) && ok;
} else {
  console.log('\n== Supabase local checks ==\nNo local Supabase Docker database detected; skipped (production is never contacted).');
}
process.exit(ok ? 0 : 1);
