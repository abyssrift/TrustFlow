# Production deploy runbook

**This document is a procedure, not a plan for a specific batch.** The version
before it was written around one particular set of 45 pending migrations. Those
shipped, the document was never updated, and following it three days later would
have replayed all 45 against a database that already had them — straight into a
trap the document itself described. Nothing batch-specific belongs in here. Put
that in `DEPLOY_HISTORY.md`.

---

## 0. Current state — a snapshot, re-verify before you trust it

**Verified 2026-08-07. Every line below is a fact that expires. Re-run §2 rather
than believing it.**

| | |
|---|---|
| Production ref | `wbvgufqfgbvbinjrdzlg` |
| Domain | `portal.trustedgellc.com` |
| Ledger head | `20260807163520` / `global_search_projects_portfolios` |
| Repo vs production | **in sync** — no pending migrations as of 2026-08-07 |
| Edge functions deployed | 8 |
| Vault secret `edge_functions_base_url` | present, created `2026-08-04 13:36:09+00` |

**Do not re-run the vault secret creation.** `vault.create_secret` on a name that
already exists is not a no-op. Check first:

```sql
select name, created_at from vault.secrets where name = 'edge_functions_base_url';
```

The deploy that got production here is recorded in `DEPLOY_HISTORY.md`. Read it
before the next batch — the 2026-08-04 half was applied by an unknown hand under
renumbered versions, and that shapes what you can conclude from the ledger.

---

## 1. Standing safety rules

These are not batch-specific and do not expire.

> **NEVER run any of these:** `supabase db push`, `db reset`, `db start`,
> `db stop`, `migration up`, `migration repair`, `functions deploy`.
> The CLI in this repo is linked to **production** (`supabase/.temp/project-ref`).
> There is no local target for these commands. `db reset` against a linked prod
> project is exactly what it sounds like.

**Local work is always psql-in-docker, from a file:**

```bash
MSYS_NO_PATHCONV=1 docker exec -i supabase_db_TrustFlow \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/<file>.sql
```

Write the SQL to a file and redirect it. Never a psql heredoc — quoting mangles
dollar-quoted function bodies and you find out at runtime.

**Never read `auth.users` or any credential column.** Not for a count, not for a
sanity check. Application identity lives in `public.users`.

**Never bulk-deploy edge functions.** Four in the repo are deliberately
**undeployed** and must stay that way: `billing-paymob-renew`,
`billing-webhook-paymob`, `create-paymob-checkout`, `import-oauth`. A bare
`supabase functions deploy` would push all four. Production is at 8 functions.

**Never close a GitHub issue without human review.** Verification queries prove
the schema moved. They do not prove the product works.

---

## 2. Find what is actually pending

**The trap: repo filenames and ledger versions are two different numbering
schemes. No string comparison between them is valid.** Repo files are named
`20260805_portfolios_table.sql`. The ledger row for that same migration is
`20260807163138 / portfolios_table`. The 2026-08-04 batch went in under synthetic
versions (`20260731000001`…`20260804000045`) that match no filename at all. A
`version >= '<filename prefix>'` filter is meaningless, and so is sorting one
list against the other.

**Compare on `name`, never on `version`:**

```sql
select version, name from supabase_migrations.schema_migrations order by version;
```

```bash
# repo side: strip the leading timestamp/date token, leaving the name
ls supabase/migrations/*.sql | awk -F/ '{print $NF}' | sed -E 's/^[0-9]+_//; s/\.sql$//'
```

Diff those two name lists. What is in the repo and not in the ledger is pending.

> The old runbook's apply loop filtered `$NF >= "20260731_"` and silently skipped
> `20260730_move_task_pipeline_analytics_fixes.sql` and
> `20260730_rpc_move_task_pipeline.sql`. Both sort *after* the then-current head
> `20260730133225` — `_` is `0x5F`, higher than any digit — but the filter
> excluded them. Production happened to already hold both, so it cost nothing.
> The loop was still wrong, and it is the shape of bug that costs something next
> time. This is why the check above is a name diff and not a range filter.

Names are not unique either: `filehub_fix_storage_policy` and
`filehub_fix_storage_insert_and_group_files` each appear twice in the ledger.
Eyeball anything the diff reports as ambiguous.

---

## 3. Order by dependency, not by filename

Filename order is a convention, not a constraint. Postgres does not care what
the file was called; it cares whether the thing you are calling exists yet.

**Worked example, from the 2026-08-07 batch.**
`20260805_portfolios_table.sql` creates `rpc_portfolios_table`, whose body does:

```sql
CROSS JOIN LATERAL public.fn_project_projection(vp.id) fp
```

`fn_project_projection` is created by `20260805_project_projection.sql`. Same date
prefix, and `portfolios_table` sorts before `project_projection` alphabetically.
**Filename order puts the caller before the callee and fails on the first file.**

So: before applying, read each pending file for what it references, and order by
that. The 2026-08-07 batch went in `project_projection` → `portfolios_table` →
`projects_table_projection_columns` → … precisely because of this.

