# Onboarding preset expansion design

## Goal

Make a new TrustFlow workspace useful after one short, plain-language setup flow. The flow recommends defaults using both team size and operating model, while leaving advanced configuration available later.

## Product decisions

- Ask for workspace name, team size, what the team manages first, approval needs, time tracking, file visibility, and repeating work only when those answers are relevant.
- Offer safe choices in everyday language. “Not sure” always maps to the least restrictive, least automated option.
- Use four size bands: `solo`, `small`, `growing`, and `scaling`.
- Use five operating-model overlays: `client_delivery`, `internal_operations`, `product_development`, `portfolio_intake`, and `governed_regulatory`.
- Compose one size entry and one or more overlay entries. Do not publish a matrix of size-by-model rows.
- Review the resulting setup before the final Create action. The review names what is created now, what is recommended, and what is deferred.
- Do not expose raw permission matrices, gate mechanics, timers, pipeline IDs, FileHub channel IDs, or database terms during onboarding.
- The default is one clear Main Workflow with review optional in the onboarding profile; timers, advanced gates, automation, channels, and external sharing are deferred unless explicitly configured later.
- Joining a company keeps the existing join flow and never applies the creator preset.
- A new company creator remains `is_owner = true` and receives the company-owned Owner role before onboarding completes. The UI refreshes the full permission and role context before routing.

## Authoritative data model

`platform_catalog_entries` remains the only source for preset labels, answer choices, recommendations, safe defaults, and deferred setup. Add immutable published entries:

- `onboarding_preset.manifest` v1
- `onboarding_preset.size.solo`, `.small`, `.growing`, `.scaling` v1
- `onboarding_preset.overlay.client_delivery`, `.internal_operations`, `.product_development`, `.portfolio_intake`, `.governed_regulatory` v1

Each preset payload has `schema_version`, `preset_type`, `selection_key`, user-facing `label`, `recommendations`, `safe_defaults`, and `deferred`. The manifest contains the question order, allowed values, and conditional predicates. Payloads contain semantic catalog keys only; they never contain company, pipeline, stage, folder, channel, role, or user UUIDs.

`company_onboarding_profiles` stores an immutable, company-owned snapshot:

- one `revision` per completed setup;
- selected size band, operating-model array, normalized answers, resolved profile, and applied catalog references;
- the idempotency key and completing user;
- relational rows in `company_onboarding_profile_catalog_entries` for exact selected catalog key/version provenance.

`user_onboarding_drafts` stores only the current user’s resumable branch, step, answers, revision, and idempotency key. Direct writes are blocked by RLS; the draft RPC uses optimistic revision checks.

## Ownership and lifecycle

| Data | Owner | Permission boundary | Creation path | Edit/clone/replace | Future platform changes |
| --- | --- | --- | --- | --- | --- |
| Manifest, size, and overlay entries | Platform | Published catalog read | Migration | Immutable; append a new version | Never rewrites companies |
| Company onboarding profile | Company | Company members read; completion RPC only writes | Atomic creator completion RPC | Immutable snapshot; a later explicit setup is a new revision | Existing profiles untouched |
| Selected workflow/template/rule copies | Company | Existing resource permissions | Existing catalog materializers or bootstrap | Company controls can edit, clone, replace | No silent rewrite |
| Draft answers | User | Only that authenticated user | Draft RPC after each accepted answer | User can resume/revise before completion | No company impact |
| Ready checklist | Platform presentation | Authenticated company members | Published checklist resolver | Read-only; later version is explicit | No existing onboarding rewrite |

## RPC and transaction boundary

Keep `rpc_instantiate_template` as the bulk project/template writer and `rpc_create_starter_template` as the starter materialization writer. Add:

- `rpc_save_onboarding_draft(...)` for resumable optimistic draft saves;
- `rpc_create_company_and_link(text, jsonb, uuid)` as an overload, preserving the existing RPC signature for old clients;
- `rpc_apply_onboarding_preset(jsonb, uuid)` for an explicit retry/repair path after a company already exists.

The new create overload calls the existing `rpc_create_company_and_link(text)` inside the same transaction, validates and resolves the published manifest/heads, writes the snapshot and provenance, and returns one result. A failure rolls back the company and bootstrap. A committed retry with the same idempotency key returns the original result. Advisory locks prevent two tabs from creating competing snapshots.

Preset application is additive and idempotent. The baseline company bootstrap remains the writer for roles and the standard workflow. Preset composition records the selected catalog components and recommendations; it may materialize a semantic operating-model workflow through the existing catalog pipeline writer when appropriate, but it never updates or deletes an existing pipeline, template, rule, folder, or role.

## UI flow

```text
selection
  -> join.code -> join.submit -> workspace
  -> create.name -> create.questions -> create.review -> create.submit -> ready
```

The shared question/review components work on web and native. Answers persist after each accepted step. Back navigation is local only. Changing a core answer prunes stale conditional answers. Submission errors return to review with the answers intact; retry reuses the same idempotency key. The ready screen explains the applied preset and keeps the starter picker optional.

`WelcomeTour` must not cover the setup/review/ready screens. It remains a separate user-level lifecycle and can start after the user reaches the workspace.

## Migration strategy and verification

Migrations are append-only and run after the existing #414 catalog migrations. Fresh creation is the only automatic application path. Existing companies are not backfilled. An owner/admin can explicitly create a new profile revision or install a newer catalog version, preserving old company-owned copies.

Database checks cover catalog completeness and UUID absence, RLS/ACLs, all size bands and overlays, malformed/conditional answer rejection, idempotent retries, rollback, owner preservation, cross-company isolation, immutable profiles, draft revision conflicts, and preservation of customized resources.

Frontend tests cover parsing, composition, conditional branching, stale-answer pruning, review disclosure, draft retry, double-submit, refresh-before-route, and join isolation. Verification includes focused Vitest, existing checkout tests, SQL contract checks in Docker, Babel syntax checks, web build, `git diff --check`, and `graphify update .`.
