# Local Supabase Dev Environment

Free alternative to Supabase's paid branching: a full local Postgres/Auth/Storage/Realtime
stack (via Docker + the Supabase CLI) that rebuilds from the same migration files that
drive prod. No shared dev DB, no risk of colliding with someone else's test data.

## One-time setup (new collaborators)

1. Install Docker Desktop and make sure it's **running**.
2. `npm install` — the Supabase CLI is a devDependency, invoked via `npx supabase`.
3. `npx supabase login` — opens a browser, one-time auth.
4. `npx supabase link --project-ref wbvgufqfgbvbinjrdzlg`
5. `npx supabase start` — first run pulls several GB of images, takes a few minutes.
   Prints local URLs and keys when done (Postgres, API, Studio, Mailpit).
6. Copy `.env.local` (already in the repo, gitignored) — Expo picks it up automatically
   and points the app at the local stack instead of prod. No edits needed unless your
   `supabase start` prints different keys (it won't, they're fixed local dev demo keys).
7. Get `supabase/seed.sql` from a teammate (Slack/AirDrop/etc.) — it's a full data dump
   of prod and is gitignored on purpose, never distributed via git. Drop it in
   `supabase/` and run `npx supabase db reset` to load it. Without this file, `db reset`
   still works, you just get empty tables.

## Day to day

| Command | What it does |
|---|---|
| `npx supabase start` / `stop` | Boot / tear down the local stack |
| `npx supabase db reset` | Wipe and rebuild local DB from migrations, in seconds |
| `npx supabase migration new <name>` | Start a new schema change |
| `npx supabase db push --linked` | Send finished local migrations to prod |
| `npx supabase functions serve --env-file supabase/functions.env.local` | Run edge functions locally |
| `npm run seed` / `npm run seed:full` | Populate sample data — see `docs/SEED_GUIDE.md` |

To switch which backend the app talks to:

```bash
npm run env:local && npx expo start -c   # → local Supabase stack
npm run env:prod  && npx expo start -c   # → prod (falls back to .env)
```

`env:local`/`env:prod` just add or remove `.env.local` (restored from the committed
`.env.local.example` — not a secret, same fixed local-dev demo keys for everyone).
Always pass `-c` when switching — Metro caches the bundled env vars, and without it
you can end up talking to the previous backend without realizing.

## History: the 2026-07-29 baseline squash

`supabase/migrations/` used to contain 190+ files going back to April 2026, but they
weren't replayable from an empty database — the tables that everything else depends on
(`tasks`, `companies`, etc.) were never captured as migration files, and a chunk of later
migrations were applied straight to prod (via psql or the Supabase MCP tool) without ever
updating the CLI's migration-history bookkeeping. Result: `supabase start` / `db diff`
couldn't build a shadow database at all.

Fixed by dumping prod's actual current schema into one file,
`supabase/migrations/20260101000000_baseline_schema.sql` (timestamped before every other
migration so it applies first), and archiving the old files into
`supabase/migrations_archive/` for historical reference only — they are **not** replayed
anymore.

**Going forward: every schema change must be a new migration file** (`npx supabase
migration new <name>`), never a raw edit in the Dashboard SQL editor and never applied
directly via `execute_sql`/`apply_migration` without also committing the corresponding
file here. Either of those silently re-breaks this setup — local and prod drift apart
again with no local-only way to detect it.

### Extensions gotcha

`pg_dump` (what `supabase db dump` uses) doesn't capture `CREATE EXTENSION` statements
scoped to a single schema dump. The baseline file manually declares the ones the schema
actually needs: `pgcrypto`, `uuid-ossp`, `pg_trgm`, `pg_net`. If you add a new Postgres
extension in prod, add its `CREATE EXTENSION IF NOT EXISTS ...` line to your migration
by hand — it won't show up in a `db dump` automatically.

### `20260101000001_platform_config.sql`

Storage buckets and pg_cron schedules live outside the `public` schema, so the baseline
dump (scoped to `-s public`) missed them entirely. This migration recreates prod's 9
storage buckets (`storage.buckets` rows — same names/limits/mime-types, no actual file
contents) and all 12 `pg_cron` jobs (automations heartbeat, notification sweeps,
analytics flush, FileHub purges, retention warnings, rate-limit cleanup, trial expiry,
stale-session sweep) so local behaves the same on a timer, not just on-demand.
If you add a bucket or cron job in prod, add it here too — same drift risk as schema.

## Using this with Claude Code

`.mcp.json` in the repo root already points Claude Code at the local stack's built-in
MCP endpoint (`http://127.0.0.1:54321/mcp` — printed as `MCP_URL` by `supabase start`,
no separate package to install). After running `supabase start`, run `/mcp` inside
Claude Code, select `supabase-local`, and authenticate if prompted — that's it. This is
in addition to, not a replacement for, whatever cloud Supabase MCP connector you already
have for prod; the two point at different databases and don't conflict.

## What's real prod data vs. what isn't

`db reset` loads schema + buckets + cron jobs from migrations (safe, no PII), then real
prod data from `supabase/seed.sql` (gitignored — **never** put this in git, a cloud
drive, or anywhere without access control; it's actual customer records). It goes stale
the moment someone signs up or creates a task in prod — regenerate it with:

```bash
npx supabase db dump --data-only -s public --db-url "<prod-connection-string>" -f supabase/seed.sql
npx supabase db reset
```

Alternatively, use `npm run seed` / `npm run seed:full` for synthetic (non-real) sample
data instead — see `docs/SEED_GUIDE.md`.

## Known gaps

- **Storage file contents** aren't synced — buckets exist locally with the right
  config, but they're empty. Uploading a fresh file locally works fine; opening a file
  that existed in prod won't, since the bytes were never copied.
- **Edge function secrets** aren't set to their real prod values locally (Supabase
  never lets secret values be read back). `supabase/functions.env.local` (gitignored)
  has dummy placeholders for every secret every function reads — enough for all
  functions to boot under `functions serve`, not enough to actually hit Resend/Expo/
  Paymob/Trello/Jira. Swap in real values there if you need to test one of those
  integrations for real.
- **Auth/project dashboard config** (email templates, OAuth provider setup, JWT
  expiry, SMTP) isn't synced — local uses the CLI's generic defaults from
  `supabase/config.toml`, not prod's actual settings. There's no CLI command that pulls
  this down; it's config-toml-only, edited by hand if you need to match prod.
