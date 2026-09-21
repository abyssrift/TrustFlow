# Onboarding preset expansion implementation plan

> **For the implementation agent:** use the repository's TDD and verification skills. Preserve unrelated dirty worktree changes.

**Goal:** ship a catalog-driven, size-and-operating-model onboarding flow with atomic company creation, safe defaults, resumable drafts, and no silent rewrites.

**Architecture:** immutable `platform_catalog_entries` provide the manifest, four size bands, and five operating-model overlays. A company snapshot and relational provenance rows record the exact selection. A new create-RPC overload composes the existing company bootstrap in the same transaction. The shared onboarding reducer and question/review components are used by both Expo routes.

## Task 1: Define pure onboarding contract and failing tests

Files:

- Add `lib/onboardingProfile.ts`.
- Add `lib/onboardingProfile.test.ts`.
- Add `hooks/useOnboardingFlow.ts`.
- Add `hooks/useOnboardingFlow.test.ts`.

Tests first:

1. Assert all four size-band and five overlay keys are accepted.
2. Assert invalid values, duplicate operating models, and missing required answers are rejected.
3. Assert “not sure” choices resolve to the least automated safe profile.
4. Assert conditional steps are derived from selected overlays and stale answers are pruned when a core answer changes.
5. Assert reducer transitions cover draft hydration, back, review, submit, failure, retry, and successful completion without double submit.

Then implement catalog payload parsing, normalized answer types, review composition, conditional-step derivation, stable idempotency-key handling, and the shared reducer/state orchestration. Keep UI labels/catalog content out of hard-coded application defaults.

## Task 2: Add the immutable preset catalog

Files:

- Add `supabase/migrations/20260914110000_onboarding_preset_catalog.sql`.
- Add `supabase/checks/check_onboarding_preset_catalog.sql`.

Seed the manifest, size, and overlay entries with semantic payloads and published heads. Replays must be deterministic; different payloads at the same key/version must fail. Add catalog checks for all entries, metadata policy, UUID absence, monotonic versions, published heads, and manifest references.

## Task 3: Add snapshots and drafts

Files:

- Add `supabase/migrations/20260914110100_company_onboarding_profiles.sql`.
- Add `supabase/migrations/20260914110200_user_onboarding_drafts.sql`.
- Add `supabase/checks/check_company_onboarding_profiles.sql`.
- Add `supabase/checks/check_user_onboarding_drafts.sql`.

Create immutable profile/provenance tables, user-owned draft storage, indexes, RLS, ACLs, and update/delete guards. Make profile revisions and draft revisions deterministic and inspectable.

## Task 4: Add atomic profile RPCs and tests

Files:

- Add `supabase/migrations/20260914110300_onboarding_profile_rpcs.sql`.
- Add `supabase/checks/check_onboarding_company_creation.sql`.

Implement server-side enum/conditional validation, published-head resolution, advisory locking, optimistic draft saves, the 3-argument create overload, and explicit apply/retry. Call the existing one-argument company writer inside the transaction so owner role assignment and baseline bootstrap stay centralized. Do not introduce IDs into catalog payloads. Return company/profile/revision/applied/recommendations/deferred data.

Checks must prove fresh creation, every size/overlay composition, owner/full-access preservation, idempotent retry, rollback, malformed input rejection, cross-company isolation, no automatic existing-company rewrite, and no duplicate bootstrap resources.

## Task 5: Add shared onboarding UI

Files:

- Add `components/onboarding/OnboardingQuestionStep.tsx`.
- Add `components/onboarding/OnboardingReviewStep.tsx`.
- Modify `app/onboarding.tsx`.
- Modify `app/onboarding.web.tsx`.
- Modify `components/onboarding/WorkspaceReadyStep.tsx`.
- Modify `lib/onboardingChecklist.ts` only if the ready response needs the profile summary.
- Modify `contexts/AuthContext.tsx` only if a post-create refresh race is exposed by tests.

Add the name, size, primary work, and conditional questions with everyday vocabulary. Add progress, back, “not sure” guidance, an honest review of created/recommended/deferred items, disabled/loading/error states, and retry behavior. Submit only after review using the same idempotency key. Keep join behavior separate. Refresh profile, permissions, and roles before routing.

Add/update:

- `components/onboarding/OnboardingQuestionStep.test.tsx`.
- `components/onboarding/OnboardingReviewStep.test.tsx`.
- `tests/onboarding.web.test.tsx`.
- `tests/onboarding.native.test.tsx`.
- `components/onboarding/WorkspaceReadyStep.test.tsx`.

## Task 6: Prevent lifecycle overlap and preserve resource boundaries

Files:

- Modify `components/onboarding/WelcomeTour.tsx` or its mount gate.
- Add/extend focused tests for onboarding/WelcomeTour interaction.

Ensure the tour does not cover setup, review, or workspace-ready content. Keep starter selection optional and preserve `rpc_create_starter_template`, `rpc_instantiate_template`, and company-owned edit/clone paths.

## Task 7: Verify and document handoff

Run:

- focused Vitest and the existing checkout-only Vitest suite;
- every new SQL check plus the existing #414 catalog/bootstrap/owner checks in Docker;
- `node scripts/babelcheck.mjs` on changed TS/TSX;
- `npm run build:web`;
- `git diff --check`;
- `graphify update .`;
- `npm run verify:agent`, reporting unrelated baseline failures separately.

Update `docs/PLATFORM_DEFAULTS_CATALOG.md` with preset/profile ownership and migration policy. Post one issue #414 comment containing decisions, migration names, changed files, and verification results. Leave the dev server on port 8081 running for manual testing.
