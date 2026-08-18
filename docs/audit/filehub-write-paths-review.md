# FileHub write-path audit (2026-08-18)

Triggered by issue #35 (idempotent upload retries). While designing that fix,
checked the live database and found the predicted duplicate-row bug is
already happening — but not where you'd expect. This document maps every
place in the app that creates a `filehub_files` row, so the next fix closes
all the doors instead of one.

## The one-sentence version

**There is exactly one "official" upload path** (`rpc_filehub_upload_commit`,
reached through `UploadManagerContext`) **and it has good safety logic —
name-conflict renaming, an advisory lock against races, rate limits, quota
checks.** Everything task-related creates `filehub_files` rows through a
completely different, much weaker mechanism: a database trigger with none of
that logic, fed by four independent, partially-duplicated pieces of
client-side upload code. The 30 duplicate rows and 6 duplicate names found
live all came from that second mechanism. None came from the official path.

## Map: every way a `filehub_files` row gets created

| # | Entry point (client) | Backend call | Creates `filehub_files` row... | Dedupe / conflict handling |
|---|---|---|---|---|
| 1 | FileHub upload modal, drag-drop, paste — via `UploadManagerContext` | `rpc_filehub_upload_commit` | directly | `filehub_dedupe_name()` (auto-rename) + `pg_advisory_xact_lock` serializing the check |
| 2 | `TaskCreationContext.tsx` — brief files attached while creating a task | `storage.upload()` then `rpc_add_task_attachments` | indirectly, via trigger (below) | none — the trigger's bare existence check only |
| 3 | `TaskBriefPanel.tsx` — brief files attached from the task detail view | `storage.upload()` then `rpc_add_task_attachments` | indirectly, via trigger | none |
| 4 | `SubmissionContext.tsx` (`submitWithEvidence`) — worker submits work with attachments | `rpc_submit_work` | indirectly, via trigger | none |
| 5 | `rpc_edit_submission` — editing a submission's attachments | inserts into `submission_attachments` | indirectly, via trigger | trigger comment notes this path relies on the trigger's reuse check specifically |
| 6 | `rpc_advance_stage` / `rpc_archive_task` / `_internal_restore_task_archive` — pipeline stage moves, archive, restore-from-archive | insert into `task_attachments`/`submission_attachments` (copy-forward) | indirectly, via trigger | none |
| 7 | `fn_harvest_task_output` — promotes a finished task's submission files into the project's deliverable folder | direct `INSERT INTO filehub_files` | directly | its own hand-rolled `IF EXISTS ... CONTINUE` check, no lock |
| 8 | `rpc_filehub_replace_file` — replace an existing FileHub file's content (new version) | `UPDATE filehub_files` + insert into `filehub_file_versions` | no — updates existing row | N/A, not a new-row path |
| 9 | `rpc_replace_task_attachment` — replace an existing task-brief attachment's content | `UPDATE task_attachments` + insert into `task_attachment_versions` | no — updates existing row | N/A. Also: a second, separate "replace" implementation from #8, own version-history table |

Rows 2–6 all funnel through one database trigger:

```
filehub_link_task_file()  -- AFTER INSERT trigger on task_attachments
                           -- and submission_attachments
```

It does this, and only this:

```sql
SELECT id INTO v_existing FROM filehub_files
WHERE company_id = ... AND bucket = ... AND storage_path = NEW.storage_path
  AND visibility = 'task'
LIMIT 1;

IF v_existing IS NULL THEN
  INSERT INTO filehub_files (...) VALUES (...);  -- no dedupe_name call
END IF;
```

