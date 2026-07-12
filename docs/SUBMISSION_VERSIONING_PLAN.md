# Task Submission — Version Control, Editing & Soft Delete — Plan

> **Status:** Draft for review. Created 2026-07-08.
> **Scope:** (A) version control + editing for task submissions — Model B, same mechanism as FileHub; (B) soft delete of submissions with management recovery; (C) federate files across the app — one cross-task search index + shared viewer/version/soft-delete utilities, **without** merging the two domains' storage or access; (D) per-file version control + soft delete for task brief attachments (FileHub Model B clone).

---

## Model — same as FileHub (Model B: parallel immutable versions + pointer)

Chosen explicitly: **mirror the FileHub versioning mechanism.** A **parallel immutable `task_submission_versions` table** holds each version's content + attachment set; `task_submissions.current_version_id` points at the live one. This is deliberately identical to `filehub_file_versions` + `filehub_files.current_version_id`, so the mental model, RPC shapes, and purge machinery all carry over.

Why this over chaining rows in `task_submissions`:
- **Revert is a pure pointer move** — set the target version `superseded_at = NULL`, the current one `superseded_at = now()`. **No new version row, no byte copy.** Bouncing v5 ↔ v3 keeps the set `{1..5}` intact.
- Versions live in a **separate table** → they never leak into the submissions list, review queries, or stage-gate precondition checks. The `task_submissions` row's identity (`id`, `status`, `reviewed_by`, `review_notes`) stays stable across every edit.

### Two distinct actions that must stay distinct
- **Resubmit** (exists) — `rpc_submit_work` inserts a **new `task_submissions` row** in the *review* flow (e.g. after `needs_revision`). New review cycle, new submission. **Leave as-is** — resubmissions are separate submissions, each with their own version history.
- **Edit** (new) — fix content / swap an attachment on the *same* submission → adds a **version** under it, no new review cycle. This is the new work.

---

## Current state (verified 2026-07-08)

**`task_submissions`:** `id, task_id, company_id, assignment_id, submitted_by, content, stage_id, status('pending'), revision_count(0), reviewed_by, reviewed_at, review_notes, submitted_at, created_at, updated_at`. No soft-delete, no lineage columns.

**`submission_attachments`:** `id, submission_id (FK ON DELETE CASCADE), company_id, uploaded_by, file_name, file_url, file_size, mime_type, category, storage_path, created_at`. Storage bucket **`submission-attachments`**, path `{company_id}/tasks/{task_id}/users/{user_id}/{ts}_{rand}.{ext}` (`upsert:true`).

**RPCs:** `rpc_submit_work(p_task_id,p_content,p_assignment_id,p_transition_id,p_attachments jsonb)` · `rpc_review_submission(...)` · `rpc_delete_submission(p_submission_id)` = **hard DELETE** (perm: own submission OR `tasks.manage` OR `is_owner`; storage objects **not** removed → orphaned).

**Read:** `rpc_get_task_details` → `v_submissions` from `task_submissions s WHERE s.task_id = p_task_id`, each with a `submitted_by`/`reviewed_by` user object, `stage_name`, and an `attachments` array. Ordered `submitted_at DESC`.

**Client:** `contexts/SubmissionContext.tsx` (`submitWithEvidence`), `contexts/TaskDetailContext.tsx` (`deleteSubmission`, realtime on `task_submissions`), `components/task-detail/EvidencePanel.tsx` (flattens attachments, grouped by stage; has a "pending/confirmed" toggle already).

