# Client-scoped custom fields — implementation plan

**Issue:** #199 — "Same client, two engagements: client data is copied per project instead of shared"
**Amends:** `docs/PROJECT_HIERARCHY_PLAN.md` §18.3 (typed custom fields). Add a `§13.19` pointer there.
**Status:** Phase 1 built on branch `feat/199-client-scoped-fields` (uncommitted →
committed, not pushed — user tests locally). Phases 2–3 follow Phase 1's schema.

---

## 1. Problem, restated

Custom field *values* are stored strictly per project (`project_field_values.project_id`).
The spreadsheet importer has nowhere else to put a client's contact card — focal
point, email, position, mobile — so it writes those onto every project for that
client. The real engagement register produced 21 copies of one phone number, each
independently editable, none authoritative. Add a tax engagement per client and it
is 42. This is the same silent-drift failure the repo has already paid for in
`fn_project_accessible`, `UploadManagerContext`, the two upload paths and the
diverged board pickers.

`clients` already exists (`company_id`, `name`, `external_ref`, `notes`,
`standing_folder_id`) and `projects.client_id` already points at it. What is
missing is any notion of what a custom field is *about*.

## 2. What exists today (traced 2026-09-02)

| Piece | State |
|---|---|
| `project_field_defs` | per-company def table (`20260802_project_custom_fields.sql`), later gained `format` (`20260804`). RLS: **company-wide** select. `data_type` frozen while values exist. |
| `project_field_values` | PK `(project_id, field_def_id)`, four nullable typed columns + one-value CHECK, `company_id` denormalized by `trg_project_field_value_typecheck`, `updated_at` maintained by that trigger. RLS select: `fn_project_accessible(project_id)`. |
| `rpc_save_project_field_def` | upsert keyed on `(company_id, key)`; `p_id` only to rename. Freezes `data_type` / in-use enum options while values exist. `project.edit`. |
| `rpc_delete_project_field_def` | soft delete, values retained. |
| `rpc_set_project_field_values` | bulk `[{project_id, field_def_id, value}]`; `null`/`''` clears. `project.edit`. Casts are the type enforcement's public face. |
| `rpc_projects_table` | `custom` CTE → `custom_fields JSONB` (keyed by field key). Patched twice from live body since last full CREATE — **never retype it**, use `pg_get_functiondef` + anchored `replace()` + explicit `DROP FUNCTION` (overload trap: `20260802_drop_stale_stage_rpc_overloads.sql`). |
| `fn_project_field_matches(p_project_id, p_filter)` | `20260803_projects_table_field_filter.sql`. `eq` / `set` / `unset`. Regex-guards `::NUMERIC`. |
| `hooks/useProjectFields.ts` | `useProjectFieldDefs`, `useProjectFieldValues` (direct PostgREST select), `saveFieldDef` / `deleteFieldDef` / `setProjectFieldValue`. Pure half in `lib/projectFields.ts`. |
| `components/projects/ProjectFieldsCard.tsx` | "Imported columns" section on project Overview; inline + popup edit. |
| `components/projects/ManageProjectFieldsPopup.tsx` | add / edit / reorder / soft-delete defs. First UI to call update/delete. |
| Importer | `lib/imports/importPlan.ts` `buildColumnDecisions` → `customFieldPlans` → `SpreadsheetImportSheet.tsx` `persistCustomFields` (runs *after* `rpc_instantiate_template`, keyed by spreadsheet name). Parser (`lib/imports/spreadsheetMapping.ts`) classifies `email` / `phone` / `unique_id` content primitives with confidence. |
| `clients` | `(company_id, name)` UNIQUE, company-wide RLS (`20260731_project_hierarchy_4_rls_placeholder.sql`). Created *only* by `rpc_instantiate_template`'s `ON CONFLICT (company_id, name) DO NOTHING` upsert. **No client detail screen. No client-update RPC.** |
| `projects.client_id` | FK → `clients`, set at instantiate from `client_ref` name match. |

