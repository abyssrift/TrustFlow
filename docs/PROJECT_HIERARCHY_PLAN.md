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

### Two RPCs

```
rpc_create_template_from_project(p_project_id, p_name)
rpc_instantiate_template(p_template_id, p_portfolio jsonb, p_projects jsonb,
                         p_idempotency_key)
```

`p_projects` is **plural** — `[{name, client_ref, start_date}, ...]`. Set-based
insert from `jsonb_to_recordset`, single transaction, not a loop. Upserts
`clients` by name in the same call.

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

Plus a **preview before commit**: *"This will create 20 projects and 500 tasks."*

### UI — one sheet and one button

- **"Save as template"** on project detail.
- **Bulk create sheet:** pick template → textarea, one project per line
  (optionally `Name, 2026-08-01`) → preview counts → create.

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
| **8** | **Re-brand + interaction polish** — see §14 | **longest** |
| **9** | **"Smartness" — spreadsheet intake that sets itself up** — see §15 | needs Phase 1 only |

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

## 13. Amendments from building Phases 1–2

Phases 1 and 2 were implemented and applied to a local stack on 2026-07-31
(20×25 → 20 projects / 500 tasks in 54 ms, one notification event instead of
500, undo verified). Building them exposed five gaps in the sections above.
Four are the same failure: **a rule written in prose that the database does not
enforce.**

### 13.1 Container deletion must be safe at *every* level (amends §10)

`rpc_archive_project` hard-deletes (`DELETE FROM public.projects`, verified).
§10 made Phase 0 blocking because archiving a parent destroyed its children —
then this plan added a new parent level without applying that same rule to it.

**Rule:** any level that can own children (client, portfolio, project) must
soft-delete and must refuse while children hold running timers. Phase 0's fix
is the template. This is a prerequisite for §6's sealed deliverable — a hard
delete would orphan the deliverable folder.

### 13.2 Stage history must be trigger-enforced, not RPC-enforced (amends §5, §8)

Exactly one function writes `project_stage_history`, and the only user trigger
on `projects` is `updated_at`. Any other write to `current_stage_id` moves the
project and records no history.

§8 calls days-in-current-stage the highest-leverage field, and §9's CFD and
cycle time are derived from the same rows. The failure is silent — no error,
just numbers that quietly understate. **A trigger on `current_stage_id` change
is the enforcement point.** The RPC stays as the permission/validation layer.

The same reasoning applies to §3.3's rollup-only rule, which is currently also
unenforced: nothing stops a project number being written directly.

### 13.3 Client identity needs a stable key, not a name (amends §4, §6)

`clients` is UNIQUE `(company_id, name)` and the bulk path upserts by name with
`external_ref` left NULL. But §6 gives the client level one job — persisting
across years so standing files and rollforward work. Exact-string matching
defeats it: "Abdallah Group" and "Abdallah Group LLC" become two clients and
year-two continuity breaks with no error.

**`external_ref` is the intended key** (a commercial-registration or file
number). Match on it when present, fall back to name. Open question for the
domain expert: what identifier does the firm already use?

### 13.4 Instantiation needs provenance (amends §4, §11)

`portfolios` has no `template_id`, and `project_templates` has no version. A
batch does not record what produced it, and editing a template retroactively
changes the apparent shape of every past batch.

§11 already asks how long a sealed project must stay retrievable; this is the
same concern one level up. Cheapest fix: `portfolios.template_id` plus a frozen
copy of the template `body` on the portfolio at instantiate time. Snapshot, not
a version table — matching §4's reasoning for keeping the body as one jsonb.

### 13.5 `portfolio_id` is denormalized and needs a guard (amends §7)

§7 put `portfolio_id` on both `projects` and `tasks` so rollback is one call.
Nothing keeps the two in agreement: move a task between projects and its
`portfolio_id` is stale, so undo silently takes the wrong rows — which is the
one operation that must never be approximate.

**Rule:** a task's `portfolio_id` derives from its project. Enforce on write
rather than trusting callers.

### 13.6 Soft-delete and uniqueness must be decided together (issue #180)

Found by testing the undo path rather than reading it. `rpc_undo_portfolio_instantiation`
soft-deletes, but `UNIQUE (company_id, name)` on `projects` and `clients`
carried no predicate, so archived rows kept their names reserved:

```
first create  -> 3 projects
after undo    -> live projects = 0
RETRY FAILED  -> duplicate key on projects_company_id_name_key
```

Undo therefore reported success and left the user unable to redo — worse than
no undo, because it looks like recovery worked. §7 hazard 3 asked for undo and
got something that only half exists.

**Rule:** wherever this schema soft-deletes, uniqueness must be partial on
`deleted_at`. A gone row does not reserve a name. **One deliberate exception:**
`portfolios_company_idempotency_key` stays total — an idempotency key must keep
blocking a replay after its batch is undone, which is the opposite requirement.

