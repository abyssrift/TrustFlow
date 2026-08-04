# Production deploy runbook

**Target:** `wbvgufqfgbvbinjrdzlg` — `portal.trustedgellc.com`
**Scope of this deploy:** 45 pending migrations (`20260731_companies_terminology` →
`20260804_seed_company_default_roles`), plus one vault secret.
**Written:** 2026-08-04. Re-verify the counts in §1 before running; they are a
snapshot, not a promise.

---

## 0. The three things that make this deploy different

**It has never been rehearsed end to end.** Production's last migration is
`20260730133225`. Everything after it went onto local one file at a time, by
hand, in whatever order it was written. "Each migration worked when I ran it"
is not the same claim as "all 45 apply in filename order to a database that has
none of them", and only the second one matters here. §2 is that rehearsal, and
it is not optional.

**Ten of the 45 patch a live function body** rather than replacing it. They read
the deployed definition with `pg_get_functiondef`, rewrite part of it, and
install the result. That makes them **order-sensitive and environment-sensitive
in a way ordinary DDL is not**: run them out of order, or against a body that
differs from the one the author was looking at, and they either fail loudly or —
worse — patch something subtly different. They are listed in §2.3.

**One of them changes how notifications reach the outside world.**
`20260804_edge_base_url_from_vault` swaps a hardcoded production URL for a vault
lookup, and is deliberately **fail-closed**: absent secret → NULL URL → the POST
is skipped. Apply it before setting the secret and notification dispatch stops
silently. §4 sets the secret *first* for exactly this reason.

---

## 1. Pre-flight

Run all of these and write the numbers down. They are the baseline that §6
compares against.

```sql
-- Where production actually is
select version, name from supabase_migrations.schema_migrations
order by version desc limit 3;
-- expect the newest to be 20260730133225 / filehub_folder_versions_read_and_restore

-- The #181 baseline (this deploy is supposed to move all four of these)
select
  (select count(*) from public.companies)                                   as companies,
  (select count(*) from public.companies c
    where not exists (select 1 from public.roles r where r.company_id = c.id)) as zero_role_companies,
  (select count(*) from public.roles)                                       as roles,
  (select count(*) from public.user_roles ur join public.roles r on r.id = ur.role_id
    where r.company_id is null and r.is_system)                             as on_global_template;
-- 2026-08-04 baseline: 6 / 4 / 14 / 29

-- The #169 baseline
select proname,
       (prosrc like '%.supabase.co/functions/v1/%') as hardcoded,
       (prosrc like '%fn_edge_base_url%')           as via_vault
from pg_proc where pronamespace = 'public'::regnamespace
  and prosrc like '%functions/v1%' order by 1;
-- 2026-08-04 baseline: 5 rows, all hardcoded = true, via_vault = false

-- Volume, so a migration that silently eats rows is visible afterwards
select
  (select count(*) from public.tasks     where deleted_at is null) as tasks,
  (select count(*) from public.projects  where deleted_at is null) as projects,
  (select count(*) from public.pipelines where deleted_at is null) as pipelines,
  (select count(*) from public.users     where deleted_at is null) as users;
```

**Backup.** Take a fresh one from the Supabase dashboard (Database → Backups)
and confirm its timestamp is *after* the pre-flight above. Do not rely on the
nightly: if this deploy runs at 14:00, the nightly is up to 14 hours stale, and
§7 is written on the assumption that the restore point is minutes old, not
hours.

**Announce a window.** §3 rewrites function bodies that the running app calls.
Nothing here takes a long lock, but a user mid-action during a `CREATE OR
REPLACE FUNCTION` can get one failed request. Ten minutes of quiet is enough.

---

## 2. Rehearsal — mandatory, on local, before touching production

### 2.1 Get a database that looks like production

```bash
# from the repo root; the local stack must be up
docker ps --format '{{.Names}}' | grep supabase_db_TrustFlow
```

The rehearsal must run against a database at production's migration level — not
against local-as-it-is, which already has all 45 applied by hand and will
therefore "pass" without proving anything. Restore a production backup into a
scratch database, or roll a fresh one to `20260730133225`.

