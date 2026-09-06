---
name: trustflow-verify
description: Run TrustFlow's deterministic, secret-free validation gates for agents and CI.
---

# TrustFlow verification

Use `npm run verify:agent` from the repository root for the standard gate. It
runs repository self-checks, Vitest, TypeScript, targeted Metro/Babel parsing
for changed files, and the cross-platform web export. The web export preserves
the existing `public/` prefix under `dist/public/` while leaving Expo's generated
`dist/index.html` intact.

The TypeScript command is still `npx tsc --noEmit`, but this checkout has
known diagnostics (including archived Deno code). Their normalized path/code
counts are recorded in `tsc-baseline.json`; verification passes only when the
set and counts match exactly, so additions, removals, or drift fail loudly.

Supabase checks are local-only. Migration drift and `supabase db lint --local`
run only when a local Supabase Docker database is already running. The entry
point never links, pushes, resets, or contacts production; skipping local
checks without a stack is expected in CI.

For a focused Babel diagnosis, run `node scripts/babelcheck.mjs <changed-files>`.