The same reasoning applied to the 2026-08-04 batch: five files were pulled out of
filename order and moved to the end of the run. See `DEPLOY_HISTORY.md`.

---

## 4. The traps that actually bite

### 4.1 Overloads and PGRST203

`CREATE OR REPLACE FUNCTION` keys on **name + argument types**. Add or change a
parameter and you have not replaced the function — you have created a second one
alongside it. PostgREST then cannot resolve the call and returns `PGRST203` for
every request. The app breaks with a schema that looks perfectly healthy.

**A signature change requires an explicit `DROP` of the old signature.** Follow it
with an assertion, so a mistake fails at deploy time and not in the app:

```sql
DROP FUNCTION public.rpc_projects_table(TEXT, UUID, BOOLEAN, INT, INT, JSONB);
EXECUTE v_def;

SELECT count(*) INTO v_sigs FROM pg_proc
WHERE proname = 'rpc_projects_table' AND pronamespace = 'public'::regnamespace;
IF v_sigs <> 1 THEN
  RAISE EXCEPTION 'rpc_projects_table must have exactly 1 signature, found % (overload trap)', v_sigs;
END IF;
```

(From `20260807_projects_table_portfolio_filter.sql`. Copy the shape.)

**Production carries 5 pre-existing `rpc_*` names at 2 signatures** —
`rpc_create_pipeline`, `rpc_filehub_analytics`, `rpc_get_user_performance_series`,
`rpc_notify_timer_auto_stopped`, `rpc_update_pipeline`. All predate the project
work and are outside it. Know them so a post-deploy overload scan does not read
as a regression; tracked separately, not any deploy's business to fix in passing.

### 4.2 Body-patching migrations

Several migrations read a live definition with `pg_get_functiondef`, `replace()` a
needle in it, and `EXECUTE` the result. These are the ones that fail on a database
whose function bodies differ from what the author was looking at.

Three rules make them survivable, and the ones in this repo already follow them:

1. **Bail out if already applied** — `IF position('p_portfolio_id' IN v_def) > 0
   THEN RAISE NOTICE …; RETURN; END IF;`. This is what makes a patcher re-runnable.
2. **Refuse to patch blindly** — if any needle is not found, `RAISE EXCEPTION`.
   Never let a `replace()` silently match nothing and install an unchanged body.
3. **Assert the signature count afterwards** (§4.1).

### 4.3 CRLF inside stored function bodies

A migration authored on Windows with CRLF line endings, piped through
`docker exec … psql`, stores `\r\n` inside `prosrc`. A later patcher whose needle
is written with `E'\n'` then matches **nothing** — and if it lacks the §4.2 rule 2
guard, it installs an unpatched body and reports success.

Symptom: the patcher "runs fine" and the feature is simply absent. Before writing
a multi-line needle, check what is actually stored:

```sql
select position(chr(13) in prosrc) > 0 as has_cr
from pg_proc where proname = '<fn>' and pronamespace = 'public'::regnamespace;
```

If it does, anchor on a single line, or normalise with
`replace(v_def, chr(13), '')` before matching. Prefer short single-line needles —
they dodge this entirely.

### 4.4 Not everything is re-runnable

Migrations that `CREATE OR REPLACE` a signature a *later* migration replaced are
not idempotent against an already-migrated database: replaying the early one
restores the old signature next to the new one, and the following statement dies
on ambiguity. **Do not blindly re-run a migration that half-applied.** Check
first:

```sql
select proname, pg_get_function_identity_arguments(oid)
from pg_proc where pronamespace='public'::regnamespace and proname = '<fn>';
```

More than one row means drop the stale signature explicitly before retrying.

---

## 5. Apply

Use the Supabase MCP `apply_migration` — it writes the ledger row — or the
dashboard SQL editor plus a manual ledger insert. One file at a time, in the §3
order, **stopping at the first error**.

If number 4 of 7 fails, the schema is at 3 and that is a coherent state. 4 failed
with 5–7 applied is not a state anything has ever tested.

**Record what `RAISE NOTICE` prints.** Backfill counts cannot be recovered after
the fact, and they are the only evidence the backfill did anything.

Take a fresh backup from the dashboard (Database → Backups) first and confirm its
timestamp is *after* your pre-flight reads. The nightly can be up to 24 hours
stale; §7 assumes the restore point is minutes old.

---

## 6. Verify

```sql
-- Ledger head moved where you expect
select version, name from supabase_migrations.schema_migrations
order by version desc limit 5;

-- No new overload duplicates (the PGRST203 shape).
-- Expect the 5 known pre-existing names from §4.1 and nothing else.
select proname, count(*) from pg_proc
where pronamespace = 'public'::regnamespace and proname like 'rpc_%'
group by proname having count(*) > 1 order by 1;

-- Volume unchanged: take these BEFORE the deploy too, and compare
select
  (select count(*) from public.tasks     where deleted_at is null) as tasks,
  (select count(*) from public.projects  where deleted_at is null) as projects,
  (select count(*) from public.pipelines where deleted_at is null) as pipelines,
  (select count(*) from public.users     where deleted_at is null) as users;

-- No function has drifted back to a hardcoded edge URL (#169)
select count(*) from pg_proc where pronamespace='public'::regnamespace
  and prosrc like '%.supabase.co/functions/v1/%';   -- want 0
select public.fn_edge_base_url() is not null;        -- want true
```

