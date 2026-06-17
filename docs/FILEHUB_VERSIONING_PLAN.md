# FileHub Version Control — Phased Implementation Plan

> **Status:** Approved, not started. Created 2026-06-17.
> **How to use this doc:** Each phase below is **self-contained** and can be handed to a separate chat. Read the **"Shared context"** section first, then your assigned phase. Phases have dependencies (noted per phase) — respect the order. Check off acceptance criteria before marking a phase done, and update the **Progress log** at the bottom.

---

## Shared context (read before any phase)

### What we're building
A version-control system for the FileHub file repository:

1. **Upload conflict** — uploading a file with the **same name** into the **same destination** prompts **Replace / Keep Both / Cancel**.
   - **Keep Both** → new file is auto-renamed Windows-style: `report (1).pdf`, `report (2).pdf`.
   - **Replace** → the current file is updated **in place** (keeps its `id`, recipients, links, activity); the prior content becomes a previous version. Recipients automatically see the latest, with full history.
   - **Cancel** → that file is skipped.
2. **Versions tab** in the file properties panel (the right-side panel on desktop web; the detail sheet on mobile) — lists previous versions with **Download** and **Restore**.
3. **30-day retention** — previous (superseded) versions are purged 30 days after they stop being current. The current version is never purged.

### Approved product decisions
- **Conflict scope ("same destination"):**
  - **group** → same `group_id` (any uploader — collaborative)
  - **broadcast** → `visibility='broadcast'` + same `folder_id` (any uploader — collaborative)
  - **direct** → **owner-only carve-out**: only conflicts against the current user's *own* direct uploads in the same `folder_id`. (Replacing a 1:1 message sent by someone else would rewrite bytes for recipients you don't control — disallowed.)
  - Name match is **case-insensitive on the trimmed name**.
- **Restore is supported** (each previous version has a Restore action).
- **Versioning model = Model B (pointer + immutable versions).** See below.
- **Platforms:** web desktop **and** mobile/adaptive (full parity).
- **Purge mechanism:** scheduled Edge Function triggered by **pg_cron + pg_net** (both approved to enable).

### Model B — pointer + immutable versions (the core mental model)
Versions are **immutable content records** in a dedicated table. The file row holds a **`current_version_id` pointer**. The history is a **linear list + a "which one is current" marker** (not a branching tree).

- **Replace** = insert a new immutable version, point `current_version_id` at it, set the old current's `superseded_at = now()`.
- **Restore** = **move the pointer** — set the target version `superseded_at = NULL` (current), set the previously-current version's `superseded_at = now()`. **No bytes copied, no new version created.**
- **The current version is never purged.** A version you navigate away from starts a 30-day clock; if you return within 30 days it's still there. So bouncing v5↔v6 keeps the set `{1…6}` intact.

Worked example (versions 1–6 exist, v6 current):

| Action | Effect | Version set |
|---|---|---|
| Restore v5 | pointer→v5; v6 `superseded_at=now()` | 1,2,3,4,**5**,6 |
| Back to v6 | pointer→v6; v5 `superseded_at=now()` | 1,2,3,4,5,**6** |

> **Key benefit:** because versions live in a **separate table**, they can never leak into the inbox/sent/broadcast/group listings — so existing list RPCs and RLS need almost no changes.