That's a plain check-then-insert with **no lock** — the exact bug class
`filehub_dedupe_name()` itself used to have before it got
`pg_advisory_xact_lock` (see `20260720_filehub_upload_commit_folder_tree.sql`'s
own header comment on that fix). If two of rows 2–6 fire close enough
together for the same `storage_path`, both can see "not found" and both
insert. It also never renames on a name clash — visibility `'task'` (and
`fn_harvest_task_output`'s `'project'`) never gets the "steal the name"
protection that `'group'`/`'broadcast'`/`'direct'` get.

**Confirmed live** (read-only queries against the production database,
2026-08-18): 13 duplicate-`storage_path` groups / 30 rows, all
`visibility = 'task'`. One pair inspected by hand: identical
`original_name`/`size_bytes`, created ~6 seconds apart, no
`replaces_file_id`/`current_version_id` link — i.e. the same upload action
happening twice, not a legitimate version chain. 3 duplicate-name groups (6
rows), also `direct`-scope inside the task path.

## Why rows 2 and 3 are their own problem, separately from the trigger

`TaskCreationContext.tsx` and `TaskBriefPanel.tsx` contain **two independent
copies of the same upload code** — pick file → resize if image via
`ImageManipulator` → `fetch` + `.blob()` →
`storage.from(TASK_BRIEF_BUCKET).upload()` → build an attachments array →
`supabase.rpc('rpc_add_task_attachments', ...)`. Same shape, same steps,
written twice instead of shared. Neither goes anywhere near
`UploadManagerContext`.

## What the official path (`UploadManagerContext`) actually offers, and why rows 2–7 can't just "switch to it" today

`UploadManagerContext` is a real, well-built system — 4-worker pool, global
(survives modal close/navigation), duplicate/name-conflict prompts as
island decisions, cooperative cancellation, quota/size checks. It's the
right thing to route through. But it's scoped narrower than it needs to be
for this fix:

```ts
export type UploadVisibility = 'direct' | 'broadcast' | 'group';
```

`'task'` and `'project'` aren't in that union, and `rpc_filehub_upload_commit`
itself is equally narrow server-side (`IF p_visibility NOT IN ('direct',
'broadcast', 'group') THEN RAISE EXCEPTION`). Routing rows 2–7 through this
manager isn't a drop-in redirect — both the client type and the RPC's
validation would need to grow to accept `'task'`/`'project'` first, and
`filehub_dedupe_name()` would need new branches for them too (see below).

## Recommended fix, in order of leverage

1. **Land #35 as written** (partial unique index on `storage_path`,
   backfilled) — this alone makes storage_path duplication structurally
   impossible regardless of which of rows 1–7 causes it, without touching any
   application code. Cheapest, safest, highest-leverage single change.
2. **Give `filehub_link_task_file` the same two protections
   `rpc_filehub_upload_commit` has**: wrap its check-then-insert in
   `pg_advisory_xact_lock` keyed the same way `filehub_dedupe_name` is, and
   call `filehub_dedupe_name()` (extended to cover `'task'`/`'project'`
   visibility) before the insert instead of inserting the raw name. This is
   the one change that fixes rows 2–6 simultaneously, since they all funnel
   through this one trigger already — no client code changes required.
3. **Give `fn_harvest_task_output` the same treatment** (row 7) — it's the
   one direct-insert path outside the trigger.
4. **Only after 1–3**, if there's still an appetite to unify the client code:
   collapse `TaskCreationContext.tsx`'s and `TaskBriefPanel.tsx`'s duplicated
   upload implementations into one shared helper (in `lib/`, not a new
   Context, since neither needs the background-job machinery
   `UploadManagerContext` provides for the main FileHub — these are
   short-lived, modal-scoped uploads). Extending `UploadManagerContext`
   itself to cover `'task'`/`'project'` visibility is the larger version of
   this same move, worth doing but bigger — the trigger-level fix in step 2
   gets the safety property without waiting on it.

Step 2 is the one that actually answers "prevent this from happening again
for any future caller": a fifth thing that inserts into `task_attachments`
next year automatically gets the same protection for free, because the
protection lives in the trigger every insert already passes through — not in
each caller remembering to call the right helper.
