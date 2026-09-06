# TrustFlow agent instructions

These instructions apply to every Codex agent working anywhere in this repository, including local, remote, worktree, subagent, and scheduled runs.

## Existing repository rules are mandatory

Before doing any work, read every existing Markdown file in `.agents/rules/` completely. Treat all of their content as authoritative repository instructions. A rule written for "Claude", an "AI agent", or an "agent" applies equally to Codex and its subagents. Preserve the rules' meaning; do not weaken, summarize away, or silently ignore them.

The rule files currently use `trigger: always_on`, so they must all be read for every task. Then reread the task-specific files when `CLAUDE.md` tells you to—for example, before UI-visible or animation work. If rule files appear to conflict, stop and report the conflict instead of choosing the less restrictive interpretation.

## Substantial-change orchestration is mandatory

For any substantial change, use the repository skill at `.agents/skills/sol-architect-orchestration/SKILL.md`. Read it completely and follow it before exploring broadly or editing code.

A change is substantial when any of these is true:

- the user calls it big, major, broad, architectural, or cross-cutting;
- it is expected to touch more than three production files or about 150 non-generated lines;
- it spans multiple subsystems or platforms;
- it changes architecture, data models, migrations, authentication, authorization, security boundaries, or shared infrastructure; or
- its risk or ambiguity makes architectural decomposition and independent review prudent.

When uncertain whether a change is substantial, treat it as substantial.

