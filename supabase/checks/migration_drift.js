#!/usr/bin/env node
/*
 * Migration drift check — does what each migration CREATEs actually exist in the DB?
 *
 * Why this is not just "read supabase_migrations.schema_migrations": the local
 * database is seeded from a production dump, so its ledger reflects PROD's
 * history, not what has been applied locally since. On 2026-08-01 the ledger
 * held 2 rows against 223 migration files. The ledger is not evidence here;
 * schema existence is.
 *
 * This matters because every acceptance test in supabase/checks/ runs against
 * local. A missing migration means those checks validate a schema that does not
 * match the repo — and a check that passes against the wrong schema is worse
 * than no check at all. That is exactly what happened: rpc_move_task_pipeline
 * (called by EditTaskModal, both variants) was absent locally, so moving a task
 * between pipelines was broken and nothing noticed.
 *
 * Usage:  node supabase/checks/migration_drift.js
 * Exits 1 if anything is missing, so it can gate a script or a hook.
 *
 * ponytail: signature extraction is regex over DDL, not a SQL parser. It reads
 * CREATE FUNCTION/TABLE/INDEX/TRIGGER and ADD COLUMN, which covers essentially
 * every migration in this repo. It cannot see a migration whose only effect is
 * an UPDATE, a GRANT, or a policy change — if drift is suspected in one of
 * those, verify by hand. Upgrade path if that ever bites: parse with pgsql-ast
 * or diff a dumped schema instead.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const MIGRATIONS = path.join(__dirname, '..', 'migrations');
const CONTAINER = process.env.SUPABASE_DB_CONTAINER || 'supabase_db_TrustFlow';

const files = fs.readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort();
const sigs = [];

for (const f of files) {
  const sql = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8')
    .split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

  const add = (kind, raw) => {
    const name = String(raw || '').replace(/^public\./i, '').replace(/["`]/g, '').trim().toLowerCase();
    if (name) sigs.push({ file: f, kind, name });
  };

  for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w."]+)\s*\(/gi)) add('function', m[1]);
  for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)/gi)) add('table', m[1]);
  for (const m of sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)/gi)) add('index', m[1]);
  for (const m of sql.matchAll(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w"]+)/gi)) add('column', m[1]);
  for (const m of sql.matchAll(/CREATE\s+TRIGGER\s+([\w."]+)/gi)) add('trigger', m[1]);
}

const values = sigs
  .map(s => `('${s.file.replace(/'/g, "''")}','${s.kind}','${s.name.replace(/'/g, "''")}')`)
  .join(',');

const query = `
WITH sig(file, kind, name) AS (VALUES ${values}),
present AS (
  SELECT 'function' AS kind, lower(p.proname) AS name
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
  UNION ALL SELECT 'table',   lower(tablename)   FROM pg_tables   WHERE schemaname = 'public'
  UNION ALL SELECT 'index',   lower(indexname)   FROM pg_indexes  WHERE schemaname = 'public'
  UNION ALL SELECT 'column',  lower(column_name) FROM information_schema.columns WHERE table_schema = 'public'
  UNION ALL SELECT 'trigger', lower(tgname)      FROM pg_trigger  WHERE NOT tgisinternal
)
SELECT s.file || '  [' || string_agg(DISTINCT s.kind || ':' || s.name, ', ') || ']'
FROM sig s
LEFT JOIN present p ON p.kind = s.kind AND p.name = s.name
WHERE p.name IS NULL
GROUP BY s.file
ORDER BY s.file;`;

let out;
try {
  // Query goes in on stdin, not -c: with ~700 signatures it blows past the
  // Windows command-line length limit and the exec fails with a misleading
  // "container not found"-shaped error.
  out = execFileSync('docker', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-tAf', '-'],
    { encoding: 'utf8', input: query, env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
} catch (e) {
  console.error(`could not query ${CONTAINER} — is the local stack up? (docker ps)`);
  console.error(String(e.stderr || e.message).split('\n').slice(0, 3).join('\n'));
  process.exit(2);
}

const missing = out.split('\n').map(l => l.trim()).filter(Boolean);
console.log(`scanned ${files.length} migrations, ${sigs.length} signatures`);

if (!missing.length) {
  console.log('migration drift: NONE — every object the migrations create exists locally');
  process.exit(0);
}
console.error(`\nmigration drift: ${missing.length} file(s) with objects missing from the local DB:\n`);
for (const m of missing) console.error('  ' + m);
console.error('\nApply them to LOCAL ONLY with:');
console.error('  MSYS_NO_PATHCONV=1 docker exec -i ' + CONTAINER + ' psql -U postgres -d postgres -f - < supabase/migrations/<file>.sql');
console.error('NEVER `supabase db push` / `db reset` — the CLI is linked to PRODUCTION.');
process.exit(1);
