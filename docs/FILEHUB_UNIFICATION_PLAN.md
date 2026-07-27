# FileHub Unification Plan (issue #143)

Goal of #143: **every file the app stores lives in FileHub as the single source of
truth, and everything else (tasks, submissions, briefs) holds pointers into it** —
so any file automatically inherits FileHub's capabilities: version control,
preview, dedup / conflict handling, folders, tags, soft-delete + purge, activity.

This doc is the audit + migration path. The **read-layer UX** (Overview tab,
Browse-by-project/category, recents, `?file=` deep link) already shipped on the
federated `files_index` view without any data migration — see
`supabase/migrations/20260727_filehub_overview_browse.sql`. What remains is the
actual storage unification described here.

---

## 1. Divergence audit — three file systems today

| Concern | FileHub (`filehub_files`) | Task briefs (`task_attachments`) | Submissions (`submission_attachments`) |
|---|---|---|---|
| Bucket | `filehub-files` | `task-attachments` | `submission-attachments` |
| Storage path | `{company}/{file_id}/{name}` | `{company}/tasks/{task}/brief/{ts}_{rand}.{ext}` | `{company}/tasks/{task}/users/{user}/{ts}_{rand}.{ext}` |
| Name / size cols | `original_name` / `size_bytes` | `file_name` / `file_size` | `file_name` / `file_size` |
| Bucket col on row | yes (`bucket`) | version rows default `'task-attachments'` | none (hard-coded) |
| Versioning unit | **per file** (`filehub_file_versions`, pointer `current_version_id`) | **per file** (`task_attachment_versions`, same model) | **per collection** (`task_submission_versions` = content text + a *set* of attachments via `attachment.version_id`) |
| Content hash / dedup / name-conflict | yes (`content_hash`, `rpc_filehub_check_*`, `name (1)` auto-rename) | none | none |
| Folders / tags / caption / visibility / recipients | yes | none | none |
| Access model | `filehub_file_accessible(file_id)` (recipients / group / broadcast) | `task_accessible(task_id)` | `task_accessible(task_id)` |
| Soft-delete granularity | per file | per file | per **submission** (attachments follow parent) |
| Purge | live — `purge-filehub-versions` edge fn + daily cron; bin + orphan sweeps | **deferred (B6)** — superseded/deleted rows + bytes never purged | **deferred (B6)** |
| Activity log | `filehub_activity` (`view`/`download`/… per user) | none | none |

**Key structural fork:** briefs are a near-exact per-file clone of FileHub (easy to
converge). Submissions are the real divergence — a *collection* versioning model
(one version = content + N files) with no per-file lineage.

**FK constraint that shapes everything:** `filehub_activity.file_id` → `filehub_files(id)`.
Until task files are `filehub_files` rows, they cannot log activity, which is why
"Recently opened" in the Overview tab is FileHub-only and task files are surfaced
via "Recently assigned" instead. Unification removes that asymmetry for free.

---

## 2. Migration path — pointer-based, no byte moves

Register each **live** task file as a `filehub_files` row that points at its
existing bucket/path. Nothing is copied in storage.

1. **New visibility + column.** Add `visibility='task'` to the `filehub_files`
   visibility CHECK, and a nullable `task_id uuid` (and keep `bucket`/`storage_path`
   pointing at the original object). RLS: a `visibility='task'` file is accessible
   iff `task_accessible(task_id)` — reuse the existing helper.
2. **Pointer columns on the source tables.** Add nullable `filehub_file_id uuid`
   to `submission_attachments` and `task_attachments`. This is the join that lets
   both worlds coexist during rollout.
3. **Idempotent backfill**, keyed on `(bucket, storage_path)` so re-runs are safe:
   for every live `task_attachments` / current-version `submission_attachments`
   row without a pointer, insert a `filehub_files` row (`visibility='task'`,
   `task_id`, `bucket`, `storage_path`, `original_name := file_name`,
   `size_bytes := file_size`, `mime_type`, `content_hash := NULL`) and set the
   pointer back. `filehub_file_versions` v1 mirrors the row.
4. **Write-through on new uploads.** Update `rpc_add_task_attachments`,
   `rpc_replace_task_attachment`, `rpc_submit_work`, `rpc_edit_submission` to
   create/point the `filehub_files` row in the same transaction. New task files are
   born unified; the backfill only covers history.

---

## 3. Versioning convergence

- **Briefs:** `task_attachment_versions` maps 1:1 onto `filehub_file_versions`
  (same per-file pointer model) — collapse into it and drop the brief-specific table.
- **Submissions:** keep collection-versioning at the *submission* layer (a
  submission version is still content + a set of attachments). Each attachment just
  gains a `filehub_file_id` pointer; the bytes and per-file lineage live in FileHub.
  Restoring a submission version re-points to the same immutable FileHub files.

---

## 4. What unification unlocks

- **Recents cover task files** — the `filehub_activity` FK is satisfied, so opening
  a submission/brief file logs a `view` and shows in "Recently opened".
- **One purge path** — the existing `purge-filehub-versions` cron covers task files,
  closing the deferred B6 gap for both submissions and briefs.
- **Dedup across the app** — backfill `content_hash` and task files participate in
  the same duplicate / name-conflict prompts as FileHub uploads.
- **`files_index` shrinks** to the single `filehub` branch, then can be dropped;
  `rpc_files_search` / `rpc_filehub_browse` become plain filters over one table
  instead of a 3-way UNION with per-source ACL branches.

---

## 5. Deprecation endgame

1. Backfill + write-through live; both pointer worlds coexist (reads still via `files_index`).
2. Switch task-file reads (task detail, brief panel, submissions) to the pointed
   `filehub_files` rows.
3. Collapse `files_index` to one branch; simplify `rpc_files_search` /
   `rpc_filehub_browse` (drop the `task_accessible` CASE — access is now the file's
   own `visibility='task'` RLS).
4. Retire `task_attachment_versions`; keep `submission_attachments` /
   `task_attachments` as thin pointer/edge tables (or fold into `filehub_files` +
   a `task_files` join table) once nothing reads their byte columns.

**Ordering / risk:** steps 2–4 in §2 are additive and safe to ship incrementally
behind the coexistence pointers. The one-way commits are dropping `files_index`
branches and the brief version table (step 3/4 of §5) — do those only after every
reader is switched over.