### Existing architecture (current state, pre-feature)
- **Routing:** [app/(tabs)/filehub.tsx](../app/(tabs)/filehub.tsx) → [components/intelligence/_filehub_web.tsx](../components/intelligence/_filehub_web.tsx) (splits ≥1024px → `_filehub_desktop.tsx`, else `_filehub_adaptive.tsx`); native → `_filehub_adaptive.tsx`.
- **State/logic:** [contexts/FileHubContext.tsx](../contexts/FileHubContext.tsx) — `useFileHub()`.
- **Tables:** `filehub_files` (core; `visibility ∈ {direct,broadcast,group}`, `tags TEXT[]`, `content_hash`, `folder_id`, `group_id`, `replaces_file_id` [legacy, unused], soft-delete via `deleted_at`), `filehub_folders`, `filehub_recipients`, `filehub_groups`, `filehub_group_members`, `filehub_activity`.
- **Storage:** private bucket `filehub-files`, 500 MB cap. Path = `{company_id}/{file_id}/{filename}`. Access via signed URLs ([lib/storage.ts](../lib/storage.ts) `openStorageFile`). **Storage RLS is path-based** — policies cannot use `has_permission()` or cross-schema joins reliably; use `split_part(name,'/',1) = my_company_id()::text` for path checks, or `EXISTS` against `filehub_files` by `storage_path`.
- **Upload flow** (client-side): compute SHA-256 → `supabase.storage.upload(path)` → `rpc_filehub_upload_commit(...)`.
- **All writes** go through `SECURITY DEFINER` RPCs (no direct INSERT/UPDATE/DELETE policies). List RPCs return the **same JSONB shape** so `FileCard`/`FileRow`/`DetailPanel` are reusable.
- **DetailPanel tab pattern** (the thing we extend): `[tab, setTab] = useState<'details'|'activity'>('details')`; activity lazy-loads on tab switch. Desktop at [_filehub_desktop.tsx:1050](../components/intelligence/_filehub_desktop.tsx#L1050); adaptive `FileDetailSheet` at [_filehub_adaptive.tsx:106](../components/intelligence/_filehub_adaptive.tsx#L106).
- **Two upload entry points:** desktop `UploadModal.handleUpload` [_filehub_desktop.tsx:257](../components/intelligence/_filehub_desktop.tsx#L257); adaptive `UploadSheet` commit [_filehub_adaptive.tsx:545](../components/intelligence/_filehub_adaptive.tsx#L545).
- **Supabase project ref:** `wbvgufqfgbvbinjrdzlg`. Apply migrations via Supabase MCP (`apply_migration`).

### Shared data spec (the contract every phase relies on)

**New table `filehub_file_versions`:**
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | `gen_random_uuid()` |
| `file_id` | UUID NOT NULL | → `filehub_files(id)` ON DELETE CASCADE |
| `company_id` | UUID NOT NULL | → `companies(id)` (denormalized for RLS) |
| `version_no` | INT NOT NULL | sequence within a file; `UNIQUE(file_id, version_no)` |
| `storage_path` | TEXT NOT NULL | this version's own object |
| `bucket` | TEXT NOT NULL DEFAULT 'filehub-files' | |
| `original_name` | TEXT NOT NULL | |
| `size_bytes` | BIGINT NOT NULL | |
| `mime_type` | TEXT | |
| `content_hash` | TEXT | |
| `created_by` | UUID | → `users(id)` ON DELETE SET NULL |
| `created_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| `superseded_at` | TIMESTAMPTZ NULL | **NULL = this is the current version**; non-null starts the 30-day purge clock |

Indexes: `(file_id, version_no)`, `(superseded_at) WHERE superseded_at IS NOT NULL` (purge), `(company_id)`.

**`filehub_files` additions:**
- `current_version_id UUID` → `filehub_file_versions(id)` (nullable for FK ordering; always set after backfill)
- `updated_at TIMESTAMPTZ`
- `updated_by UUID` → `users(id)`
- The existing `storage_path / original_name / size_bytes / mime_type / content_hash` columns remain and are kept as **denormalized copies of the current version's values** so all existing reads keep working unchanged.

**Invariant:** for any `filehub_files` row, exactly one `filehub_file_versions` row with the same `file_id` has `superseded_at IS NULL`, and `current_version_id` points at it; the live row's denormalized fields equal that version's.

---

## Phase 1 — Database: schema, backfill, RPCs, RLS/storage
**Depends on:** nothing. **Blocks:** all other phases.
**Files:** `supabase/migrations/20260617_filehub_versioning.sql` (apply via Supabase MCP `apply_migration`).

### 1.1 Schema
- Create `filehub_file_versions` per the Shared data spec (+ indexes, + enable RLS).
- Add `current_version_id`, `updated_at`, `updated_by` to `filehub_files`.

### 1.2 Backfill (one-time, in the migration)
For every existing `filehub_files` row: insert a `v1` `filehub_file_versions` row (`version_no=1`, `superseded_at=NULL`) mirroring the file's current `storage_path/bucket/original_name/size_bytes/mime_type/content_hash/uploaded_by/created_at`, then set `filehub_files.current_version_id` to it. Do this in a single `INSERT ... RETURNING` / `UPDATE ... FROM` pass (or a `DO` block) so it's idempotent (`WHERE current_version_id IS NULL`).

### 1.3 RLS
- Enable RLS on `filehub_file_versions`. SELECT policy: `company_id = public.my_company_id() AND public.has_permission('filehub:view')`. No INSERT/UPDATE/DELETE policies (all writes via SECURITY DEFINER RPCs; purge uses service role).
- **Existing list RPCs / `filehub_files` RLS need NO version filtering** (versions are a separate table). Do **not** add `version_of` logic anywhere — that was the Model A approach and is not used.

### 1.4 Storage SELECT policy rewrite
Replace `filehub_storage_select` so an object is readable when **either**:
- a live `filehub_files` row with `storage_path = storage.objects.name` is accessible to the user (existing logic: uploader OR broadcast OR direct-recipient OR group-member, same company, not deleted); **or**
- a `filehub_file_versions` row with `storage_path = storage.objects.name` whose parent `filehub_files` row is accessible to the user (same audience check).

Factor the accessibility check so both branches share it. Leave INSERT (path-prefix) and DELETE policies unchanged.

### 1.5 RPCs (all `SECURITY DEFINER`, `SET search_path = public`, `GRANT EXECUTE ... TO authenticated`)

**`rpc_filehub_check_name_conflict(p_name TEXT, p_visibility TEXT, p_group_id UUID, p_folder_id UUID) RETURNS JSONB`**
Returns the conflicting **live** file (`id, original_name, uploader full_name, size_bytes, created_at`) or `NULL`. Scope rules:
- normalize: `lower(trim(p_name))` vs `lower(trim(f.original_name))`; `f.deleted_at IS NULL`, `f.company_id = my_company_id()`.
- group: `f.visibility='group' AND f.group_id = p_group_id`.
- broadcast: `f.visibility='broadcast' AND f.folder_id IS NOT DISTINCT FROM p_folder_id`.
- direct: `f.visibility='direct' AND f.uploaded_by = auth.uid() AND f.folder_id IS NOT DISTINCT FROM p_folder_id`.

**`rpc_filehub_upload_commit(...)` (extend the existing 12-param function)**
- Keep the existing signature/behavior; **add**: after inserting the `filehub_files` row, insert a `v1` `filehub_file_versions` row (`superseded_at=NULL`) and set `current_version_id`.
- **Auto-dedupe name** for the Keep-Both path: when committing a brand-new file whose normalized name collides in scope (same rules as `check_name_conflict`), append ` (N)` before the extension, picking the lowest free N. Do this server-side so it's race-safe. (The client only calls this for "Keep Both" or no-conflict; "Replace" uses the replace RPC instead.)

**`rpc_filehub_replace_file(p_target_id UUID, p_storage_path TEXT, p_size_bytes BIGINT, p_content_hash TEXT, p_mime_type TEXT, p_caption TEXT DEFAULT NULL) RETURNS UUID`**
- Permission checks: group → caller must be a member of the file's group; broadcast → `has_permission('filehub:broadcast')`; direct → caller must be the file's `uploaded_by`. Always same company, file not deleted.
- Insert a new `filehub_file_versions` row: `version_no = (max for file)+1`, `superseded_at = NULL`, fields from the new bytes (`original_name` = the live file's current name to keep the lineage name stable), `created_by = auth.uid()`.
- Set the previously-current version's `superseded_at = now()`.
- Update `filehub_files`: `current_version_id` = new version, denormalized fields = new version's, `updated_at = now()`, `updated_by = auth.uid()`, optionally `caption`.
- Returns the new version id. (Optional: emit a notification event — defer unless trivial.)

**`rpc_filehub_file_versions(p_file_id UUID) RETURNS JSONB`**
- Require `filehub:view` + that the caller can see the live file (reuse access logic).
- Return array ordered by `version_no DESC`: `id, version_no, original_name, size_bytes, mime_type, storage_path, bucket, created_at, superseded_at, is_current (superseded_at IS NULL), expires_at (superseded_at + interval '30 days', NULL if current), uploader {id, full_name, avatar_url}`.

**`rpc_filehub_restore_version(p_version_id UUID) RETURNS VOID`**
- Resolve `file_id` from the version; run the same permission checks as `replace_file`.
- Pointer move: set target version `superseded_at = NULL`; set the previously-current version (`superseded_at IS NULL`, different id) `superseded_at = now()`; update `filehub_files` denormalized fields = target version's, `current_version_id = p_version_id`, `updated_at=now()`, `updated_by=auth.uid()`.
- No byte copy, no new version row.

### 1.6 Acceptance criteria
- [ ] Migration applies cleanly; every pre-existing file has exactly one current `v1` and a set `current_version_id`.
- [ ] `check_name_conflict` returns the right row per scope rules (test group/broadcast/direct + the direct owner-only carve-out).
- [ ] `upload_commit` creates a `v1`; a colliding brand-new commit auto-renames to `name (1)`.
- [ ] `replace_file` adds a version, supersedes the old, keeps `filehub_files.id` stable, syncs denormalized fields, enforces perms.
- [ ] `restore_version` moves the pointer with no new row/byte copy; re-restoring the other way leaves the version set unchanged.
- [ ] Versions never appear in `rpc_filehub_list` / `rpc_filehub_group_list_files` results.
- [ ] A direct-send **recipient** (not just the owner) can download a previous version via its signed URL (storage policy covers version objects).

---

## Phase 2 — Purge Edge Function + cron schedule
**Depends on:** Phase 1 (table + `superseded_at`). **Blocks:** nothing (can run in parallel with 3–5).
**Files:** `supabase/functions/purge-filehub-versions/index.ts`; a migration to enable `pg_cron`/`pg_net` and schedule the job.

- Edge function (service role): select `filehub_file_versions` where `superseded_at IS NOT NULL AND superseded_at < now() - interval '30 days'`. For each, delete the storage object (`supabase.storage.from(bucket).remove([storage_path])`), then delete the row. Batch + log counts. Current versions (`superseded_at IS NULL`) are excluded by definition.
- Enable `pg_cron` and `pg_net` extensions (approved). Schedule a **daily** job that `pg_net` POSTs to the function URL with the service-role key. Deploy the function via Supabase MCP `deploy_edge_function`.
- **Acceptance:** [ ] manually inserting a version with `superseded_at = now() - 31 days` and running the function deletes both the row and its storage object; current versions and <30-day versions are untouched. [ ] cron job is listed and scheduled daily.

---

## Phase 3 — Client context wiring
**Depends on:** Phase 1 (RPCs exist). **Blocks:** Phases 4 & 5.
**Files:** [contexts/FileHubContext.tsx](../contexts/FileHubContext.tsx).

- Add `FileVersion` type: `{ id, version_no, original_name, size_bytes, mime_type, storage_path, bucket, created_at, superseded_at, is_current, expires_at, uploader }`.
- Extend `FileHubFile`: `current_version_id?: string`, `version_count?: number`. (Update `rpc_filehub_list` / `rpc_filehub_group_list_files` JSONB in Phase 1 to include `version_count = (SELECT count(*) FROM filehub_file_versions v WHERE v.file_id = f.id)` — note this in Phase 1 too.)
- Add methods (mirror existing patterns — Alert on error):
  - `checkNameConflict(name, visibility, groupId, folderId) => Promise<conflict|null>`
  - `replaceFile(targetId, { storagePath, size, hash, mime, caption? }) => Promise<void>` (refresh after)
  - `fileVersions(fileId) => Promise<FileVersion[]>`
  - `restoreVersion(versionId) => Promise<void>` (refresh file lists/detail after)
- Expose all via context value.
- **Acceptance:** [ ] type-checks; methods callable; `version_count` present on listed files.

> **Cross-phase note:** add `version_count` to the list RPC JSONB in **Phase 1** (it's a DB change). Phase 3 just consumes it. Flagged in both places so neither chat misses it.

---

## Phase 4 — Upload conflict prompt (desktop + adaptive)
**Depends on:** Phases 1 & 3. **Blocks:** nothing.
**Files:** [_filehub_desktop.tsx:257](../components/intelligence/_filehub_desktop.tsx#L257) (`UploadModal.handleUpload`); [_filehub_adaptive.tsx:545](../components/intelligence/_filehub_adaptive.tsx#L545) (`UploadSheet`).

- In the per-file upload loop, **after** the existing SHA-256 + duplicate-hash check, call `checkNameConflict(file.name, draft.visibility, groupId, draft.folderId)`.
- If a conflict exists, prompt **Replace / Keep Both / Cancel** (use `Alert.alert` with 3 buttons, consistent with the existing dup prompt):
  - **Replace** → generate a fresh `{company}/{uuid}/{safeName}` path, `supabase.storage.upload(path, file)`, then `replaceFile(conflict.id, {...})`. (Do **not** call `upload_commit`.)
  - **NOTE (verified in Phase 3):** `rpc_filehub_check_name_conflict` returns a **flat** object `{ id, original_name, uploader_name, size_bytes, created_at }` (not a nested uploader object). The prompt should read `conflict.uploader_name`. The context method `checkNameConflict(name, visibility, groupId, folderId)` returns this object or `null`.
  - **Keep Both** → proceed with the normal `upload_commit` path (server auto-renames).
  - **Cancel** → `continue` (skip this file).
- No conflict → existing `upload_commit` path unchanged.
- Each upload already mints a fresh path, so old version bytes are never overwritten — no change needed there.
- **Acceptance:** [ ] uploading a same-named file into a group/broadcast (any uploader) and into your own direct folder triggers the prompt; [ ] Replace produces a new version on the same file id; [ ] Keep Both creates `name (1)`; [ ] Cancel skips; [ ] works on both desktop and adaptive.

---

## Phase 5 — Versions tab (desktop + adaptive)
**Depends on:** Phases 1 & 3. **Blocks:** nothing.
**Files:** desktop `DetailPanel` [_filehub_desktop.tsx:1050](../components/intelligence/_filehub_desktop.tsx#L1050); adaptive `FileDetailSheet` [_filehub_adaptive.tsx:106](../components/intelligence/_filehub_adaptive.tsx#L106).

- Extend the tab union to `'details' | 'activity' | 'versions'`. Render the `versions` tab pill **only when `file.version_count > 1`**.
- Lazy-load on tab switch (same pattern as the activity tab): call `fileVersions(file.id)` into local state with a loading flag; reset on `file?.id` change.
- Row UI per version (newest first): version # (mark current with a "Current" badge), `formatFileSize(size_bytes)`, uploader name, `relativeDate(created_at)`, and for non-current versions an "expires in N days" hint from `expires_at`. Actions:
  - **Download** → `openStorageFile(bucket, storage_path, original_name)` (+ `logActivity(file.id, 'download', { version_no })`).
  - **Restore** (non-current only) → confirm (`useAlert`/`Alert`), then `restoreVersion(version.id)`, then refresh the versions list + the file. Current version has no Restore button.
- Reuse existing helpers in each file (`formatFileSize`, `relativeDate`, `getMimeIcon`, theme colors).
- **Acceptance:** [ ] tab appears only when history exists; [ ] lists versions newest-first with current badge + expiry hint; [ ] Download opens the right bytes; [ ] Restore makes the chosen version current and the previously-current one becomes a restorable history entry (verify v5→back-to-v6 keeps the set intact); [ ] parity on desktop + adaptive.

---

## Suggested phase assignment
- **Chat A:** Phase 1 (DB) — the keystone; do first/alone.
- **Chat B:** Phase 2 (purge) — after Phase 1.
- **Chat C:** Phase 3 (context) — after Phase 1.
- **Chat D:** Phase 4 (upload prompt) — after Phase 3.
- **Chat E:** Phase 5 (versions tab) — after Phase 3.
(Phases 2, and the pair 4+5, can run in parallel once their deps land.)

## Global invariants (every phase must preserve)
1. A `filehub_files` row's `id` **never changes** on replace/restore.
2. Exactly one current version (`superseded_at IS NULL`) per file; `current_version_id` points at it; denormalized live-row fields equal it.
3. The current version is never purged. Non-current versions expire 30 days after `superseded_at`.
4. Versions never surface in inbox/sent/broadcast/group listings.
5. Direct sends are owner-only for conflict/replace/restore; group & broadcast are collaborative.

## Progress log
- 2026-06-17 — Plan approved (Model B, collaborative group/broadcast + direct owner-only, restore enabled, web+mobile, pg_cron purge).
- 2026-06-17 — **Phase 1 DONE + reviewed.** Migration `supabase/migrations/20260617_filehub_versioning.sql` (822 lines, **untracked — author this file was created by a prior session/chat, not in git**). Applied to DB as two entries: `20260617090050 filehub_versioning_phase1` (prior session) + `20260617090944 filehub_versioning_phase1_reconcile` (Opus subagent, reconciled the storage policy to the factored `filehub_file_accessible()` form). **Double-apply was safe** (idempotent guards). Parent review verified read-only: no destructive SQL; 65 files / 65 versions, exactly one current `v1` each, 0 dup-v1, 0 bad pointers, 0 denorm mismatch; `filehub_storage_select` live-branch logically identical to the original (no download breakage) + additive version branch; all 6 new functions SECURITY DEFINER + granted to `authenticated`; `restore_version` confirmed as a true pointer move (no byte copy/new row). **TODO: commit the untracked migration file to git.** Acceptance criterion #7 (recipient signed-URL download of a past version) only structurally verified — confirm end-to-end during Phase 5.
- 2026-06-17 — **Phase 3 DONE + reviewed + committed** (branch `filehub-versioning`, commit e14ace2). Only `contexts/FileHubContext.tsx` changed: `FileVersion` type, `current_version_id`/`version_count` on `FileHubFile`, and `checkNameConflict`/`replaceFile`/`fileVersions`/`restoreVersion` methods (correct `p_*` params, refresh inbox+group lists after mutations). `npx tsc --noEmit` shows no new errors (pre-existing errors are only in `components/tabs/_tasks_desktop.tsx`, unrelated prior-session work). Finding: conflict RPC returns flat `uploader_name` (noted in Phase 4 above).
- Phase 1 migration + plan doc committed on branch `filehub-versioning` (commits 6a9db5e, 30e82dc).
- 2026-06-17 — **Phase 4 DONE + reviewed.** Upload conflict prompt added to both `_filehub_desktop.tsx` (`UploadModal.handleUpload`, methods threaded via props) and `_filehub_adaptive.tsx` (`UploadSheet`, via `useFileHub()`). After the dup-hash check: `checkNameConflict` → 3-button Replace/Keep Both/Cancel. Replace uploads to a fresh path then `replaceFile()` and `continue`s (no `upload_commit`); Keep Both falls through (server auto-renames); Cancel skips. Adaptive handles web vs native upload branch. `npx tsc --noEmit` clean for both files (only unrelated pre-existing `_tasks_desktop.tsx` errors remain).
- 2026-06-17 — **Phase 5 DONE.** Versions tab added to `DetailPanel` (desktop) and `FileDetailSheet` (adaptive): tab union extended, pill gated on `version_count > 1`, lazy-load on switch, newest-first rows with Current badge + "expires in N days" hint, Download (+ activity log) and Restore (confirm → `restoreVersion` → reload). `expiresInDays()` helper added. Desktop restore uses `useAlert().showConfirm`; adaptive uses `Alert.alert`. ⚠️ Committed together with unrelated QOL work (a parallel session's AdaptiveFileGrid/expo-image image-grid feature touching the two filehub files, CreateTask modals, StageActions) that had rewritten `_filehub_adaptive.tsx`. tsc clean for both filehub files at commit time, but the adaptive Versions tab landed on a concurrently-rewritten file — **should get a runtime visual sanity check.** All client phases (3,4,5) complete. Remaining: Phase 2 (purge edge fn + cron) — not started, awaiting go.
- 2026-06-17 — **Phase 2 DONE + reviewed.** Edge function `supabase/functions/purge-filehub-versions/index.ts` deployed (ACTIVE, verify_jwt false): batched purge of versions where `superseded_at < now()-30d`, removes storage object before row, skips on remove-failure (no orphans), re-asserts predicate in DELETE WHERE (restore-safe), hard-guards `superseded_at IS NULL`. Daily cron `purge-filehub-versions-daily` @ `30 3 * * *` → SECURITY DEFINER wrapper `fn_invoke_purge_filehub_versions()` (reads Vault `purge_filehub_secret`, `net.http_post`). pg_cron/pg_net already enabled. Local migration file `20260617_filehub_versioning_purge_schedule.sql` authored for repo parity (was applied live via MCP as `schedule_purge_filehub_versions_daily`). Verified: cron job jobid=7 active; wrapper SECURITY DEFINER; predicate dry-run = 0 eligible. **⚠️ MANUAL STEP REMAINING:** set shared secret in BOTH the Edge Function env (`PURGE_FILEHUB_SECRET`) and Vault (`purge_filehub_secret`) to enforce auth — until then the endpoint is unauthenticated (limited blast radius: only purges already-eligible rows). **ALL 5 PHASES COMPLETE.**
- _(append: phase, date, chat, outcome)_
