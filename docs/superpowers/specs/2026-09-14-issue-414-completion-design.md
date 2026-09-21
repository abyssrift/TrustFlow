# Issue 414 completion design

## Goal

Complete the two remaining catalog gaps: make the workspace-ready checklist a
published catalog entry consumed by both onboarding routes, and make explicit
catalog upgrades materialize real company-owned resources safely.

## Boundaries

- `WelcomeTour` and `users.onboarded_at` remain the separate per-user welcome
  tour; they are not company-default catalog state.
- Existing company rows are never rewritten, reassigned, renamed, or deleted by
  a catalog upgrade.
- `rpc_instantiate_template` remains the bulk project-instantiation writer and
  `rpc_create_starter_template` remains the starter-template materialization
  writer.
- Catalog payloads contain semantic keys only; no tenant, pipeline, stage,
  role, folder, channel, team, or user UUIDs.

## Data flow

`platform_catalog_entries` and `platform_catalog_heads` remain the source of
published definitions. Onboarding resolves the published
`onboarding_checklist.workspace-ready` entry and renders normalized checklist
items. Explicit adoption resolves a requested published version, locks the
company/catalog key, calls the type-specific writer, and records non-empty
`materialized_refs` in `company_catalog_installations` in the same transaction.
Retries return the existing references; an empty legacy ledger row is repaired.

Supported materializing kinds are roles/permissions, task workflows, project
starters, notification rules, and FileHub system folders. Workflow upgrades
create a new non-default company pipeline; role upgrades create additional
company roles without touching the existing Owner role; notification rules and
folders are additive. Checklist entries are read-only catalog content.

## Verification contract

- SQL checks prove checklist publication/shape, semantic payloads, ACLs,
  upgrade authorization, idempotent replay, atomic failure behavior, owner
  preservation, v2 workflow adoption, published-head starter discovery, and
  FileHub no-channel/no-delete behavior.
- Focused onboarding tests prove both route variants render catalog checklist
  content and preserve Continue when the catalog read fails.
- Existing checkout tests and web export remain required. Native and web
  walkthroughs are reported separately from automated verification.
