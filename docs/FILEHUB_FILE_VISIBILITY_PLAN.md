# FileHub File Visibility — per-pipeline configurable policy

## Why

Today "who can see a task's files" is decided in **four** places that disagree:

| Layer | Rule today |
|---|---|
| `task_attachments` (briefs) table RLS | **company-wide** (`company_id = my_company_id()`) |
| `submission_attachments` table RLS | submitter **OR** `submission.review` **OR** owner |
| FileHub Browse / Overview / pointer / activity | `task_accessible` = owner/creator/manager/**assignee**/`task.view_detail` |
| Storage bucket SELECT RLS (`task-attachments`, `submission-attachments`, `task-submissions`) | **company-wide** (folder = company_id) |

So an assignee sees a submission in FileHub that the submission table would hide; briefs are readable company-wide; and the storage byte boundary is company-wide regardless. There is no single source of truth and nothing is configurable.

**Goal:** one **per-pipeline, configurable** file-visibility policy, enforced by a **single function** that every layer calls. Admins configure it from the pipeline (roles / people / assignees / reviewers, optionally per task-category).

## Config model

New column `pipelines.file_visibility jsonb NOT NULL DEFAULT '{"preset":"task_members"}'`.

```jsonc
{
  "preset": "task_members" | "submitters_reviewers" | "company" | "custom",
  // used when preset = "custom" (presets expand to these flags):
  "assignees": true,          // task assignees can view
  "reviewers": true,          // holders of submission.review can view
  "roles":  ["<role_uuid>"],  // holders of ANY of these roles can view
  "users":  ["<user_uuid>"],  // explicit people
  // optional per-category override (task.category → its own block of the same shape)
  "categories": { "Design": { "preset": "custom", "roles": ["..."] } }
}
```

**Non-configurable floor:** the company owner, and the task's `created_by` / `manager_id`, can *always* see the task's files. You can't hide a task's files from its own manager/owner. Everything else is policy-driven.

**Preset → flags:**
- `task_members` *(default)* → `assignees:true, reviewers:true` (≈ `task_accessible` ∪ reviewers)
- `submitters_reviewers` → `assignees:false, reviewers:true` (submission-style privacy)
- `company` → any company member (preserves today's brief behavior)
- `custom` → exactly the flags/roles/users set

## Single enforcement function

`fn_task_file_accessible(p_task_id uuid) RETURNS boolean` — `STABLE SECURITY DEFINER`, **the one source of truth**:

1. task exists, `deleted_at IS NULL`, same company — else `false`.
2. **floor:** `is_owner` OR `created_by = me` OR `manager_id = me` → `true`.
3. load `pipelines.file_visibility` for `tasks.pipeline_id`, applying the `categories[task.category]` override if present.
4. `assignees` && caller is an assignee (user or team via `team_members`) → `true`.
5. `reviewers` && `has_permission('submission.review')` → `true`.
6. caller holds any role in `roles[]` (via existing role-membership / `fn_user_has_permission`) → `true`.
7. caller ∈ `users[]` → `true`.
8. preset `company` → any company member → `true`.
9. else `false`.

This is **separate from `task_accessible`** (which governs task *detail* visibility on the board/screen). File access may be stricter or looser than detail access; the floor keeps managers/owner safe either way. `task_accessible` stays as-is for non-file surfaces.

## Enforcement points — all switch to `fn_task_file_accessible`

1. **Table RLS**
   - `task_attachments` SELECT → `company AND fn_task_file_accessible(task_id)` *(behavior change: briefs stop being company-wide; the `company` preset restores it per-pipeline)*.
   - `submission_attachments` SELECT → `company AND fn_task_file_accessible(<task via task_submissions>)`.
   - `task_submissions` SELECT → **decision:** keep its current submitter/reviewer/owner rule (it's submission *metadata*, not the file), or align to the file policy. Default plan: leave it; only the *attachment* rows follow the file policy.
2. **Storage RLS (SELECT)** on `task-attachments`, `submission-attachments`, `task-submissions`:
   - `company AND ( foldername[2] <> 'tasks' OR foldername[3] !~ '^[0-9a-f-]{36}$' OR fn_task_file_accessible(foldername[3]::uuid) )`.
   - Regex-guards the `::uuid` cast so a non-conforming path can **never throw** and break the bucket; falls back to company-scope for non-task paths.
   - Paths confirmed: both `task-attachments` and `submission-attachments` are `{company}/tasks/{task_id}/…` (task id at position 3).
3. **FileHub layer** — replace `task_accessible` with `fn_task_file_accessible` in: `filehub_file_accessible` (task branch), `rpc_filehub_browse` per-row ACL, `rpc_filehub_overview` (recents + recently-assigned), `rpc_filehub_pointer_id`, `rpc_filehub_log_activity_by_path`.

## UI — pipeline editor

- New **"File visibility"** section in the pipeline settings/editor (`components/pipeline-editor/`).
- Preset dropdown; for `custom`: role multi-select (reuse the `visibility_permissions` role picker + `rpc_get_pipeline_members`), people picker, `assignees`/`reviewers` toggles; optional "add category override" rows.
- Saved via `rpc_pipeline_set_file_visibility(pipeline_id, jsonb)` — gated by the pipeline-manage permission; validates role/user UUIDs belong to the company.

## Migration / defaults

- Backfill every pipeline `file_visibility = {"preset":"task_members"}`.
- **Call-out:** this tightens **briefs** from company-wide → task-scoped (assignees + floor). That matches the stated intent ("no random guy accessing every file"). Any pipeline that wants the old company-wide briefs sets preset `company`.
- No data migration — the policy is evaluated live.

## Phases

1. **Schema + function**: add `file_visibility` column (+ default backfill) and `fn_task_file_accessible`. Inert until wired.
2. **Wire enforcement**: switch the FileHub RPCs, the three table RLS policies, and the three storage RLS policies to `fn_task_file_accessible`. (Ship 2 behind a quick runtime check — this is the behavior-changing step.)
3. **Pipeline editor UI** + `rpc_pipeline_set_file_visibility`.
4. **Per-category overrides** (optional; can defer).

## Risks

- `fn_task_file_accessible` runs on every task-file row read **and** every task-bucket storage GET — same cost profile as `task_accessible` (STABLE, cached per-statement), but now also on storage. Bench before shipping phase 2.
- Storage-RLS cast safety — handled by the regex guard; a broken policy predicate breaks **all** reads for the bucket, so this must be tested against real + malformed paths.
- Behavior change for briefs (company → task-scoped) and potentially submissions (per preset). Intended, but flag on rollout.

## Open decisions (need your call before Phase 1)

1. **Default preset** — `task_members` (assignees can view, recommended) vs `submitters_reviewers` (stricter, submissions stay private to submitter/reviewers)?
2. **One policy per pipeline for all files, or split brief vs submission?** Plan assumes one shared policy. Split is more flexible, more config surface.
3. **Category overrides in v1 or defer to Phase 4?**
4. **Per-task override** (a task opting out of its pipeline's default) — future, or never?
