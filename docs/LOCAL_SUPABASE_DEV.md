# Local Supabase Dev Environment

A full local Postgres/Auth/Storage/Realtime stack (Docker + the Supabase CLI) that
rebuilds from the same `supabase/migrations/` that drive prod. No shared dev DB, no
risk of colliding with someone else's test data.

## One-time setup (new collaborators)

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and make
   sure it's **running**.
2. `npm install` — the Supabase CLI is a devDependency, invoked via `npx supabase`.
3. `npx supabase login` — opens a browser, one-time auth.
4. `npx supabase link --project-ref wbvgufqfgbvbinjrdzlg`
5. `npx supabase start` — first run pulls several GB of Docker images, takes a few
   minutes. Prints local URLs and keys when done (Postgres, API, Studio, Mailpit).
6. Point the app at the local stack instead of prod:
   ```bash
   cp .env.example .env.local
   ```
   Fill in `EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` and the `anon key` printed
   by `supabase start`. Expo loads `.env.local` over `.env` automatically — no code
   changes needed. `.env.local` is gitignored, so this is machine-local.
7. Get `supabase/seed.sql` from a teammate (Slack/AirDrop/etc.) if you want real prod
   data — it's a full data dump and is gitignored on purpose, never distributed via
   git. Drop it in `supabase/` and run `npx supabase db reset` to load it. Without this
   file, `db reset` still works fine, you just get empty tables — use `npm run seed` /
   `npm run seed:full` instead (see `docs/SEED_GUIDE.md`) for synthetic sample data.

## Day to day

| Command | What it does |
|---|---|
| `npx supabase start` / `stop` | Boot / tear down the local stack |
| `npx supabase db reset` | Wipe and rebuild local DB from `supabase/migrations/`, in seconds |
| `npx supabase migration new <name>` | Start a new schema change |
| `npx supabase db push --linked` | Send finished local migrations to prod |
| `npx supabase functions serve --env-file supabase/functions.env.local` | Run edge functions locally (dummy secrets, enough for functions to boot) |
| `npm run seed` / `npm run seed:full` | Populate sample data — see `docs/SEED_GUIDE.md` |

To go back to talking to prod, delete or rename `.env.local` and restart with
`npx expo start -c` — always pass `-c` when switching, Metro caches the bundled env
vars and otherwise you can end up on the previous backend without realizing.

## Every schema change is a migration file

`npx supabase migration new <name>`, never a raw edit in the Dashboard SQL editor and
never applied directly via `execute_sql`/`apply_migration` without also committing the
corresponding file under `supabase/migrations/`. Either of those silently breaks
`db reset`/`db diff` locally — local and prod drift apart with no local-only way to
detect it.

## Using this with Claude Code

`.mcp.json` in the repo root already points Claude Code at the local stack's built-in
MCP endpoint (`http://127.0.0.1:54321/mcp` — printed as `MCP_URL` by `supabase start`,
no separate package to install). After running `supabase start`, run `/mcp` inside
Claude Code, select `supabase-local`, and authenticate if prompted. This is in addition
to, not a replacement for, whatever cloud Supabase MCP connector you already have for
prod — the two point at different databases and don't conflict.

## Known gaps

- **Storage file contents** aren't synced — buckets exist locally with the right
  config (from migrations), but they're empty unless you upload fresh files locally.
- **Edge function secrets** aren't real prod values. `supabase/functions.env.local`
  (gitignored) has dummy placeholders for every secret every function reads — enough
  for functions to boot under `functions serve`, not enough to actually hit
  Resend/Expo/Paymob/Trello/Jira. Swap in real values there if you need to test one of
  those integrations for real.
- **Auth/project dashboard config** (email templates, OAuth provider setup, JWT expiry,
  SMTP) isn't synced from prod — local uses the CLI's defaults in
  `supabase/config.toml`, edited by hand if you need to match prod.