Then run the checks — see §8 for which ones are known-stale.

**Then use the app, in production, as a real user.** The queries prove the schema
moved. They do not prove the product works. Minimum: open a board and advance a
task; open a project and confirm its fields render (a Year reads `2025`, not
`2,025`); import a small spreadsheet and re-import it edited via the Update path;
trigger something that notifies and confirm the notification arrives — that last
one is the only real test that the edge/vault path is intact.

---

## 7. If it goes wrong

**A migration fails mid-run.** Stop. Do not skip it, do not continue to the next
file. Read the error — most likely an overload (§4.1), or a patcher meeting a body
it did not expect (§4.2, §4.3). The schema is at the last successful file. Fix
forward on local, then come back.

**Do not simply re-run the failed file** — see §4.4. Check
`pg_get_function_identity_arguments` before any retry.

**A patcher reported success but the feature is missing.** Suspect §4.3. Read the
stored body and confirm the change is actually in it, rather than trusting the
absence of an error.

**Applied cleanly but the app is broken.** Restore the backup from §5. Almost
everything here is schema and function bodies, with one class of exception:
migrations that write rows (role seeding, backfills). A restore undoes those too,
which is fine — but if the deploy is later re-run, their `RAISE NOTICE` counts
will differ from the first run's, because the first run already moved some. That
is expected, not a failure.

**Notifications stopped.** The vault secret is missing or wrong. The edge-URL
lookup is fail-closed by design: absent secret → NULL URL → the POST is skipped
silently. Confirm with `select public.fn_edge_base_url();`. Set the secret; no
redeploy needed. It deliberately is **not** seeded from a literal — that is the
whole point of #169. A restored clone must be inert until someone gives it a base
URL on purpose.

**Rolling back one function.** The old body lives in the migration that *created*
it, not in the patch that rewrote it.
`git log -S '<function name>' supabase/migrations/` finds the chain.

---

## 8. Known-stale checks and known drift

**Do not let these abort a deploy, and do not "fix" the code to satisfy them.**
Verified stale as of 2026-08-04; tracked in #201.

| Check | Why it fails |
|---|---|
| `20260731_projects_p3_table_check` | asserts an unstaged project keeps `current_stage_id IS NULL`. `trg_projects_default_stage` now assigns one on insert — the check predates the feature. |
| `20260731_project_stage_move_check` | "expected 1 history row, got 2" — same trigger. The insert stages the project (one history row), then the move writes the second. |
| `20260801_portfolio_flow_analytics_check` | "expected wip_count=1, got 2" — same trigger. Projects now start staged, so both count as WIP. |
| `check_rollforward_link_guard` | written to demonstrate the vulnerability and expects RLS to silently deny (0 rows). The fix shipped as a **raising trigger**, which aborts the check. Shipped behaviour is *louder* than the check expects, not weaker. |
| `check_rpc_rollforward_project` | picks two arbitrary non-owner users (`ORDER BY u.id LIMIT 2`) and assumes neither holds `project.view_all`. In the company it selects, 3 of 9 do. Fragile by construction. |

**Known schema drift, not caused by any recent deploy.** Do not "fix" it by
replaying the migration:

- `20260516_teams_rls.sql` — 10 policies on `teams` / `team_members` /
  `team_roles`. Those tables carry 17 policies that exist in **no** migration.
  RLS policies are OR'd, so replaying this **widens** access on the RBAC tables.
  Tracked in #200.
- `20260430_harden_timer.sql` — one superseded `task_work_sessions` policy.

---

## 9. What is NOT verified — read this before claiming the deploy is done

Two things are outstanding right now. Neither is a maybe.

**`supabase/checks/*.sql` have NEVER been run against production.** Not a single
one. The rehearsal the previous runbook called mandatory was **deliberately
waived by the owner on 2026-08-07 as a cost decision**. That was a choice, not an
oversight, and it is not a claim of correctness. Everything asserted about the
project/portfolio features in production rests on schema-level reads and on the
same code having worked locally. If someone later asks "was this tested against
prod" — the answer is no.

**The frontend has NOT been deployed.** Production's database is ahead of the app
running against it. The migrations that landed on 2026-08-04 and 2026-08-07
include RPCs and columns that no deployed client calls yet. Nothing observed in
the live app right now exercises the new schema, so "the app looks fine" is not
evidence about the deploy. Conversely, a frontend deploy is the moment all of it
gets exercised for the first time — treat that as the real risk event, not the
migration run that already happened.

Do not let a reader infer otherwise from the green ledger.