**Reusable platform machinery (don't rebuild):** `company_retention_settings`, `retention_warnings`, `storage_archive_queue` tables already exist, plus the FileHub purge Edge Function + `pg_cron`/`pg_net` pattern (`supabase/functions/purge-filehub-versions`).

---

## Feature B — Soft delete + management recovery  *(do first; small, self-contained)*

### B1. Schema
Add to `task_submissions`: `deleted_at TIMESTAMPTZ NULL`, `deleted_by UUID NULL → users(id)`.
Index: `(task_id) WHERE deleted_at IS NULL` (keeps the hot read path lean).
Attachments get **no** own soft-delete column — the submission is the unit of deletion; they follow the parent. (Per-attachment delete = YAGNI; add only if asked.)

### B2. Convert `rpc_delete_submission` to soft
Same permission check; replace `DELETE FROM task_submissions` with
`UPDATE task_submissions SET deleted_at = now(), deleted_by = auth.uid() WHERE id = p_submission_id AND deleted_at IS NULL`.
Storage bytes are intentionally kept (that's what makes recovery possible).

### B3. Filter the read
In `rpc_get_task_details`, add `AND s.deleted_at IS NULL` to the `v_submissions` select. (Also to the `has_pending_submission` / `no_pending_submission` / `has_approved_submission` precondition `EXISTS` checks in the same function, so a soft-deleted submission doesn't hold a stage gate open.)

### B4. Recovery (management only)
- `rpc_restore_submission(p_submission_id)` — perm: `tasks.manage` OR `is_owner` (**not** the original submitter; recovery is a management act). `UPDATE ... SET deleted_at = NULL, deleted_by = NULL WHERE id = ... AND deleted_at IS NOT NULL`.
- `rpc_list_deleted_submissions(p_task_id)` — perm: `tasks.manage` OR `is_owner`. Returns soft-deleted submissions for the task (same JSONB shape as `v_submissions` + `deleted_at`, `deleted_by` user object) so the existing card UI is reusable.

### B5. Client
- `TaskDetailContext.deleteSubmission` — no change (already calls the RPC + refetches; now it soft-deletes).
- Add `restoreSubmission(id)` + `listDeletedSubmissions()` to the context.
- `EvidencePanel` (or the submissions list): for users with `tasks.manage`, a **"Deleted (n)"** toggle that loads `rpc_list_deleted_submissions` and shows each with a **Restore** button. Mirrors the existing "Show Pending / Confirmed Only" toggle pattern already in `EvidencePanel`.

### B6. Retention / purge  *(defer — flag, don't build)*
Soft-deleted submissions + their storage objects should hard-purge after a retention window (recommend **90 days**). **Reuse** the FileHub purge Edge Function pattern (service role: `superseded/deleted` predicate → `storage.remove` → row delete → daily `pg_cron`), or hook `storage_archive_queue`. Do not build until B1–B5 ship and someone actually needs reclaim.
`// ponytail: no purge yet — soft-deleted rows accumulate. Add the cron reusing purge-filehub-versions when storage cost matters.`

**Acceptance:** delete hides from task detail + stops gating stages; management sees it under "Deleted" and can Restore; a restored submission reappears intact with its attachments; storage bytes survived the round-trip.

---

## Feature A — Version control + editing  *(Model B; depends on B1's migration; do second)*

Directly parallels `filehub_file_versions`. Where FileHub versions storage bytes, submission versions the **content text + attachment set**.

### A1. Schema
**New table `task_submission_versions`** (immutable content records):
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | `gen_random_uuid()` |
| `submission_id` | UUID NOT NULL | → `task_submissions(id)` ON DELETE CASCADE |
| `company_id` | UUID NOT NULL | denormalized for RLS |
| `version_no` | INT NOT NULL | `UNIQUE(submission_id, version_no)` |
| `content` | TEXT | this version's content |
| `created_by` | UUID | → `users(id)` |
| `created_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| `superseded_at` | TIMESTAMPTZ NULL | **NULL = current**; non-null starts the (deferred) purge clock |

Indexes: `(submission_id, version_no)`, `(superseded_at) WHERE superseded_at IS NOT NULL`, `(company_id)`. RLS SELECT: `company_id = my_company_id() AND` caller can view the parent task. No write policies (SECURITY DEFINER RPCs only).

**`task_submissions` additions:** `current_version_id UUID → task_submission_versions(id)`, `updated_at`, `updated_by`. The existing `content` column stays as a **denormalized copy of the current version's content** so all current reads work unchanged (same trick FileHub used for `storage_path`/name).

**`submission_attachments` addition:** `version_id UUID → task_submission_versions(id)`. **Attachments belong to a version**, not the submission — that's what makes each version's file set independent. Keep `submission_id` too (RLS/convenience). Backfill existing attachments to their submission's v1.

**Backfill (idempotent, `WHERE current_version_id IS NULL`):** for every `task_submissions` row insert a `v1` version (`version_no=1`, `superseded_at=NULL`, `content` copied), point `current_version_id` at it, and set every existing `submission_attachments.version_id` to that v1.

**Invariant:** exactly one `task_submission_versions` row per `submission_id` has `superseded_at IS NULL`; `current_version_id` points at it; the live `content` equals it.

### A2. `rpc_edit_submission(p_submission_id, p_content, p_kept_attachment_ids uuid[], p_new_attachments jsonb)`
- Perm: original `submitted_by` (while editable) OR `tasks.manage` OR `is_owner`.
- Insert a new `task_submission_versions` row: `version_no = max+1`, `superseded_at = NULL`, new `content`, `created_by = auth.uid()`.
- Set the previously-current version's `superseded_at = now()`.
- Point `task_submissions.current_version_id` at the new version; sync denormalized `content`; `updated_at=now()`, `updated_by=auth.uid()`. **The `task_submissions.id` never changes.**
- **Attachments:** `p_kept_attachment_ids` → insert new `submission_attachments` rows for the new `version_id` **reusing the same `storage_path`** (pointer copy, no re-upload); `p_new_attachments` → freshly uploaded client-side, inserted for the new version. The old version keeps its own attachment rows untouched.
- **Review interaction (the one real product decision — see Open Decisions):** default = editing a submission whose status is `approved`/`confirmed` resets `status = 'pending'` (content changed → re-review). If edits are locked after approval instead, raise when status isn't `pending`/`needs_revision`.
- Returns the new version id.

### A3. Read + history
- `rpc_get_task_details` `v_submissions`: **no version filtering needed** (versions are a separate table) — it already reads the live `task_submissions` row with its denormalized `content` + current attachments. Add `version_count = (count(*) FROM task_submission_versions v WHERE v.submission_id = s.id)` and, for attachments, filter to the current version (`a.version_id = s.current_version_id`).
- `rpc_submission_versions(p_submission_id)` — perm = can-view-task. Returns versions newest-first: `id, version_no, content, created_at, created_by, is_current (superseded_at IS NULL), expires_at, attachments[]` (each version's own set).

### A4. Restore a prior version  *(pointer move — identical to FileHub)*
`rpc_restore_submission_version(p_version_id)` — perm as A2. Resolve `submission_id`; set target version `superseded_at = NULL`; set the previously-current version `superseded_at = now()`; update `task_submissions.current_version_id` + denormalized `content` to the target. **No new version row, no byte copy.** (Distinct from B4's `rpc_restore_submission`, which un-deletes a soft-deleted submission — names kept explicit.)

### A5. Client
- `SubmissionContext`: `editSubmission(id, {content, keptAttachmentIds, newFiles})` — upload only new files (existing `processAndUploadFile` path), then `rpc_edit_submission`.
- `TaskDetailContext`: add `submissionVersions(id)`, `restoreSubmissionVersion(id)`; expose in the value; existing realtime on `task_submissions` covers pointer/content changes (add a channel on `task_submission_versions` if history views need live refresh).
- UI: an **Edit** action on a submission (author/management); a **"v{n} · history"** affordance shown when `version_count > 1` that opens the version list (preview content + attachments per version, Restore per past version). Reuse `EvidencePanel`'s card/preview components. Mirrors FileHub's Versions tab.

**Acceptance:** editing produces a new current version with the `task_submissions.id` unchanged; every prior version is previewable with its own attachments; **restore is a pointer move — no dup rows, no re-upload — and v5→v3→v5 leaves the set `{1..5}` intact**; versions never appear in the submissions list or stage-gate checks; an edit after approval re-enters review per the chosen policy; parity desktop + adaptive.

---

## Feature C — Federate files: cross-app index/search + shared utilities  *(independent of A/B; can ship in parallel)*

**Direction: federate, not merge.** Files stay owned by their domain tables (`filehub_files`, `submission_attachments`, `task_attachments`). We add (1) one read model that unifies them for search/browse, and (2) shared client components so both sides of the app use the same viewer / version-history / soft-delete UI. No storage migration, no new audience dimension on FileHub, no coupling of the stage-gating path to the file repository.

### The three file sources (verified)
| Source | Table | Bucket | Name / size / path cols | Context |
|---|---|---|---|---|
| FileHub | `filehub_files` | `bucket` col (`filehub-files`) | `original_name` / `size_bytes` / `storage_path` | `visibility`, `folder_id`, `group_id`, recipients |
| Submission | `submission_attachments` | `submission-attachments` | `file_name` / `file_size` / `storage_path` | `submission_id` → `task_submissions.task_id` |
| Task brief | `task_attachments` | `task-attachments` | `file_name` / `file_size` / `storage_path` | `task_id` |

### C1. `files_index` view (normalization only)
Read-only `UNION ALL` mapping all three into one shape:
`source ('filehub'|'submission'|'task_brief'), file_id, company_id, bucket, storage_path, file_name, mime_type, size_bytes, category, uploaded_by, created_at, deleted_at, task_id (NULL for filehub), submission_id (NULL otherwise), filehub_visibility/folder_id/group_id (NULL otherwise)`.
- **Only live rows:** filehub `deleted_at IS NULL`; submission attachments joined to `task_submissions` with `deleted_at IS NULL` **and** `version_id = current_version_id` (current version only — past-version files don't clutter search but are still reachable from a submission's history); task briefs as-is.
- The view is just normalization — **access is enforced by the RPC below**, not the view. (Keep it plain; don't rely on `security_invoker` because the three sources gate differently.)

### C2. `rpc_files_search(p_query text, p_sources text[] DEFAULT NULL, p_task_id uuid DEFAULT NULL, p_limit int DEFAULT 50)`  *(SECURITY DEFINER)*
Returns `files_index` rows where `company_id = my_company_id()`, `p_query` matches (`file_name ILIKE '%q%'`, plus filehub `caption`/`tags`), optionally filtered by source/task, **and the caller can access that row's source**:
- `filehub` → reuse `filehub_file_accessible(file_id)` (exists from the FileHub work).
- `submission` / `task_brief` → caller can view the parent task (reuse the task-detail access predicate: assignee OR manager OR creator OR owner OR `task.view_detail`).
- Each returned row carries a signed-URL-ready `{bucket, storage_path}` and a click-through target (`task_id`/`submission_id` or filehub folder).
`// ponytail: ILIKE over ~120 rows total. Add pg_trgm GIN on the three name cols when tables hit ~10k+; predicate pushdown means each UNION branch uses its own index — no query rewrite needed.`
- **Perf shape:** filter (company + name match + LIMIT) **before** the per-row access `EXISTS` checks, so access is verified on ≤ `p_limit` survivors (indexed PK/FK lookups), never the whole corpus. `UNION ALL` is concatenation, not a join — the view costs nothing over querying the tables directly, and it runs only on user-triggered search.

### C3. Unified search/browse surface (FileHub)
FileHub's existing search queries `rpc_files_search` across all sources. Each result gets a **source badge** (FileHub / Task / Submission / Brief) and clicks through to its home (submission/brief → task detail; filehub → its folder). Reuse the existing FileHub search UI + `FilePreviewGrid`. This is the "index and search across all tasks" win.

### C4. Shared client utilities (reuse code, not tables)
Extract the pieces both sides want into one implementation each, parameterized by data source:
- **Viewer / preview** — `useFileViewer` + `FilePreviewGrid` are **already shared** (`EvidencePanel` uses them). No work beyond pointing task/filehub surfaces at them.
- **`<VersionHistory>`** — one component fed by either `rpc_filehub_file_versions` or `rpc_submission_versions` (both expose `version_no / is_current / created_at / attachments`). Powers FileHub's Versions tab **and** a submission's history view.
- **Soft-delete/restore action** — one menu action wired per-domain to its delete+restore RPCs (`rpc_delete/restore_submission`, filehub equivalents).

> The versioning **tables stay separate** (`filehub_file_versions` vs `task_submission_versions`) — only the **search index** and the **UI utilities** are shared. That's the federate line: connect the app without fusing the two domains' storage/access.

### C5. Consistency model (why there's nothing to sync)
`files_index` is a **view, not a table** — FileHub search holds no copy of a submission file; results are computed from the source tables at read time. Consequences:
- Removing a file from a submission (edit → new current version without it) drops it from search **instantly** (`version_id = current_version_id` filter). Soft-deleting the submission does the same (`deleted_at IS NULL` join). Restore brings it back. Purge removes it everywhere.
- **No dual writes, no triggers, no mirror rows to drift.** Each file has exactly one owning table; the merge alternative (auto-inserting `filehub_files` rows per submission upload) would need delete/restore/purge kept in lockstep across two tables — that entire failure class is designed out.
- Accepted limitation: submission files are *searchable* in FileHub but aren't FileHub files — no folders/tags/recipients on them. If wanted later, add an explicit **"Copy to FileHub"** action (deliberate copy that then lives independently, no sync expected). Not built now.

**Acceptance:** a file uploaded via a task submission is findable by name in FileHub search and click-throughs to its task; a soft-deleted submission's files drop out of search; FileHub files still search/behave exactly as before; no submission access leaks a file the caller can't already see on the task; the Versions UI renders identically for a FileHub file and a submission.

---

## Feature D — Version control + soft delete for task brief attachments  *(confirmed 2026-07-09)*

A brief attachment (`task_attachments`) is a **standalone file** — FileHub-shaped, not collection-shaped like a submission. So it gets the exact FileHub Model B **per file** (submissions version the collection; brief files version individually).

### D1. Schema
**New table `task_attachment_versions`** — mirror of `filehub_file_versions`: `id, attachment_id → task_attachments(id) CASCADE, company_id, version_no UNIQUE(attachment_id, version_no), storage_path, bucket DEFAULT 'task-attachments', file_name, file_size, mime_type, created_by, created_at, superseded_at (NULL = current)`. Same indexes/RLS pattern as A1 (SELECT = company + can-view-task; writes via RPCs only).
**`task_attachments` additions:** `current_version_id`, `deleted_at`, `deleted_by`, `updated_at`, `updated_by`. Existing `file_name/file_size/mime_type/storage_path` stay as denormalized copies of the current version. Backfill v1 per row, idempotent — same recipe as A1.

### D2. RPCs (clones of the FileHub set, perms = task manager/creator/owner OR `tasks.manage`)
- `rpc_replace_task_attachment(p_attachment_id, p_storage_path, p_file_name, p_file_size, p_mime_type)` — new version + supersede old + pointer/denorm sync. Client uploads new bytes to a fresh path first (existing brief-upload path).
- `rpc_task_attachment_versions(p_attachment_id)` — history, newest first, same JSONB shape as A3's so `<VersionHistory>` (C4) renders it unchanged.
- `rpc_restore_task_attachment_version(p_version_id)` — pointer move, identical mechanics to A4.
- Convert the existing brief-attachment delete to **soft** (`deleted_at = now()`) + `rpc_restore_task_attachment` (management) — same pattern as B2/B4. Reads (`rpc_get_task_details` `v_task_attachments`, C1's brief branch) filter `deleted_at IS NULL`.
- All mutations log to `activity_events` (per the audit rule above).

### D3. Client
Brief section of task detail: **Replace** action on a file, **history** affordance when `version_count > 1`, soft-delete + management restore — all rendered by the same shared C4 components (`<VersionHistory>`, delete/restore action). No new UI primitives.

**Acceptance:** replacing a brief file keeps `task_attachments.id` stable and old versions downloadable/restorable; restore = pointer move; deleted brief files recoverable by management and hidden from task detail + search; `has_attachment` stage precondition ignores soft-deleted rows.

---

## Note — Submissions section vs Evidence & Proofs panel
Both render **the same rows**: `EvidencePanel` flatMaps `data.submissions[].attachments` from `rpc_get_task_details` — there is no second data set. Version control implemented once on the submission domain surfaces in **both**: Evidence & Proofs shows current-version attachments (A3 filter), the submissions section carries edit/history/restore affordances. No separate implementation needed or wanted.

---

## Open decisions (recommended defaults — change before A2/B4 land)

| # | Decision | Recommended default |
|---|----------|---------------------|
| 1 | Edit an **already-approved** submission? | **Allow**, but the new version resets to `pending` (re-review); approved version stays in history. *(Alt: lock edits after approval.)* |
| 2 | Who may **edit**? | Original submitter (while current version isn't locked) **+** `tasks.manage`/owner. |
| 3 | Who may **soft-delete** vs **recover**? | Delete: submitter (own) or management. Recover: **management only**. |
| 4 | Retention before hard purge of soft-deleted | **90 days**, reusing the FileHub purge pattern. Deferred (B6). |
| 5 | Per-attachment delete (vs whole-submission)? | **No** — submission is the unit. Add only on explicit request. |
| 6 | Version control / soft delete for **task brief attachments** (`task_attachments`)? | **Yes — confirmed 2026-07-09.** See Feature D. |

**Audit (definite-do, not a decision):** every mutating RPC in A/B (`rpc_edit_submission`, `rpc_delete_submission`, `rpc_restore_submission`, `rpc_restore_submission_version`) logs one row to the existing append-only `activity_events` (actor, action, submission id, version_no where relevant) — management recovery needs a trail of who deleted/reverted what.

---

## Suggested sequencing
1. **B1–B5** (soft delete + recovery) — smallest, highest immediate value; B1's migration is the base for A.
2. **A1–A5** (edit + versioning, Model B) — decision #1 confirmed (edit-after-approval → re-review).
3. **D1–D3** (brief attachment versioning + soft delete) — independent of A/B (own table + RPCs); shares C4's components, so its UI is cheapest after C4 exists. Migration can land any time.
4. **C1–C4** (federated index + shared utilities) — after A1 and D1 so both version filters exist for the view.
5. **B6** purge — last, only when reclaim is actually needed; one cron can purge submission + brief versions together.

> A, B, C, D are decoupled enough for separate chats: **B** = submission soft-delete, **A** = submission version table, **D** = brief-attachment version table (FileHub clone), **C** = view + search RPC + shared components. Ordering constraints: A1 & D1 migrations before C1's view.

## Invariants (every change preserves)
1. Exactly one current version per submission (`task_submission_versions.superseded_at IS NULL`); `current_version_id` points at it; the live `content` equals it. A `task_submissions.id` never changes on edit/restore.
2. Versions never surface in the submissions list, review queries, or stage-gate precondition checks (they live in a separate table). Soft-deleted submissions never surface in the default read.
3. Storage bytes for a soft-deleted submission or superseded version survive until the (deferred) purge — recovery/restore never re-uploads.
4. Restore is a pointer move: no new version row, no byte copy.
5. Resubmissions (`rpc_submit_work`) remain separate submissions, each with its own version history; only edits add versions.

## Progress log

### 2026-07-09 — Feature B (B1–B5) shipped
- **Migration:** `submission_soft_delete` applied to project `wbvgufqfgbvbinjrdzlg` via MCP; same SQL at `supabase/migrations/20260709_submission_soft_delete.sql`.
- **B1:** `task_submissions.deleted_at/deleted_by` + partial index `idx_task_submissions_task_live (task_id) WHERE deleted_at IS NULL`.
- **B2:** `rpc_delete_submission` converted to soft UPDATE (permission check unchanged: own submission OR `tasks.manage` OR owner); logs `task.submission_deleted` to `activity_events` via `log_event()`.
- **B3:** `rpc_get_task_details` re-applied whole with `AND s.deleted_at IS NULL` on `v_submissions` and on the `has_pending_submission` / `no_pending_submission` / `has_approved_submission` precondition EXISTS checks. Stats counts intentionally left unfiltered (not in scope).
- **B4:** new `rpc_restore_submission` (management only, company-scoped, logs `task.submission_restored`) + `rpc_list_deleted_submissions` (management only, v_submissions shape + `deleted_at` + `deleted_by` user object). Both SECURITY DEFINER, `search_path=public`, GRANT to authenticated.
- **B5:** `contexts/TaskDetailContext.tsx` — added `restoreSubmission` / `listDeletedSubmissions` + `DeletedSubmissionData` type; `components/task-detail/StageActions.tsx` — management-only "Deleted (n)" toggle under the submissions list with per-row Restore; delete confirm copy updated (no longer "permanently").
- **Verified:** function defs via `pg_get_functiondef` (soft delete present, no hard DELETE, 7 `deleted_at IS NULL` filters in task details, audit calls present); columns + index exist; `npx tsc --noEmit` shows no new errors (pre-existing ones in `_tasks_desktop.tsx` etc. unchanged).
- **Left:** B6 purge (deferred by design); Features A/C/D untouched.

### 2026-07-09 — Feature A (A1–A5) shipped
- **Migration:** `submission_versioning` applied to project `wbvgufqfgbvbinjrdzlg` via MCP; same SQL at `supabase/migrations/20260709_submission_versioning.sql`.
- **A1:** new `task_submission_versions` table (UNIQUE(submission_id, version_no), superseded/company indexes, RLS SELECT mirroring `submission_attachments_select`, no write policies); `task_submissions.current_version_id/updated_at/updated_by`; `submission_attachments.version_id` (+index); idempotent backfill created v1 for all 40 submissions (content/created_by/created_at copied from the row), pointed `current_version_id`, and versioned all 42 attachment rows. Verified post-backfill: 0 missing pointers, 0 missing version_ids, exactly one current version per submission, 0 content drift → attachments filter omits the `version_id IS NULL` escape hatch.
- **`rpc_submit_work`:** re-applied whole from live def; now inserts v1 + sets `current_version_id` + tags new attachments with the v1 `version_id`.
- **A2:** new `rpc_edit_submission(p_submission_id, p_content, p_kept_attachment_ids uuid[], p_new_attachments jsonb)` — new version (max+1), supersedes old, kept attachments pointer-copied (same `storage_path`, no re-upload), new attachments same jsonb shape as `rpc_submit_work`, pointer + denorm content sync, `updated_at/by`; decision #1: approved/confirmed → `pending` (review fields kept — they belong to the old review); blocks editing soft-deleted submissions; logs `task.submission_edited` with version_no; returns new version id.
- **A3:** `rpc_get_task_details` re-applied whole from live def (all 7 Feature-B `deleted_at` filters preserved, verified by pg_get_functiondef): `v_submissions` gains `version_count` + `current_version_id`, attachments filtered to `a.version_id = s.current_version_id`. New `rpc_submission_versions(p_submission_id)` — perm = can-view-task (same predicate as task details), newest-first, per-version attachments, `is_current`, `expires_at = superseded_at + 30 days`. `rpc_list_deleted_submissions` re-applied with the same current-version attachment filter.
- **A4:** new `rpc_restore_submission_version(p_version_id)` — pure pointer move (no new row, no byte copy), perm as A2, no-op if already current; content changes so decision #1's re-review reset applies on restore too; logs `task.submission_version_restored`. All new RPCs SECURITY DEFINER, `search_path=public`, GRANT to authenticated, company-scoped.
- **A5:** `contexts/SubmissionContext.tsx` — upload path extracted to shared `uploadFilesToStorage` (same bucket/path/concurrency); new `editSubmission(id, {taskId, taskTitle, companyId, content, keptAttachmentIds, newFiles})` uploads only new files then calls the RPC, mirroring the job/progress pattern. `contexts/TaskDetailContext.tsx` — `SubmissionData` gains `version_count`/`current_version_id`; new `SubmissionVersionData` type + `submissionVersions(id)` / `restoreSubmissionVersion(id)` in type + value. `components/task-detail/StageActions.tsx` — pencil Edit action (author/manager/owner, same gate as delete) opens a DraggableSheet with prefilled content, keep/remove toggles on current files, add-photo/file/paste (pickers generalized to take a target setter), Save-new-version; "v{n}" history chip when `version_count > 1` lazy-loads versions into a sheet (newest first, Current badge, content preview, per-version files, confirm-then-Restore). Sheets use `useThemeColors` inline styles (RN Modal web color rule).
- **Verified:** backfill counts above (read-only checks); function flags via pg_get_functiondef (SECURITY DEFINER + search_path on all 8 submission RPCs); `npx tsc --noEmit` — zero errors in the three touched files, only known pre-existing errors elsewhere.
- **Deviations:** `expires_at` returned by the RPC but not rendered (purge is deferred B6 — showing an expiry that nothing enforces would mislead); restore also resets approved/confirmed → pending (content changes, so the decision #1 rule is applied for consistency).
- **Left:** B6 purge, Features C/D untouched.

### 2026-07-12 — Feature D (D1–D3) shipped
- **Migration:** `task_attachment_versioning` applied to project `wbvgufqfgbvbinjrdzlg` via MCP; same SQL at `supabase/migrations/20260709_task_attachment_versioning.sql`.
- **Discovered write/delete path:** all brief-attachment inserts go through `rpc_add_task_attachments` (TaskCreationContext + TaskBriefPanel; no direct client inserts found, so no trigger needed — the RPC now creates v1 + sets `current_version_id` per file). **No delete path existed at all** (no RPC, no RLS UPDATE/DELETE policy, no client UI) — soft delete is a new `rpc_delete_task_attachment` gated like `rpc_add_task_attachments` (task creator/manager or `tasks.manage`) + owner.
- **D1:** new `task_attachment_versions` (UNIQUE(attachment_id, version_no), superseded/company indexes, RLS SELECT `company_id = my_company_id()` mirroring the parent's `task_attachments_select` gate, no write policies); `task_attachments.current_version_id/deleted_at/deleted_by/updated_at/updated_by` + partial index `idx_task_attachments_task_live (task_id) WHERE deleted_at IS NULL`; idempotent backfill created v1 for all 8 attachments (8 rows live at apply time, not the 9 noted on 2026-07-09) — verified 0 missing pointers, exactly one current version per attachment, 0 pointer/storage_path drift.
- **D2:** `rpc_replace_task_attachment` (new version max+1, supersede old, pointer + denorm sync incl. `file_url`, logs `task.attachment_replaced`); `rpc_task_attachment_versions` (perm = can-view-task, newest first, same per-version field names as `rpc_submission_versions`: version_no/is_current/created_at/expires_at/created_by object + file fields); `rpc_restore_task_attachment_version` (pure pointer move, no-op if current, logs `task.attachment_version_restored`); `rpc_delete_task_attachment` (soft, bytes kept, logs `task.attachment_deleted`); `rpc_restore_task_attachment` (management: `tasks.manage` OR owner, logs `task.attachment_restored`); `rpc_list_deleted_task_attachments` (management, v_task_attachments shape + deleted_at/deleted_by object). All SECURITY DEFINER, `search_path=public`, GRANT to authenticated, company-scoped.
- **Reads:** `rpc_get_task_details` re-applied whole from live def (all 7 B `deleted_at` filters + A version logic preserved, verified post-apply — 9 filters total now): `v_task_attachments` filters `a.deleted_at IS NULL` and gains `version_count`/`current_version_id`; `has_attachment` stage precondition now ignores soft-deleted rows.
- **D3:** `contexts/TaskDetailContext.tsx` — `TaskAttachmentData` gains `version_count`/`current_version_id`; new `TaskAttachmentVersionData`/`DeletedTaskAttachmentData` types + `replaceTaskAttachment`/`taskAttachmentVersions`/`restoreTaskAttachmentVersion`/`deleteTaskAttachment`/`restoreTaskAttachment`/`listDeletedTaskAttachments` in type + value. `components/task-detail/TaskBriefPanel.tsx` — upload path extracted to `uploadOne` (same compress/path recipe); per-tile Replace (fresh upload then RPC) + soft-delete X (confirm, "management can restore" copy) for uploaders (manager/creator/owner), "v{n}" history pill when `version_count > 1` opening a DraggableSheet (lazy-loaded, Current badge, per-version download, confirm-then-Restore) with `useThemeColors` inline styles (RN Modal web color rule); management-only "Deleted (n)" toggle with per-row Restore, mirroring StageActions' Feature-B pattern.
- **Verified:** DB counts above (read-only); SECURITY DEFINER + search_path on all 7 task-attachment RPCs; `npx tsc --noEmit` — zero errors in the two touched files, only known pre-existing errors elsewhere (`_tasks_desktop.tsx`, `_layout.web.tsx`, `_analytics_adaptive.tsx`, hooks).
- **Deviations:** versions RLS SELECT is company-only (the parent `task_attachments_select` is company-only — a can-view-task predicate would be stricter than the rows it versions; reads go through the RPC anyway); `category` denorm not recomputed on replace (RPC signature per spec has no category param; icons render from `mime_type`); C4 `<VersionHistory>` doesn't exist yet (Feature C not built) so the history sheet mirrors StageActions' Feature-A sheet inline.
- **Left:** B6 purge, Feature C untouched.

### 2026-07-12 — Feature C (C1–C3) shipped
- **Migration:** `files_index_search` applied to project `wbvgufqfgbvbinjrdzlg` via MCP; same SQL at `supabase/migrations/20260712_files_index_search.sql`.
- **C1:** plain view `files_index` (not security_invoker, not materialized) — `UNION ALL` of live `filehub_files` (`deleted_at IS NULL`), `submission_attachments` joined to `task_submissions` (`s.deleted_at IS NULL AND a.version_id = s.current_version_id` — current version only), and `task_attachments` (`deleted_at IS NULL`), normalized to `source/file_id/company_id/bucket/storage_path/file_name/mime_type/size_bytes/category/uploaded_by/created_at/task_id/submission_id/folder_id/group_id/visibility`. Supabase's default privileges would have exposed it (view runs with owner rights, bypassing source RLS), so `REVOKE ALL FROM anon, authenticated` — the view is reachable only through the RPC.
- **C2:** `rpc_files_search(p_query, p_sources text[] DEFAULT NULL, p_task_id uuid DEFAULT NULL, p_limit int DEFAULT 50)` — SECURITY DEFINER, `search_path=public`, GRANT to authenticated (revoked from PUBLIC/anon). Cheap filters first (company + `file_name ILIKE '%q%'` + filehub caption/tags + optional source/task) with a 3× over-fetch candidate LIMIT, then per-row access on survivors: `filehub_file_accessible(file_id)` for filehub, new helper `task_accessible(p_task_id)` for submission/brief rows (no existing helper found in pg_proc — it's the exact predicate copied from `rpc_get_task_details`: assignee OR team-assignee OR manager OR creator OR owner OR `task.view_detail`, company-scoped, live tasks only). Returns JSONB array with file fields + source + task_id/submission_id + `task_title` (tasks.title) + folder/group/visibility for filehub rows. `// ponytail:` over-fetch is a heuristic, fine at ~115 files; pg_trgm when tables hit ~10k+.
- **C3:** `contexts/FileHubContext.tsx` — new `CrossSearchResult` type + `taskResults` in context; on the existing debounced search it additionally calls `rpc_files_search` with `p_sources=['submission','task_brief']` (FileHub rows keep coming from `rpc_filehub_list`, so they behave *exactly* as before and never duplicate). New shared `components/intelligence/TaskFileResults.tsx` — "From Tasks" section with per-row source badge (Submission / Brief), task title + size, row press → `/task/{task_id}`, eye icon → `openStorageFile(bucket, storage_path, name, mime)`. Rendered in the non-groups search surface of both `_filehub_desktop.tsx` and `_filehub_adaptive.tsx` (list + "No Results" empty state — task hits show even when FileHub itself has none). Groups mode untouched (its search is channel-scoped by design).
- **Storage check:** `submission-attachments` / `task-attachments` storage SELECT policies are company-scoped (verified pg_policy) — any company member can already sign URLs for task-detail rendering; the RPC only returns rows the caller can access, so no new paths exposed.
- **Verified (read-only):** view counts match source-table counts exactly (filehub 65 / submission 42 / task_brief 8); no anon/authenticated grants on the view; SECURITY DEFINER + search_path flags on both functions; anon cannot execute the RPC; RPC with no auth returns `[]`; end-to-end via simulated JWT claims in a rolled-back transaction — 39 hits for 'a' across sources, 6 task-sourced, sample submission row carries bucket/storage_path/task_title/submission_id. `npx tsc --noEmit` — zero errors in the four touched files, only known pre-existing errors elsewhere.
- **C4 skipped (deliberate):** the viewer (`useFileViewer`/`FilePreviewGrid`) is already shared, and Features A & D each shipped working inline version-history sheets — extracting a shared `<VersionHistory>` now would be a refactor of two working UIs with no new capability. Revisit only if a third version-history surface appears.
- **Left:** B6 purge (deferred by design).
