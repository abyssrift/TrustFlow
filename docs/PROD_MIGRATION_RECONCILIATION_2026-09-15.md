# Production migration reconciliation — 2026-09-15

Status: read-only reconciliation complete. No production or local database writes were performed.

## Current ledger facts

- Production project: `wbvgufqfgbvbinjrdzlg`
- Production ledger rows: 472
- Production head: `20260901114209 / filehub_share_link_followups`
- Current repository migration files: 320
- Current repository migrations after the production head: 39
- Local migration ledger: 0 rows after repeated resets; it is not evidence of local schema state.

The production ledger contains historical names and synthetic versions that do not map 1:1 to current filenames. Reconciliation must therefore use migration names and the recorded deployment history, never a raw timestamp/count comparison.

## Pending current migration files

These 39 current repository files have zero migration-name matches in the production ledger and are therefore ledger-confirmed unrecorded. They are not yet schema-confirmed pending: the ledger cannot detect equivalent SQL applied manually or under another name.

### 2026-09-03 through 2026-09-09

- `20260903_task_external_id_dedup.sql`
- `20260907_issue339_create_portfolio.sql`
- `20260907_issue350_task_completion.sql`
- `20260907_portfolios_empty_reader.sql`
- `20260907080650_global_search_v4.sql`
- `20260907080841_filehub_task_attachment_versioning.sql`
- `20260907094755_filehub_folder_activity_reader.sql`
- `20260908115151_issue335_filehub_activity_coverage.sql`
- `20260908130000_issue395_stage_reversal_undo.sql`
- `20260908135529_repair_filehub_storage_bootstrap.sql`
- `20260909111004_issue396_forward_stage_undo.sql`

### 2026-09-13

- `20260913065331_project_workspace_contract.sql`
- `20260913065845_project_workspace_rpcs.sql`
- `20260913070243_platform_defaults_catalog.sql`
- `20260913070247_company_defaults_bootstrap.sql`
- `20260913070250_catalog_starter_templates.sql`
- `20260913070255_catalog_pipeline_consumers.sql`
- `20260913070259_company_notification_defaults.sql`
- `20260913070302_catalog_filehub_system_folders.sql`
- `20260913070306_company_bootstrap_notification_bridge.sql`
- `20260913070308_catalog_filehub_client_folder_consumer.sql`
- `20260913070312_catalog_bootstrap_acl_hardening.sql`
- `20260913100000_filehub_task_submission_convergence.sql`
- `20260913130000_filehub_lifecycle_safety.sql`
- `20260913130503_filehub_project_browse_projection.sql`
- `20260913140000_project_workspace_bin.sql`
- `20260913150000_project_filehub_hardening.sql`

### 2026-09-14

- `20260914090000_catalog_onboarding_checklist.sql`
- `20260914090100_catalog_upgrade_materialization.sql`
- `20260914090200_bootstrap_catalog_head_consumers.sql`
- `20260914100000_filehub_browse_cursor.sql`
- `20260914100100_filehub_browse_acl_pagination.sql`
- `20260914100300_filehub_project_acl_revoke.sql`
- `20260914100400_filehub_browse_canonical_aliases.sql`
- `20260914110000_onboarding_preset_catalog.sql`
- `20260914110100_company_onboarding_profiles.sql`
- `20260914110200_user_onboarding_drafts.sql`
- `20260914110300_onboarding_profile_rpcs.sql`
- `20260914110400_onboarding_manifest_v2.sql`

## Rehearsal and deployment plan

1. Freeze the migration set in a reviewed commit. The worktree is currently dirty, and several pending migrations are uncommitted. Do not deploy from this moving state.
2. Take a fresh production backup and record its timestamp.
3. Reconcile the frozen commit against a freshly rebuilt rehearsal database. Do not use the local migration ledger as the baseline; it is empty and the local schema has known clone drift.
4. Inspect and dependency-order the pending files. The likely dependency blocks are workspace contract → workspace RPCs, catalog/head consumers → company bootstrap/catalog consumers, and FileHub schema/projection → ACL/pagination/hardening migrations.
5. Apply one migration at a time through the approved production workflow, recording notices and stopping at the first error. Never use `supabase db push`, `db reset`, `migration up`, or `migration repair` in this repository.
6. Verify the ledger head, function signatures/overloads, expected objects, row-volume invariants, storage policies, and notification edge/vault path after each batch.
7. Run production smoke tests before deploying the frontend: login/onboarding, project creation, FileHub browse/upload, task transition/reversal, and notification delivery.

## Gates before any production write

- [ ] Pending list reviewed against the frozen commit.
- [ ] Each migration's objects/data effects checked against production before applying; ledger absence alone is not sufficient.
- [ ] Fresh backup exists and is newer than the preflight reads.
- [ ] Rehearsal database passes the relevant checks and migration scripts.
- [ ] Dependency/order review completed for all 39 files.
- [ ] No unexpected function overloads or signature conflicts.
- [ ] Owner explicitly confirms the production deployment window.

## Evidence and limitations

- Production ledger was read through the connected Supabase migration listing.
- `npx supabase migration list` could not authenticate in the local CLI environment (401), so the CLI output was not used as evidence.
- `node supabase/checks/migration_drift.js` was run against local Docker. It reported 18 migrations with missing local objects, plus known clone/runtime drift.
- The ledger proves recorded migration history, not unlogged manual SQL changes.
