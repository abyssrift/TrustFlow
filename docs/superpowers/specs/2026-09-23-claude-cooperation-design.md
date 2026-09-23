# Claude Cooperation and Challenge Design

## Goal

Make Claude an independent, adversarial reviewer of TrustFlow plans and
implementations whenever the Sol orchestration workflow is used, without
giving Claude authority to edit the worktree or make repository decisions.

## Design

The cooperation boundary is a local PowerShell adapter,
`scripts/claude-challenge.ps1`, which invokes Claude Code in headless `--bare`
mode. The adapter accepts a challenge phase (`plan` or `implementation`), a
prompt packet, and an output directory. It passes only read-oriented tools,
requests JSON-schema output, writes the raw response and normalized report to
an artifact directory, and exits non-zero on missing Claude, malformed output,
or a reported blocking finding.

The Sol orchestration skill gains two mandatory gates:

1. `plan`: before dispatching workers, Claude challenges the architecture
   brief, acceptance criteria, invariants, and work-package boundaries.
2. `implementation`: after worker integration and before final acceptance,
   Claude reviews the complete diff and verification evidence.

Sol remains the decision owner. Every Claude finding must be recorded as
accepted, rejected with rationale, or resolved by a code/process change.
Claude may read files and inspect git state, but may not edit, commit, reset,
run migrations, or access external services through this adapter.

## Output contract

Each run writes:

- `request.json`: phase, run id, repository, prompt metadata, and command
- `claude.json`: raw Claude JSON response
- `report.json`: normalized findings and run metadata
- `report.md`: human-readable report for the architect

Findings use stable severities (`critical`, `warning`, `suggestion`) and must
include a concrete claim, evidence location, and recommended disposition.

## Failure policy

The plan gate blocks worker dispatch when Claude is unavailable or returns
invalid output. The implementation gate blocks final acceptance for critical
findings or an unavailable reviewer. A caller may explicitly record an
approved emergency bypass, but the default is fail closed.

## Non-goals

- Claude does not implement fixes.
- Claude does not replace TrustFlow verification commands.
- This does not create a second agent orchestration hierarchy.
- This does not modify or reset existing user worktree changes.

## Verification

The adapter is tested with a fake Claude executable for success, malformed
output, unavailable executable, and blocking findings. A smoke test optionally
runs the real `claude --bare -p` command when credentials are present.
