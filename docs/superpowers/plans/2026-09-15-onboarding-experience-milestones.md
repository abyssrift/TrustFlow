# Plan: Onboarding experience levels and milestone progress

## Global constraints

- Preserve the existing append-only defaults catalog and bootstrap writers.
- Add only the JSONB `experience_level` answer (`guided` or `full_control`); do not add catalog rows, permission semantics, a user preference column, or timezone persistence.
- Guided/Full control changes presentation only and must never reapply a preset or rewrite company data.
- The creator must remain `users.is_owner = true`, retain the Owner role, and complete the existing profile/permission/role refresh before the first milestone is marked complete.
- Use the existing onboarding draft and company-creation RPC contracts; do not add a parallel writer.
- Support native and web onboarding, with responsive milestone presentation at desktop and mobile widths.
- Follow reduced-motion rules; do not rely on declarative Reanimated entering/layout animations on web.

## Task 1: Contract and progress helpers

Extend `lib/onboardingProfile.ts` and tests with the stable experience-level enum, legacy default, wire serialization, validation, and resolved-profile field. Add pure milestone derivation in `lib/onboardingProgress.ts` and tests covering incomplete, active, successful-create, and reduced-motion-independent state.

## Task 2: Database contract

Add `supabase/migrations/20260915110000_onboarding_experience_level.sql` and `supabase/checks/check_onboarding_experience_level.sql`. Normalize missing values to `guided`, preserve snapshots/idempotency, and assert owner role/permissions and no existing-company rewrites.

## Task 3: Shared onboarding UI

Add shared `ExperienceLevelStep` and `OnboardingProgress` components with tests. Add progress to the question/ready components, including a compact mobile layout, touch-safe controls, and a small reduced-motion-safe transition.

## Task 4: Route integration

Wire both onboarding routes and route tests. Add the experience-level step, temporary full-control escape hatch, payload mapping, and milestone completion only after `refreshProfile()` returns successfully. Preserve join/starter paths and draft resume behavior.

## Task 5: Verification and handoff

Run focused tests, Docker SQL checks, Babel/build checks, graphify update, and final Sol review. Update issue #414 with the catalog decisions, migration strategy, changed files, and verification results.
