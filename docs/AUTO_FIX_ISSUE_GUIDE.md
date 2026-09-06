# Auto-fix issue guide

`auto-fix` marks a ticket as eligible for the scheduled automation that picks
the oldest qualifying issue, implements it, and opens a draft PR against
`experimental`. The automation only gets one unattended pass at an issue
before a human has to step in, so an underspecified ticket costs more than it
saves: the agent either guesses (risking a mis-scoped fix) or posts a
clarifying comment and gives up for that run (see #37 for a real example of
the latter — two clarifying passes on the same ambiguous ask before a human
resolved it).

## When to apply `auto-fix`

Apply the label only once the issue is concrete enough that an agent with no
access to you could implement it correctly on the first attempt. Good fits:

- A bug with a clear repro and an unambiguous correct behavior.
- A scoped enhancement to an existing screen/flow/RPC where "done" is
  checkable without a product decision.
- Anything where the fix is mechanical once the target behavior is stated.

Hold off on `auto-fix` (or split the issue) when:

- The request depends on a product/design decision that doesn't have an
  obvious "right" answer (a new data model, new UX pattern, pricing/plan
  behavior). File it without the label, or label only the parts that are
  unambiguous and track the rest separately.
- The scope bundles multiple independent asks of different sizes — split so
  each ticket can be picked up and finished in one pass.
- The description is a one-line title with no context.

## Required sections

Every `auto-fix` issue must use the **Auto-fix ticket** issue template
(`.github/ISSUE_TEMPLATE/auto_fix.md`) and have every section filled in:

1. **Problem statement** — what's broken or missing, in user-impact terms.
2. **Current behavior** — what happens today (errors/screenshots/logs where useful).
3. **Expected behavior** — the precise target outcome.
4. **Reproduction steps** — deterministic steps, environment, preconditions.
5. **Scope boundaries** — explicitly in scope vs. explicitly out of scope.
6. **Acceptance criteria** — a testable checklist defining "done".
7. **Risk notes** — affected modules/flows and known regressions to watch for.
8. **Validation guidance** — how to verify the fix (tests, manual steps,
   platform-specific checks — see the two-viewport-width rule in
   `.agents/rules/walkthroughs.md` for any UI-visible change).

A section left as the template's placeholder comment counts as missing.

## Maintainer triage checklist

Before adding the `auto-fix` label (or leaving it on an issue after a
clarifying-comment pass comes back), confirm:

- [ ] All 8 required sections are filled in with real content, not the
      template placeholder.
- [ ] Acceptance criteria are testable outcomes, not restatements of the
      problem statement.
- [ ] Scope boundaries rule out at least one plausible-but-unwanted
      interpretation of the ask (if there's only one possible interpretation,
      say so explicitly instead).
- [ ] Nothing in the issue requires a product/design decision that isn't
      already made — if it does, either make the call in the issue or strip
      the label until it's made.
- [ ] The issue is sized for one PR, not a program of work — split it if not.

If an issue accumulates two `[auto-fix attempt blocked]` or
`[auto-fix attempt failed]` comments, the automation removes the `auto-fix`
label and adds `auto-fix-failed` for manual review. Re-adding `auto-fix`
after that should come with whatever was missing actually fixed in the issue
body, not just relabeling.