This generalises past projects. It applies to any future level that soft-deletes
(§13.1's clients and portfolios), and it is a prerequisite for §13.1 itself:
converting `rpc_archive_project` from hard to soft delete creates exactly the
case that triggers it.

### 13.7 `estimated_hours` is derived, not stored (amends §4)

§4 listed `estimated_hours` among the columns `projects` gains. That contradicts
§3.3: every project number is derived from its children, never written directly.
A stored estimate on the project can drift from the sum of its tasks, and once
two screens disagree nobody can say which is right.

**Decision (Phase 3):** `estimated_hours` and `tracked_seconds` are **computed in
the read RPC**, never columns. Of §4's original list, only the true *inputs*
become columns:

| Column | Kind | Verdict |
|---|---|---|
| `due_date`, `owner_id` | input | column |
| `weight` | input — relative importance for weighted progress | column |
| `estimated_hours` | rollup of child tasks | **derived, no column** |
| `tracked_seconds` | rollup of child work sessions | **derived, no column** |

The test for any future field: *could a child change make this stale?* If yes it
is a rollup and must be derived. This is §3.3 applied rather than restated —
the rule was prose until it had a column to refuse.

### 13.8 Phase 3 does NOT ship alone — §10's independence claim was wrong

§10 marked Phases 2 and 3 as each "ships alone: yes". Building Phase 3 disproved
it. Measured on a seeded local stack after Phases 1–2 were applied:

```
projects total = 5    with current_stage_id = 0
stage history rows    = 0
project-kind pipelines= 0
```

Phase 2 delivered the stage engine as **schema only** — `subject_kind`,
`current_stage_id`, `project_stage_history`, the trigger, and
`rpc_advance_project_stage` all exist and are correct, but **nothing in the app
can reach any of it.** No screen creates a `subject_kind='project'` pipeline, and
none assigns a project a stage.

The consequence lands squarely on Phase 3: **Stage** and **Days in current
stage** are the table's two headline columns — §8 calls the latter the
highest-leverage field available — and both render empty for every row, forever,
until a project can be given a stage.

**Corrected dependency:** Phase 3 requires a minimal Phase 2 UI — somewhere to
mark a pipeline as project-kind, and somewhere to move a project between stages.
That is small (the pipeline editor already exists; the mover RPC already exists)
but it is not optional, and it was invisible in a phase table that only tracked
schema.

**The general lesson for the remaining phases:** "ships alone" was assessed
against *database* dependencies only. Phases 5 (analytics) and 6 (board) read the
same stage data and inherit the same hidden prerequisite. A phase is only
independent when its data can actually be *produced*, not merely stored.

### 13.9 Starter templates, and the anchor their offsets need (amends §4, §7)

§7 said capture-from-a-finished-project should come before an editor, because
authoring 25 tasks cold rebuilds the pain the feature exists to kill. True — but
it left a dead end nobody spotted until the screen existed: **Bulk Create
requires a template, templates can only be made from a finished project, and a
new workspace has no projects.** The highest-value feature in the plan was
unreachable precisely when it was most needed.

Fixed with a **code-level starter library** (`lib/starterTemplates.ts`, 13
templates / 12 sectors / 194 tasks) rather than seeded rows or a global table.
Picking one materialises it into an ordinary per-company `project_templates`
row, so nothing downstream changes. This is §2's argument made concrete: the
audit template says "Trial Balance" and "Management Letter", and none of that
vocabulary reaches a column, a component or a type. Templates are content.

One correction to §4's claim that a starter needs "no migration": true of the
data, false of the write path. `project_templates` ships **no INSERT policy** —
all writes go through `SECURITY DEFINER` RPCs — so a client insert is
hard-denied. One RPC mirroring the existing one was the right answer;
weakening the RLS would not have been.

**Was open, now settled (see §13.10).** `rpc_instantiate_template` derived
`due_date` from `due_offset_days` **only when the caller supplied `start_date`**,
and the bulk-create textarea treated the date as optional. Before starters this
barely mattered — save-as-template capture produces no offsets at all. Now 194
researched offsets sat inert unless a user typed a date on every line, which
nobody will. Verified: a 3-project batch with no dates produced 9 tasks with
`due_date IS NULL`.

The tempting fix was one `COALESCE(x.start_date, now())`. **It was rejected.** A
silent default is exactly how 66 tasks shipped with `due_date = 0` and nobody
noticed — a defaulted date looks identical to a chosen one at every later
surface. The anchor is now **required and raises when absent** (§13.10); the
only default retained is a template item's missing `due_offset_days`, which
means "due the day the project starts". That is a content-level default with a
visible consequence, not a schedule invented on the user's behalf.

### 13.10 Bulk create produces orphans — the missing batch-configuration step

Phase 1 was called shipped. Running it against real data says otherwise:

```
66 tasks created:  pipeline_id = 0   current_stage_id = 0   due_date = 0
 3 projects:       start_date  = 0   due_date         = 0
```

Every task is **invisible**. A task with no `pipeline_id` and no `current_stage_id`
appears on no board. The 500-task button works and produces 500 rows nobody can
see or schedule. §7 measured this feature by rows inserted and transaction time;
neither notices that the output is unusable.

Three separate-looking gaps — no pipeline, no team, no dates — are **one missing
step**: nothing ever asks *how this batch should be configured*. §7's UI was "pick
template → paste names → create", which is the right shape and one step short.

**§4's "no `pipeline_id` in a template" reasoning was right and the conclusion was
wrong.** A template genuinely cannot know a company's boards. But the fix is to
resolve it at *instantiate* time, when the company is known — not to leave it null
and hope something downstream fills it in. Nothing does.

**The design: map by category, not by task.**

Template bodies already carry `category` (§3.1 — grouping within a level is a
field). The starter research produced exactly this: the audit template's 22 tasks
fall into Planning / Fieldwork / Review / Reporting. So the mapping unit is the
category, and a 25-task template becomes **four decisions, not twenty-five**:

| Category | Board | Team |
|---|---|---|
| Planning | Audit Intake | Seniors |
| Fieldwork | Audit Fieldwork | Field Team |
| … | | |

Same step carries the schedule anchor, because it is the same moment:

- **Anchor + direction** — *starts on* / *due by* a date. Back-scheduling is not
  optional politeness; §2's domain arrives with a deadline ("six months to
  complete them"), not a start date. `portfolios.target_date` already exists.
- **Stage** — each task lands on its chosen pipeline's first stage. Without this,
  a `pipeline_id` alone still leaves it off the board.

**Rule this establishes:** a bulk operation must produce rows that are *reachable*
by the app's existing surfaces. "Inserted successfully" is not the acceptance
test; "appears on a board, with a date, owned by someone" is. Every future bulk
path (#100's importers) inherits this.

#### Shipped — backend (branch `feat-project-batch-config`)

`rpc_instantiate_template` was **extended, not paralleled** — two ways to create
projects from a template would drift. The old 4-argument overload is dropped, so
callers cannot silently keep using the orphan-producing path:

```
rpc_instantiate_template(
  p_template_id      UUID,
  p_portfolio        JSONB,  -- + target_date (REQUIRED anchor)
                             --   anchor_direction (REQUIRED 'start'|'deadline')
  p_projects         JSONB,  -- [{name, client_ref?, start_date?}]
                             --   start_date = per-line override of the anchor
  p_category_mapping JSONB,  -- [{category, pipeline_id, assignee_team_id?}]
                             --   one row per DISTINCT category in the body
  p_idempotency_key  TEXT
) RETURNS JSONB  -- {portfolio_id, already_processed, projects_created, tasks_created}

rpc_preview_instantiate_template(p_template_id, p_portfolio, p_projects, p_category_mapping)
  RETURNS JSONB  -- {projects, tasks, boards, first_task_date, last_task_date}
```

`rpc_preview_instantiate_template` is read-only and calls the **same** resolver
and span maths as the commit path, so a preview that succeeds is a promise the
commit will too — it cannot become an optimistic estimate that disagrees with
what gets written.

**Category mapping is the sole source** of `pipeline_id` / `current_stage_id` /
`assignee_team_id`. The template body's legacy per-item `pipeline_id` and
`assignee_team_id` fields are **no longer read** — honouring them would
reintroduce the per-task mapping this design exists to avoid, and they are what
carried the silent NULLs. Each task lands on its mapped pipeline's **first stage
by `position`**, resolved server-side.

Three shared helpers keep preview and commit honest:
`fn_resolve_batch_category_mapping` (validation + first-stage resolution),
`fn_batch_offset_range` (span from the body), `fn_resolve_batch_start_date`
(forward/back-scheduling formula).

**Everything that can silently lose work raises instead**, naming the offender:
a category in the body with no mapping row; a mapping row for a category the
body never uses (typo guard — this is the one that would otherwise route tasks
nowhere); a `pipeline_id` outside the caller's company; a mapped pipeline with
zero stages; an empty body; a missing/invalid anchor or direction; an anchor in
the past.

**Back-scheduling** (`anchor_direction = 'deadline'`): span is `MAX(due_offset_days)`
read from the *same* `project_templates.body` the tasks generate from, so
`start_date = deadline − span` cannot drift from what is actually inserted.
`projects.due_date` — added in Phase 3 and never previously written by this RPC —
is now set to `start_date + span`.

**Verified** (`supabase/checks/check_rpc_batch_config.sql`, local): every RAISE
fires as specified; forward and back-scheduling both land correct `due_date`s;
zero NULL `pipeline_id` / `current_stage_id` / `due_date` across a batch; preview
matches what commit writes; and every created task is reachable through the exact
query shape `components/tabs/_tasks_desktop.tsx` uses to render a board — the
reachability rule above, checked rather than asserted in prose. A 20 × 25
(500-task) batch ran in **58–94 ms** emitting **exactly 1** `notification_events`
row, so §7's Hazard 1 fix still holds at this scale.

#### Shipped — UI (branch `feat-project-batch-config-ui`)

`BulkCreateProjectsSheet.tsx` is now a two-step wizard inside the same
`Popup presentation="auto"` it already used — "setup" (template, batch name,
paste-names textarea, unchanged) and a new "configure" step inserted before
commit, matching this section's design exactly:

- **Category → board/team mapping**, one row per distinct category the
  selected template's `body` uses (four rows for the 22-task audit template,
  not twenty-two) — board required, team optional. Boards are fetched
  `subject_kind='task'` and scoped to the caller's company by
  `pipelines_select` RLS, not a client filter, so there is no way to select
  another company's board. Boards with zero stages are shown but disabled
  (greyed, "No stages" label) so the "mapped pipeline has no stages" RAISE is
  structurally unreachable through the form.
- **Schedule anchor**: a required date + direction picker. *Due by*
  (back-scheduling) is listed first and styled no differently from *Starts on*
  — deliberately not buried as the secondary option, per this section's "the
  domain receives a deadline, not a start date." Quick presets: Today, Next
  Monday, End of Quarter. A date in the past — batch-level or a per-line
  override in the textarea — is flagged inline and blocks proceeding rather
  than reaching the RAISE.
- **Preview**: calls `rpc_preview_instantiate_template` live (debounced) once
  every category is mapped and the anchor is set, and renders its result as
  the sentence this section specifies — `3 projects · 66 tasks · 4 boards ·
  first task Aug 26, last Sep 30` — never a row count. A preview error renders
  in place as the form's validation feedback, per design: preview and commit
  share the same resolver, so a successful preview is a promise commit will
  also succeed.
- Create is disabled until preview succeeds, and sends the exact payload
  preview just validated.

Verified end-to-end against local (no prod writes): logged into a seeded
company, picked the 22-task audit starter template, batch-created 3 projects on
both desktop (centered) and mobile web (< 768px, `DraggableSheet`) viewports,
mapped all 4 categories to distinct boards/teams, back-scheduled from a
deadline via "End of Quarter", confirmed the preview sentence, created, and
confirmed by SQL: 6 projects / 132 tasks across both runs, **zero** NULL
`pipeline_id` / `current_stage_id` / `due_date` / project `start_date` /
`due_date`. Opened the mapped "Internal Audit Workflow" board in the app and
saw the new Fieldwork tasks on its first stage (`AUDITING`) — the §13.10
reachability rule checked in the app, not only in SQL.

**One pre-existing bug found and fixed at the root** in
`components/common/Popup.tsx`: the centered (desktop) footer's `primaryAction`
never gated `onPress` or styling on `variant === 'disabled'` — only
`DraggableSheet` did. Every centered-presentation `Popup` caller with a
disabled primary action was clickable when it shouldn't have been. A dead click
rather than data loss, since callers no-op'd internally, but it is fixed for
every caller rather than worked around here. Mirrors `DraggableSheet`'s
existing pattern; no caller passes `variant: 'disabled'` as a literal today, so
the blast radius is limited to expression-driven callers like this one.

Deliberately not built: promoting the category-mapping row to a shared
component. §13.11 anticipates mounting the same "which board, which team"
picker from the future Work tab (#184) — worth extracting when there is a
second call site, not before.

#### Corrected after review (branch `fix-batch-config-density`)

Running the above on a real screen produced two defects the automated
verification could not see.

**1. It violated the documented desktop-density rule.** The wizard passed no
`maxWidth`, silently inheriting `Popup`'s 420px default, and shipped as the
tall single-column scroll `.agents/rules/ux-consistency.md` §"Desktop density"
forbids. Corrected to `maxWidth={1080}` with **three peer columns** — projects
being created, category mapping, schedule + preview — each `flex-1` with its
own `ScrollView` so a long list in one cannot push the others out of view.
That is the property that makes the screen survive a batch of hundreds of
projects across dozens of categories, which is the case this feature exists
for. Below 768px it collapses to the documented `mobilePage` drill-in
(schedule + preview, with a summary row into a full-height category page),
mirroring `RoleEditorSheet.web.tsx`. Step 1 stays `presentation="auto"` at 640
— one decision, correctly narrow.

**The root cause is worth more than the fix.** `Popup`'s default is 420, so
*omitting* `maxWidth` and *choosing* a narrow dialog are indistinguishable —
doing nothing produces a violation and nothing in code objects. 15 files
repo-wide had the same omission. This is §13.2's "a rule written in prose that
the system does not enforce", moved to the UI; the standing guardrail work is
tracked separately.

**2. Preview promised success, then commit failed.** A green preview —
`4 projects · 56 tasks · 1 board` — was followed by a raw
`duplicate key value violates unique constraint "projects_company_id_name_key"`.
The constraint is correct: it is the **partial** index from #180
(`WHERE deleted_at IS NULL`) working as designed, and an *active* project
already held the name. The defect was that nothing upstream checked, so
§13.10's own contract — *a successful preview is a promise the commit will
also succeed* — was false.

Fixed server-side in `fn_check_batch_duplicate_names`, called by **both**
preview and commit at the same point in their pre-flight order, so the two
cannot disagree. A client-side pre-check would have needed its own copy of
"what counts as a collision", which is the duplication this design avoids
everywhere else. It covers both shapes: two identical names **within one
paste** (which the unique index would never catch — both inserts are in one
statement) and a name matching an **active** project. A name matching a
*soft-deleted* project is explicitly still allowed; forbidding it would
contradict the partial index and resurrect #180's "archived names stay
reserved forever". Errors name the offending projects, matching how unmapped
categories already behave; the UI renders them in the preview slot and keeps
Create disabled.

Cost measured directly: the duplicate lookup is **0.4 ms** for a 20-project
batch. Self-check gained four cases — in-paste duplicate, active collision,
soft-deleted name permitted, and that both messages name the project. One
pre-existing assertion had to be corrected: the back-scheduling block
previewed the *forward* batch's already-committed names, which was harmless
before this validation existed and is a genuine collision now.

### 13.11 Project detail becomes a workspace (amends §8)

§8 assumed project detail was a readout and called `ProjectDashboard` an extend.
The vision it has to serve is larger: assign work to boards and teams, raise
flags, reach every file, and roll the engagement forward next year. That is a
**workspace**, and it forces three corrections.

**It stops being a `Popup` and becomes a route** — `/projects/[id]` with
Overview / Work / Files. Tabs of that weight need deep links, bookmarks and
back-button behaviour; a modal has none. §8's "only one genuinely new route" was
true of a readout and false of this.

**The tabs are things already planned, not new work:**

| Tab | Is |
|---|---|
| Overview | §13.10's dashboard cleanup (#183) — state, read-mostly |
| Work | #182's batch configuration, generalised — control |
| Files | Phase 4's deliverable, plus a *view* over client-level inputs |

**#182's mapping step and the manager's assignment surface are one component
mounted at two moments** — configure the batch at creation, revisit it any time
after. Building it twice would guarantee they diverge.

Files keep §6's split: inputs live at the **client** so they survive across
years, output at the **project**. The Files tab *surfaces* both. It must never
copy client files into each project, or year five holds five copies of the same
reference sheet.

### 13.12 Flags are a fixed composable set, not custom states (settles §5)

Confirmed with the domain: **blocked · awaiting client · at risk**. Fixed for now,
expected to grow.

Custom *states* were considered and rejected. They rebuild the stage engine as a
second parallel lifecycle, after which nothing can authoritatively answer "what
stage is this in" — the exact loss §5 avoided by making "awaiting client" a flag.
One stage machine, many flags, flags compose with any stage and with each other.

Shape: **one `flags text[]` with a CHECK on allowed values, plus one note**, not
three booleans. "For now" is the tell that a fourth is coming, and a fourth flag
should be a CHECK change rather than a schema-plus-UI change. `projects.blocked` /
`blocked_reason` fold into it — cheap precisely because none of this has been
deployed yet.

### 13.13 Rollforward is template-instantiate against a live project (settles §11)

§11 asked whether rollforward or templates would dominate, and predicted "one
extra RPC reading a live project instead of a template body — same shape". That
holds, and the domain's answer is **both, configurably**: some firms clone last
year's engagement wholesale, others want a subset of files plus fresh structure.

`rpc_rollforward_project(p_source_project_id, p_new_name, p_options jsonb)` —
`rpc_create_template_from_project` and `rpc_instantiate_template` composed, with
the source being a live project.

"Configurable" means **a handful of toggles, not a rules engine**: carry
assignments · carry the category→board mapping · carry estimates · carry file
references. Task structure always carries; that is what rollforward is. Defaults
per company (a jsonb on `companies`, like the terminology layer), overridable per
use.

**Files are referenced, never duplicated.** Client-level standing files are
already shared across years by §6. Last year's working papers should be *linked*
from this year, not copied — otherwise year five holds five copies. Deliberately
copying a blank template spreadsheet to fill in fresh is a different, explicit
action, and is §11's open "standard starting files per template task".

Rollforward is not a new phase — it is a sibling RPC in Phase 1, with the file
half arriving in Phase 4.

### 13.14 Project visibility settled — and it is not an RLS problem (settles §11)

§11 called this the single blocking risk and framed it as choosing an RLS policy.
The framing was wrong. Verified:

```
rpc_projects_table     security_definer = true
rpc_project_dashboard  security_definer = true
rpc_get_projects       security_definer = true
```

**Every project read path bypasses RLS.** `SECURITY DEFINER` runs as the function
owner, so `projects_select` never fires for the table, the dashboard or the list.
Tightening that policy would have changed nothing on any screen a user looks at,
while appearing to fix it — the worst possible outcome for a security control.

**The decision, confirmed with the domain:**

- An auditor must **not** see another auditor's engagements.
- Seeing the *numbers* without the contents is **also** a leak. Completion %,
  tracked hours, contributor names and estimates are themselves disclosure.

That second answer is what settles the design: the gate is the **project row**.
Either you can see the project and its rollups are correct, or the row does not
exist for you. There is no partial state — a redacted row still tells you the
engagement exists.

**Model: default deny, plus a `project.view_all` escape hatch.** Visible if you
are `owner_id`, or you are assigned a task in it, or your team is — unless you
hold `project.view_all`, which manager/organiser roles carry. This reuses RBAC
rather than inventing an ACL, and mirrors `task.view_all` and
`filehub:view_all_files`, which already exist.

**Access follows assignment.** No separate membership table to maintain: assign
someone a task and access arrives with it. A freshly bulk-created project with no
assignments is visible only to `project.view_all` holders — which is correct, that
is unallocated work.

#### Shipped (branch `feat-project-visibility`)

**One predicate, five call sites** — not the four this section predicted.
`fn_project_accessible(project_id)` is `STABLE SECURITY DEFINER`, mirroring
#163's `fn_task_file_accessible` shape (existence + company floor first, then
owner / assignment / bypass). Wired into `projects_select` RLS — which is what
covers a direct `supabase.from('projects')` read and does nothing for the four
definer functions — plus `rpc_projects_table`, `rpc_project_dashboard`,
`rpc_get_projects`, and:

**`rpc_create_template_from_project`, a fifth reader this section missed.** It
captured an arbitrary project's full task structure — titles, descriptions,
categories, priorities, weights, hours — into a template body, gated only by
`project.create` / `is_owner`, with no per-project check at all. Found by
querying `pg_proc` for *every* `SECURITY DEFINER` function whose body touches
`public.projects` rather than trusting the three this plan named. The lesson
generalises: the call-site list for a predicate must be derived from the
catalogue, not from a document. `rpc_advance_project_stage` and
`rpc_restore_project` were checked and deliberately left alone — a write path
and an already-archived-rows domain, neither leaking rollups.

Denial and non-existence are folded into the same branch everywhere, so both
answer identically. A distinguishable "denied" would itself disclose that the
engagement exists — the same reasoning that ruled out a redacted row.

**Naming resolved: `project.view_all`, dot notation.** The `project.*` namespace
(`project.view`, `.create`, `.edit`, `.delete`, `.archived`, `.created`,
`.restored`, `.created_from_template`) is 100% dots with zero colons;
`filehub:view_all_files`'s colon is an isolated FileHub-scoped convention, not
the dominant pattern for this permission's own namespace. Seeded on system
Owner / Admin / Manager.

**Performance: no new index required.** `tasks.project_id` (`idx_tasks_project_id`,
partial on `deleted_at IS NULL`) into `task_assignments.task_id`
(`idx_task_ast_task_id`) already cover the join. `EXPLAIN (ANALYZE, BUFFERS)` on
`rpc_projects_table`, warm cache, local seed (3 projects / 66 tasks):
**6.400 ms / 117 buffers → 6.431 ms / 395 buffers.** Buffer touches roughly
tripled — that is the per-row check — but wall-clock was flat because every
extra touch is an indexed lookup, not a seq scan. Worth re-measuring at a
few thousand projects before assuming it stays flat.

**Deliberately not touched:** `clients_select` / `portfolios_select` /
`project_templates_select` remain on the §13.14-era company-wide placeholder.
Whether a client or portfolio should inherit visibility from the projects
referencing it is a separate undecided question, flagged rather than silently
answered.

Migration `20260801_project_visibility.sql`; self-check
`supabase/checks/20260801_project_visibility_check.sql` proves all five
behaviours including that a denied caller gets zero rollups (the dashboard
raises rather than blanking) and that `view_all` is not a tenant escape.

**Phase 1 is no longer blocked on an open question.**

### 13.15 Not yet load-bearing

`companies.terminology_labels` (§2's terminology layer) has zero readers. That
is correct for Phase 2 — but it is speculative schema until Phase 3 uses it,
and should be counted as such rather than as shipped.

---

## 14. Phase 8 — re-brand and interaction polish

The last phase, and the longest. Everything before it is judged on whether the
data is correct and reachable. This one is judged on whether the product feels
like one product.

**Why it is last and not first.** Polishing a screen whose data model is still
moving means polishing it twice. #182 is the argument: the batch-config screen
was rebuilt three times in one day — once for the missing step, once for
density, once for duplicate handling — and any visual work done on the first
version would have been thrown away with it. Structure settles, then surface.

**Why it is not optional.** Every phase before this ships correctness, and
correctness is invisible when the screen presenting it reads as unfinished. A
list of four projects rendered as four lines of plain text is technically an
accurate view of the data and tells the user nothing about what a project *is*.

### 14.1 The standard: nothing renders as bare text

Every entity a user can act on gets an identity — icon or avatar, colour,
state, and the one number that matters for it. A project is a thing with a
client, a deadline, a stage and a completion; showing only its name discards
all four.

Concretely, per entity:

| Entity | Must carry |
|---|---|
| Project | icon/colour, client, stage chip, due date, completion |
| Client | avatar or monogram, active project count |
| Portfolio | source, size, target date, progress |
| Template | sector icon, task count, category spread |
| Task (in project context) | board, stage, assignee, due date |

Density follows §"Desktop density" in `.agents/rules/ux-consistency.md` — this
phase is where the modals annotated `maxWidth={420}` during the Popup
enforcement pass get re-judged and widened where they are genuinely info-dense.

### 14.2 Interaction polish is a first-class deliverable, not a garnish

Named explicitly because it is the part that gets deferred and then never
happens. The recurring failures are small, human, and repetitive:

- **Duplication** — duplicate a project, a template, a batch, a task. Currently
  nothing duplicates. The name-collision handling built in §13.10 is the *floor*
  for this, not the feature: a duplicate action should propose `"X (copy)"`,
  not reject `"X"`.
- **Rename in place**, without opening a modal.
- **Undo** beyond the bulk-instantiate case — deletes, moves, stage changes.
- **Multi-select and bulk act** on the selection.
- **Empty states that offer the next action**, not a shrug.
- **Errors that name the thing and offer the fix** — §13.10's duplicate-name
  message is the pattern; a raw constraint name is the anti-pattern.
- **Keyboard**: escape closes, enter submits, arrows move within a list.
- **Loading that shows shape** (`SkeletonBlock`/`SkeletonList`), not a spinner.

### 14.3 Scope guard

This phase re-skins and re-sequences. It does **not** change the schema, the
RPC contracts, or the access model — if it wants to, that is a defect in an
earlier phase and belongs there. The one exception is columns that exist purely
to be displayed (an icon key, a colour), which are cheap and additive.

### 14.4 Acceptance

Not "it looks better" — that cannot be checked. The tests are:

1. No entity list in the product renders as bare text (§14.1's table).
2. Every action in §14.2 exists on projects, clients, templates and tasks, or is
   explicitly declined in writing with a reason.
3. Every modal has been judged at 1400px, 1000px and 390px — per
   `.agents/rules/walkthroughs.md`, which now requires multi-width walkthroughs.
4. No screen shipped in Phases 1–7 still shows a raw database error string.

---

## 15. Phase 9 — "Smartness": spreadsheet intake that sets itself up

§2's loop starts with a file: *a client office sends a portfolio of ~120
companies.* Today that file becomes a person retyping 120 names into a
textarea. This phase makes the file the input.

**Scope:** drop an Excel/CSV of clients or a portfolio manifest, and get
clients, a portfolio, projects and their tasks — configured, scheduled and on
boards — with the human confirming rather than transcribing.

### 15.1 It must reuse the batch path, not add a second one

The importers that exist (`lib/imports/adapters/*`, #100) create tasks **one at
a time from the client**. That is the shape this phase must not copy — it is
slow, it cannot be transactional, and it produced the notification storm §7
Hazard 1 exists to prevent.

A spreadsheet import ends by calling **`rpc_preview_instantiate_template` then
`rpc_instantiate_template`** (§13.10). The parser's job is to produce that
payload — a projects array and a category mapping — and nothing else. This
matters more than it sounds: every guarantee already proven (one notification
per batch, no orphan tasks, required anchor, duplicate-name detection,
one-call undo) comes free, and cannot drift, because there is one writer.

If a spreadsheet needs something the batch RPC cannot express, extend the RPC.
Do not add an import-specific insert.

### 15.2 Where the "smart" actually is

Four inference problems, in increasing order of how wrong they can be:

1. **Find the table.** Real files have a title row, a merged banner, a logo,
   blank leading columns, and the header on row 7. Detect the header row rather
   than assuming A1.
2. **Map the columns.** Propose `name` / `client_ref` / `external_ref` /
   `start_date` / `due_date` from header text and cell shape. This is where
   most of the felt "seamlessness" lives — a correct auto-mapping is the
   difference between confirming and configuring.
3. **Resolve clients.** Match against existing clients by `external_ref` first,
   name second — §13.3's rule, already load-bearing: *identity is a stable key,
   not a name.* Ambiguous matches are a question, never a guess.
4. **Pick a template.** Suggest from sector/history. Lowest confidence of the
   four; always a suggestion.

**Learning is scoped to mapping, not to writes.** Remember a company's confirmed
column mapping per source so the second file from the same office is a
one-click confirm. Never let it drift into inferring *values*.

### 15.3 Non-negotiables

- **A human confirms before any write.** The output of parsing is a filled-in
  §13.10 configure step, not a completed import. "Seamless" means the form
  arrives already answered — not that it is skipped.
- **Show confidence, and show unmatched rows first.** A row the parser is unsure
  about must surface above the 118 it got right. Burying failures in a success
  count is how #182 shipped 66 invisible tasks.
- **Re-importing the same file is a no-op.** Content-hash the file into the
  existing `idempotency_key`. Someone will drag the same file twice.
- **Partial import is not allowed.** All rows commit or none — the batch is
  already one transaction, so this is free unless someone breaks it.
- **The file is evidence.** Store it in FileHub against the portfolio; when a
  number is disputed six months later, the source is the answer.

### 15.4 Acceptance

Measured on a *real* messy file, not a clean fixture:

1. A 120-row file with a banner, merged cells and a header on row 7 parses to a
   correct preview without the user touching the mapping.
2. Clients already known are matched, not duplicated — verified by row count in
   `clients` before and after.
3. Every created task lands on a board with a date and an owner (§13.10's
   reachability rule — the same query shape the board uses).
4. The same file dropped twice creates one portfolio.
5. Unmatched/low-confidence rows are visible without scrolling.

### 15.5 Shipped (branch `feat-spreadsheet-intake`)

**Pipeline:** `lib/imports/spreadsheetMapping.ts` (pure — header detection,
column-mapping proposal, row extraction, client-name matching; has zero
`lib/supabase`/xlsx imports on purpose so its self-check runs under plain
`npx tsx`, unlike the orchestration layer) + `lib/imports/spreadsheetIntake.ts`
(I/O — reads bytes via the **already-installed** `xlsx` library through the
existing `components/common/loadXlsx(.native).ts` lazy-loader, same one
`lib/taskMobility.ts`'s export/import already uses; queries `clients` directly,
RLS-scoped, no new RPC needed for read).

1. **Find the table** — `detectHeaderRow` scores every row in the first 30 by
   filled-cell count + "mostly non-numeric" + "the next row also has data",
   so a banner/logo/blank-spacer row never outscores the real header.
2. **Map the columns** — `proposeColumnMapping` matches header text against a
   small keyword-per-field rule set (`client_external_ref` checked before
   `client_ref`/`name` — most specific first), nudges confidence from cell
   shape (does the column look date-like / code-like), and mirrors a single
   name-ish column into BOTH `name` and `client_ref` — the same
   name-doubles-as-client convention the paste-textarea already used. Fully
   editable in `SpreadsheetImportSheet`'s mapping step; edits re-run
   `buildIntakeRows` live against the retained AOA, never a stale proposal.
3. **Resolve clients** — `resolveClientMatch`: `external_ref` exact match
   first; else case-insensitive exact name; else a normalized
   (lowercased, suffix-stripped: LLC/Ltd/Group/…) substring match surfaces as
   `ambiguous` — a question, rendered as pick-one-or-"actually new" buttons,
   never auto-resolved. **Correctness note the self-check exercises
   directly:** a resolved `ref`/`exact_name`/user-confirmed match sends the
   *existing client's DB-canonical name* as `client_ref`, not the row's raw
   text — `rpc_instantiate_template`'s name-fallback join (`c.name =
   i.client_ref`) is case-**sensitive**, so echoing back a differently-cased
   row would have silently forked a duplicate client.
4. **Template suggestion — deferred, not built** (§15.2 #4, explicitly
   lowest-confidence). The user still picks a template by hand in
   `BulkCreateProjectsSheet`'s existing setup step.
5. **Per-source mapping memory — deferred, not built.** §15.2's "remember a
   company's confirmed mapping for the next file from the same office" has no
   storage yet (no new table, no local-storage cache). Every file gets fresh
   header detection + a proposed mapping every time. Flagged as a real gap,
   not silently dropped — worth a `company_id + header-signature -> mapping`
   cache (client-side is enough; the rule already says "scoped to mapping,
   not writes") if repeat imports from the same office turn out to be common.

**Hand-off, not a second writer:** `SpreadsheetImportSheet.tsx` produces a
resolved rows array and renders the **existing**
`components/projects/BulkCreateProjectsSheet.tsx` with it via new *optional*
props (`initialRows`, `initialPortfolioName`, `initialSource`,
`initialIdempotencyKey`, `initialSourceFile`) — every existing caller (the
plain "Bulk Create" button) passes none of them and is byte-for-byte
unchanged. `BulkCreateProjectsSheet` still owns template pick, category
mapping, and the schedule anchor; still calls
`rpc_preview_instantiate_template` then `rpc_instantiate_template`, unchanged.
`ParsedLine` gained one field, `client_ref`, so an imported row's client name
can differ from its project name (the textarea path sets `client_ref = name`,
preserving its exact prior behavior).

**Idempotency (§15.3):** the dropped file's SHA-256 (via the existing
`computeSHA256` in `lib/uploadHelpers.ts` — no new hashing code) becomes
`spreadsheet:<hash>`, fed into the SAME `idempotency_key` param
`rpc_instantiate_template` already required. `SpreadsheetImportSheet` also
pre-checks it client-side (one indexed `portfolios` select) so a repeat drop
short-circuits to "Already Imported" before the user re-walks the wizard —
the server-side `already_processed` short-circuit is the actual correctness
guarantee; the client check is a courtesy.

**Evidence trail (§15.3 "the file is evidence"), routed through the existing
upload manager, not a new upload path:** on Create,
`BulkCreateProjectsSheet.getOrCreateStandingFolder` calls the **existing**
idempotent `rpc_filehub_folder_create` (`scope='broadcast'`) to get-or-create
"Portfolio Imports/<batch name>", passes that folder id as
`p_portfolio.standing_folder_id` into `rpc_instantiate_template` (now written
to a new `portfolios.standing_folder_id` column in the SAME transaction —
migration `20260801_spreadsheet_intake_portfolio_folder.sql`, body-only
`CREATE OR REPLACE`, dumped from the LIVE function via `pg_get_functiondef`
and edited minimally rather than retyped from a migration file, per this
doc's own standing warning about that class of regression), and — only after
a successful, non-replayed commit — calls the **existing**
`useUploadManager().startUpload()` to upload the source file into that folder
with `visibility: 'broadcast'`. No change to `UploadManagerContext.tsx`, no
new FileHub visibility value, no bespoke drop zone/upload path: file
*selection* uses the same shared `hooks/useWebDnd.ts` (`useFileDrop`,
`useDropPulse`) and the same hidden-`<input type="file">` pattern
`components/intelligence/_filehub_desktop.tsx` already uses; file *upload*
goes through the one existing engine. A FileHub failure degrades to "no
source file attached" — it never blocks or fails the actual data write.

**Trust-boundary validation:** not-a-spreadsheet / unreadable file, empty
sheet, no detectable header, and a hard `MAX_INTAKE_ROWS = 5000` ceiling
(ponytail — arbitrary but documented and named in the error; raise it or
chunk the RPC calls if a real file needs more) all raise
`SpreadsheetIntakeError` with a specific message before the wizard advances.
Duplicate names within the file are NOT re-validated client-side — the
existing `fn_check_batch_duplicate_names` (both duplicate-in-paste and
duplicate-active-project shapes) already runs inside
`rpc_preview_instantiate_template`/`rpc_instantiate_template` at the
configure step that follows, so re-implementing that check here would be the
exact kind of duplicated validation this design avoids everywhere else — it
still surfaces before the user reaches Create, just one step later than a
purely-client-side check could.

**Self-checks:** `lib/imports/spreadsheetIntake.check.ts` (`npx tsx
lib/imports/spreadsheetIntake.check.ts`) — pure-function asserts against a
fixture with a banner, a logo row, a blank leading column, header on row 7,
and a blank-name row (must be *kept*, never silently dropped). SQL:
`supabase/checks/check_rpc_spreadsheet_intake.sql`, verified locally —
`rpc_filehub_folder_create` get-or-create is idempotent,
`portfolios.standing_folder_id` lands correctly, a ref-matched row does not
duplicate an existing client (`clients` row-count delta = exactly the new
ones), and replaying one `idempotency_key` yields ONE portfolio and zero new
`clients` rows (the literal §15.4 #2/#4 acceptance tests, checked at the SQL
level). `supabase/checks/check_rpc_batch_config.sql` (pre-existing,
re-verified against the new migration) still passes unchanged.

**Not verified end-to-end in a browser.** The worktree this was built in has
no `node_modules` of its own (Metro's dev-server bundler resolves strictly
within its own project root and does not walk up to the parent checkout the
way `npx tsc`/`npx tsx` do), so the Expo web dev server could not bundle here
— confirmed via a direct Metro bundle request, `UnableToResolveError` on
`expo-router/entry`, not a code defect. `npx tsc --noEmit` stays at the
project's 5 pre-existing baseline errors with zero new ones.