## 3. Decisions

### 3.1 RLS on client-scoped values → company-wide select

Mirror `project_field_defs_select` and the existing `clients_select`
(`company_id = my_company_id() AND deleted_at IS NULL` shape). A client's
contact card is *already* company-visible — the `clients` row is — so its
custom fields being the same is consistent and needs no new predicate. The
issue's "wider disclosure than `fn_project_accessible`" note is already the
status quo for `clients` itself. If per-client visibility is ever wanted, it is
the same open question §11 left for `clients` / `portfolios` / `templates`, and
should be answered for all of them at once, not invented here.

### 3.2 The Phase 1 migration moves zero rows

`scope` is added to `project_field_defs` **defaulting to `'project'`** — every
existing def and value is untouched, every existing reader keeps working. New
imports stop creating the duplication (this is part 1's actual job per the
issue: "part 1 should ship first or the export will faithfully copy the
duplication around").

Promoting an *existing populated* field to client scope — the "21 copies
disagree, do not silently pick" open question — is a **separate, explicit RPC
with a dry-run conflict preview**, in Phase 2. Phase 1 therefore contains no
unreviewable data decision.

### 3.3 One def table, value storage forks by scope

`project_field_defs` stays the single definition table (`scope` is just another
column). Only *values* fork:

- **Option A (chosen):** new table `client_field_values`, PK
  `(client_id, field_def_id)`, otherwise a structural copy of
  `project_field_values` (same four typed columns, same one-value CHECK, same
  denormalized `company_id`, same `updated_at`). Trigger is the existing
  typecheck trigger with `clients` swapped for `projects`.
- **Option B (rejected):** make `project_field_values.project_id` nullable, add
  nullable `client_id`, CHECK exactly one. Rejected: breaks the
  `(project_id, field_def_id)` PK, and every existing reader filters
  `v.project_id = …` so would silently skip client rows until rewritten anyway
  — Option A's "new table, existing project readers untouched" is the smaller
  real diff.

A field is exactly one scope, never both, so there is **no per-project override
of a client value** — each def routes to one value source by its `scope`. No
merge/precedence logic anywhere.

### 3.4 One writer, one filter predicate — extended, not duplicated

`rpc_set_project_field_values` accepts `client_id` as an *alternative* key in
each array element (`{client_id, field_def_id, value}` vs
`{project_id, field_def_id, value}`). Optional addition, existing callers
unaffected. `fn_project_field_matches` and the `rpc_projects_table` `custom` CTE
each gain one client-scoped leg resolved through `projects.client_id`. Field
keys are globally unique per company (`project_field_defs_company_key_live`), so
project-scoped and client-scoped values merge into one `custom_fields` object
with no collision.

### 3.5 No client detail screen

Client-scoped fields are viewed and edited from *any* of that client's project
detail cards, badged as shared. A focused "Edit <client>'s shared details"
Popup (Phase 3) is as far as this goes. `clients.standing_folder_id` already
covers the files angle — nothing new there.

---

## 4. Phase 1 — scope mechanism for new fields

### 4.1 Migration `supabase/migrations/20260902_project_field_scope.sql`

1. `ALTER TABLE public.project_field_defs ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'project'`
   + `CONSTRAINT project_field_defs_scope_ck CHECK (scope IN ('project','client'))`
   (idempotent `DO $ck$` guard, same shape as `project_field_defs_format_ck`).
2. `CREATE TABLE public.client_field_values` — structural copy of
   `project_field_values` with `client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE`
   replacing `project_id`, PK `(client_id, field_def_id)`, same
   `client_field_values_one_value_ck`. Index on `field_def_id`. RLS enabled.
3. `CREATE FUNCTION public.trg_client_field_value_typecheck()` — the body of
   `trg_project_field_value_typecheck` with `projects` → `clients`,
   `NEW.project_id` → `NEW.client_id`, and the def lookup additionally
   asserting `d.scope = 'client'` (a project-scoped def must never get a
   client value, and vice versa — enforce both directions). `BEFORE INSERT OR
   UPDATE` trigger.
4. RLS: `CREATE POLICY client_field_values_select ON public.client_field_values
   FOR SELECT USING (company_id = my_company_id())`. No write policies — RPC
   only, same convention as the project table.
5. `rpc_save_project_field_def` — add trailing `p_scope text DEFAULT NULL`.
   **Patch from the live body** (`pg_get_functiondef` → four anchored
   `replace()` calls → `DROP FUNCTION public.rpc_save_project_field_def(text, text, text, text[], text, integer, uuid, text)` → `EXECUTE`),
   exactly the mechanic in `20260804_project_field_display_format.sql`. New
   behaviour: on an UPDATE where `p_scope` differs from the stored scope AND
   `EXISTS` any value row (in either value table) → `RAISE EXCEPTION 'Cannot
   change the scope of custom field "%" while it has values — use
   rpc_promote_field_to_client_scope.'`. Re-`REVOKE`/`GRANT` the new 9-arg
   signature. `DO $verify$` asserts exactly one signature and that the
   frozen-type / in-use-enum guards survived the patch.
6. `rpc_set_project_field_values` — patch from live body. Each element may carry
   `client_id` **or** `project_id`. Build the temp table with both nullable;
   `RAISE EXCEPTION` if an element has neither or both. Accessibility check:
   project rows keep `fn_project_accessible`; client rows check
   `EXISTS (SELECT 1 FROM clients WHERE id = client_id AND company_id = my_company_id() AND deleted_at IS NULL)`.
   Def-scope check: a `client_id` element's def must be `scope='client'`, a
   `project_id` element's def must be `scope='project'` — else "Custom field
   not found." The DELETE-clears and the typed-cast UPSERT each split into a
   project branch (unchanged) and a `client_field_values` branch. Return
   `{set, cleared}` summed across both.
7. `rpc_projects_table` — patch from live body. Extend the `custom` CTE: keep
   the project leg, `UNION ALL` a client leg
   (`FROM client_field_values v JOIN project_field_defs d … WHERE d.scope='client'`)
   producing `(project_id := p.id via clients join, key, value_json)`; the
   `jsonb_object_agg` then folds both. Simplest concrete shape: a
   `client_custom` CTE keyed by `client_id`, then in the final SELECT
   `COALESCE(cfv.fields, '{}') || COALESCE(ccf.fields, '{}')` joined via
   `p.client_id`. `DO $verify$` asserts one signature and that `custom_fields`
   + "Needs attention" + `p_field_filters` all survived.
8. `fn_project_field_matches` — `CREATE OR REPLACE` (SQL, body-only, signature
   unchanged). Each of the `eq` / `set` / `unset` branches gets its
   `project_field_values` EXISTS `UNION`-ed with a `client_field_values` EXISTS
   resolved via `(SELECT client_id FROM projects WHERE id = p_project_id)` and
   `d.scope='client'`.
9. Wiring `DO $$` self-check at the tail: column exists, table + trigger +
   policy exist, `fn_project_field_matches(NULL, …)` still returns without
   error, every patched RPC has exactly one signature.

### 4.2 Check `supabase/checks/check_client_scoped_fields.sql`

`BEGIN … ROLLBACK`, seeded company, `SET LOCAL ROLE authenticated` for the RLS
assertions, direct-`postgres` insert for the trigger assertions — same
conventions as `check_project_custom_fields.sql`. Prove:

1. A client-scoped value written once against `client_id` is returned by
   `rpc_projects_table.custom_fields` for **every** project of that client, and
   by `fn_project_field_matches` for each.
2. `trg_client_field_value_typecheck` refuses: wrong typed column, two columns
   at once, a def from another company, and a `scope='project'` def.
3. `rpc_set_project_field_values` refuses an element with both keys / neither
   key, and a `client_id` element whose def is `scope='project'`.
4. Company-B owner can neither read nor write company-A client values.
5. `rpc_save_project_field_def` refuses a scope flip once a value exists.
6. Re-import idempotency: saving the same def twice with the same `p_scope`
   does not duplicate and does not error.

### 4.3 Frontend

| File | Change |
|---|---|
| `lib/projectFields.ts` | `FieldScope = 'project' \| 'client'`; export it. No formatting change. |
| `hooks/useProjectFields.ts` | `ProjectFieldDef.scope`; add `scope` to `DEF_COLUMNS`. `useProjectFieldValues(projectId)` also selects the project's `client_id`, then fetches `client_field_values` for that client and merges — each def keyed by `scope` decides which map it reads. Expose `clientId` so the card can write. `saveFieldDef` passes `p_scope`. `setProjectFieldValue` gains an overload/param `{ clientId }` that sends `client_id` instead of `project_id`. |
| `components/projects/ProjectFieldsCard.tsx` | client-scoped rows show a small "shared · all of <client>'s engagements" badge (Tooltip). Editing a client-scoped value routes through `useAlert().showConfirm` first ("This changes every project for this client."). Reads `clientId` from the hook; a client-scoped field on a project with no `client_id` renders read-only with "no client linked". |
| `components/projects/ManageProjectFieldsPopup.tsx` | scope segmented control in the add/edit form (default Project). Disabled with a tooltip once the def has values → "Promote from the field's row" (Phase 2 action; until then the tooltip just explains). |
| `lib/imports/importPlan.ts` | `ColumnTarget` `custom` variant + `CustomFieldPlan` gain `scope: FieldScope`. In `buildColumnDecisions`, a *new* custom column defaults `scope='client'` when `profile.primitive ∈ {email, phone, unique_id}`, else `'project'`. A column matched to an existing def inherits that def's scope. `customFieldPlans` carries it through. |
| `components/projects/SpreadsheetImportSheet.tsx` | Review step: per custom column, a Project/Client scope toggle (pre-filled from the plan, with a one-line "looks like client info" hint when auto-set to client). `persistCustomFields`: pass `p_scope`. For client-scoped plans — after instantiate, resolve each created project's `client_id` (one `select id, client_id from projects where id in (…)`), group values by `client_id`, write **once per client** via `client_id` elements. If two source rows for one client disagree on a client-scoped field, keep the last and `errorToast` naming the client + field (`// ponytail: last-row-wins on intra-import client conflict; upgrade to a merge-review step if firms report bad collisions`). |
| `lib/imports/spreadsheetIntake` re-exports | add `FieldScope` where `FieldDataType` is already surfaced, if the importer imports it from there. |

### 4.4 Phase 1 acceptance

- [x] Migration `20260902_project_field_scope.sql` — `scope` column + CHECK,
  `client_field_values` (+ typecheck trigger both directions + company-wide RLS),
  and the anchored patches to `rpc_save_project_field_def` (+`p_scope`),
  `rpc_set_project_field_values` (client_id elements + scope discipline),
  `rpc_projects_table` (`client_custom` CTE folded into `custom_fields`) and
  `fn_project_field_matches` (client leg per branch). Applied to local; every
  `DO $verify$` / overload trap passes.
- [x] Self-check `check_client_scoped_fields.sql` — all six §4.2 points pass
  locally.
- [x] `check_project_custom_fields.sql` still passes (shared RPCs unchanged in
  behaviour).
- [x] Frontend: `FieldScope` type + re-exports; `useProjectFields` (scope on
  def, `useProjectFieldValues` merges `client_field_values` by the project's
  client, exposes `clientId`, `saveFieldDef`→`p_scope`, `setProjectFieldValue`
  `{ clientId }` path); `ProjectFieldsCard` (shared badge + Tooltip,
  `useAlert().showConfirm` before a client-scoped edit, client-less project
  renders read-only); `ManageProjectFieldsPopup` (Project/Client segmented
  control, locked+explained once the def has values); `importPlan`
  (`scope` on the `custom` target / `CustomFieldPlan`,
  `defaultScopeForPrimitive`, matched columns inherit the def scope);
  `SpreadsheetImportSheet` (per-custom-column "Belongs to" toggle in Review,
  `persistCustomFields` passes `p_scope` and writes client-scoped values once
  per resolved `client_id`, last-row-wins with a conflict `errorToast`).
- [x] `npx tsc --noEmit` — no new errors in any touched file (repo baseline has
  163 pre-existing, unchanged).
- [x] `npm run check` — 35/35 (adds two `importPlan.check.ts` scope assertions).
- [ ] Importer walked in a browser at 1400px and 390px — **pending** (user
  tests locally; no browser in this environment).

---

## 5. Phase 2 — promote existing fields, and cross-project copy (the issue's "part 2")

### 5.1 `rpc_promote_field_to_client_scope(p_id uuid, p_strategy text, p_dry_run boolean)`

- `p_strategy ∈ ('most_recent', 'most_common')`. `most_recent` = the value from
  the project with the latest `project_field_values.updated_at`; `most_common` =
  mode, ties broken by `updated_at`.
- `p_dry_run = true` returns, per affected client:
  `{client_id, client_name, distinct_values: [{value, project_count, latest_updated_at}], winner}`
  — the UI renders this as the conflict preview the issue demands ("do not
  silently pick").
- `p_dry_run = false`: for each client of a project holding a value, insert the
  winning value into `client_field_values`, delete **all** that field's
  `project_field_values` rows, flip `project_field_defs.scope` to `'client'`.
  One transaction. `log_event(…, 'project_field.promoted', {def_id, strategy,
  clients_affected, conflicts_resolved})`.
- `rpc_demote_field_to_project_scope(p_id)` — reverse: copy each client value
  down onto every one of that client's projects, delete `client_field_values`
  rows, flip scope back. (Lossy — a per-project edit made while client-scoped is
  gone. Confirm copy says so.)
- Check `check_field_scope_promotion.sql`: unanimous field promotes with no
  conflict rows; a 3-way disagreement across 7 projects resolves per strategy
  and the dry-run lists all three; demote round-trips a unanimous field.

### 5.2 Manage Fields UI

- Each populated def row gets a "Promote to client scope" action → a Popup that
  calls the dry-run, shows the conflict table, lets the user pick the strategy,
  then commits. Disabled for defs with no values (just flip scope inline — no
  RPC needed, `rpc_save_project_field_def` already allows it).
- Demote is a secondary action on client-scoped defs, behind a confirm.

### 5.3 "Copy fields from another project"

For the genuinely per-engagement values scope does not solve — carrying last
year's `Proposed fee` into this year's tax job, seeding a new project from a
sibling.

- A picker on project detail: choose a source project (same client filtered to
  the top), choose which custom fields to copy, preview, commit via
  `rpc_set_project_field_values`.
- Where the copy is whole-project (all fields + tasks + dates), that is a
  rollforward — route through `rpc_rollforward_project`, do not grow a second
  copier (`global-utilities-index.md` rule 1).
- Check: copying a subset writes exactly those cells; an unmapped field errors,
  not silently drops.

---

## 6. Phase 3 — refinement, QOL, extra features

### 6.1 Finish #197 parts 2–3 on top of merged scopes

`rpc_projects_table.custom_fields` now carries client-scoped values too, so:

- **Column picker** — opt-in custom-field columns on `ProjectsTable`
  (presentation only, no new query). A client-scoped column is especially
  useful here: the same value runs down every one of a client's rows, which is
  exactly what makes "sort the portfolio by focal point" work.
- **Range filters** — `fn_project_field_matches` gains `gt` / `gte` / `lt` /
  `lte` / `between` for `number` and `date` (the deferred `// ponytail` in
  `20260803_projects_table_field_filter.sql`). Client-scoped keys resolve
  through the same client leg added in Phase 1.
- Filter chips in the Projects header UI wired to the new operators.

### 6.2 The shared-value affordance, properly

- The `ProjectFieldsCard` badge on a client-scoped row becomes a control:
  "shared with N engagements" → opens a small list of those projects
  (name + stage), each a link. Uses a lightweight
  `rpc_client_engagements(p_client_id)` (id, name, current_stage) or reuses
  `rpc_get_projects` filtered client-side.
- Edit confirm dialog names the count: "This updates the value on all N of
  <client>'s projects."

### 6.3 "Edit <client>'s shared details" Popup

- Reachable from any project detail (a button next to the client name, and from
  the card header) — a focused Popup listing *only* that client's client-scoped
  fields, editable in one place, without pretending to be a client detail
  screen. Same `FieldValueEditor` components the card already has, pointed at
  `client_id`.
- Gated `project.edit`; the confirm-blast-radius copy still applies per field.

### 6.4 Promotion nudge

- A passive, dismissible hint on `ManageProjectFieldsPopup` (and optionally the
  card): when a **project-scoped** field has the *same non-null value across ≥3
  of one client's projects* for ≥2 clients, surface "This looks like client
  info — 2 clients have it repeated. Promote to client scope?" → the Phase 2
  promotion flow. Heuristic RPC `rpc_field_scope_suggestions()` returning
  `[{def_id, label, sample_clients}]`; reuses the importer's
  `email`/`phone`/`unique_id` primitive idea but works on stored data.

### 6.5 Search integration

- Client-scoped field values (focal point name, email) join
  `rpc_global_search` / the `tsvector` index (see TopBar Smart Search) so
  "find the engagement for jane@acme.com" resolves. Index `client_field_values`
  text values by client, project results inherit via `client_id`.

### 6.6 Audit + observability

- `log_event` on every client-scoped value write (blast radius > 1 project
  justifies the row that a project-scoped edit does not get):
  `'project_field.client_value_set' {def_key, client_id, projects_affected}`.
- `rpc_projects_table` / dashboard already logged; nothing new there.

### 6.7 QOL / polish

- Empty & permission states: client-scoped field on a client-less project,
  no-`project.edit` viewer, a client with zero client-scoped fields.
- `ManageProjectFieldsPopup`: group the list by scope with a subheading, so
  "which of these are shared" is legible at a glance.
- Importer review step: a running count — "3 columns → client, 11 → project" —
  so the scope split is visible before commit.
- `formatFieldValue` unchanged, but the card's type line for a client-scoped
  field reads "Choice · shared · from the "Position" column".

### 6.8 Candidates deferred to their own issues (not Phase 3)

- **`project_field.edit` permission split** (`20260802` decision 6). A
  client-scoped field's cross-project blast radius is the case that might
  justify "can edit projects but not their shared schema" as a distinct grant.
  File separately if a firm asks.
- **Client detail screen.** Out of scope for #199 entirely; if `clients` grows
  a lifecycle/notes/contacts UI, client-scoped fields slot into it for free.

---

## 7. Sequencing & delegation

1. **Phase 1** — one agent, one branch off `experimental` (not a worktree —
   worktrees here branch from stale `master` and do not build under Metro).
   Migration + check + frontend as one cohesive unit so the frontend calls
   match the RPC signatures it just wrote. Do not push; user tests locally.
2. **Phase 2** — after Phase 1 lands on `experimental`. Depends on the `scope`
   column and `client_field_values`.
3. **Phase 3** — after Phase 1 (6.1/6.3/6.4/6.5 also lean on Phase 2's
   promotion RPC; 6.2/6.6/6.7 do not).

Each phase: `tsc` clean, `npm run check` green, self-checks pass, UI walked at
1400px **and** 390px, plan doc + issue #199 updated as part of the phase, not
after.
