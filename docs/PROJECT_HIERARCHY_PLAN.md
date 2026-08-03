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

Per task item: `title, description, category, priority, weight,
estimated_hours, due_offset_days?`.

**Amended by §13.10 / #182, then by the Phase 7 editor:** the original list
below still names `pipeline_id` and `assignee_team_id` as body-item fields.
They are not — §13.10 moved board/team resolution to *instantiate* time via
`p_category_mapping`, and both fields are **no longer read** by
`rpc_instantiate_template`. `category` is what carries that mapping now, so
it is load-bearing rather than decorative: the batch step maps categories to
boards, not tasks. The Phase 7 template editor (`components/templates/`,
issue #177) enforces this at the UI level too — no per-item pipeline picker,
a category *picker* (reuse from the template's own list) instead of a
free-typed field, so a typo can't silently orphan a task's category from its
board mapping.

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
| Template editor | genuinely new, and last — shipped, issue #177, see §13.17 |

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

### Phase 6 shipped — the purpose-built board (#176)

`components/projects/ProjectBoard.tsx` is new, standalone, and imports
nothing from `_tasks_desktop.tsx`/`_tasks_adaptive.tsx` — no
`taskBoardCache`, no personalizer, no StageTransitionFX, no
submission/claiming/timer machinery. It duplicates only the task board's
*visual* shell (column header treatment, card shadow/radius, rounded
stage-body chrome). `/projects` gained a `Table / Board` toggle
(`components/tabs/_projects_desktop.tsx` and `_projects_adaptive.tsx`);
Timeline stays a disabled placeholder.

**Shared, on purpose:** `rpc_projects_table` (#173, already
`fn_project_accessible`-gated) for card data, called once per stage column
with `p_stage_id`/`p_limit`/`p_offset` — never a new RPC. Every stage move,
drag-and-drop or tap-to-move alike, funnels through
`rpc_advance_project_stage` (#172) — never a raw `UPDATE
current_stage_id`. `ageColor`/`dueColor`/`fmtDue` are imported from
`ProjectsTable.tsx` (not re-derived). Cards route to `/projects/[id]` (#184).
`ProjectStagePicker` (#172) is the tap-to-move affordance and the *only* move
path on mobile.

**Pagination:** each stage column is its own bounded page,
`PAGE_SIZE=30`, fetched in parallel (one `rpc_projects_table` call per
stage, not per project) with a manual "Load 30 more" per column — the
initial payload is bounded by `stage count × PAGE_SIZE`, never by total
project count. Verified locally against 2,501 projects seeded into one
stage: the board still renders that column as a `30+` badge with a bounded
30-row page (~350-800ms per `rpc_projects_table` call against the seeded
data; the query's own cost — company-wide rollup CTEs shared with the
table view — is unaffected by the board's pagination, and is
`rpc_projects_table`'s existing, out-of-scope-for-this-phase behavior, not
something the board introduced).

**Mobile (<768px), driven live at 390px, not just assumed:** one stage at a
time via a horizontal chip row, cards stacked vertically below, tap-to-move
only (no drag surface on touch). Building this surfaced two real bugs,
both fixed in the same phase, not deferred: (1) react-native-web's
`ScrollView` defaults to `flexGrow: 1` regardless of the `horizontal` prop,
so both chip rows (pipeline switcher and mobile stage filter), nested in a
`flex-1` column with no counter-style, stretched to fill the remaining
column height and turned every `rounded-full` chip into a full-height pill
— fixed with an explicit `style={{ flexGrow: 0 }}` on each. (2) the mobile
card list itself had no scroll container at all, so a stage with more cards
than fit one screen was unreachable below the fold — fixed by wrapping the
card list (not the chip row) in its own `ScrollView`. Neither was caught by
`tsc` or the desktop screenshot; both only showed up driving a real browser
at a narrow width.

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
| **6** | Project board (purpose-built) — **shipped** (#176) | yes |
| **7** | Template editor — **shipped** (#177) | yes |
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

#### Shipped (issue #184, branch `feat-project-route`)

**The route and header, not the tab contents.** `/projects/[id]` — one file,
`app/projects/[id].tsx`, not a `.tsx`/`.web.tsx` split like `app/task/[id]`:
that split exists there because desktop web wants a genuinely different
2-pane arrangement from native/mobile-web; this route has no such
divergence, so one width-aware component serves both, same reasoning §8
already applied to boards ("write a purpose-built X" over speculative
generalization). Tab state lives in `?tab=` via `useLocalSearchParams` +
`router.setParams`, the exact mechanism FileHub's `?tab=`/`?file=` deep link
already established (`_filehub_desktop.tsx`) — extended, not reinvented.
`ProjectDetailContext` (mirrors `TaskDetailContext`'s provider-per-route
shape) fetches `rpc_project_dashboard` once; all three tabs read from it.

**Overview and Work render real data now; Files is a pure stub.** Overview
is the KPI/panel body moved (not copied) out of the two Popups this issue
retired, marked as #183's to restructure. Work shows the tasks already on
the project plus a banner naming what's missing (#182's mapping component,
not yet built — building a second one here would be exactly the divergence
this section warned about, so it wasn't). Files has zero backing data
(`rpc_project_dashboard` carries none) and is an explicit empty state
pointing at #174.

**`ProjectDashboard.tsx` / `ProjectDashboardSheet.tsx` deleted, not kept as
a quick-peek.** Both were 90%-identical Popups (desktop `centered` /
mobile `sheet`) with zero remaining callers once `ProjectsTable`'s row-click
was repointed at the route on both list screens (`_projects_desktop.tsx`,
`_projects_adaptive.tsx`). Keeping either as a "quick peek" would have been
the second project-detail surface #184 itself was written to prevent (see
#167's board-picker drift, cited in the issue). `ProjectStagePicker.tsx` and
`SaveAsTemplateSheet.tsx`, previously mounted inside those Popups, are now
mounted directly by `ProjectHeader.tsx` instead — same components, new host.

**Flags shipped as `flags text[]` + `flag_note`, additive.** §13.12's fixed
set (blocked / awaiting_client / at_risk) needed real schema to back the
header, and the "cheap because nothing's deployed yet" premise in §13.12 was
already stale by the time this issue started: `blocked`/`blocked_reason`
(20260731_projects_lifecycle_columns.sql) had shipped with live readers —
`rpc_projects_table`'s list badge/sort/"blocked only" filter. Folding those
into `flags` would have meant touching that RPC's fixed contract, out of
scope for a route/tab-shell issue. So `20260801_project_header_flags.sql`
adds `flags`/`flag_note` alongside the existing columns rather than
replacing them, and `useProjectLifecycle.setFlags` (the only write path now
— `ProjectBlockedToggle.tsx`, the old boolean's only editor, was deleted
with its callers) keeps both representations in sync in one `UPDATE`, so
`rpc_projects_table` stays correct without being touched. Reconciling the
two into one column everywhere is flagged, not answered — same posture
§13.14 took on `clients_select`/`portfolios_select`.

**Denial and non-existence verified indistinguishable end to end**, not
assumed from reading `rpc_project_dashboard`'s exception message. Live test:
a user with base `project.view` but no `project.view_all`, assigned to
project A and not project B — `/projects/<A>` renders the workspace,
`/projects/<B>` and `/projects/<random-uuid>` render the byte-identical
"Project not found" screen (question-mark icon, no mention of permissions).
Confirmed both at the SQL layer (`fn_project_accessible` /
`rpc_project_dashboard` under an impersonated JWT) and by driving a real
logged-in browser session to both URLs and diffing the screenshots.

#### Shipped (issue #183, branch `feat-project-overview`)

**The Overview tab's redesign** — the twelve-region, equal-weight body #184
moved into `ProjectOverviewTab.tsx` as an explicit placeholder is now the
four-question layout this section's table row promised: one answer-line
sentence (stage · days in stage · % complete · days remaining ·
blocked-or-not) above four panels grouped *On Track? / What's Stuck? /
Who's on It? / What's the Shape?* — the last visibly quieter (muted
background, no header icon, narrower column) since category/priority
breakdowns are reference, not decision-support, per the issue. Empty panels
("No tasks yet", "No tracked time yet", "Nothing stuck") collapse to a
single demoted row instead of a card reserving the same height as a
populated one. Ageing colours and due-date wording are imported from
`ProjectsTable.tsx` (now exported: `ageColor`, `dueColor`, `fmtDate`,
`fmtDue`, `initials`), not re-derived, so the table row a user clicked from
and the workspace they land on agree on what "7 days in this stage" means.

**A real data gap, resolved without new SQL.** `rpc_project_dashboard`
carries task rollups only — no `blocked`, `current_stage_id`'s age, or
`due_date`, all of which live on the `projects` row itself and were already
fetched by `useProjectLifecycle` for `ProjectHeader`. That hook gained two
additive fields (`dueDate`/`daysRemaining`, one extra selected column;
`daysInStage`, a second tiny select on `project_stage_history` scoped to
the current, already-accessible `project_id` — safe without a new
SECURITY DEFINER RPC because reaching the hook already required passing
`rpc_project_dashboard`'s `fn_project_accessible` check for that exact
project). No migration, no RPC change.

**A stale-state bug found by actually clicking the app, not by reading the
diff.** The first version called `useProjectLifecycle` a second time from
`ProjectOverviewTab` (reuse the hook, not a new fetch shape). That created
two independent instances: toggling "Blocked" in `ProjectHeader` updated
the header's own copy but left the Overview tab's answer line and "What's
Stuck?" panel showing the old state until an unrelated remount. Fixed by
lifting the hook one level up — `ProjectDetailContext` now calls it once
and exposes `lifecycle`/`lifecycleLoading`/`refreshLifecycle`/
`advanceStage`/`setFlags` alongside `data`/`loading` (additive fields, the
existing `data`/`loading`/`notFound`/`refresh` shape is untouched); both
`ProjectHeader` and `ProjectOverviewTab` read the same state now. Verified
live: toggled "Blocked" in the header with the Overview tab open, watched
the answer line flip to "Blocked" and the Stuck panel populate with a
danger-bordered reason card in the same render, then toggled it back off
and watched both revert — no reload involved.

**Not verified**: a project with literally zero tasks (`totals.total === 0`,
which also empties `by_category`/`by_priority`). No project in the local
seed data has zero tasks, so the "On Track?"/"Shape" panels' own `noTasks`-
guarded `EmptyLine` branches are exercised only by code inspection — same
conditional shape as the "No tracked time yet" / "Nothing stuck" branches
that *were* driven live, but not independently screenshotted.

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

#### Shipped (branch `feat-rollforward`, migration `20260801_rollforward_project.sql`)

`rpc_rollforward_project(p_source_project_id, p_new_name, p_options jsonb)`
literally calls the two existing RPCs rather than reimplementing their insert
logic: step 1 calls `rpc_create_template_from_project` to snapshot the source
project into a real (but transient) `project_templates` row — which is also
where the access gate comes from for free, since that RPC is already call
site 5 of `fn_project_accessible` (§13.14). Step 2 calls
`rpc_instantiate_template` with a single-row `p_projects` batch built from
that template, so every guarantee already proven — one notification per
batch, a required schedule anchor, first-stage resolution, duplicate-name
detection naming the offender, `portfolio_id` as the one-call undo unit —
carries over unmodified. The transient template row is soft-deleted before
the function returns (the portfolio's own `template_body_snapshot`, already
written by `rpc_instantiate_template`, is the permanent record), so
rollforward never clutters the "Save as Template" list.

**Four toggles, defaulted per company.** `companies.rollforward_defaults`
mirrors `terminology_labels`' shape exactly — one jsonb,
`{carry_assignments, carry_mapping, carry_estimates, carry_files}`, all
`true` by default (the issue's stated common case: wholesale clone),
overridable per call via `p_options`. `carry_mapping=true` auto-derives
`p_category_mapping` from the SAME captured body — each category maps back
to the board it already used — so nothing loses its board unless the caller
explicitly turns this off, in which case a fresh mapping is required (same
shape/step `BulkCreateProjectsSheet` already collects). `carry_estimates`
strips `estimated_hours` from the body with one `jsonb_agg(elem - 'key')`
when off. `carry_assignments` governs the category mapping's
`assignee_team_id` — **team-level only**: the underlying
`project_templates.body` item shape has never carried per-user assignment
(team-level only, "no interpolation/template language", plan §4), and
`rpc_instantiate_template`'s insert never writes `assignee_user_id`.
Extending that shared shape to also carry person-level assignment would be
an invasive change to infrastructure three other features depend on —
flagged, not built silently.

**Files are referenced, never duplicated — provably.**
`projects.rolled_forward_from_project_id` is set **only** when
`carry_files=true`; its presence is the entire toggle effect, not a flag that
could drift from it. `filehub_folder_accessible` and the
`filehub_files_select_visibility` RLS policy (both body-only
`CREATE OR REPLACE`, every existing caller unaffected) grow one additional
`EXISTS` branch: a folder/file scoped to project P is also visible to anyone
who can see a project whose `rolled_forward_from_project_id = P`. No
`filehub_files` row is read, inserted, or touched by the rollforward RPC
itself — access is resolved entirely at read time through the FK.
`supabase/checks/check_rpc_rollforward_project.sql` proves this directly:
zero new `filehub_files` rows after a `carry_files=true` rollforward, a user
assigned only to the NEW project's task can reach the OLD project's
deliverable folder (`filehub_folder_accessible` true, and the raw RLS-gated
`SELECT ... FROM filehub_files` also surfaces the row under `SET LOCAL ROLE
authenticated`), while `fn_project_accessible` on the source project stays
false for that same user — the grant never widens into general access.

**Access gating, reachability, and undo — all inherited, all checked.** A
caller who cannot see the source project gets the identical
`rpc_create_template_from_project` "Project not found." (folded, not a
distinguishable "denied", per §13.14). Every rolled-forward task has a
non-NULL `pipeline_id`/`current_stage_id`/`due_date` — checked with the same
query shape `components/tabs/_tasks_desktop.tsx` uses. A colliding project
name raises `fn_check_batch_duplicate_names`'s offender-naming error, not a
raw constraint violation. `rpc_undo_portfolio_instantiation` reverses a
rollforward exactly like any other `portfolio_id` batch — no special-casing
needed, since a rollforward's portfolio row looks like any other batch's.

**UI:** `components/projects/RollforwardSheet.tsx` — one name field, four
toggles, a schedule anchor (reusing the "due by"/"starts on" + preset +
`Calendar` pattern `BulkCreateProjectsSheet` established), and a
category→board/team mapping panel that only becomes editable when
`carry_mapping` is turned off (pre-filled with each category's *current*
board as a starting point). `Popup maxWidth={820}`, two peer columns
(form+toggles / mapping) on desktop, a single `DraggableSheet` with a
mapping drill-in page on mobile web. Not yet wired into
`ProjectOverviewTab.tsx` / a "Roll Forward" action — that call site belongs
to the agent owning that file; flagged, not added here.

**Deliberately not built:** a `rpc_preview_rollforward_project` mirroring
`rpc_preview_instantiate_template`. The sheet shows category/task counts
computed directly from the source project's own tasks (no server round-trip
needed for a single-project batch), which is enough signal for a one-project
action; add a real preview RPC if rollforward grows a multi-project variant
where preview-vs-commit drift becomes a real risk again.

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

### 13.16 Phase 4 shipped — the sealed deliverable (settles §6, #174)

`projects.deliverable_folder_id` and `clients.standing_folder_id` (the latter
already existed as a column, unwritten until now) are live. Harvest is exactly
what §6 specified: no new file mechanism, no counter column — a version
snapshot via FileHub's existing `filehub_file_versions.batch_id` folder
versioning (`rpc_filehub_folder_versions`, `20260730133142` /
`20260730133225`). One correction discovered building this: those two
migrations, plus `20260730122954_filehub_share_permission.sql`, existed as
files but had **not actually been applied to the local stack** — confirmed by
direct `pg_proc`/`information_schema` introspection, not assumed from the
migration folder. Applied via `psql -f` (never `supabase migration up`) as
prerequisite groundwork; this is the same class of drift §13's opening line
warns about, just on the infra side rather than the schema side.

**The mechanism (`supabase/migrations/20260801_project_deliverable.sql`):**

- **Visibility is a one-value extension, not a new model.** `filehub_files`
  gains `visibility='project'` + a `project_id` column, and
  `filehub_folders` gains `scope='project'` + `project_id`, each gated by
  `fn_project_accessible()` — the exact predicate #186 already wired into
  every other project read path. A sealed deliverable can therefore never
  become a way to read a file its viewer could not already reach via the
  project. Mirrors precisely how `'task'` was added for #143/#151.
- **Trigger-enforced, not RPC-enforced** — `trg_tasks_harvest_deliverable`
  (`AFTER UPDATE OF current_stage_id ON tasks`) reads
  `pipeline_stages.harvests_to_deliverable` and calls
  `fn_harvest_task_output`. This is §13.2's lesson ("a rule written in prose
  that the database does not enforce") applied here on purpose: tasks change
  stage via drag-drop, RPCs, and bulk paths alike, and a single RPC hook
  would have missed some of them.
- **Output = the task's latest submission's attachments** (`submission_attachments`,
  not `task_attachments` — the brief is input, not output). Each promoted file
  becomes its own `filehub_files` row pointing at the SAME `storage_path` as
  the source (no bytes copied) with its own `filehub_file_versions` row and a
  fresh `batch_id`. That is what makes immutability free: a later change to
  the task's file is a new submission with a new `storage_path`, so the
  earlier harvested row is never touched, and the folder's version count
  (`count(distinct batch_id)`) advances by exactly one per harvest event. A
  re-harvest of an unchanged file is a no-op (matched on folder + storage_path
  + bucket) — moving a task in and out of the stage doesn't pile up
  duplicates.
- **The toggle is reachable, not just schema** — `rpc_add_stage` /
  `rpc_update_stage` were extended (trailing defaulted params, no arity
  break) and a "Seal to Project Deliverable" switch was added to both
  `StageBuilder.web.tsx` and `StageBuilder.tsx`, hidden for `subject_kind='project'`
  pipelines (the trigger is task-stage-only). §13.8's exact trap — "nothing in
  the app can reach any of it" — was checked against directly, not assumed.
- **Read path:** `rpc_project_files(p_project_id)` returns the deliverable's
  files + `rpc_filehub_folder_versions` output, plus the client's standing
  files, in one call. Denial/non-existence folded together exactly like
  `rpc_project_dashboard` (`'Project not found.'`, never a distinguishable
  "denied" — #186 / §13.14). `components/projects/ProjectFilesTab.tsx` (#184's
  placeholder) renders both sections read-only, reusing
  `FilePreviewGrid`/`FilePreviewCard`/`FilePreviewModal` — no new file-listing
  UI. Upload is explicitly out of scope here and stays out — nothing here
  writes a file.
- **Client standing folder** — `rpc_client_ensure_standing_folder`, lazy
  get-or-create nested under a dedicated "Client Files" root, calling the
  existing `rpc_filehub_folder_create` twice (root then leaf) rather than a
  raw insert — same shape as `BulkCreateProjectsSheet.getOrCreateStandingFolder`
  (#188). Deliberately distinct from the deliverable folder (own scope, own
  lifecycle, no lazy-create-on-harvest).

**Two pre-existing bugs found and fixed at the root while proving visibility
under real RLS (not just via the `SECURITY DEFINER` RPC layer that normally
hides this).** `filehub_files_select_visibility`'s `'direct'` branch queries
`filehub_recipients`, whose own policy queries `filehub_files` right back —
and separately, `filehub_files`'s `'group'` branch queries
`filehub_group_members`, whose own policy self-joins. Both are two-table (or
self-referential) RLS cycles that Postgres's planner has always tripped on
("infinite recursion detected in policy for relation ..."), on **any** raw
`SELECT` against `filehub_files` under RLS, regardless of which visibility
branch a given row actually matches — never hit before because every real
read goes through a `SECURITY DEFINER` RPC (`BYPASSRLS`), and nothing had
exercised a raw table read under `authenticated` until this check tried to.
Fixed by wrapping both cross-table checks in `SECURITY DEFINER STABLE`
functions (`fn_filehub_is_direct_recipient`, `fn_filehub_is_group_member`) —
the exact same technique `task_accessible`/`fn_project_accessible` already
exist for. Without this fix, the acceptance criterion "prove a user who
cannot see a file cannot reach it via the deliverable" could not have been
proven at the RLS level at all, for any visibility value.

**Verified** (`supabase/checks/check_project_deliverable.sql`, `BEGIN`/`ROLLBACK`,
local): first harvest lazily creates the deliverable folder and promotes v1
with the source's exact `storage_path`; a second submission changes the
task's file without mutating the sealed v1 row; a genuine re-entry into the
harvest stage adds v2 as its own row while v1 stays byte-identical and still
opens, and the folder reads as 2 distinct versions both by raw
`count(distinct batch_id)` and via `rpc_filehub_folder_versions`; re-entering
again with no new submission creates zero new rows; a user with no
assignment and no `project.view_all` gets zero rows from `filehub_files`,
`filehub_folder_accessible()=false`, and `rpc_project_files` raising
`'Project not found.'`, while the task's own assignee sees both harvested
versions through `rpc_project_files`; and `rpc_add_stage`/`rpc_update_stage`
round-trip the toggle. `check_rpc_batch_config.sql` and
`check_rpc_spreadsheet_intake.sql` re-run clean, unaffected.

**Not built:** a manual "harvest now" / "seal project" button. §6 described
harvest as the per-stage toggle only ("tasks entering this stage promote
their output"); there is no separate whole-project seal action in scope, so
none was added. Also not built: category-based folder structure inside the
deliverable (flat for now — one folder per project, files listed
chronologically) and a "restore deliverable to version N" UI (the RPC,
`rpc_filehub_folder_restore_batch`, already exists and works against a
`scope='project'` folder for free via the `filehub_folder_accessible`
extension, but no button calls it yet).

### 13.17 Phase 7 shipped — the template editor (settles §4/§8/§10, #177)

Firms can now author and edit `project_templates.body` directly —
`components/templates/TemplateEditor.tsx` — instead of only capturing one from
a finished project. Reachable from two existing entry points, both of which
already committed a `project_templates` row before the editor ever opens, so
"cancel" in the editor still leaves the captured/materialized template
in place: `SaveAsTemplateSheet.tsx` (opens the editor right after
`rpc_create_template_from_project` commits, so an author fixes categories on
what was just snapshotted before it goes stale) and
`StarterTemplatePickerSheet.tsx`'s new "Customize First" action (materializes
the same starter row `rpc_create_starter_template` would for "Use This
Template", then routes into the editor instead of handing the researched
offsets back sight-unseen).

**§4 correction, not a new decision:** the body-item contract there still
listed `pipeline_id` as an editable field. It is not, and has not been since
§13.10 — the editor does not expose a per-item pipeline picker, and
`fn_validate_template_body` does not validate one. See §4's amendment above.

**Backend:** one migration
(`supabase/migrations/20260801_rpc_template_editor.sql`) adds exactly the
write path `project_templates`'s RLS was missing —
`rpc_create_project_template` (blank-slate authoring),
`rpc_update_project_template` (full replace of
name/description/color/body, gated the same way the existing capture RPCs
are), `rpc_delete_project_template` (soft delete, `project.delete`-gated,
matching the schema migration's documented convention). No RLS weakened —
`project_templates` still ships no INSERT/UPDATE/DELETE policy;
everything routes through these `SECURITY DEFINER` functions.
`fn_validate_template_body` mirrors the exact constraints the DB enforces at
task-insert time (priority enum, weight 1–10, non-negative
`estimated_hours`/`due_offset_days`) so a bad template fails loud, naming the
offending task, at save time — not as a raw constraint error mid bulk-create.

**Categories are made reusable, not free-typed per row.** The editor's
category field is a picker sourced from categories already used elsewhere in
*this* template (plus an explicit "new category" affordance), not a bare
text input on every task row. This is the direct fix for the failure mode
§13.10 exists to prevent — "Planning" on one row and "Planing" on the next
would otherwise silently split one category's tasks across two (or zero)
board mappings at instantiate time.

**The schedule anchor is surfaced, not left as a bare integer.** Per §13.9's
own lesson (194 researched offsets sat inert until an anchor existed to
interpret them), the editor shows the implied span — "22 tasks · 4
categories · Day 0 → Day 35" at the template level, a Day-0-to-Day-N position
bar per task — instead of a naked `due_offset_days` number box.

**Layout follows ux-consistency.md's desktop-density rule**, not the
single-column shape #182 had to be rebuilt out of:
`Popup presentation="centered"` `maxWidth={1100}` with `sideMenu={<SidebarLayout width={320}>}`
(template fields + reorderable task list) and a paired-column form in the
main pane — same shape as `EditTaskModal.web.tsx`. Below 768px it collapses
to a `DraggableSheet` two-page drill-in (list page, then a full-height item
page with a back chevron), the same pattern as `RoleEditorSheet.web.tsx`.
Reordering is plain up/down buttons, not `hooks/useWebDnd.ts` drag — array
order only has to roughly track `due_offset_days`, and two buttons per row
cover that without cross-browser DnD's surface area.

**Round-tripped, not just saved.** `supabase/checks/check_rpc_template_editor.sql`
creates a blank template, exercises every `fn_validate_template_body`
rejection path (each asserting the error names the offending task), saves a
valid two-task body, then calls `rpc_preview_instantiate_template` — the
same read-only resolver `BulkCreateProjectsSheet` uses — and asserts it
reports 1 project, 2 tasks, 1 board, and real first/last task dates. A
template that saves through this editor is therefore provably instantiable,
not just schema-valid. Manually re-verified against two more real starter
templates (22-task audit, 14-task tax prep, 12-task bookkeeping close)
through the actual UI at 1400px and 390px: opened via "Customize First",
edited a task's `due_offset_days` in the browser, saved, and confirmed the
new value landed in `project_templates.body` via a direct DB read — not just
that the UI looked like it saved.

---

### 13.18 Phase 5 shipped — portfolio flow analytics (settles §9, #175)

`components/intelligence/PortfolioFlowTab.tsx` (native, react-native-svg) /
`PortfolioFlowTab.web.tsx` (web, any width, recharts with hover tooltips) —
a "Portfolio" tab mounted unchanged from both `_analytics_adaptive.tsx` and
`_analytics_desktop.tsx`. Same data behind both: `hooks/
usePortfolioFlowData.ts` calls `rpc_portfolio_wip_by_stage` /
`rpc_portfolio_cfd` / `rpc_portfolio_throughput` / `rpc_portfolio_capacity`
(all `SECURITY DEFINER`, `analytics.view` + `fn_project_accessible` per row).

**Where the CFD's timestamps come from.** `project_stage_history` is
trigger-written (§13.2), so `rpc_portfolio_cfd` can compute, for stage S at
bucket-end D, `COUNT(DISTINCT project)` that has EVER reached position >= S
by D — a real cumulative-flow diagram, not a synthetic one. The client only
diffs adjacent-stage `cumulative_count` to draw stage band widths.

**Two real bugs found building this, neither about the numbers:**

- The native/svg WIP chart's `onLayout`-measuring `<View>` combined
  `onLayout` with `onStartShouldSetResponder` on one node. On web,
  react-native-web's ResizeObserver-backed `onLayout` never fires when both
  props share a node — `width` state stuck at 0 forever, so the chart
  rendered nothing despite the RPC returning 5 real rows (confirmed by
  instrumenting: DOM measured 782px wide / 0px tall, no layout event ever
  arrived). Fixed by splitting onto two nested Views + giving the measured
  node an explicit height, matching `CfdChart`'s already-working structure.
- A pre-existing Rules-of-Hooks violation in `_analytics_adaptive.tsx`:
  `useBillingPlan()` was called after two early returns, so
  `permissionsLoaded` flipping true mid-session changed the hook count
  between renders ("Rendered more hooks than during the previous render"),
  crashing the whole Analytics screen on native/narrow web — not specific to
  Portfolio, just first surfaced by actually loading this tab at 390px.
  Hoisted above the early returns, matching `_analytics_desktop.tsx`.

**Verified, not just rendered:** `rpc_portfolio_wip_by_stage`'s `wip_count`
for the QA pipeline matched a hand `COUNT(*)` on `projects`/
`pipeline_stages` exactly (Intake=1, In Progress=2, Awaiting Client=2,
Review=0, Done=2, both ways), from three different callers (owner sees all,
direct assignee sees only their own project, zero-access sees zero — not an
error). Self-check `supabase/checks/20260801_portfolio_flow_analytics_check.sql`
covers the same for CFD (hand `COUNT(DISTINCT project_id)`), throughput/
cycle-time (Little's Law arithmetic), capacity (hand `SUM`s gated by the
CALLING user, not the assignee), and cross-tenant isolation.

**What local data actually supported:** a real, if small, "Portfolio Flow QA
Pipeline" with 18 real trigger-written stage-history rows across 7 projects
and 5 stages spanning ~11 days — enough to draw a genuine (not fabricated)
CFD with visible arrival/completion bands. Bulk-seeded volume (2,500+ rows in
one stage) exists in the same DB from a sibling agent's perf testing and was
used only to confirm the WIP chart doesn't choke on a large count, never
presented as evidence of correctness.

**Mobile web touch gap, reported plainly rather than papered over:**
recharts' tooltip only updates on `touchmove`, not `touchstart`/`touchend`
(confirmed by reading `RechartsWrapper.js` and by dispatching a real
`Input.dispatchTouchEvent` tap in a live browser — no tooltip appeared). A
stationary tap on a touch device shows nothing; only a touch-drag would. This
is inherited from recharts' default trigger behavior and is not unique to
this tab — every other recharts chart in Intelligence (`PipelineOverviewChart.tsx`,
`IntelligenceSections.tsx`) has the same characteristic. Fixing it app-wide
is out of scope here; flagged, not silently shipped.

Focus ring: matches the app's single global focus treatment (`global.css`,
commit 0452396) — no local `outline`/focus code in this tab.

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

---

## 16. Phase 10 — Integration: projects everywhere

Phases 1–9 build the projects tree and its own screens. Nothing else in the app
knows projects exist. The dashboard shows tasks. Intelligence → Overview shows
pipelines. The calendar shows task deadlines. A firm running twelve engagements
sees none of that on the screen it opens first.

This phase is not new features. It is making the rest of the product aware of
the entity we just built.

### 16.1 The one thing that will go wrong

**Five surfaces will each invent their own definition of "blocked", "on pace",
and "projected end date", and they will disagree on screen.**

That is the failure mode this whole document has hit repeatedly under other
names — #167's diverged board pickers, the two upload paths, the four
`SECURITY DEFINER` readers that each re-implemented project visibility before
`fn_project_accessible` (§13.14). It is worse here because the output is a
*number*. Two screens showing a different projected completion date for the
same project does not read as a bug, it reads as the product being untrustworthy.

**So the deliverable is one server-side definition first, consumed everywhere
second.** A `rpc_project_health` (or an extension of `rpc_projects_table`,
preferred if it can carry the columns without another round trip) returns per
project: `blocked` / `blocked_reason`, days in current stage, completion, pace,
projected end, and a confidence flag on that projection. Dashboard, Intelligence
Overview, calendar, timeline and the projects table all read those columns. No
surface computes any of them client-side. If a surface needs a number the RPC
does not return, the RPC grows a column — it does not get a second
implementation next to it.

### 16.2 Do not invent the forecast math — Phase 5 already shipped it

`rpc_portfolio_throughput` and `rpc_portfolio_capacity` (§13.18) already compute
completion rate over a window from real `project_stage_history` timestamps.
"Projected end at current pace" is that throughput applied to remaining scope.
Writing a second pace calculation for the dashboard is the §16.1 failure with
extra steps.

**And it must be honest about confidence.** A projection from three stage
transitions is noise wearing a date's clothing. The RPC returns the sample size
it used and the surface renders a projection differently — or refuses to render
one — below a threshold. Shipping a confident wrong date is worse than shipping
no date; this is the same standard §13.9 applied when it rejected a silent
`COALESCE` default, and the same one that made 66 tasks with `due_date = 0` a
defect rather than a cosmetic issue.

### 16.3 Surfaces, and what each one owes

| Surface | Files | Owes |
|---|---|---|
| Dashboard | `components/tabs/_index_*.tsx` | blocked projects surfaced by exception (not a list of all projects — the point is what needs attention), output this period, projects at risk of their due date |
| Intelligence → Overview | `components/intelligence/_analytics_*.tsx`, alongside `PipelineOverviewChart` | project-level rollup next to the existing pipeline rollup, reusing that chart's tooltip/theming, not a new chart idiom |
| Calendar | `components/calendar/CalendarOverlay.web.tsx`, `components/common/Calendar.tsx` | project start/due/expiry as first-class entries beside task deadlines, filterable by portfolio and client |
| **Timeline tab** | `components/tabs/_projects_*.tsx` | **the disabled placeholder shipped in Phase 6 gets built here** as the projection view — per project, actual dates vs projected end. §8 left it a stub with no phase and no issue. See §16.3.1 for why it stays on the Projects screen |
| Deadline strip | existing top-bar strip | projects appear beside tasks |

#### 16.3.1 Why the projection timeline lives in Projects, not only Intelligence

The instinct to put a projections view in Intelligence is right about the
*content* and wrong about the *audience*, and the permission model settles it:

    project.view    — held by 22 roles
    analytics.view  — held by 15 roles

**Seven roles can see Projects and cannot open Intelligence.** They are the
people actually running the engagements. Putting projected completion only
behind `analytics.view` means the person responsible for a deadline cannot see
whether they will hit it, while someone who does not work the engagement can.
That is the wrong way round, and no amount of navigation design fixes a
permission boundary.

So the two views are different products of the same data, not duplicates:

| | Projects → Timeline | Intelligence → Portfolio Flow |
|---|---|---|
| Question | "when does *this* land, and what is late?" | "is the firm keeping up?" |
| Grain | one row per project, actual vs projected | aggregate — CFD, throughput, capacity |
| Next action | open the project and fix it | staffing / commitment decisions |
| Gate | `project.view` | `analytics.view` |
| Status | to build (this phase) | shipped, Phase 5 (§13.18) |

Both read the same `rpc_project_health` projection columns. That is §16.1
applied: two presentations, one definition, never two pace calculations. If the
timeline and the portfolio charts ever disagree about a date, that is a bug in
having computed it twice.

### 16.4 Access control is not automatic here

Every one of these surfaces is a **new place a project can leak**. The dashboard
and Intelligence read across the whole company by design — that is exactly the
shape of the #185 escalation and the reason §13.14 has one predicate and five
call sites. Every new read path goes through `fn_project_accessible`, and the
self-check for this phase proves a three-actor case (owner / assigned / no
access) on **each** new surface, not once for the phase.

Note this interacts directly with #190: until per-company roles actually hold
`project.view_all`, most of these surfaces render empty for most users. #190
lands before this phase, or the integration cannot be evaluated.

### 16.5 Acceptance

1. A blocked project appears on the dashboard without the user opening Projects.
2. The projected end date shown on the dashboard is byte-identical to the one on
   the project's own page and in the timeline — same RPC, same number.
3. A project with too little history shows no projection, not a confident guess.
4. Project dates appear in the calendar and filter by portfolio.
5. The Timeline toggle is no longer disabled.
6. Three-actor visibility proven on every new surface.

---

## 17. Project QOL — folded into Phase 8, not a phase of its own

Raised separately, but it is already §14's second half and belongs there.
Splitting it out would mean touching the same files twice: you cannot re-skin a
project card in one phase and fix its interactions in another without redoing
the first pass. §14 already carries "handling small user human interactions such
as duplication" as an explicit priority.

What the separate raise adds is the diagnosis, which §14 should state plainly:
**the average user does not understand what a project is versus a portfolio
versus a pipeline versus a task.** That is a naming and affordance problem, not
a polish problem, and it is the thing §14.1 ("nothing renders as bare text")
exists to fix. Concretely it needs, inside Phase 8:

- an empty state on every projects surface that explains the entity rather than
  saying "No projects"
- duplicate / rename / archive reachable from where the user is looking, not
  only from a detail route
- the four entities visually distinguishable at a glance — a portfolio must not
  look like a project which must not look like a pipeline
- destructive actions confirmed via `useAlert().showConfirm`, never `Alert.alert`
- terminology consistent with the §13 terminology layer wherever a label is user-facing

**Ordering caveat.** §16 renders projects on five more surfaces. If §16 ships
before §14, the shared presentational primitives (project icon, status chip,
health badge) do not exist yet and each surface invents its own — the §16.1
failure in visual form. So Phase 8 defines the primitives, then Phase 10 consumes
them; or the two ship together. They do not ship in the other order.

---

## 18. Phase 9 redesign — the smart parser (supersedes §15's mapping layer)

§15 shipped an intake that reads a spreadsheet whose columns are named the way
we expected. Measured against a real client file (22 columns, a Qatari audit
firm's 2025 engagement register), it recovers **3 columns of 22 — and names
every project wrong**:

    name       <- col 13 "Name of focal Point"   (a CONTACT PERSON)
    client_ref <- col 1  "Company Name"
    start_date <- col 19 "Expected date"         ("1st week of January", "still pending")

`proposeColumnMapping`'s `/\bname\b/i` rule matched "**Name** of focal Point"
before it reached "Company Name". This is not an incomplete feature; it is a
confidently wrong one, and it fails in the direction that silently corrupts
every row.

### 18.1 Headers are not the signal. Content is.

The same file disproves header-matching twice over:

| Column | Header claims | Cells actually contain |
|---|---|---|
| 21 | "Follow -up **Status**" | dates — `25/1/2026` |
| 19 | "Expected **date**" | half dates, half prose |
| 13 | "**Name** of focal Point" | a person, not the entity |

A content profile over the same 22 columns classifies all three correctly,
including *declining* to treat col 13 as the entity name:

    1  Company Name           UNIQUE-ID/NAME   Bitumen Trading
    2  Group / Individual     ENUM(4)          Individual
    4  Audit status           ENUM(2)          Issued
    5  Service                ENUM(1)          Audit & Tax
    6  Planned auditor        ENUM(1)          Abdallah Kamel
    7  AUDIT 2025             MONEY            8,000
    16 Emails                 EMAIL            nazar@bitumentrading.com
    21 Follow -up Status      DATE             25/1/2026

**So: the header nominates, the content votes, and content wins ties.** The
primitives — email, phone, money, date, year, enum, free text, unique id — are
industry-neutral. "Audit status" is not a universal concept; "a column holding
two repeated values" is.

### 18.2 The three rules that keep this industry-agnostic

1. **Content-first classification.** Header text is one weak signal among
   several, never sufficient on its own. A header may only *raise* a candidate
   the cell content already supports.
2. **Enums are where the product asks.** A 4-value column may be a stage, a
   category, or a grouping. Nothing can distinguish those automatically, and
   guessing is precisely how col 13 happened. Propose, then require one
   confirmation.
3. **Nothing is ever discarded.** An industry we have not seen has columns we
   cannot name. `Inventory Count Needed`, `EL Status 2025`, `Position` must
   survive an import into a product that has no concept for any of them.
   **This is the whole answer to "how do we not limit Excel users."** The
   parser's job is to recognise what it can and *carry* what it cannot.

### 18.3 Decisions taken

**Unmapped columns become typed custom fields**, not a JSONB blob.
`project_field_defs` (per company: key, label, data type, enum options,
source column) + `project_field_values` (per project). A field is filterable,
sortable, showable as a projects-table column, editable after import, and
reusable by the next import. A blob would preserve the bytes and lose the
product: a firm that filters on "Inventory Count Needed = YES" every week
cannot do so against inert JSON.

**Enum values fuzzy-match, then require confirmation.** `Abdallah kamel` must
find `Abdallah Kamel`; case and whitespace drift is the norm in real files, not
the exception. But nothing is created until the user confirms the pairing.
Auto-creating unmatched values is explicitly rejected — a typo would become a
permanent duplicate user, which is #182's failure (66 unreachable tasks) with a
new face.

#### Shipped — the custom-field schema (branch `feat-project-custom-fields`)

`20260802_project_custom_fields.sql`. Two tables, three RPCs, one added column
on `rpc_projects_table`. Four decisions this section left open, settled by
building it:

**Values are four typed columns, not one TEXT column with a cast.**
`value_text` / `value_num` / `value_date` / `value_bool`, a CHECK that exactly
one is populated, and a BEFORE trigger that requires the populated one to match
the def's `data_type`. A cast at read time was rejected for the §13.2 reason: it
would surface the bad row to the *reader*, long after the writer that created
it. Filtering and sorting also want a real `numeric`/`date`.

**Deleting a def soft-deletes it and RETAINS its values.** §18.2 rule 3 applied
to the delete path — the entire reason this table exists is that unrecognised
data must survive, so "hide this column" must not destroy an import. Every
reader joins through `deleted_at IS NULL`, so a deleted field vanishes from the
API and from `rpc_projects_table` while its rows stay on disk. **Re-saving the
same key revives the same def id**, so the values come back — which is also what
makes a repeat import idempotent rather than a duplicate-def generator. No purge
RPC ships; add one when erasure is actually asked for.

**A populated field's `data_type` is frozen, and an in-use enum option cannot be
withdrawn.** Otherwise the def-edit path manufactures exactly the rows the value
trigger exists to refuse, and the type guarantee is a lie one `UPDATE` later.
Converting a populated field is a data migration, not an edit.

**`rpc_projects_table` carries them — no second RPC.** It already returns one
row per project and already aggregates three per-project CTEs; custom fields
ride along as a fourth, appended as `custom_fields JSONB` (object keyed by field
key, `{}` when empty). A separate reader would be a second request per table
page for data the first is already shaped to carry, and the two could disagree
about which defs are deleted. Signature unchanged; existing callers select by
name and are unaffected.

Visibility is `fn_project_accessible` on `project_field_values` (§13.14 — no
sixth definition; a custom field can hold a fee, a status or a contact, so
seeing it is the same disclosure as seeing the row). Field *defs* stay on the
company-wide policy — a column's name and type is not project data — which the
self-check asserts explicitly so it reads as a decision. `(company_id, key)` is
UNIQUE **partial on `deleted_at IS NULL`** per §13.6, so a deleted key is
reusable instead of burnt. No new permission key: `project.edit`.

`supabase/checks/check_project_custom_fields.sql` proves three-actor visibility
(owner / assignee-of-that-project-only / zero rows, not an error), cross-tenant
isolation in both directions including attaching company A's def to company B's
own project, type rejection through the RPC *and* through a direct INSERT that
bypasses it, and the retain-on-delete + revive semantics. Verified to have teeth
by breaking each guarantee in turn: a company-wide values policy fails (1b), a
disabled trigger fails (3b), cascading the values on delete fails (4b).

### 18.4 Row shape — the traps in the real file

Column classification is the interesting half; row handling is the half that
silently corrupts data.

- **Continuation rows.** Row 7 is `["", "Contracting W.L.L.", "", ...]` — the
  tail of row 6's company name, wrapped in the source. Imported naively it
  becomes a junk project named "Contracting W.L.L.". A row whose *only*
  populated cell is in the name column, following a populated row, is a
  continuation candidate and must be surfaced, not silently merged **or**
  silently imported.
- **Blank separator rows** (row 20) are structure, not data.
- **Multi-valued cells.** `Emails` holds
  `accounts& HR department <administration@...> , Sunil <sunil@...>` — two
  addresses, display-name form, comma-separated.
- **Money as text** — `"8,000"`, and the components do not reconcile with the
  stated total (row 3: 4,000 + 0 + 1,000 vs a TOTAL of 3,000). Import the
  numbers; never compute a "corrected" total silently. §13.9 again.
- **Ambiguous dates** — `25/1/2026`, `1/2/26`, `8/2/26`. DD/MM vs MM/DD cannot
  be resolved per-cell; resolve per-column by finding a value > 12 in the first
  position, and if the column is genuinely ambiguous, ask once for the column
  rather than guessing 400 times.
- **Case-variant entities** — `Abdallah Kamel` / `Abdallah kamel`.

### 18.5 Acceptance

Measured against the real file, not a fixture we wrote to pass:

1. Every one of the 22 columns is either mapped to a concept or created as a
   custom field. **Zero silently discarded.**
2. Projects are named from "Company Name", never from "Name of focal Point".
3. "Follow -up Status" is offered as a date; "Expected date" reports that half
   its cells are not dates rather than importing them as null.
4. The continuation row does not become a project without the user seeing it.
5. `Abdallah kamel` binds to the existing `Abdallah Kamel`, and nothing is
   created without confirmation.
6. Re-importing the same file with a saved mapping requires no re-mapping.
7. The self-check runs against this actual workbook, checked into the repo.

### 18.6 Shipped — the parser (branch `feat-spreadsheet-classifier`)

Pure functions only; extends `lib/imports/spreadsheetMapping.ts` rather than
adding a module beside it, and keeps its zero-`lib/supabase`/zero-xlsx
constraint so the self-check still runs under plain `npx tsx`. No UI, no
schema, no RPC — §18.3's `project_field_defs`/`project_field_values` are a
separate piece of work and this layer only hands them the candidates.

**The classifier.** `profileColumn`/`profileColumns` emit an industry-neutral
primitive per column — `email | phone | date | year | money | unique_id | enum
| freetext | empty | unknown` — each with a **coverage fraction over non-empty
cells** and a confidence, plus every runner-up candidate, the distinct count,
the enum vocabulary, and up to five cells the winner does *not* explain.
Coverage carries the weight §18.1 asked for: "Expected date" arrives as a date
column at **0.62**, not as a pass or a fail, and names the prose that did not
parse. The returned array is **dense and index-aligned**, so §18.5 #1's "zero
silently discarded" is structural rather than a promise — a caller iterating it
cannot skip a column, and `empty`/`unknown` are explicit reports, not absences.

**Header demoted to nomination.** `proposeColumnMapping` now profiles first and
reads headers second. `client_external_ref`/`start_date` need a supporting
content primitive **and** a header nomination (a file holds several date
columns and only the header says which one is meant); `name` is decided by
content ranking — unique, populated, textual — with the header able only to
re-rank columns that already qualify. `headerHintFor` records what the header
*wanted* even when content overrules it: "Proposed fee" nominates `money` and
profiles as `empty`, which is the rule made visible.

**Column context, a separate second pass.** `detectColumnRelations` reads the
column *sequence* and emits `sibling_group` / `total_of` / `contact_block` /
`single_period`. Prior art: Sherlock classifies columns in isolation and is
weak on the rarer types; Sato adds table- and neighbour-context for ~0.925 F1.
We are not doing ML — no corpus, no inference infra, and §15.3's confirmation
step covers the gap — but the finding transfers for free: `AUDIT 2025 |
ARABIC3 2025 | TAX | TOTAL A&T 2025` are four identical MONEY columns one at a
time, and a fee breakdown plus its total as a neighbourhood. `total_of` reports
`reconciles: false` and names the offending rows; it never computes a corrected
total (§18.4 / §13.9). Kept a separate function so a relationship can never
quietly change a column's primitive.

**Row shape.** `classifyRowShapes` returns `data | blank | continuation` for
every row, and `buildIntakeRows` carries `shape` on each `IntakeRow` — the
continuation row is neither dropped nor merged nor imported as a project, it
arrives tagged. Making `shape` a *required* field was deliberate: an optional
one is a flag every caller can forget.

**Dates.** `resolveDateOrder` decides DD/MM vs MM/DD **once per column** by
looking for a value > 12 in the first position, returns `'ambiguous'` when no
cell is decisive or cells contradict, and `undefined` when the column has no
slash dates so the question is never asked pointlessly. `parseDateValue`
deliberately does **not** fall through to `new Date(s)` — V8 reads "8/2/26" as
August 2nd in local time, which is exactly the per-cell guess §18.4 forbids.
`parseSpreadsheetBytes` feeds the resolved order into `buildIntakeRows`.

**Measured, on the real 22-column register.** 22/22 columns classified, 0
discarded, 0 `unknown`. `name` -> col 1 "Company Name" (*"values are unique,
96% populated"*), never col 13. "Follow -up Status" -> `date` at coverage 1.00
with order DMY, from content alone — its header nominates nothing. "Expected
date" -> `date` at 0.62, surfacing `1st week of January` / `still pending` /
`started`. One continuation row and one blank separator flagged. `total_of`
finds col 10 summing cols 7-9 and reports 8 non-reconciling rows. Ten columns
are marked `needsConfirmation` (seven enums, three free-text) — §18.2 rule 2,
and the same auto-suggest-then-require-review shape OneSchema and Flatfile
both ship.

**Deviation from §18.5 #7, deliberate.** The real workbook is **not** checked
in — it carries a client's company names, personal mobile numbers and personal
email addresses, and this repo is pushed to GitHub. `lib/imports/spreadsheetMapping.check.ts`
asserts against an **anonymised rebuild**: the 22 headers verbatim (trailing
spaces included), invented companies/people/emails/phones, and every structural
trap preserved — continuation row, blank separator, multi-valued display-name
emails, `"8,000"` text money, a non-reconciling total, a case-variant person
name, an all-empty column with a real header. The fixture is *stricter* than
the source in one place on purpose: its "Expected date" is genuinely ambiguous
(1/2/26, 8/2/26, 2/3/26 — nothing over 12) where the real file resolves DMY, so
both branches of the order question are covered. The real file was run through
the same code out-of-tree and produces the numbers above.

**Known ceilings, named in the code.** An Excel serial is just a number, so a
money column whose values all land in 20 000–80 000 reads as dates — the fix
belongs one layer up (`sheet_to_json` with `cellDates: true`), not in a better
range guess. Profiling samples the first 500 body rows, not all 5 000. And
`parseSpreadsheetBytes` still reads with `blankrows: false`, so `rowNumber` is
an index into the *compacted* sheet, not the user's row number — pre-existing,
and worth fixing when the UI starts quoting row numbers at people.

### 18.7 Measured on a multi-industry corpus — where it breaks

§18.6's 22/22 was measured on the one file the code was written while looking
at. That number cannot answer the question the product actually asks, which is
whether content-first classification generalises past a Qatari audit register.

`lib/imports/testCorpus/` answers it. Eleven invented workbooks from eleven
industries — construction buyout schedule, law firm matter list, marketing
campaign tracker (ES/EN), clinic appointment schedule, sprint plan (5 columns),
manufacturing work orders (40 columns), real-estate listings, freight shipment
register, an Arabic recruitment pipeline, a nearly-empty sheet and a
single-column sheet. 128 columns. Ground truth is authored in `corpus.ts`
beside each sheet, before the classifier is run over it; `generate.ts` writes
real .xlsx bytes and reads them back with production's own `sheet_to_json`
options, so what is measured is the pipeline and not a hand-fed array. No real
data: every company, person, email, phone, MRN and container number is invented.

    npx tsx lib/imports/testCorpus/benchmark.ts            # full report
    npx tsx lib/imports/testCorpus/benchmark.ts --wrong    # failures only
    npx tsx lib/imports/testCorpus/generate.ts out/        # the .xlsx files

**The score, 2026-08-02.**

| | |
|---|---|
| primitives correct | **92 / 128 (72%)** |
| entity name correct | **5 / 11 (45%)** |
| columns unclassified (`unknown`) | 6 |
| columns silently dropped | 1 (the single-column sheet, which never reaches classification) |
| date order correct / wrong / ambiguous | 3 / **0** / 2 |
| row-shape traps caught | **2 of 12** |

`corpus.check.ts` ratchets those numbers so they cannot quietly get worse.
They are a measurement, not a pass mark — 45% on the entity name is the number
§18.1 exists to fix, measured again outside the file it was fixed against.

**What is wrong, worst first.** Ranked by how much damage the failure does to a
real import, not by how many columns it touches.

1. **A non-Latin-script sheet loses its name column and every text column.**
   `textual` and the free-text coverage test use `/[a-z]/i`; the identifier test
   uses `/[a-z0-9]/i`. All three are ASCII-only. In the Arabic recruitment
   pipeline col 0 `الاسم` (nine unique candidate names) profiles as **`unknown`**,
   as does col 8 `ملاحظات` (prose). Because no Arabic column can be `textual`, the
   entity name falls to col 2 `المصدر` — the *source* column — and every
   candidate imports named **"LinkedIn"** or **"Referral"**. Emails, phones,
   dates and money in the same sheet all classify correctly, which is what makes
   this so sharp: content-first works, the content test just cannot read the
   script. Any Arabic, Chinese, Cyrillic or Greek register is affected. The
   original audit file hid this because its Arabic-speaking firm typed Latin.

2. **The classifier invents an entity name when the sheet has none.** The clinic
   schedule identifies patients by numeric MRN; every other column is a repeated
   vocabulary. `rankEntityNameColumns` accepts `enum` columns as candidates, so
   it returns col 2 "Provider" — 3 distinct values over 14 rows — and every
   appointment imports named **"Dr. Reyes"**. This is §18.1's failure with a new
   face, and unlike an enum column the name proposal carries no
   `needsConfirmation`. Declining to name anything is a behaviour the corpus
   asserts and the code does not have.

3. **An entire US-format date column silently becomes a confident identifier.**
   Coverage is measured with `looksLikeDateCell`, which calls `parseDateValue`
   with the **DMY default**, before `resolveDateOrder` ever runs. A MM/DD column
   whose days are mostly past the 12th fails its own date test. Construction col
   8 "Sub Completion" (`04/30/2026`, `08/15/2026`, …) → **`unique_id`, coverage
   1.00, confidence 0.85, `needsConfirmation: false`**. Col 11 "COI Exp" →
   `unknown`. Col 7 "NTP" in the same sheet *survives* at coverage 0.62 purely
   because 6 of its 10 dates land on the 1st–12th. Whether a US date column
   imports at all is decided by which days of the month the file happens to
   contain. The fix belongs in the profiler: resolve the order first, or measure
   coverage under both orders and keep the better.

4. **A "Ref" header eats the entity name column.** Freight col 0 "Ref"
   (`SHP-26-0441`) is `unique_id` and header-nominated, so `client_external_ref`
   claims it; claimed columns are excluded from name ranking, and the entity name
   lands on col 1 "BOL". The register has no client in it at all. Two wrongs from
   one nomination: a client external ref invented out of the shipment's own key,
   and every shipment named by its bill of lading.

5. **Any all-distinct numeric column becomes an identifier.** `uniqueCov` has no
   type test — distinct values, ≥3 rows, ≥50% filled, ≥50% alphanumeric, no zero
   — and `unique_id` outranks `money` in `PRIMITIVE_PRIORITY`. Eleven columns:
   "List Price" (`$1,250,000`), "DOM", "WIP", "Pcs", "Wgt (kg)", "Freight"
   (`USD 18,400`), "Qty Ord", "Qty Comp", "Run Hrs", "Std Hrs", "Var Hrs",
   "Lab Cost". Law col 9 "A/R" classifies as money **only because it contains a
   literal `0`**, which blocks the unique test. So whether a fee column keeps its
   numeric identity depends on whether two rows happen to share a value — the
   audit register scored 22/22 partly because its fees repeat.

6. **A hyphenated code with 7–20 digits is a phone number.** `segmentIsPhone`
   accepts anything containing `+`, `(`, `)`, `-` or a space with 7–20 digits,
   and a bare integer at 7–12. `phone` is second in priority, above `date`,
   `unique_id` and `money`. Law col 0 "Matter No" (`2026-0114`) → **phone**.
   Manufacturing col 30 "Lot" (`L-2026-0033`) → **phone**. Real-estate col 0
   "MLS #" (`1188402`) → **phone**. The register's primary key is offered to the
   user as a contact number.

7. **Totals, subtotals and footer rows import as projects.** 6 of the 12 row
   traps. `RowKind` has no concept for them. Construction's "TOTAL" row, freight's
   and law's "TOTALS", manufacturing's "Line 1 subtotal" and "GRAND TOTAL", and —
   worst — marketing's "Subtotal Q1" and "TOTAL", which sit **in the name
   column** and therefore import as two campaigns called `Subtotal Q1` and
   `TOTAL`. `detectColumnRelations` finds a total *column*; nothing reads rows.

8. **The continuation guard is silently disabled by a wrong name column.** It
   caught both continuation rows here (2 of 2) — but only because the name
   resolved correctly in those two files. `classifyRowShapes` tests
   `onlyCol === nameColumn`, so in any of the six files where the name is wrong
   the guard is off and a wrapped cell becomes a nameless project. Construction
   nearly demonstrated it: the name landed on "Subcontractor" over "SOW Ref" by a
   0.15 score margin, decided by one subcontractor appearing twice.

9. **Blank separator rows never reach the classifier.** `parseSpreadsheetBytes`
   reads with `blankrows: false`, so all 3 authored blank rows were deleted
   before `classifyRowShapes` saw them — `RowKind='blank'` is unreachable in
   production — and every `rowNumber` below a blank row is off by the number of
   blanks above it. §18.6 named the row-number half of this; the corpus confirms
   both halves.

10. **A single-column sheet is rejected outright.** `detectHeaderRow` needs ≥2
    filled cells, so a one-column list of eight project names returns -1 and the
    import dies on "Could not find a header row". That is the single most common
    shape of a hand-made list, and it is the one file in the corpus where a
    column is genuinely discarded.

11. **Money outside the US/UK dialect is unreadable.** Marketing col 6
    `€ 12.500,00` (European decimal separators) and col 7 `8.4k` / `22k`
    (shorthand) both fail `MONEY_RE`. Currency *prefixes* work — `USD 18,400`,
    `QAR 3,600`, `EUR 6,150` all parse — so the gap is separators and shorthand,
    not currencies.

12. **Percentages have no primitive.** `MONEY_RE` rejects a trailing `%`.
    Construction col 10 "% Comp" → `unknown`, col 6 "Retention" → `enum`;
    manufacturing col 26 "Yield" → `unknown`; marketing col 8 "ROI" is swept up by
    finding 5.

13. **Month-granular dates are not dates.** `TEXT_DATE_RE` requires a day, so
    freight col 6 "ETA" (`Feb-26`, `Mar-26`) → `freetext`. An ETA in a shipping
    register is normally a month.

14. **`1/0` and small numeric vocabularies read as money.** Manufacturing col 28
    "QA Pass" (1/0) and col 9 "Shift" (1/2/3) → `money`, because `money` outranks
    `enum`. `Y/N`, `TRUE/FALSE` and `✓` all classify correctly as enums — only the
    numeric boolean dialect fails. There is no boolean primitive.

15. **The enum ratio is a cliff, not a slope.** `distinct * 2 <= filled`: freight
    col 8 "POD" (5 port codes over 8 rows) → `freetext`; manufacturing col 1
    "Part No" (5 parts over 10 rows) → `enum`. The same kind of column, opposite
    answers, decided by how many rows the file has.

16. **A few placeholders demote an id column.** Freight col 9 "Ctr#" — five
    container numbers and three `—` placeholders — → `freetext` at 0.63.

**What held up, and must survive the fixes.**

- **Zero columns dropped** in all ten files that reached classification. §18.5
  #1's structural promise generalises exactly as claimed.
- **Zero wrong date orders.** Every resolvable column resolved correctly (3) and
  every undecidable one was flagged `ambiguous` rather than guessed (2) —
  including the clinic column where *every* value is ≤ 12. The per-column
  decision in §18.4 is the part of this design that most clearly works.
- **The §18.1 trap does not reproduce.** Real-estate has a column literally
  headed **"Name"** holding the listing agent; content correctly rejected it and
  chose "Address" instead. Construction's entity name is neither leftmost nor
  called "name" and was still found.
- **Header-row detection is robust**: a title banner, a printed-revision line, a
  merged two-row group header, a leading blank column and blank rows above the
  table — the right header row was found in all ten.
- **Excel serial dates work** (manufacturing's three date columns, raw numbers).
- **The small-vocabulary registers are clean**: clinic 10/10, sprint 5/5,
  nearly-empty 3/3.

**Nothing in this section was fixed.** The corpus and the benchmark are
deliberately separate work from any change to `spreadsheetMapping.ts` — a
measurement written by the same pass that patches the thing being measured is
worth nothing. Findings 1, 2 and 3 are the ones that corrupt data without ever
asking the user a question, and are where a fix should start.

---

## 19. Phase 11 — the import journey (Phase 9's UX debt)

Phase 9 built a correct engine and shipped it behind a flow nobody can follow.
Both times a user opened it they got stuck, and both times the cause was the
same shape: **the screen states a problem it will not let you solve.**

### 19.1 The evidence, not opinion

Two dead ends found within minutes of the first real use:

1. **Setup step.** `canProceedToConfigure` required `pastLines.length === 0`
   and said "Fix the date on the previous step to continue." For imported rows
   there is no per-row date editor on any previous step — they are
   deliberately read-only so a stray edit cannot diverge from what was
   confirmed upstream. The user was told to fix something unreachable. It also
   fires on the NORMAL case: you import last year's register, so every dated
   row is behind today by construction. Fixed in a2c269f by making past dates
   a choice — keep as historical, or clear and let the batch anchor supply them.
2. **Configure step.** The SAME hard block, re-worded as "Per-item override(s)
   in the past ... Fix the date on the previous step", on a screen whose
   previous step does not offer that fix either. One instance was fixed; the
   pattern was not.

**The organising rule for this phase:** a validation that blocks must name the
field, the reason and the remedy, and the remedy must be reachable from where
the message appears. "Fix it somewhere else" is not a remedy, it is a dead end
with punctuation.

### 19.2 What is wrong with the journey

- **No map.** Import, review, setup, configure, create is four decisions deep
  with no indication of where you are, what remains, or what is still needed.
  Configure shows 21 projects, 4 category-to-board pickers and a schedule
  anchor at once, all at equal weight, with the primary button disabled and no
  statement of which of the three is blocking it.
- **Vocabulary the user does not share.** Category, board, schedule anchor,
  per-item override, batch — none defined in the UI. Section 17 already named
  this: users cannot distinguish portfolio / project / pipeline / task, and
  this flow adds four more terms on top.
- **Nothing explained at the point of confusion.** DUE BY / STARTS ON changes
  the meaning of every date in the batch and is two unlabelled toggles. "Tasks
  are due on their researched offset from this date" is not actionable.
- **Errors are red text, not states.** The past-date block renders as a
  paragraph of names above the list, disconnected from the rows it names,
  while those same rows are also outlined in red below — the same information
  twice, in two idioms, neither actionable.
- **No preview of the outcome.** "21 projects, 294 tasks pending board +
  schedule configuration" appears before the user can judge whether 294 is right.

### 19.3 Scope

1. Every blocking validation gets field, reason, remedy, and the remedy
   reachable in place. Audit all of them; the two found are unlikely to be all.
2. A visible spine — where am I, what remains, what is blocking the button
   right now. A disabled primary must always be able to say why.
3. Define the vocabulary in place, inline, not as a docs link.
4. Errors attach to their rows, once, with the fix inline.
5. Show the outcome before committing, for a sample project.
6. 390px is not an afterthought. This flow has only been looked at on desktop.

### 19.4 Open defect carried into this phase

**Dates render swapped in the batch list.** 8/2/26 displays as "Aug 2",
3/2/26 as "Mar 2", 10/2/26 as "Oct 2", while 15/2/2026 and 28/2/2026 render
correctly — because a day above 12 cannot be misread as a month. That is the
signature of a `new Date("8/2/26")` somewhere, which parses M/D/Y.

The data is NOT corrupt. The full path — proposeColumnMapping,
buildColumnDecisions, dateOrderFor (resolves DMY), buildIntakeRows — was
replayed against the real workbook and produces 2026-02-08 for JREIJ. The swap
is at render, downstream of correct data, and is not reproducible headlessly;
it needs the running app instrumented.

Worst class of bug in an import tool: silently wrong on half the rows (only
days <= 12 can swap) and invisible to anyone not checking against the source.

---

## 20. Phase 12 — projects get the pipeline ENGINE, not just a stage column

Phase 2 gave projects `pipeline_id` and `current_stage_id` and called them
pipeline-driven. They are not. Measured:

    rpc_advance_project_stage  ->  UPDATE public.projects   (the entire body)
    rpc_execute_stage_action   ->  23 references to gates, notifications,
                                   transitions and actions

Every piece of pipeline machinery is task-only:

    rpc_process_automations              TASKS ONLY
    rpc_create/update/delete_automation  TASKS ONLY
    rpc_execute_stage_action             TASKS ONLY
    rpc_add/update/delete_stage_action   TASKS ONLY
    rpc_add/update/delete_transition     TASKS ONLY
    fn_auto_stop_timers_on_transition    TASKS ONLY
    rpc_review_by_transition             TASKS ONLY

A project pipeline therefore has stages and history, and no action buttons that
execute, no automations, no gates (requires_submission, requires_timer,
preconditions), no transition notifications and no timer auto-stop. A user
configuring a project pipeline sees the same editor as a task pipeline and gets
a fraction of the behaviour, with nothing saying so.

### 20.1 The decision this phase needs first

**Do projects get the full engine, or a deliberately reduced one?** They are
not the same kind of thing: a task is worked by a person and has a timer, a
project is a container whose progress is the aggregate of its tasks. Some
concepts port directly (transitions, actions, notifications, preconditions),
some are questionable (requires_timer on a project — a project must never
become a timer target, per the existing rule), some need redefining
(requires_submission: whose submission?).

Building the full engine and then discovering half of it is meaningless for
projects is the expensive order.

### 20.2 Whatever is decided, one rule

**The pipeline editor must not offer a control that does nothing for the
subject kind it is editing.** `pipelines.subject_kind` already exists
(20260731_pipeline_subject_kind.sql); the editor ignores it and shows every
control regardless. That is how a user configures a gate on a project pipeline
and never learns it was never enforced. Silent no-ops are worse than absent
features.

### 20.3 Blocks Phase 10

Section 16 assumes stage transitions mean something — blocked, on pace and
projected end are all derived from stage movement. If advancing a project stage
is a bare column write with no gates and no events, those numbers rest on
nothing. Phase 12 lands before or with Phase 10.

### 20.4 DECIDED — automations and notifications only, and hide the rest

Decision taken: **projects do NOT get the full pipeline engine.** A full
project pipeline is overkill and would confuse users who already cannot
distinguish portfolio / project / pipeline / task (§17). What ships:

**IN — automations and notifications.** These are the two that make a project
stage mean something operationally: the firm finds out a project moved, and a
project that sits too long moves itself.

**DEFERRED — gates, action buttons, review-by-transition.** Good QOL, not now.
`requires_timer` is not merely deferred but probably wrong forever: a project
must never become a timer target, per the existing rule. `requires_submission`
needs redefining before it can be built — whose submission, when a project's
work is its tasks?

**Reframing that makes this small:** projects ALREADY have stages —
`pipeline_id`, `current_stage_id` and trigger-written `project_stage_history`
all shipped in Phase 2. Nothing here adds a pipeline concept to projects. The
only question was what FIRES on a stage change, and the answer is: two things.

### 20.5 Why this is cheaper than it sounds

**Notifications are trigger-based, not inline.** `fn_emit_notification_event`
(5 args) is the shared entry point and `fn_trg_tasks_notify_update` /
`fn_trg_task_assignments_notify` / `fn_trg_task_comments_notify` fire from
table triggers — `rpc_execute_stage_action` does not create notifications
itself. So a project stage-change notification is ONE trigger on `projects`
calling the same entry point, mirroring the task trigger. Existing pattern,
extended; no new machinery. (See the first rule of
`.agents/rules/global-utilities-index.md`.)

**Automations need no schema change.** `pipeline_automations` keys on
`pipeline_id` + `source_stage_id` + `target_stage_id`, and projects use the
SAME `pipelines` / `pipeline_stages` tables — `subject_kind` is what
distinguishes them. So the rows already point at stages that may be project
stages; `rpc_process_automations` simply never looks at projects.

**But know what "automations" currently means.** `rpc_process_automations`
understands exactly ONE `condition_type`: `'overdue'`. The engine is thinner
than the name suggests. Extending it to projects means "a project that has sat
in a stage past its due date moves on" — that is the whole feature today, and
the scope should say so rather than implying a rules engine exists.

### 20.6 Non-negotiable: stop offering what does not work

Deferring gates and actions is only safe if the editor STOPS SHOWING them for
project pipelines. `pipelines.subject_kind` already exists
(20260731_pipeline_subject_kind.sql) and the editor ignores it, rendering every
control regardless of subject. Today that means a user can configure a
`requires_submission` gate on a project pipeline, save it, and never learn it
was never enforced.

**A silent no-op is worse than an absent feature**, and it is worse than the
bug it hides: the user believes the gate is protecting them. So §20.2's rule is
part of THIS phase's definition of done, not a follow-up — the controls that do
nothing for `subject_kind = 'project'` are hidden or disabled with a reason, in
the same change that ships the two that work.

### 20.7 SHIPPED — `20260803_project_stage_engine.sql`

**Notifications.** `trg_projects_notify_stage` (`AFTER UPDATE OF
current_stage_id ON projects`, WHEN clause copied from
`trg_projects_stage_history` so the event and the history row can never
disagree about what counts as a move) calls `fn_emit_notification_event` with
`project.stage_transition`, mirroring `fn_trg_tasks_notify_update`. It honours
the same `trustflow.bulk_instantiate` suppression the task triggers use. A
seeded `notification_rules` row consumes it via a new `payload_users` strategy
in `process-notification-event`.

**Who hears about it.** Everyone for whom `fn_project_accessible` is true —
in practice the owner, anyone assigned a task in it, and every
`project.view_all` holder, because those are that predicate's three branches.
`fn_project_stage_notify_recipients(p_project_id)` resolves the list at emit
time and puts it in the payload. It does NOT re-derive the rule: it enumerates
the whole company as candidates and filters each through
`fn_project_accessible` evaluated as that user (`request.jwt.claims` +
the legacy `request.jwt.claim.sub`, both saved and restored). The candidate set
is deliberately the widest possible one so it can never be the thing that
decides access — §13.14 stays one predicate, five call sites.

Recipients are resolved in the DB rather than by the Edge Function because
`fn_project_accessible` is `auth.uid()`-bound and a service-role client cannot
evaluate it — and because that is what makes the guarantee provable from SQL.

**Automations.** `pipeline_automations` needed no change, exactly as §20.5
predicted; `rpc_create/update/delete_automation` are already subject-agnostic.
`rpc_process_automations` now branches on `pipelines.subject_kind` and reads
`projects.due_date` where the task branch reads `tasks.due_date`. `'overdue'`
is still the ONLY `condition_type` the processor understands, for tasks as
well — `'idle'` and `'due_soon'` are accepted by `rpc_create_automation` and
never evaluated, so `AutomationEditor` now shows them disabled with that
reason rather than pretending. One schema change was needed after all, to the
LOG table, not to `pipeline_automations`: `automation_execution_log.task_id`
was `NOT NULL` and backs the 3-fires-per-hour circuit breaker, so `task_id` is
now nullable, `project_id` joins it, and a CHECK keeps exactly one populated.

Note that nothing schedules `rpc_process_automations` — there is no `pg_cron`
entry for it, for tasks either. Projects will not actually self-advance until
something calls it.

**§20.6.** `StageBuilder.tsx` and `StageBuilder.web.tsx` both hide, for
`subject_kind='project'`: the submission gate, requires-timer + minimum timer,
business hours, re-assign on entry, recursive spawning, manager routing / max
escalation depth, and stage actions. `ProjectStageNote.tsx` (shared by both, so
a native-only fix cannot be mistaken for a fix) stands in their place and says
what a project stage does instead. `graph/StageNode.tsx` stops badging
`requires_submission` / `requires_timer` / `linked_pipeline_id` on a project
stage — a stage already carrying those flags from before this change would
otherwise still be making the promise the editor stopped making.

Nothing to do for review-by-transition: `pipeline_stage_transitions` has no
review flag, and transitions themselves ARE enforced for projects
(`rpc_advance_project_stage` validates the path), so `TransitionEditor` stays.

Self-check: `supabase/checks/check_project_stage_engine.sql`.
