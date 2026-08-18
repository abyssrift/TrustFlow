-- Issue #35: idempotent upload retries need two real unique constraints to
-- build on top of. Neither exists today:
--
-- 1. No unique index on filehub_files (visibility, storage_path). A naive
--    client retry on a transient network failure re-PUTs to storage and
--    re-inserts the row, double-counting the file. CONFIRMED LIVE
--    (2026-08-18): 13 storage_path groups / 30 active rows already
--    duplicated this way -- verified one group by hand, two rows, same
--    original_name/size_bytes, ~6s apart, no replaces_file_id/
--    current_version_id link, i.e. an accidental double-submit or retry,
--    not a version chain.
--
--    Scoped by visibility, not just storage_path, because
--    fn_harvest_task_output deliberately creates a SECOND filehub_files row
--    (visibility='project') that points at the SAME storage_path as the
--    originating task submission's row (visibility='task') -- it shares the
--    physical object rather than duplicating bytes, instead of recording an
--    actual reference back to the source row (see docs/audit/
--    filehub-write-paths-review.md). A plain (storage_path) index would
--    reject that legitimate cross-visibility sharing on the very next
--    harvest; a (visibility, storage_path) index still catches same-
--    visibility duplication -- the actual bug above -- while allowing it.
--
-- 2. filehub_dedupe_name() (20260720_filehub_upload_commit_folder_tree.sql)
--    only prevents NEW clashes via a transaction-scoped advisory lock around
--    its own read-then-insert. It does nothing for any other write path and
--    nothing for rows that already clashed before the lock existed.
--    CONFIRMED LIVE: 3 duplicate-name groups (direct visibility), 2 rows
--    each.
--
-- Both are small in the current data (30 + 6 rows) but real, so this
-- migration backfills (soft-delete, not hard-delete -- the extra rows land
-- in the existing Bin/restore flow like any other delete, keeping this
-- reversible) before adding the constraints, per schema-constraints.md's
-- "resolve existing violations before adding the index" rule.
--
-- NOT APPLIED to the database as part of this session (local-only) --
-- written to the repo for review. The backfill step mutates real rows
-- (soft-delete), unlike a purely additive migration, so review the
-- kept/removed row choice (earliest created_at wins) before running this.

-- ============================================================
-- Section 1: backfill -- storage_path duplicates
-- ============================================================
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY visibility, storage_path ORDER BY created_at ASC, id ASC) AS rn
  FROM public.filehub_files
  WHERE deleted_at IS NULL
)
UPDATE public.filehub_files f
SET deleted_at = now()
FROM ranked
WHERE f.id = ranked.id
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS filehub_files_storage_path_uq
  ON public.filehub_files (visibility, storage_path)
  WHERE deleted_at IS NULL;

-- ============================================================
-- Section 2: backfill -- filename dedupe, matching
-- filehub_dedupe_name()'s three visibility-scoped clash rules exactly.
-- folder_id is nullable (root folder); dedupe_name treats two NULLs as the
-- same folder via `IS NOT DISTINCT FROM`, so the index must too -- a plain
-- unique index does NOT (NULL <> NULL in a b-tree unique constraint), so
-- folder_id is coalesced to a sentinel UUID in both the backfill grouping
-- and the index expression.
-- ============================================================
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY
             company_id,
             visibility,
             CASE visibility WHEN 'group' THEN group_id END,
             CASE visibility WHEN 'direct' THEN uploaded_by END,
             coalesce(folder_id, '00000000-0000-0000-0000-000000000000'::uuid),
             lower(trim(original_name))
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM public.filehub_files
  WHERE deleted_at IS NULL
    AND visibility IN ('group', 'broadcast', 'direct')
)
UPDATE public.filehub_files f
SET deleted_at = now()
FROM ranked
WHERE f.id = ranked.id
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS filehub_files_name_uq_group
  ON public.filehub_files (
    company_id, group_id,
    (coalesce(folder_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    (lower(trim(original_name)))
  )
  WHERE deleted_at IS NULL AND visibility = 'group';

CREATE UNIQUE INDEX IF NOT EXISTS filehub_files_name_uq_broadcast
  ON public.filehub_files (
    company_id,
    (coalesce(folder_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    (lower(trim(original_name)))
  )
  WHERE deleted_at IS NULL AND visibility = 'broadcast';

CREATE UNIQUE INDEX IF NOT EXISTS filehub_files_name_uq_direct
  ON public.filehub_files (
    company_id, uploaded_by,
    (coalesce(folder_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    (lower(trim(original_name)))
  )
  WHERE deleted_at IS NULL AND visibility = 'direct';