> **NEVER** `supabase db push`, `db reset`, `migration up`, or `migration repair`.
> The CLI in this repo is linked to **production** (`supabase/.temp/project-ref`).
> Local work is always:
> ```bash
> MSYS_NO_PATHCONV=1 docker exec -i supabase_db_TrustFlow \
>   psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/<file>.sql
> ```

### 2.2 Apply all 45 in filename order, stopping at the first failure

```bash
for f in $(ls supabase/migrations/*.sql | awk -F/ '$NF >= "20260731_" {print}' | sort); do
  echo "── $f"
  MSYS_NO_PATHCONV=1 docker exec -i supabase_db_TrustFlow \
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < "$f" || { echo "FAILED: $f"; break; }
done
```

`ON_ERROR_STOP=1` and the `break` together are the point: a partial apply that
keeps going is how you get a production schema no environment has ever seen.

### 2.3 Pay attention to these ten

They patch a live body instead of replacing it, so they are the ones that can
fail on a database whose functions differ from the author's:

| Migration | Patches |
|---|---|
| `20260801_project_deliverable` | task/project RPC bodies |
| `20260801_spreadsheet_intake_portfolio_folder` | `rpc_instantiate_template` |
| `20260802_drop_stale_stage_rpc_overloads` | drops overloads — **PGRST203 risk if skipped** |
| `20260802_rollforward_link_guard` | `rpc_rollforward_project` |
| `20260803_batch_past_start_dates_allowed` | preview + instantiate |
| `20260803_project_stage_on_create_and_needs_attention` | project create path |
| `20260803_projects_table_field_filter` | the projects list RPC |
| `20260804_edge_base_url_from_vault` | 5 edge invokers (6th absent in prod — skips cleanly) |
| `20260804_project_field_display_format` | `rpc_save_project_field_def` |
| `20260804_seed_company_default_roles` | seeds + backfills |

A migration that adds a parameter must **`DROP` the old signature explicitly**.
`CREATE OR REPLACE FUNCTION` with a changed argument list creates an
**overload**, not a replacement — Postgres keys on name + argument types — and
PostgREST then returns `PGRST203` for every call. This has bitten this repo
before; it is why `20260802_drop_stale_stage_rpc_overloads` exists.

### 2.3a What the 2026-08-04 rehearsal already established

Three findings, all verified, that change how much §2.3 should worry you.

**The body-patching migrations are NOT environment-sensitive after all.** Every
function the four runtime patchers target — `rpc_projects_table`,
`rpc_rollforward_project`, `rpc_save_project_field_def`,
`rpc_instantiate_template` — **does not exist in production.** Confirmed: a
`pg_proc` count over all nine names this batch touches returns **0**. They are
created by earlier migrations *in this same batch*, so the bodies those
patchers read are the ones the repo just wrote, not something production
drifted to. Run them in order and the anchors are exactly what the author saw.

The one genuine exception is `20260804_edge_base_url_from_vault`, which patches
five pre-existing invokers. All five were verified present in production with
the hardcoded host still in the body, and the sixth the migration names
(`fn_invoke_billing_paymob_renew`) is absent and skips cleanly.

**Three migrations are NOT safely re-runnable.** Re-applying all 45 in filename
order to an already-migrated database gives 42 ok, 3 failed:

| Migration | Fails with |
|---|---|
| `20260731_project_hierarchy_3_rpc_instantiate` | `function name "rpc_instantiate_template" is not unique` |
| `20260731_project_hierarchy_5_gap_fixes` | same |
| `20260803_project_stage_on_create_and_needs_attention` | `rpc_projects_table must have exactly 1 signature, found 2` |

This is **not** a clean-apply problem. It is the overload trap seen from the
other side: an early migration re-creates a signature that a later one
replaced, so on a database that already has the final state you briefly get two.
It matters for §7 — **do not blindly re-run a migration that half-applied.**
Check `pg_get_function_identity_arguments` first and drop the stale signature.

**No new overloads are introduced by this batch.** A post-run scan found eight
`rpc_*` names with two signatures, all of them filehub/pipeline functions
(`rpc_filehub_upload_commit`, `rpc_create_pipeline`, …) that predate this work
and are outside it. Worth their own issue; not this deploy's business.

### 2.4 Run every check

