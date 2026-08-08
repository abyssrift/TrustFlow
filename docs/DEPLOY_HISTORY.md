# Production deploy history

Append-only. Newest last. One entry per batch that reached production
`wbvgufqfgbvbinjrdzlg` (`portal.trustedgellc.com`).

**Why this file exists.** Until 2026-08-07 nothing in this repo recorded that 52
migrations had reached production, or in what order, or by whom. The only artifact
was a runbook still describing them as *pending*, which made replaying them onto a
database that already had them look like the correct next step. It would have hit
the non-idempotency trap that same runbook documented. The procedure lives in
`PROD_DEPLOY_RUNBOOK.md`; batch facts live here, so the procedure cannot rot into
a plan for a batch that already shipped.

**Ledger versions are not filenames.** Neither batch below went in under its repo
filename. Do not string-compare the two.

---

## 2026-08-04 — 45 migrations, provenance unknown

**Ledger range:** `20260731000001` … `20260804000045`
**Repo range:** `20260731_companies_terminology` … `20260802_rollforward_link_guard`
**Applied by:** unknown. Nothing in the repo, the commit history, or the ledger
records who ran this or with what tooling. It is reconstructed here from the
production ledger alone.

**Renumbering.** The 45 were **not** recorded under their repo filenames. They went
in under synthetic versions that are a plain 1–45 counter with a date prefix:
`20260731000001`, `20260731000002`, … `20260804000045`. The `name` column does
match the repo (filename minus its date prefix), so **name is the only reliable
join between this repo and the production ledger.**

**Five files were deliberately applied out of filename order**, pulled out of the
middle of the batch and moved to the end as entries 41–45:

| Ledger | Name | Repo filename |
|---|---|---|
| `20260804000041` | `project_stage_history_trigger` | `20260731_project_stage_history_trigger.sql` |
| `20260804000042` | `project_deliverable` | `20260801_project_deliverable.sql` |
| `20260804000043` | `rollforward_project` | `20260801_rollforward_project.sql` |
| `20260804000044` | `drop_stale_stage_rpc_overloads` | `20260802_drop_stale_stage_rpc_overloads.sql` |
| `20260804000045` | `rollforward_link_guard` | `20260802_rollforward_link_guard.sql` |

Someone hand-resolved a dependency ordering here — the same class of problem the
runbook's §3 describes. **The reasoning was not written down anywhere.** If a
future batch touches these objects, this reordering is the only surviving evidence
that filename order does not work for them.

**Also on this date:** vault secret `edge_functions_base_url` created
`2026-08-04 13:36:09+00`. It already exists. Do not create it again.

**Not recorded and not recoverable:** the `RAISE NOTICE` backfill counts from
`20260803_backfill_project_view_all` and `20260804_seed_company_default_roles`.

---

## 2026-08-07 — the remaining 7, dependency-ordered

**Ledger range:** `20260807163116` … `20260807163520`
**Applied by:** Claude, via Supabase MCP `apply_migration`, one file at a time.

| Ledger | Name | Repo filename |
|---|---|---|
| `20260807163116` | `project_projection` | `20260805_project_projection.sql` |
| `20260807163138` | `portfolios_table` | `20260805_portfolios_table.sql` |
| `20260807163213` | `projects_table_projection_columns` | `20260805_projects_table_projection_columns.sql` |
| `20260807163325` | `project_notifications` | `20260805_project_notifications.sql` |
| `20260807163358` | `project_needs_attention` | `20260806_project_needs_attention.sql` |
| `20260807163421` | `projects_table_portfolio_filter` | `20260807_projects_table_portfolio_filter.sql` |
| `20260807163520` | `global_search_projects_portfolios` | `20260808_global_search_projects_portfolios.sql` |

**Applied dependency-first, not in filename order — deliberately.**
`20260805_portfolios_table.sql` creates `rpc_portfolios_table`, whose body does
`CROSS JOIN LATERAL public.fn_project_projection(vp.id)`. `fn_project_projection`
is created by `20260805_project_projection.sql`. Filename sort puts
`portfolios_table` first — the caller before the callee — so the previous
runbook's "apply in filename order" instruction **would have failed on the very
first file of this batch.** That is the worked example now carried in
`PROD_DEPLOY_RUNBOOK.md` §3.

After this batch, **repo and production are in sync.** Ledger head:
`20260807163520 / global_search_projects_portfolios`.

**Not done, deliberately:**

- `supabase/checks/*.sql` were **not** run against production. The rehearsal the
  then-current runbook called mandatory was **waived by the owner on 2026-08-07 as
  a cost decision.** See runbook §9.
- The frontend was **not** deployed. Production's database is ahead of its running
  app. See runbook §9.

---

## Corrections to the pre-2026-08-07 runbook

Recorded because the claims were confidently stated, verified-sounding, and wrong.
Anyone reading the old document in `git log` should know which parts to distrust.

**"§2.3a: a `pg_proc` count over the nine function names this batch touches
returns 0 in production."** False as of 2026-08-07, and the conclusion drawn from
it — that the body-patching migrations only ever read freshly-written bodies —
inverts reality. Production holds essentially all of those functions, each at
exactly **1 signature**. Spot-verified present: `rpc_projects_table`,
`rpc_rollforward_project`, `rpc_save_project_field_def`, `rpc_instantiate_template`
— the exact four the old §2.3a named as absent. Body patchers on production are
patching **live, pre-existing** bodies. Runbook §4.2 and §4.3 assume that.

**"§2.2 apply loop."** Filtered `$NF >= "20260731_"`, which silently skipped
`20260730_move_task_pipeline_analytics_fixes.sql` and
`20260730_rpc_move_task_pipeline.sql` — both sort *after* the then-head
`20260730133225` (`_` outranks any digit in ASCII) but below the filter. Harmless
that time: production already held both, as `20260730085730` and `20260730093258`.
Wrong for any future batch. Replaced by a name-diff in runbook §2.

**"§4: create the vault secret."** Must not run again. The secret has existed since
`2026-08-04 13:36:09+00`.

**"§2.3a: eight `rpc_*` names carry two signatures."** That was a local
observation. **Production carries 5:** `rpc_create_pipeline`,
`rpc_filehub_analytics`, `rpc_get_user_performance_series`,
`rpc_notify_timer_auto_stopped`, `rpc_update_pipeline`. All predate the project
work. Runbook §4.1 carries the production list, so a post-deploy overload scan has
a correct baseline.

**"§6: want `on_global_template` = 0."** Production reads **25** as of 2026-08-07
(Personnel 14, Manager 5, Admin 3, Owner 3; 3 of those users have no company).
`zero_role_companies` is 0 and the `trg_companies_seed_default_roles` trigger is
present, so the seeding half of #181 did land. Whether 25 is residue, or expected
for platform-level accounts, is **not established** — it is recorded here as an
open observation, not a defect. Do not treat the old "want 0" as a target without
first deciding what those rows are.
