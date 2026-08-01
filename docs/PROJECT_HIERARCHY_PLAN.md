# Project Hierarchy Plan (issue #142)

Goal of #142: **projects stop being an organizational folder and become a
first-class entity** — with their own configurable lifecycle, their own sealed
deliverable, and their own numbers. But numbers a project *earns from its
children* rather than reports itself.

That last clause is the spine of this document. A project is a **container that
has state**, never a worker.

---

## 1. Where we are today

`projects` is a label. Verified against prod:

| Fact | Value |
|---|---|
| Columns | `id, company_id, name, description, color, status, pipeline_id, created_by, created_at, updated_at, deleted_at, expiry_date, is_featured` |
| Rows | **6** |
| Distinct `status` values | **1** (`'active'` — free text, never used) |
| Tasks with a `project_id` | **13** of 308 |
| `projects_select` RLS | `company_id = my_company_id() AND deleted_at IS NULL` — **company-wide** |
| Nesting | none |
| Lifecycle | none |
| Deliverable | none |

`pipeline_id` on a project points at a board without meaning anything — it is a
label, not a lifecycle.

**Migration risk is effectively nil.** 6 rows, 13 linked tasks. This is
greenfield, and the free-text `status` column can be replaced outright.

**What already exists and is load-bearing:**

- Rollups: `rpc_project_dashboard`, `rpc_get_project_stats` already aggregate
  child tasks into completion %, weighted progress, tracked seconds, by-stage,
  by-category, contributors.
- Stage engine: `pipelines`, `pipeline_stages`, `pipeline_stage_transitions`,
  `pipeline_stage_actions`, `pipeline_stage_history`, `pipeline_stage_targets`,
  `pipeline_automations`.
- Task nesting: `tasks.parent_task_id` (18 subtasks in prod).
- Task grouping: `tasks.category`.
- FileHub pointers: #143 / #151 backfill **verified complete** — 13/13 live
  briefs and 40/40 submission attachments carry `filehub_file_id`, and there
  are exactly 53 `filehub_files` rows at `visibility='task'`.

**What does not exist:** any template table, any bulk-create RPC. The importers
(`lib/imports/adapters/*`) create tasks **one at a time from the client**; the
only server-side helper is `rpc_import_place_task_stage`.

---

## 2. Domain grounding — and why this is not an audit product

The requirements come from a back-office auditing firm. The real intake loop:

> a client office sends a **portfolio of ~120 companies** → the firm triages which
> are theirs (~20 per auditor; most of the 120 belong to other backoffices) →
> each company runs through the same steps → a sealed deliverable goes back.

That is the defining loop of **back-office / outsourced processing** generally —
bookkeeping, claims, medical billing, KYC review, translation, payroll, title
search — not of audit specifically. Every entity below renames cleanly:

| This plan | Audit | Agency | Law | Claims |
|---|---|---|---|---|
| Client | Abdallah Group | Brand | Client | Policyholder |
| Portfolio | 120-company intake | 40 store localizations | — | 200-claim batch |
| Project | 2026 audit | Campaign | Matter | Claim |
| Tasks | Trial balance, joining | Wireframes, copy | Filings | Verify, assess |
| Deliverable | Working papers | Final assets | Closing binder | Adjudication file |

Audit is being used as a **forcing function** — a concrete, demanding domain
that stress-tests a general model. The alternative, designing against an
imagined average customer, is what produces unusable abstraction.

**The three things that would actually niche the product — all avoidable:**

1. **Domain vocabulary in schema or UI.** A column named `engagement_id` or
   `working_paper_ref` is a one-way door. `project_id` and `category` are not.
2. **Hardcoded stages.** Already avoided — stages are per-pipeline and
   configurable. This single decision carries most of the generality.
3. **Domain logic in the product.** Materiality calculations, IFRS checks,
   statutory retention rules. These belong in a template or a stage config,
   never in app code.

**And the mechanism that buys niche fit anyway:** a terminology layer — one
`jsonb` on `companies` mapping level names to display labels. A firm sees
"Engagement", an agency sees "Campaign". Configurable stages + templates-as-data
+ configurable labels means one general schema presents as a specialist tool per
vertical. Cheap, and it is the entire answer to "are we becoming audit software".

---

## 3. Entity model