```bash
for f in supabase/checks/*.sql; do
  echo "── $f"
  MSYS_NO_PATHCONV=1 docker exec -i supabase_db_TrustFlow \
    psql -U postgres -d postgres -f - < "$f" 2>&1 | grep -E 'NOTICE|ERROR'
done
node supabase/checks/migration_drift.js
```

**Five checks fail today and none of them indicates a broken build.** All five
were verified on 2026-08-04 as stale or fragile — the code is right and the
check is out of date. Do not let them abort the deploy, and do not "fix" the
code to satisfy them. Tracked in #201.

| Check | Why it fails |
|---|---|
| `20260731_projects_p3_table_check` | asserts an unstaged project keeps `current_stage_id IS NULL`. `trg_projects_default_stage` (20260803) now assigns one on insert — the check predates the feature. |
| `20260731_project_stage_move_check` | "expected 1 history row, got 2" — same trigger. The insert now stages the project, which writes a history row, then the move writes the second. |
| `20260801_portfolio_flow_analytics_check` | "expected wip_count=1, got 2" — same trigger again. Projects now start staged, so both count as WIP. |
| `check_rollforward_link_guard` | written to demonstrate the vulnerability, and expects RLS to silently deny (0 rows). The fix shipped as a **raising trigger**, which aborts the check. The shipped behaviour is *louder* than the check expects, not weaker. |
| `check_rpc_rollforward_project` | picks two arbitrary real non-owner users (`ORDER BY u.id LIMIT 2`) and assumes neither holds `project.view_all`. In the company it selects, 3 of 9 non-owner users do. Fragile by construction. |

**On the last one specifically** — it was worth ruling out that
`20260804_seed_company_default_roles` had widened someone's access, since it
re-points `user_roles` off the global template. It provably has not: every
company-copy role holds **fewer or equal** permissions than the template it was
copied from, with identical `project.view_all`, and `has_permission` applies no
company filter to roles — so a global-role row always counted exactly as the
company copy now does. The backfill narrows or preserves; it cannot widen.

**Known drift, not caused by this deploy** — do not let it block you, and do not
"fix" it by replaying the migration:

- `20260516_teams_rls.sql` — 10 policies on `teams` / `team_members` /
  `team_roles`. Those tables carry 17 policies that exist in **no** migration.
  RLS policies are OR'd, so replaying this **widens** access on the RBAC tables.
  Tracked in #200.
- `20260430_harden_timer.sql` — one superseded `task_work_sessions` policy.

---

## 3. Apply to production

Only after §2 is green. In filename order, one at a time, watching each.

Use the Supabase MCP `apply_migration` (it records the ledger row) or the
dashboard SQL editor. **Stop at the first error** — do not skip a file and
continue. If number 19 fails, the schema is at 18 and that is a coherent state;
19 failed and 20–45 applied is not.

Migrations that print `RAISE NOTICE` counts (`20260803_backfill_project_view_all`,
`20260804_seed_company_default_roles`) — **record what they say.** Those numbers
are the evidence the backfill did something, and they cannot be recovered later.

Expect from `20260804_seed_company_default_roles` on production:
`#181 backfill: 4 company(ies) seeded, ~29 user_roles row(s) moved off the global template`

---

## 4. The vault secret — **before** the migration that needs it, not after

`20260804_edge_base_url_from_vault` is fail-closed by design: no secret → NULL
URL → POST skipped. Setting the secret first means there is never a window where
notification dispatch is silently off.

```sql
select vault.create_secret(
  'https://wbvgufqfgbvbinjrdzlg.supabase.co',
  'edge_functions_base_url',
  'Base URL for edge function invocation from SQL (#169)'
);
```

Then confirm before moving on:

```sql
select public.fn_edge_base_url();  -- after the migration lands; must NOT be null
```

The migration deliberately does **not** seed this from the literal it removes.
Seeding it would mean a restored clone configures itself to call production —
which is the entire failure #169 exists to prevent. A clone is inert until
someone deliberately gives it a base URL.

---

## 5. Edge functions

Nothing to deploy. Production is at 8 functions after `687fc17` removed
`generate-pdf-report-v8` and `purge-ksa-templates-cleanup`.

Four functions exist in the repo and are **not** deployed —
`billing-paymob-renew`, `billing-webhook-paymob`, `create-paymob-checkout`,
`import-oauth`. Leave them that way. `fn_invoke_billing_paymob_renew` has been
POSTing to a 404, and that function does not exist in production anyway.

