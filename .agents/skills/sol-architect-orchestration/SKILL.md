---
name: sol-architect-orchestration
description: Orchestrate TrustFlow feature, refactor, and code-change planning with a GPT-5.6 Sol medium architect that delegates bounded work to GPT-5.6 Luna workers, preserves its own context, and performs the final integration and review. Use by default for any such planning, including scheduled runs; direct work is reserved for trivial non-planning inspection or tiny mechanical actions, unless the user explicitly overrides the workflow in the current chat or task.
---

# Sol Architect Orchestration

Use this workflow for any planning for a feature, refactor, or code change, as
defined in the repository `AGENTS.md`. This default applies across all
execution contexts, including local, remote, worktree, subagent, and scheduled
runs. The only exception is an explicit user override in the current chat or
task. Direct work is allowed only for a trivial non-planning factual inspection
or a tiny mechanical action that needs no feature, refactor, or code-change
plan.

## Establish the architect

The lead architect must run as `gpt-5.6-sol` with `medium` reasoning effort. If the current lead is not running with that model and effort, its first action after recognizing feature, refactor, or code-change planning is to start a Sol/medium agent as the architect and transfer the task to it. The invoking agent must not independently explore broadly or implement the change.

The Sol architect owns requirements, constraints, decomposition, interfaces, integration decisions, and final acceptance. It must read `AGENTS.md`, `CLAUDE.md`, and every file in `.agents/rules/` before planning.

## Protect the architect's context

Keep raw exploration, verbose command output, localized implementation detail, and routine test execution out of the architect's context whenever a bounded Luna assignment can handle them.

- Delegate repository exploration, focused design questions, implementation slices, and targeted verification to `gpt-5.6-luna` workers with `medium` reasoning effort.
- Start Luna agents with no inherited conversation history, or the smallest useful recent-turn fork. Give each one a self-contained brief containing its scope, acceptance criteria, relevant interfaces, constraints, and required repository-rule paths.
- Require concise handoffs: findings, files changed, decisions made, commands run, failures, and remaining risks. Do not ask Luna agents to paste large logs or unrelated source into their reports.
- Give writing agents disjoint file ownership. Parallelize read-only investigation freely, but never assign overlapping edits without an explicit integration plan.
- Every Luna agent must read `AGENTS.md`, `CLAUDE.md`, and all `.agents/rules/*.md` before acting. It must also read this skill so it understands its bounded role.

Luna agents execute scoped work; they do not redefine product requirements, broaden scope, make irreversible external decisions, or accept the final result.

## Architect, then delegate

Before delegating implementation, the Sol architect must produce a compact internal architecture brief that states:

- the requested outcome and non-goals;
- affected subsystems and important existing patterns;
- interfaces and invariants that must remain stable;
- the work packages and their file ownership;
- integration order and verification gates; and
- the conditions that would require returning to the user.

Delegate the resulting work packages to Luna agents. The architect should coordinate and refine their assignments without taking over routine implementation merely to stay busy. It may make small integration edits when that is safer than another handoff.

## Sol performs the final review

After all Luna work returns, the Sol architect must personally:

1. inspect the complete final diff and relevant surrounding code;
2. verify that the pieces form one coherent design and follow all repository rules;
3. check each acceptance criterion, test result, and unresolved warning;
4. run or directly inspect the final integration verification appropriate to the risk;
5. correct integration defects or delegate a narrowly scoped correction; and
6. repeat its own final review after corrections.

The final PASS/BLOCK decision cannot be delegated. The architect must not rubber-stamp subagent summaries or claim verification from a diff reread when the required behavior was not actually exercised.

## Boundaries

This orchestration changes who performs the work, not what work is authorized. All user scope, repository rules, safety constraints, branch protections, and approval boundaries still apply. If the environment cannot start the required Sol architect or Luna workers, stop before implementing the planned feature, refactor, or code change and report that the required orchestration is unavailable.