```
Client  (Abdallah Group)          recurring subject · standing files · NO lifecycle
  └─ Project (2026 audit)         stages · deadline · deliverable · completes
       └─ Task                    existing table, unchanged
            └─ Subtask            existing parent_task_id
Portfolio (Office X, 2026 batch)  intake batch · source · manifest · NO lifecycle
```

A project sits at the **intersection of a client and a portfolio** — it points at
both. This is three entities, two of them lightweight, with no recursion.

### 3.1 Fixed depth — recursion explicitly declined

Portfolio → Project → Tasks, with subtasks below. **No open-ended nesting.**

Recursion forces every node to be the same kind of thing, which means every node
must support every capability: the factory, the polymorphic rollup, a "can this
node hold a timer" check at every call site. That cost is permanent and buys
flexibility nobody uses.

The real world here is *not* recursive — a client has no deadline, no stages, and
never completes; a project has all three. **The asymmetry is the feature**: half
of what a project needs, a client does not.

Counting what already exists, the depth is largely already there:

| Level | Status |
|---|---|
| Client | new — small, no lifecycle |
| Project | exists, upgraded here |
| Task | exists |
| Subtask | **exists** — `parent_task_id` |
| Section / working-paper grouping | **exists** — `tasks.category` |

Grouping *within* a level (audit sections, working-paper index) is a **field**,
not a level. Grouping fields are free; hierarchy levels cost forever.

If a genuine fourth level ever appears, add one **named** level for that concrete
case. Never open-ended depth.

### 3.2 A project is not a task

Projects get their own table and reuse the pipeline **definition** engine via a
`subject_kind` discriminator. They never touch the task **execution** engine.

The deciding numbers: **78 SQL functions** reference `tasks` and **13 tables** FK
to it. Merging projects into `tasks` means auditing all 78 for a `kind` filter,
and a miss is silent — projects leaking into timers, assignment pools,
notifications, search, analytics.

More important, semantically: **a project must never be a timer target.** If it
could hold one, someone would start one, and that corrupts exactly the
attribution #141 exists to protect.

### 3.3 Rollup-only

**Every project number is derived from its children** — time, output, progress.
Never written directly. This is the one rule that makes containers safe, and it
is what makes 3.2 enforceable rather than aspirational.

### 3.4 Dual membership, orthogonal

`tasks.pipeline_id` and `tasks.project_id` already exist and are already
independent. That stays, and it is a **decision, not a deferral**:

- **`pipeline_id` = *how* the work flows** — which board, which stages, who sees it
- **`project_id` = *what* it is for** — which engagement it rolls up to

An Abdallah task lives on the Audit board *and* under the Abdallah project.
Pushing this to the frontend instead would repeat the failure already recorded in
#167 (board pickers diverged because each screen decided for itself) and in
#143's own stated blocker (submissions drifted from FileHub's model).

The genuinely flexible part is the **default** — when a template spawns 25 tasks,
which board they land on. That is a per-task field on the template.

---

## 4. Schema

### New — all three are light

| Table | Columns | Lifecycle |
|---|---|---|
| `clients` | `id, company_id, name, external_ref, notes, standing_folder_id, timestamps, deleted_at` | **No.** Recurring subject, never completes. |
| `portfolios` | `id, company_id, name, source, received_at, target_date, manifest jsonb, timestamps, deleted_at` | **No.** Batch. Progress is a rollup. |
| `project_templates` | `id, company_id, name, description, color, body jsonb, created_by, timestamps, deleted_at` | n/a |

**`portfolios.manifest`** holds the full received list (~120 names) with a flag
for which were instantiated. The ~100 that belong to other backoffices are
**never created as projects** — no phantom rows diluting every rollup and board —
but remain answerable for reconciliation. One column, no table.

**`portfolios` doubles as the undo batch** — a bulk instantiation *is* a
portfolio. Same concept, so intake tracking and one-call rollback come from the
same thing.

### Upgraded

- **`projects`** — gains `client_id`, `portfolio_id`, `current_stage_id`,
  `start_date`, `due_date`, `owner_id`, `weight`, `estimated_hours`, `blocked`,
  `blocked_reason`, `deliverable_folder_id`. Free-text `status` **dropped**.
- **`pipelines`** — gains `subject_kind` (`'task' | 'project'`, default `'task'`).
  Keeps `visibility_permissions`, `file_visibility`, automations — a project
  pipeline inherits all of it for free.
- **`pipeline_stages`** — gains an auto-harvest flag, alongside the existing
  `requires_submission` / `requires_attachments` / `child_inherits_submission`.
