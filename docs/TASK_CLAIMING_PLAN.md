# Task claiming toggle (issue #25)

## Scope decisions (from discussion)

- Enforcement point: **starting a work session/timer**, not stage advancement
  or submission. `rpc_start_work` is the single choke point all timer starts
  go through (`task_work_sessions` has no write RLS policy — every write is
  already funneled through this one RPC), so it's the natural gate.
- Claim lifecycle: any already-assigned member can claim; release is
  **automatic** — the claim clears when the task leaves its current stage
  (fresh claim needed per stage) or when the claimant is unassigned from the
  task. No manual "release" action for v1.
- The dead `rpc_claim_task` call / "Claim Task" button in
  `TaskCardActions.tsx` (confirmed never visible in real usage — its old
  condition was "task has zero assignees," and calling it always failed
  since no migration ever defined the function) is **repurposed** for this
  issue rather than left to rot or built alongside. Old meaning (self-assign
  to an unassigned task) is removed; new meaning is "become the sole active
  worker among a task's already-assigned team."

## Data model

- `teams.enforce_single_claimant boolean default false` — the per-team
  toggle.
- `tasks.claimed_by uuid references users(id)`, `tasks.claimed_at timestamptz`
  — claim state lives on the task itself (not a separate table) since only
  one active claim per task ever exists.

## RPCs

- `rpc_set_team_claiming(p_team_id, p_enabled)` — gated by `is_owner` OR
  `team.edit` (an existing, already-used permission — no new dead key this
  time).
- `rpc_claim_task(p_task_id)` — real implementation of the previously-dead
  call. Requires the task to actually have an enforcing team assigned
  (`task_assignments.assignee_team_id` → a team with claiming on), requires
  the caller to be assigned to the task directly OR a member of that
  enforcing team, and rejects if already claimed by someone else. Same
  signature as the dead client call (`p_task_id` only), so
  `TaskCardActions.tsx`'s existing `handleClaim` needed no call-site change.
- `rpc_start_work` — extended (full redefinition, per this repo's
  per-migration convention) with the actual gate: if the task is assigned to
  an enforcing team, starting a session requires `claimed_by = auth.uid()`.

## Auto-release

Two triggers:
- `trg_tasks_clear_claim_on_stage_change` (`BEFORE UPDATE OF current_stage_id
  ON tasks`) — clears `claimed_by`/`claimed_at` in the same row update
  whenever the stage actually changes.
- `trg_task_assignments_clear_claim` (`AFTER DELETE ON task_assignments`) —
  clears the claim if the removed assignment was the claimant (direct user
  assignment) or the claimant was a member of the removed team assignment.

**Known gap** (marked with a `ponytail:` comment in the migration): a claim
is *not* released when someone merely leaves `team_members` while the team
assignment itself stays on the task — only a full unassign or stage change
releases it. Narrow edge case; add a `team_members` DELETE trigger if it
turns out to matter in practice.

## UI

- `TeamRolesSheet.tsx` — new toggle row above the roles list, immediate-apply
  (calls `rpc_set_team_claiming` directly, not bundled into the roles "Save"
  button since it's a different concern).
- `TaskCardActions.tsx` — `handleClaim`/"Claim Task" button now shown when
  the task requires claiming, is unclaimed, and the viewer is eligible
  (individually assigned, or a member of the enforcing team — checked via a
  new `myTeamIds` prop threaded from the board, mirroring the pattern the
  boards already use for their own "mine" filters). When claimed by someone
  else, the card shows "Claimed by \<name\>" instead of action buttons.
- Board queries (`_tasks_adaptive.tsx`, `_tasks_desktop.tsx`) — added
  `enforce_single_claimant` to the existing nested team select
  (`team:assignee_team_id(name, enforce_single_claimant)`); `claimed_by`
  needed no query change since both already `select('*')` on tasks.

## Known follow-up (not fixed in this PR)

`TimerContext.startWork` uses an optimistic-then-commit pattern: it shows
the timer as active locally immediately, then commits `rpc_start_work` in
the background. If that commit fails — including on a claim rejection — the
`catch` block only `console.error`s; it does not roll back the optimistic
UI state or toast the user. This is a **pre-existing** gap (any
`rpc_start_work` rejection was already silently swallowed, e.g. task
archived mid-click), not something this issue introduced, but #25 makes the
failure path more commonly reachable. Worth its own fix — rolling back
`setActiveSession` and surfacing a toast on commit failure — rather than
folding into this PR.
