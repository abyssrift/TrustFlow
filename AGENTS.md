# TrustFlow agent instructions

These instructions apply to every Codex agent working anywhere in this repository, including local, remote, worktree, subagent, and scheduled runs.

## Existing repository rules are mandatory

Before doing any work, read every existing Markdown file in `.agents/rules/` completely. Treat all of their content as authoritative repository instructions. A rule written for "Claude", an "AI agent", or an "agent" applies equally to Codex and its subagents. Preserve the rules' meaning; do not weaken, summarize away, or silently ignore them.

The rule files currently use `trigger: always_on`, so they must all be read for every task. Then reread the task-specific files when `CLAUDE.md` tells you to—for example, before UI-visible or animation work. If rule files appear to conflict, stop and report the conflict instead of choosing the less restrictive interpretation.

## Planning and implementation orchestration is mandatory

## Local database safety

Dropping, resetting, or recreating the local database is destructive and is
not a routine troubleshooting step. Do not drop the local database, erase its
volumes, or reset migration history unless the user explicitly authorizes that
specific action and the exact disposable target has been verified first.

For tests and schema experiments, prefer a separate disposable database or
container, a transaction with rollback, or an approved baseline/schema dump.
Before any destructive local database operation, preserve or verify the
current migration state and confirm that no needed fixtures or local data will
be lost. Never use a local-database reset as a shortcut for a migration or
reporting task, and never apply that shortcut to production.

For Explorer-style collection/inspector work, start with the [Portable File Explorer guide](docs/PORTABLE_FILE_EXPLORER.md) for actual imports, selection semantics, domain boundaries, and responsive adoption.

For **any planning related to a feature, refactor, or code change**, use the
repository skill at `.agents/skills/sol-architect-orchestration/SKILL.md`.
The default architect is `gpt-5.6-sol` with `medium` reasoning effort. Sol
owns planning, decomposition, integration, and the final review; bounded
implementation packages are assigned to `gpt-5.6-luna` workers with `medium`
reasoning effort. This hierarchy applies in every context, including local,
remote, worktree, subagent, and scheduled runs.

The only exception is an explicit model/workflow override stated by the user
in the current chat or task. Direct work remains appropriate for a trivial,
non-planning factual inspection or a tiny mechanical action that requires no
feature, refactor, or code-change plan. Do not treat size, file count, or a
judgment that a change is "small" as permission to bypass the hierarchy when
planning a feature, refactor, or code change.

## Cross-agent challenge

When the Sol orchestration workflow is active, it must invoke
`scripts/claude-challenge.ps1` twice: once against the architecture brief
before worker dispatch, and once against the integrated diff before final
acceptance. Claude is a read-only adversarial reviewer. Its artifacts and the
architect's disposition of every finding belong in the handoff. A missing or
malformed review blocks acceptance unless the user explicitly authorizes an
emergency bypass.