- **`tasks`** — gains `blocked`, `blocked_reason`. **Nothing else.**

### What deliberately does not change

> the `tasks` table shape · the 78 SQL functions referencing it · the task board ·
> timers · submissions · the 13 tables that FK to tasks

This containment is most of why the plan is buildable.

### `project_templates.body` — one jsonb, not a normalized table

The shape is read whole, written whole, and never queried across. JSONB saves a
table, its FKs, and an RLS policy.

Per task item: `title, description, pipeline_id, category, priority, weight,
estimated_hours, due_offset_days?, assignee_team_id?`.

- **Relative dates only.** `due_offset_days` from project start — absolute dates
  in a template are dead on arrival. Optional; the firm confirmed most due dates
  are set manually.
- **Teams, not users.** `task_assignments.assignee_team_id` already exists.
  User-level assignment makes a template unshareable and stale the moment
  someone leaves.
- **No template language.** Titles are literal ("Balance Sheet"), not
  `{{project.name}} — Balance Sheet`. The project supplies context in every view.
  A one-line `replace()` adds `{{name}}` later if a flattened view needs it;
  adding it now invites a templating engine nobody asked for.

*Ceiling:* a dangling `pipeline_id` if a board is deleted. Validate at
instantiate, fall back to the default board, warn in the preview — cheaper than
FK upkeep. Normalize only if "which templates use board X" is ever needed.

---

## 5. Lifecycle

`projects.status` free-text dies; `current_stage_id` replaces it. "Lacking /
started / awaiting client" stop being strings and become configurable stages on a
project pipeline, edited in the existing pipeline editor.

**"Awaiting client" is a blocked flag, not a stage.** Confirmed with the domain:
a client can stall you during fieldwork *and* during review. Modelling it as a
stage would lose which stage the work is actually in. The flag composes with any
stage, in any vertical.

