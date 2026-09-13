# Issue #414 Task 1 — Catalog foundation

Status: DONE

Implemented the bounded catalog foundation in the assigned migration and SQL
check. The catalog is append-only and database-owned, with positive versions,
stable SHA-256 hashes of canonical `jsonb` text, separate recommended/published
heads, a company installation ledger with indexed tenant keys, UUID-free
semantic payload validation, explicit published-entry resolution, and a
permission-gated installation RPC that refuses version overwrite.

The migration seeds `roles_permissions` version 1 from current global system
roles and their permission keys by semantic names; it does not copy UUIDs.

## RED

Command:

```powershell
Get-Content supabase/checks/check_platform_defaults_catalog.sql |
  docker exec -i supabase_db_TrustFlow psql -U postgres -d postgres -v ON_ERROR_STOP=1
```

Result:

```text
BEGIN
ERROR:  catalog entries table is missing
CONTEXT:  PL/pgSQL function inline_code_block line 8 at ASSERT
```

## GREEN

The migration and check were replayed in one transaction against a fresh
catalog schema in the running local Supabase Postgres container, then rolled
back. Exact result:

```text
NOTICE:  check_platform_defaults_catalog: contract passed
```

The check was also run after the migration against the local database and
passed with the same notice.

## Other verification

`npm run verify:agent` was started. It passed the repository self-checks shown
through `statusMapper: all assertions passed`; it was interrupted while still
processing the large unrelated self-check suite at the user's request for an
immediate status update. It did not reach a final exit result.

The `supabase` CLI is not installed (`supabase : The term 'supabase' is not
recognized...`), so CLI migration lint/list commands were unavailable. Docker
Postgres was healthy and used for SQL verification.

## Remaining risks

- The full repository verification gate has no final result because it was
  interrupted before completion.
- No production or remote database was contacted; local SQL verification only.
- Later catalog packages still need to adopt this foundation and populate other
  default domains.