**Do not run a bulk `supabase functions deploy`.** It would deploy all four.

---

## 6. Verify

```sql
-- Ledger advanced to the end
select version, name from supabase_migrations.schema_migrations
order by version desc limit 3;

-- #181 resolved
select
  (select count(*) from public.companies c
    where not exists (select 1 from public.roles r where r.company_id = c.id)) as zero_role_companies,
  (select count(*) from public.user_roles ur join public.roles r on r.id = ur.role_id
    where r.company_id is null and r.is_system)                               as on_global_template,
  (select count(*) from pg_trigger where tgname = 'trg_companies_seed_default_roles') as seed_trigger;
-- want: 0 / 0 / 1

-- #169 resolved
select proname,
       (prosrc like '%.supabase.co/functions/v1/%') as hardcoded,
       (prosrc like '%fn_edge_base_url%')           as via_vault
from pg_proc where pronamespace = 'public'::regnamespace
  and prosrc like '%functions/v1%' order by 1;
-- want: 5 rows, hardcoded = false, via_vault = true
select public.fn_edge_base_url() is not null as base_url_set;

-- No overload duplicates (the PGRST203 shape)
select proname, count(*) from pg_proc
where pronamespace = 'public'::regnamespace and proname like 'rpc_%'
group by proname having count(*) > 1;
-- want: zero rows

-- Volume unchanged (compare to §1)
select
  (select count(*) from public.tasks     where deleted_at is null) as tasks,
  (select count(*) from public.projects  where deleted_at is null) as projects,
  (select count(*) from public.pipelines where deleted_at is null) as pipelines,
  (select count(*) from public.users     where deleted_at is null) as users;
```

**Then use the app, in production, as a real user.** The queries above prove the
schema moved; they do not prove the product works. Minimum: open a board and
advance a task; open a project and check its fields render (a Year must read
`2025`, not `2,025`); import a small spreadsheet; re-import it edited and take
the Update path; trigger something that notifies and confirm the notification
actually arrives — that last one is the only real test that §4 worked.

---

## 7. If it goes wrong

**A migration fails mid-run.** Stop. Do not skip it. Read the error — most
likely an overload (§2.3) or a patch migration meeting a body it did not expect.
The schema is at the last successful file, which is a state §2 rehearsed. Fix
forward on local, re-rehearse, come back.

> **Do not simply re-run the failed file.** §2.3a proves three of these are not
> idempotent: an early migration re-creating a signature a later one replaced
> leaves two, and the next statement dies on ambiguity. Before any retry:
> ```sql
> select proname, pg_get_function_identity_arguments(oid)
> from pg_proc where pronamespace='public'::regnamespace and proname = '<fn>';
> ```
> More than one row means drop the stale signature explicitly before retrying.

**Applied cleanly but the app is broken.** Restore the §1 backup. Everything in
this deploy is schema and function bodies; there is no data migration whose loss
would outweigh a restore, with one exception:

> **`20260804_seed_company_default_roles` writes rows** — it seeds roles and
> re-points `user_roles`. A restore undoes that too, which is fine, but if the
> deploy is later re-run those `RAISE NOTICE` counts will differ from the ones
> recorded in §3 because the first run already moved some. Not a fault; expect
> it and do not read it as a failure.

**Notifications stopped.** §4's secret is missing or wrong. Confirm with
`select public.fn_edge_base_url();` — a NULL means the invokers are silently
skipping every POST, exactly as designed. Set the secret; no redeploy needed.

**Rolling back one function.** The old body is in the migration that created it,
not in the patch that rewrote it. `git log -S '<function name>'
supabase/migrations/` finds the chain.

---

## 8. After

- Update #181 and #169 with the production numbers from §6, and close them only
  after a human has looked at the running app — **never close an issue without
  human review.**
- The 16 shipped-but-unconfirmed issues (#171, #173, #174, #175, #176, #177,
  #179, #180, #182, #183, #185, #186, #188, #189, #190, #196) become confirmable
  once this is live.
- #200 (objects live in the DB but in no migration) is still open and this
  deploy does not address it. The two known cases are in §2.4.