**Stage movement is manual in v1.** Auto-advance ("all child tasks terminal →
advance parent to Review") is a `pipeline_automations` follow-on, not v1.

**Project stage history** — `pipeline_stage_history` gains subject
polymorphism (or a sibling table). This is what makes **days-in-current-stage**
free, and that is the single best "this is rotting" signal available.

---

## 6. Deliverable — the sealed folder

A project's final output is a **FileHub folder pointer**, and "done" means that
folder is **sealed as a version**. FileHub versioning already exists; harvest is
a version snapshot, not a new mechanism.

This is a hard dependency on #143 / #151, not a neighbour. Building project
deliverables before task files are FileHub pointers creates a *third* file model
alongside submissions and briefs — precisely what #143 exists to undo.

**Two folder roles, at different levels:**

- **Inputs** — reference sheets, templates, standing files. Read often, persist
  **across years** → live at the **client** level (`clients.standing_folder_id`).
- **Output** — the harvested deliverable. Produced, sealed, belongs to one year →
  lives at the **project** level (`projects.deliverable_folder_id`).

**Harvest is a per-stage toggle.** A flag on `pipeline_stages` — *"tasks entering
this stage promote their output to the project deliverable"* — sits in an
existing pattern. Per-stage, not per-project, so a pipeline can auto-harvest at
"Reviewed" and stay manual everywhere else.

---

## 7. Bulk instantiation — the highest-value piece

**The unit of work is the batch, not the project.** A template that creates one
project still means doing it 120 times. The feature is *"here are 120 names,
spawn the 20 that are ours."*

### Capture: save-as-template, not a cold editor

Users already have a finished project that worked; one button snapshots its
shape. An editor to author 25 tasks from scratch rebuilds the exact manual pain
the feature exists to kill. The editor comes later, to *maintain* saved
templates.

### Two RPCs — now three (§13, issue #182)

```
rpc_create_template_from_project(p_project_id, p_name)
rpc_instantiate_template(p_template_id, p_portfolio jsonb, p_projects jsonb,
                         p_category_mapping jsonb, p_idempotency_key)
rpc_preview_instantiate_template(p_template_id, p_portfolio jsonb,
                         p_projects jsonb, p_category_mapping jsonb)
```

`p_projects` is **plural** — `[{name, client_ref, start_date}, ...]`. Set-based
insert from `jsonb_to_recordset`, single transaction, not a loop. Upserts
`clients` by name in the same call.

`p_category_mapping` and the required `p_portfolio.target_date` /
`anchor_direction` pair were added after the first ship exposed the gap §13
below documents — see there for why and for the exact contract.

This is also what #100 needs — the importers currently create tasks one at a time
from the client. Building it once serves both.

### Three hazards, all identified, all cheap

1. **Notification fan-out.** `trg_tasks_notify_insert` fires per row and writes a
   `notification_events` row per task via `fn_emit_notification_event`. 20 × 25 =
   500 events, each fanning out per-recipient in `process-notification-event` —
   and 120 × 25 would be 3,000. **Fix:** a session GUC
   (`current_setting('trustflow.bulk_instantiate', true)`) set inside the RPC and
   checked by the trigger; emit **one** `project.created_from_template` event.
2. **Idempotency.** A double-click doubles everything. Unique key on
   `(company_id, idempotency_key)`. This lesson is already recorded twice — #35
   and the FileHub idempotent folder create.
3. **Rollback.** Someone *will* bulk-create with the wrong template.
   `portfolio_id` on projects and tasks makes undo a single call. **This belongs
   in the first phase** — do not ship a 2,500-row button without an undo. Folds
   into #138.

Plus a **preview before commit** — as shipped (§13), `rpc_preview_instantiate_template`
states the outcome, not the row count: *"20 projects · 500 tasks · 4 boards ·
first task Aug 2, last Sep 15."*

### UI — one sheet and one button

- **"Save as template"** on project detail.
- **Bulk create sheet:** pick template → **configure the batch** (category →
  board/team mapping, schedule anchor + direction, §13) → textarea, one
  project per line (optionally `Name, 2026-08-01`) → preview outcome → create.
  UI half not yet built as of this writing — see §13.10 for the backend
  contract it builds against.

A textarea beats a CSV upload or a grid; paste from Excel is newline-separated
anyway. Template list can live in settings.

---

## 8. Views

**Screens needed — only one is a genuinely new route.** `app/(tabs)/projects.tsx`
already exists, as do `components/projects/` and `components/tabs/_projects_*.tsx`.

| Surface | Status |
|---|---|
| `/projects` with **Table / Board / Timeline** toggle | upgrade existing route |
| Project detail | [`ProjectDashboard.tsx`](../components/projects/ProjectDashboard.tsx) already has KPIs, stage distribution, contributors, deadlines — extend |
| Portfolio flow analytics | new **tab inside** existing `components/intelligence/` |
| Template editor | genuinely new, and last |

**The table comes before the board.** The board answers *"what's stuck and
where"* — the right standup surface, and at ~120 projects across ~6 stages it is
~20 cards a column, still readable. What it **cannot** answer is *"am I cooked"*:
kanban has no time axis and no capacity axis. Sorting by days-stuck, spotting
projects committing more hours than the team has, seeing intake outrun delivery —
that is a dense sortable table and a flow chart.

**Seven fields drive decisions:**

1. Stage
2. **Days in current stage** ← highest-leverage, and free once project stage
   history exists. The signal nobody builds because nobody realises it is
   already in the data.
3. Due date / days remaining
4. Child completion (X/Y tasks, weighted %)
5. Owner
6. Blocked / awaiting-client flag
7. Tracked vs estimated hours

Board card shows 4 (name, stage-age, progress, due). Table shows all 7, sortable.
Density belongs in the table.

### Do not extract a generic `<Board>`

The board is inlined in [`_tasks_desktop.tsx`](../components/tabs/_tasks_desktop.tsx)
(1,740 lines) plus `_tasks_adaptive.tsx`, `taskBoardCache`, web DnD, and the
personalizer. Generalizing that to serve a project card that needs **none** of
its machinery — no timers, no submissions, no claiming, no stage actions — is
worse than duplicating a visual shell. Write a purpose-built project board.

If a third board subject ever appears, extract **then**, with two real
implementations to generalize from.

**Separate and unconditional:** the task board loads every task in a pipeline
with no `limit`, no `range`, and no virtualization. Project boards make it a
drill-down, which helps, but at ~2,500 tasks it still needs pagination or this
work lands as a performance regression. Ties to #45.

---

## 9. Analytics

Projects get treated like tasks for **input and output**, which concretely means:

- **Arrival rate vs completion rate** — a cumulative flow diagram over project
  stages. Tells you in month 2, not month 5, that intake outruns delivery.
- **WIP per stage** — how many are parked in "awaiting client".
- **`cycle time = WIP / throughput`** — the literal "am I cooked" number,
  computable from data already collected.
- **Capacity** — committed `estimated_hours` vs available tracked hours per
  person.

#46 and #47 are the small cousins of this.

---

## 10. Phasing

| | Scope | Ships alone? |
|---|---|---|
| **0** | #156 / #158 / #159 — subtask + pipeline data-loss bugs | **blocking** |
| **1** | `clients` + `portfolios` + `project_templates` + `projects.start_date`; save-as-template; **bulk instantiate**; undo | **yes — the big one** |
| **2** | `subject_kind`, project pipelines, `current_stage_id`, blocked flag, project stage history, terminology layer | yes |
| **3** | Portfolio table view + days-in-stage | yes |
| **4** | Deliverable folder + harvest toggle | needs #143 read-paths verified |
| **5** | Analytics — CFD, throughput, forecast, capacity | yes |
| **6** | Project board (purpose-built) | yes |
| **7** | Template editor | yes |

**Phase 0 is blocking, not foldable.** #156 (archiving a parent hard-deletes
subtasks), #158 (`rpc_delete_pipeline` bulk-deletes with no timer guard), #159
(restore cannot reassemble a subtask tree). Adding a second parent-child level
onto a cascade that already destroys children turns a bug into an incident. They
are also cheap now and expensive once the projects tree exists.

