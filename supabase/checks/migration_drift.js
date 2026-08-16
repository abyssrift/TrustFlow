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
 * #195 — POLICIES. This check reported "drift: NONE" while local had RLS
 * enabled on storage.objects and ZERO policies on it, so every upload in the
 * app was denied. Ten migrations define storage policies; none had been
 * applied. A checker whose job is "does the database match the repo", in an
 * app whose entire security model is RLS, could not see the security model.
 * Two things were wrong and both are fixed here:
 *   - CREATE POLICY was never extracted;
 *   - the `present` side only looked at schema `public`, so even had it been
 *     extracted, every storage.* policy would have read as missing.
 * Policies are keyed schema.table.policy because a policy name is only unique
 * within its table — `tasks_select` and `projects_select` are different
 * objects, and several tables here use the same suffixes.
 *
 * DROPs are now tracked too, for every kind. Without that, adding policies
 * would have produced instant false positives: this repo routinely drops and
 * recreates a policy under a new name (projects_update, 20260803), and the
 * old name would have been reported missing forever. For each object the LAST
 * migration that mentions it decides — created, or dropped and left dropped.
 * A file that drops and recreates in one breath counts as a create.
 *
 * ponytail: signature extraction is regex over DDL, not a SQL parser. It reads
 * CREATE FUNCTION/TABLE/INDEX/TRIGGER/POLICY and ADD COLUMN, which covers
 * essentially every migration in this repo. It cannot see a migration whose
 * only effect is an UPDATE or a GRANT — if drift is suspected in one of those,
 * verify by hand. Nor does it check a policy's BODY: a policy present under
 * the right name but with the wrong USING clause reads as fine here. Upgrade
 * path if either bites: parse with pgsql-ast, or diff a dumped schema.
 *
 * #200 — REVERSE PASS. Repo → DB drift (above) makes a feature not work,
 * loudly and locally. DB → repo drift — an object hand-applied straight to a
 * database and never captured in a migration — is silent everywhere and only
 * detonates on a rebuild or a fresh environment, at which point whatever
 * behaviour it was quietly holding up is just gone, with nothing in version
 * control to restore it from. Two real examples that motivated this: the
 * company default-role-seeding trigger (#181) and 17 RBAC policies on
 * teams/team_members/team_roles (#195) — both live, both load-bearing,
 * neither named by any migration.
 *
 * For each function/table/trigger/policy actually in the database, is its
 * name mentioned by ANY migration at all (as a create OR a drop — this pass
 * asks "does the repo know this name exists", not "should it currently
 * exist", which is the forward pass's job). Scoped to `public` (functions,
 * tables, triggers) plus `public`+`storage` (policies, since this app writes
 * its own storage policies) — every other schema (`auth`, `realtime`,
 * `vault`, `pgsodium`, `extensions`, `cron`, `net`, …) is Supabase/extension
 * infrastructure this repo's migrations never touch, so it would be 100%
 * noise. Extension-OWNED objects that do land in `public` (pg_cron, uuid-
 * ossp, etc. sometimes install there) are filtered via pg_depend — a
 * `CREATE EXTENSION` dependency, not a migration's CREATE FUNCTION/TABLE/
 * TRIGGER, is what made them exist. Index/column are deliberately excluded
 * from this pass: both are routinely created inline by CREATE TABLE (a
 * PRIMARY KEY implies an index; every column is a column) without a separate
 * DDL statement of their own, so a reverse check on them would mostly flag
 * things the forward-pass regexes were never going to see as "created" in
 * the first place — noise, not drift. One more known gap, same as the
 * forward pass's own ceiling: an object created by application code at
 * runtime (none currently known in this repo) would also read as reverse
 * drift here and needs triaging by hand, same as everything else this script
 * can't see the intent behind.
 *
 * Expect a large baseline count the first time this runs, and don't read it
 * as 200 new incidents: the earliest migration FILE in this repo is dated
 * 2026-04-30 (confirmed by `ls supabase/migrations | sort | head`), so the
 * entire pre-existing schema — has_permission(), my_company_id(), the core
 * tables, dozens of RPCs — predates migration tracking altogether and will
 * always read as reverse drift. That is a real, known gap (the whole
 * foundation isn't in version control either), but it is a DIFFERENT problem
 * from #181/#195's silent-recent-drift — those two are exactly the kind of
 * NEW orphan this pass exists to catch, and it does catch them. The
 * practical path to a clean, meaningful signal: capture the current schema
 * once as a single consolidated baseline migration (`pg_dump --schema-only`
 * against prod, checked in as migration #1), which zeroes this count in one
 * shot; every orphan found after that is a genuine new incident, not
 * pre-tracking history.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const MIGRATIONS = path.join(__dirname, '..', 'migrations');
const CONTAINER = process.env.SUPABASE_DB_CONTAINER || 'supabase_db_TrustFlow';

const files = fs.readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort();
const sigs = [];
/** `kind:name` -> 'create' | 'drop', decided by the LAST migration to mention it. */
const lastAction = new Map();

/** Bare object name: unqualified, unquoted, lowercased. */
const norm = raw => String(raw || '').replace(/^public\./i, '').replace(/["`]/g, '').trim().toLowerCase();

/** A policy is identified by the table it guards, so it carries its schema. */
const policyName = (name, table) => {
  const t = String(table || '').replace(/["`]/g, '').trim().toLowerCase();
  return `${t.includes('.') ? t : `public.${t}`}.${String(name || '').replace(/["`]/g, '').trim().toLowerCase()}`;
};

for (const f of files) {
  const sql = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8')
    .split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

  const creates = [];
  const drops = [];
  const add = (kind, name) => { if (name) creates.push({ kind, name }); };
  const rm = (kind, name) => { if (name) drops.push({ kind, name }); };

  for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w."]+)\s*\(/gi)) add('function', norm(m[1]));
  for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)/gi)) add('table', norm(m[1]));
  for (const m of sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)/gi)) add('index', norm(m[1]));
  for (const m of sql.matchAll(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w"]+)/gi)) add('column', norm(m[1]));
  for (const m of sql.matchAll(/CREATE\s+TRIGGER\s+([\w."]+)/gi)) add('trigger', norm(m[1]));
  for (const m of sql.matchAll(/CREATE\s+POLICY\s+(?:"([^"]+)"|([\w]+))\s+ON\s+([\w."]+)/gi)) add('policy', policyName(m[1] ?? m[2], m[3]));

  for (const m of sql.matchAll(/DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?([\w."]+)\s*\(/gi)) rm('function', norm(m[1]));
  for (const m of sql.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w."]+)/gi)) rm('table', norm(m[1]));
  for (const m of sql.matchAll(/DROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?([\w."]+)/gi)) rm('index', norm(m[1]));
  for (const m of sql.matchAll(/DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?([\w."]+)/gi)) rm('trigger', norm(m[1]));
  for (const m of sql.matchAll(/DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?(?:"([^"]+)"|([\w]+))\s+ON\s+([\w."]+)/gi)) rm('policy', policyName(m[1] ?? m[2], m[3]));
  for (const m of sql.matchAll(/DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?([\w"]+)/gi)) rm('column', norm(m[1]));

  for (const c of creates) {
    sigs.push({ file: f, ...c });
    lastAction.set(`${c.kind}:${c.name}`, 'create');
  }
  // A drop-and-recreate inside one file is a create, not a removal — that is
  // the shape every "add a parameter to an RPC" migration in this repo takes.
  for (const d of drops) {
    if (creates.some(c => c.kind === d.kind && c.name === d.name)) continue;
    lastAction.set(`${d.kind}:${d.name}`, 'drop');
  }
}

/** Only objects the repo, read end to end, still expects to exist. */
const live = sigs.filter(s => lastAction.get(`${s.kind}:${s.name}`) === 'create');

const values = live
  .map(s => `('${s.file.replace(/'/g, "''")}','${s.kind}','${s.name.replace(/'/g, "''")}')`)
  .join(',');

// #200 reverse pass: every name ANY migration has ever mentioned, create or
// drop — "does the repo know this name", not "should it exist right now".
// lastAction's keys already cover both (see the loop above).
const known = new Map(); // kind -> Set<name>
for (const key of lastAction.keys()) {
  const i = key.indexOf(':');
  const kind = key.slice(0, i), name = key.slice(i + 1);
  if (!known.has(kind)) known.set(kind, new Set());
  known.get(kind).add(name);
}
const REVERSE_KINDS = ['function', 'table', 'trigger', 'policy'];
const knownValues = REVERSE_KINDS
  .flatMap(kind => [...(known.get(kind) || [])].map(name => `('${kind}','${name.replace(/'/g, "''")}')`))
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
  -- No schema filter: the policies this check was blind to were on
  -- storage.objects, and pg_policies already spans every schema.
  UNION ALL SELECT 'policy',  lower(schemaname || '.' || tablename || '.' || policyname) FROM pg_policies
),
known(kind, name) AS (VALUES ${knownValues}),
-- Reverse pass source: public-schema functions/tables/triggers (extension-
-- owned ones excluded via pg_depend -- CREATE EXTENSION put them there, not
-- a migration) plus public+storage policies. See the #200 comment up top
-- for why every other schema and kind is out of scope.
db_objects AS (
  SELECT 'function' AS kind, lower(p.proname) AS name
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  UNION ALL
  SELECT 'table', lower(c.relname)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
  UNION ALL
  SELECT 'trigger', lower(t.tgname)
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT t.tgisinternal
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = t.oid AND d.deptype = 'e')
  UNION ALL
  SELECT 'policy', lower(schemaname || '.' || tablename || '.' || policyname)
    FROM pg_policies WHERE schemaname IN ('public', 'storage')
)
SELECT 'FWD ' || s.file || '  [' || string_agg(DISTINCT s.kind || ':' || s.name, ', ') || ']'
FROM sig s
LEFT JOIN present p ON p.kind = s.kind AND p.name = s.name
WHERE p.name IS NULL
GROUP BY s.file
UNION ALL
SELECT DISTINCT 'REV ' || o.kind || ':' || o.name
FROM db_objects o
LEFT JOIN known k ON k.kind = o.kind AND k.name = o.name
WHERE k.name IS NULL
ORDER BY 1;`;

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

const lines = out.split('\n').map(l => l.trim()).filter(Boolean);
const missing = lines.filter(l => l.startsWith('FWD ')).map(l => l.slice(4));
const orphans = lines.filter(l => l.startsWith('REV ')).map(l => l.slice(4));
const byKind = live.reduce((a, s) => ({ ...a, [s.kind]: (a[s.kind] || 0) + 1 }), {});
console.log(
  `scanned ${files.length} migrations, ${live.length} live signatures ` +
  `(${sigs.length - live.length} later dropped) — ` +
  Object.entries(byKind).map(([k, n]) => `${n} ${k}`).join(', '),
);

if (!missing.length) {
  console.log('migration drift (repo -> DB): NONE — every object the migrations create exists locally');
} else {
  console.error(`\nmigration drift (repo -> DB): ${missing.length} file(s) with objects missing from the local DB:\n`);
  for (const m of missing) console.error('  ' + m);
  console.error('\nApply them to LOCAL ONLY with:');
  console.error('  MSYS_NO_PATHCONV=1 docker exec -i ' + CONTAINER + ' psql -U postgres -d postgres -f - < supabase/migrations/<file>.sql');
  console.error('NEVER `supabase db push` / `db reset` — the CLI is linked to PRODUCTION.');
}

if (!orphans.length) {
  console.log(`migration drift (DB -> repo): NONE — every public/storage function, table, trigger and policy is named by some migration`);
} else {
  console.error(`\nmigration drift (DB -> repo): ${orphans.length} DB object(s) not named by any migration:\n`);
  for (const o of orphans) console.error('  ' + o);
  console.error('\nEach one either needs a migration written to capture it, or should not be in the database.');
  console.error('False positive? Check it isn\'t extension-owned (pg_depend) or a runtime-created object — see the #200 comment up top.');
}

process.exit(missing.length || orphans.length ? 1 : 0);
