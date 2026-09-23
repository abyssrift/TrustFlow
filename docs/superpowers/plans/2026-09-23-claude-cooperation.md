# Claude Cooperation and Challenge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fail-closed, read-only Claude challenge gate to TrustFlow's Sol orchestration workflow.

**Architecture:** A PowerShell adapter owns process invocation, schema validation, artifact persistence, and exit status. The orchestration skill owns when to call it and how Sol reconciles findings. Existing red-team guidance remains the review rubric.

**Tech Stack:** PowerShell 7-compatible script, Claude Code CLI, JSON Schema, Markdown workflow instructions, Pester-free fixture tests using temporary directories and a fake executable.

## Global Constraints

- Do not invoke Sol for this implementation because the user explicitly overrode that repository default.
- Claude is read-only: `Read`, `git diff`, and `git status` only.
- Never reset, commit, migrate, or modify the worktree from the challenge adapter.
- Preserve all unrelated existing working-tree changes.
- Fail closed on unavailable Claude, malformed JSON, malformed findings, or blocking findings.

---

### Task 1: Add the challenge adapter

**Files:**
- Create: `scripts/claude-challenge.ps1`
- Create: `scripts/claude-challenge.schema.json`

**Interfaces:**
- Consumes: `-Phase plan|implementation`, `-PromptFile`, `-OutputDir`, optional `-ClaudeCommand`.
- Produces: `request.json`, `claude.json`, `report.json`, `report.md`; exit code `0` for accepted/no findings and `10` for blocking findings.

- [x] Write the adapter with explicit argument validation, a temporary prompt file fallback, `--bare -p`, `--output-format json`, `--json-schema`, `--allowedTools Read Bash(git diff *) Bash(git status *)`, and `--permission-prompts none`.
- [x] Reject output unless it is an object with `structured_output.findings[]`, valid severities, non-empty claims, and evidence fields.
- [x] Persist artifacts without embedding secrets or the full environment.
- [x] Generate Markdown with a reconciliation checklist.

### Task 2: Add deterministic adapter tests

**Files:**
- Create: `scripts/claude-challenge.tests.ps1`

**Interfaces:**
- Consumes: the adapter and a fake Claude command supplied through `-ClaudeCommand`.
- Produces: process exit assertions and artifact assertions.

- [x] Test a successful no-finding response.
- [x] Test a critical finding returns exit code `10` and appears in `report.md`.
- [x] Test malformed JSON and missing executable return non-zero and write diagnostic artifacts.
- [x] Test the command arguments contain read-only permissions and no edit/commit/reset/migration permissions.

### Task 3: Integrate the two gates into the orchestration skill

**Files:**
- Modify: `.agents/skills/sol-architect-orchestration/SKILL.md`
- Modify: `.agents/workflows/red-team-challenger.md`

**Interfaces:**
- Consumes: the adapter contract from Task 1.
- Produces: mandatory plan and implementation challenge instructions plus reconciliation rules.

- [x] Add the plan gate before worker dispatch.
- [x] Add the implementation gate after integration verification and before final PASS.
- [x] Require Sol to disposition every finding and preserve artifact paths.
- [x] Require an explicit, logged bypass only when the reviewer is unavailable.
- [x] Align the red-team report rubric with the adapter's structured finding fields.

### Task 4: Verify and hand off

**Files:**
- Modify: none beyond Tasks 1–3.

- [x] Run the PowerShell fixture tests.
- [x] Run `node scripts/babelcheck.mjs` only if applicable; this change has no TypeScript/Babel source.
- [x] Inspect the final diff and confirm unrelated changes are untouched.
- [x] Report artifact paths, test results, and the real-Claude smoke-test status.