**Phase 1 needs nothing from Phase 2.** Templates require only
`projects.start_date` from the lifecycle work — tasks already have pipelines and
stages; only the *project's own* stage is missing, and bulk creation does not
need it. So the highest-value piece ships first, standalone, and de-risks
everything after it.

---

## 11. Open questions

**Blocking Phase 1 — security:**

- **Project visibility.** `projects_select` is currently
  `company_id = my_company_id()` — **every user in the company sees every
  project.** Fine for a colourless folder with 6 rows; not fine once a project
  carries client identity, a sealed deliverable, and financial rollups, and 120
  arrive split across auditors. Project access **cannot** inherit
  `pipelines.visibility_permissions`, because a project's tasks span several
  boards by design (§3.4) — that orthogonality was deliberate and this is its
  bill. `pipelines_select` has the role-array pattern to copy; what is missing is
  the policy decision: role-based, owner-based, or portfolio-scoped.
  **Question for the domain expert: within a backoffice, can any auditor see any
  other auditor's companies?** The expected answer is no, and that expectation is
  load-bearing.

**Non-blocking — these fill in boxes rather than move them:**

- **Rollforward vs template** as the primary creation path. Expected to be both,
  with rollforward more common. If it dominates, it is one extra RPC reading a
  live project instead of a template body — same shape, nothing wasted.
- **Working-paper index** — whether `category` needs to be an ordered,
  firm-defined list rather than free text.
- **When the deliverable seals** — sign-off or issuance, and whether anything may
  change after. This is #141 meeting the real world.
- **Retention** — how long a sealed project must stay untouched and retrievable.
  Affects archive and purge; there are usually statutory minimums.
- **Standard starting files per template task** — the client-specific brief is
  not automatable, but "the trial balance task always starts from the TB template
  spreadsheet" is.

---

## 12. Ordering / risk

The expensive parts already exist: the stage engine, FileHub pointers (#151
backfill verified), rollup RPCs, subtasks, categories, idempotent folder create.
The new tables are three light ones and a `jsonb`; Phase 1 is two RPCs, one
sheet, one button.

**One-way commits** — do these only after the readers are switched:

- dropping `projects.status`
- collapsing project reads onto `current_stage_id`

**Reversible by design** — additive columns, the coexisting `portfolios.manifest`,
and `subject_kind` defaulting to `'task'` so every existing pipeline is unchanged.

**The single real risk is §11's visibility question**, because RLS mistakes are
security bugs rather than bugs. It must be answered before Phase 1 ships, since
Phase 1 is what makes projects worth reading.

---

## 13. Amendments from building bulk instantiation (issue #182)

### 13.9 Starter templates left `due_offset_days` inert (amends §4, §7)

`rpc_instantiate_template` derived `due_date` from `due_offset_days` **only
when the caller supplied `start_date`**, and nothing forced that. Verified: a
batch with no dates produced tasks with `due_date IS NULL`. §4/§7's starter
library shipped 194 researched offsets that sat unused unless a user typed a
date on every textarea line, which nobody does.

