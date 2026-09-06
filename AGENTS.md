# TrustFlow agent instructions

These instructions apply to every Codex agent working anywhere in this repository, including local, remote, worktree, subagent, and scheduled runs.

## Existing repository rules are mandatory

Before doing any work, read every existing Markdown file in `.agents/rules/` completely. Treat all of their content as authoritative repository instructions. A rule written for "Claude", an "AI agent", or an "agent" applies equally to Codex and its subagents. Preserve the rules' meaning; do not weaken, summarize away, or silently ignore them.

The rule files currently use `trigger: always_on`, so they must all be read for every task. Then reread the task-specific files when `CLAUDE.md` tells you to—for example, before UI-visible or animation work. If rule files appear to conflict, stop and report the conflict instead of choosing the less restrictive interpretation.

## Planning and implementation orchestration is mandatory

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
