# Issue #414 Task 1 — Catalog foundation fix wave

Status: DONE (focused verification passed)

The catalog now uses `platform_catalog_entries`, `platform_catalog_heads`, and
`company_catalog_installations`. Entries carry kind/classification, lifecycle
state, content/baseline hashes, materialized references, creation path,
selection metadata, and timestamps. Entries are append-only; versions are
positive and monotonic under an advisory lock, with exact replay handled
idempotently. Installations use `(company_id, catalog_key, catalog_version)` so
explicit upgrades can coexist. UUID-shaped JSON keys and values are rejected.

The explicit resolver accepts an optional version and rejects unpublished
versions. Privileged install/resolver execution is revoked from PUBLIC and
anon and granted only to authenticated. RLS, tenant indexes, authorization,
and RPC replay/no-overwrite behavior are covered by the SQL check.

## TDD evidence

Command:

```powershell
Get-Content supabase/checks/check_platform_defaults_catalog.sql |
  docker exec -i supabase_db_TrustFlow psql -U postgres -d postgres -v ON_ERROR_STOP=1
```

The pre-migration contract was red because the tenant catalog index was missing.
After the catalog migration and ACL hardening were applied, the same check
passed with:

```text
NOTICE:  check_platform_defaults_catalog: contract passed
ROLLBACK
```

## Focused verification

Migration replay command:

```powershell
Get-Content supabase/migrations/20260913070243_platform_defaults_catalog.sql |
  docker exec -i supabase_db_TrustFlow psql -U postgres -d postgres -v ON_ERROR_STOP=1
```

Result: completed successfully.

Catalog check command:

```powershell
Get-Content supabase/checks/check_platform_defaults_catalog.sql |
  docker exec -i supabase_db_TrustFlow psql -U postgres -d postgres -v ON_ERROR_STOP=1
```

Exact result:

```text
NOTICE:  check_platform_defaults_catalog: contract passed
ROLLBACK
```

`git diff --check` completed with no whitespace errors.

## Broad verification and concerns

The focused checks were run against the local Docker Postgres stack. The broad
repository check suite reached 129/130; its only failure was an unrelated,
already-untracked `lib/uploadTargetNormalization.check.ts` expectation for a
new `replaceAttachmentId` field. Migration drift also reports pre-existing
local DB/repository divergence outside this catalog work. No
remote/production database was contacted.

## Completion wave: onboarding checklist and explicit upgrades

The remaining #414 gaps are now covered. `onboarding_checklist.workspace-ready`
is a published, platform-owned v1 entry consumed by both onboarding routes via
`lib/onboardingChecklist.ts`; `WorkspaceReadyStep` no longer owns duplicate
default copy. The separate `WelcomeTour` state remains user/onboarding state.

`rpc_adopt_platform_catalog_version` is the explicit, owner-authorized upgrade
coordinator. It locks the company/catalog key, materializes real company-owned
resources through private type-specific helpers, records non-empty references,
repairs legacy empty-reference ledger rows, and returns the same references on
replay. It does not overwrite customized v1 data or the owner assignment.
Bootstrap and quick setup resolve published heads, while starter discovery
filters to published-head versions.

Added migrations:

- `20260914090000_catalog_onboarding_checklist.sql`
- `20260914090100_catalog_upgrade_materialization.sql`
- `20260914090200_bootstrap_catalog_head_consumers.sql`

Verification in the local Docker stack:

- 9 catalog/bootstrap SQL contracts passed, including real v2 adoption,
  duplicate replay, empty-ledger repair, owner preservation, and customized
  pipeline preservation.
- Focused Vitest: 6 files, 9 tests passed.
- Checkout-only Vitest: 18 files passed, 90 tests passed, 1 file skipped and
  2 tests skipped.
- `npm run build:web` passed and exported `dist`.
- Targeted Babel checks and `git diff --check` passed.

The repository-wide `tsc` gate still reports unrelated pre-existing errors in
other modules, with no diagnostics in the changed catalog/onboarding files.
The aggregate agent gate also retains unrelated detached-worktree failures;
these are excluded from the checkout-only result above.

## Manual walkthrough

The dev server is available at `http://localhost:8081`.

1. At a 1400px web viewport, create a fresh company. The ready step should
   show the catalog-provided Owner access, Main Workflow, and File Hub defaults,
   plus the starter-template action. Continue into the workspace and verify
   the creator can open Roles, Pipelines, Projects, and File Hub.
2. At a 390px web viewport, repeat the ready step and verify the catalog cards
   stack without clipping and both actions remain reachable.
3. On native Expo, repeat the same flow. The shared `WorkspaceReadyStep` should
   render the same catalog items and preserve Continue when the checklist read
   is unavailable.

The Windows UI automation helper was unavailable during this run, so these
three visual paths remain a manual handoff rather than an automated observation.