### 13.10 Batch create produces orphans — the missing batch-configuration step

Running the real feature against real data:

```
66 tasks created:  pipeline_id = 0   current_stage_id = 0   due_date = 0
 3 projects:       start_date  = 0   due_date         = 0
```

A task with no `pipeline_id`/`current_stage_id` is on no board — invisible.
§7 measured this feature by rows-inserted and transaction time; neither
notices the output is unreachable. Root cause: §4's "a template must not
carry `pipeline_id`" was right, but the fix was left as "leave it NULL and
hope something downstream resolves it" — nothing did.

**Shipped fix — extended `rpc_instantiate_template`, not a parallel path**
(two ways to create projects from templates would drift):

```
rpc_instantiate_template(
  p_template_id      UUID,
  p_portfolio        JSONB,   -- {name?, source?, received_at?, manifest?,
                               --  target_date (REQUIRED — the anchor),
                               --  anchor_direction (REQUIRED: 'start'|'deadline')}
  p_projects         JSONB,   -- [{name, client_ref?, client_external_ref?,
                               --   start_date?}] — start_date is a PER-LINE
                               --   override of the batch anchor, same
                               --   anchor_direction semantics
  p_category_mapping JSONB,   -- [{category, pipeline_id, assignee_team_id?}]
                               --  — one row per DISTINCT category the
                               --  template body uses. Map by category, not
                               --  by task (a 25-task template becomes ~4
                               --  decisions).
  p_idempotency_key  TEXT
) RETURNS JSONB  -- {portfolio_id, already_processed, projects_created, tasks_created}

rpc_preview_instantiate_template(
  p_template_id, p_portfolio, p_projects, p_category_mapping
) RETURNS JSONB  -- {projects, tasks, boards, first_task_date, last_task_date}
-- Read-only. Calls the exact same resolver + span math as the commit path,
-- so a preview that succeeds is a promise the commit will also succeed.
```

**Category mapping is now the SOLE source of `pipeline_id`/`current_stage_id`/
`assignee_team_id`.** The template body's legacy per-item `pipeline_id` /
`assignee_team_id` fields (§4) are no longer read — honoring them would be
exactly the per-task mapping input this design deliberately avoids, and it's
what let templates carry silent NULLs in the first place. Each task lands on
its mapped pipeline's **first stage by `position`**, resolved server-side —
`fn_resolve_batch_category_mapping` RAISEs loudly (naming the category) if
any category the body uses has no mapping row, if a mapping row references a
category the body doesn't use (typo guard), if a `pipeline_id` doesn't belong
to the caller's company, or if a mapped pipeline has zero stages.

**The schedule anchor is required, never defaulted.** `target_date` missing,
`anchor_direction` missing/invalid, or the anchor date being in the past all
RAISE — no `COALESCE(start_date, now())`. **Back-scheduling**
(`anchor_direction = 'deadline'`): the anchor is read as a deadline, and the
batch's span (`MAX(due_offset_days)`) is computed from the *same*
`project_templates.body` the tasks are generated from (`fn_batch_offset_range`),
so `start_date = deadline - span` can never drift from what actually gets
inserted. `due_offset_days` missing on a template item defaults to `0` (due
the day the project starts), not `NULL` — the one default that stayed, since
an unscheduled item defaulting to "no later than start" is a defensible
content-level default, unlike the anchor itself. `projects.due_date` (added
in Phase 3, previously never written by this RPC) is now set to
`start_date + span` on every row.

**Verification** (`supabase/checks/check_rpc_batch_config.sql`, run against
local): every trust-boundary RAISE fires as specified; forward and
back-scheduling both land tasks with the correct `due_date` and zero NULL
`pipeline_id`/`current_stage_id`/`due_date` across the batch; preview's
`{projects, tasks, boards, first_task_date, last_task_date}` matches what the
commit actually writes; every created task is reachable through the exact
query shape `components/tabs/_tasks_desktop.tsx` uses to render the board
(`tasks` filtered by `pipeline_id`, grouped client-side by
`current_stage_id`) and lands on the mapped pipeline's first stage. A 20
project × 25 task (500-task) batch completed in **72–80ms** and emitted
**exactly 1** `notification_events` row across three local runs — the §7
Hazard 1 fix still holds at this scale.

**Not built here:** the UI half (batch-configuration screen, category →
board/team picker, anchor date+direction picker). This section is the
contract it builds against — see issue #182.
