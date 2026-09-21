# TrustFlow platform defaults catalog

Issue #414 establishes the database catalog as the single authority for
platform-curated defaults. Runtime clients resolve published catalog entries;
they do not carry a second copy of the default data.

## Inventory and ownership

| Existing behavior | Catalog key/version | Classification | Owner and boundary | Creation path | Customization and update behavior |
| --- | --- | --- | --- | --- | --- |
| Semantic role and permission bundle | `roles_permissions` v1 | Platform-curated default | Platform-owned; permissions are platform-wide, materialized roles are company-owned | `rpc_bootstrap_company_defaults` reads the published payload | Company roles and permissions can be edited. Platform entries are immutable; a later version is an explicit upgrade. Existing companies are not rewritten. |
| Main task workflow, stages, transitions, and actions | `task_workflow.standard` v1 | Platform-curated default; materializes as a company default pipeline | Platform-owned recipe; pipeline rows are company-owned | Bootstrap creates one `Main Workflow` only when the company has no pipelines. `rpc_create_catalog_pipeline` is the explicit preset consumer. | Company pipeline data can be edited, cloned, or replaced using existing pipeline controls. Future catalog versions install alongside the old copy only after an explicit choice. |
| Pipeline editor quick setup | `task_workflow.standard` v1 | Recommended preset | Platform recipe; resulting pipeline belongs to the company | `rpc_create_catalog_pipeline` | No static UI preset is authoritative. The created pipeline is editable and future catalog changes do not rewrite it. |
| Curated project starter recipes (13 existing recipes) | `project_template.<starter-id>` v1 | Platform-curated default / onboarding recommendation | Platform-owned recipe; materialized `project_templates` rows belong to the company | `StarterTemplatePickerSheet` resolves the catalog and calls `rpc_create_catalog_starter_template`, which keeps `rpc_create_starter_template` as the materialization writer | The picker selection is a one-time onboarding choice for that copy. The company copy is editable, cloneable, and replaceable. A later version is an explicit new copy; existing templates are untouched. |
| Project template library | None for company-created rows | Company-created template | Company-owned and company-visible | Save-from-project, catalog starter selection, or duplicate | `TemplatesLibrary` edits and duplicates company-owned rows. These rows are never platform defaults and are not affected by catalog publication. |
| Standard notification rules | `notification_rules.standard` v1 | Platform-curated default | Platform-owned recipe; materialized rules are company-owned | Company bootstrap and owner-user creation trigger | Company admins can edit, disable, or delete their copies. Legacy `company_id IS NULL` rules remain available as legacy platform rules and are not silently converted. Future versions require explicit installation. |
| Notification delivery preferences | None | User preference | User-owned; scoped to the authenticated user | `rpc_upsert_notification_preferences` and the notification preferences screens | The user can change or restore preference values. Company catalog updates do not change preferences. |
| FileHub system roots (`Portfolio Imports`, `Client Files`) | `filehub_system_folders.standard` v1 | Platform-curated default, lazy | Platform-owned names and scopes; folder rows are company-owned | `rpc_filehub_get_system_folder` resolves the catalog and delegates to the existing idempotent folder writer on first use | Company users can use the existing folder lifecycle controls. No bootstrap rows or channels are created. Future versions never rename or delete existing folders automatically. |
| FileHub channels/groups and ordinary folders | None | Company-created template/resource | Company-owned and company-scoped | Existing FileHub create RPCs | Company members with permission can create and manage them. There are no platform channel rows in the catalog. |
| Workspace-ready onboarding checklist | `onboarding_checklist.workspace-ready` v1 | One-time onboarding choice | Platform-owned copy shown to authenticated company members; selection is recorded per company | Both onboarding routes resolve the published entry through `loadOnboardingChecklist`; the checklist itself creates no company rows | Read-only presentation. A later version is explicit; existing onboarding state and the separate `WelcomeTour` are untouched. |
| Onboarding preset selection | Installation ledger `selected_by` + `creation_path` | One-time onboarding choice | User choice recorded against the company and catalog version | Picker or onboarding flow calls the catalog materializer | Selecting again intentionally creates another company-owned copy where the operation is a clone/create action; retry of the same bootstrap path is idempotent. |

## Onboarding preset contract

The onboarding catalog uses stable semantic keys. Every key starts at v1 and
changes are append-only:

| Key | Purpose | v1 guarantee |
| --- | --- | --- |
| `roles_permissions` | Baseline role and permission bundle | A fresh company receives company-owned Admin, Manager, Owner, and Personnel roles; the creator is assigned its own Owner role. |
| `task_workflow.standard` | Baseline task workflow | A fresh company receives one editable Main Workflow with Backlog, In Progress, In Review, and Done stages plus working transitions and action buttons. |
| `filehub_system_folders.standard` | Lazy FileHub roots | `Portfolio Imports` and `Client Files` resolve to company-owned folders on first use; no channels or groups are seeded. |
| `project_template.<starter-id>` | Starter/project recipe | The catalog recipe is materialized through `rpc_create_starter_template`; bulk project creation remains on `rpc_instantiate_template`. |
| `notification_rules.standard` | Company notification rule recipe | Fresh owner-linked companies receive company-scoped copies of the published rules; a company can edit or disable its copies. |
| `onboarding_checklist.workspace-ready` | Ready-screen checklist | Authenticated company members see a read-only published checklist; it does not create resources. |
| `onboarding_preset.manifest` v2 | Question and answer contract | The onboarding UI receives question order, labels, options, and catalog-owned conditional branches from the published manifest head. v1 remains immutable for historical drafts. |
| `onboarding_preset.size.{solo,small,growing,scaling}` | Team-size overlay | Size-specific recommendations, safe defaults, deferred topics, and admin/member guarantees; no company resources are rewritten. |
| `onboarding_preset.overlay.{client_delivery,internal_operations,product_development,portfolio_intake,governed_regulatory}` | Operating-model overlay | Model-specific recommendations, safe defaults, deferred topics, tutorial topics, and admin/member guarantees; multiple overlays compose in stable order. |

The effective preset is one size key plus one or more operating-model keys. The
client sends only the semantic answers and an idempotency key:

```text
rpc_create_company_and_link(
  p_company_name text,
  p_onboarding_answers jsonb,
  p_idempotency_key uuid
) returns jsonb
```

The JSON answer contract is:

```json
{
  "size_band": "solo | small | growing | scaling",
  "operating_models": ["client_delivery | internal_operations | product_development | portfolio_intake | governed_regulatory"],
  "gates": "none | light | formal",
  "time_tracking": "off | optional | required",
  "files": "light | centralized | governed",
  "repeating_work": "rare | sometimes | frequent"
}
```

The RPC validates enums and conditional answers, resolves published catalog
heads, calls the existing company/bootstrap writer in the same transaction,
and records an immutable `company_onboarding_profiles` snapshot plus
`company_onboarding_profile_catalog_entries` provenance. It returns:

```json
{
  "company_id": "materialized company UUID",
  "profile_id": "immutable snapshot UUID",
  "revision": 1,
  "answers": {},
  "resolved_profile": {
    "size_band": "small",
    "operating_models": ["client_delivery"],
    "selected_catalog_keys": [],
    "selected_catalog_versions": [],
    "recommendations": {},
    "guarantees": {},
    "safe_defaults": {},
    "deferred": []
  },
  "applied": [{
    "installation_id": "company catalog installation UUID",
    "catalog_key": "roles_permissions",
    "catalog_version": 1,
    "materialized_references": {"...": "resource IDs"}
  }],
  "recommendations": {},
  "guarantees": {},
  "deferred": []
}
```

The identifiers in the response are materialized company references only. No
company, pipeline, stage, folder, channel, role, or user ID is present in a
platform preset payload. A retry with the same idempotency key returns the
original `company_id` and `profile_id` and creates no second company or
snapshot. `rpc_apply_onboarding_preset(p_answers, p_idempotency_key)` is the
explicit owner/admin retry or later-selection path for an existing company;
it creates a new snapshot revision and does not overwrite company resources.

Setup interruption is resumable through the user-scoped draft API:

```text
rpc_load_onboarding_draft() returns user_onboarding_drafts | null
rpc_save_onboarding_draft(
  p_branch text, p_step_key text, p_answers jsonb,
  p_idempotency_key uuid, p_expected_revision integer
) returns user_onboarding_drafts
```

Only the authenticated user can read a draft. Saves use optimistic revision
checks, and a stale tab receives a revision-conflict error instead of silently
discarding answers. Drafts never create or modify company resources.

### Guaranteed capabilities and tutorial boundaries

Every preset v1 guarantees the following baseline boundary:

- Admin/owner: the creator has full ownership; company admins can manage members, roles, workflows, and company settings within their existing permission boundary.
- Member: a member can see assigned tasks, comment, and submit work; members do not receive company-wide access merely because a preset was selected.
- Tutorial: create a task/request, assign ownership, move work through the workflow, and understand task-scoped file access. Model overlays add the topics below.

| Overlay | Additional admin capability guaranteed | Additional member capability guaranteed | Tutorial topics guaranteed |
| --- | --- | --- | --- |
| Client delivery | Manage clients, projects, members, and settings | Work on assigned client tasks without unrelated company-wide data | Create a client project; share files safely; review before delivery |
| Internal operations | Manage internal members, roles, workflows, and settings | See assigned internal work, comment, and submit | Create an internal request; assign an owner; reuse a template |
| Product/development | Manage product work, members, roles, workflows, and settings | View assigned development work, comment, and submit | Plan a release; move work through review; attach a file |
| Many projects/requests | Manage intake, projects, members, roles, workflows, and settings | View assigned requests, comment, and submit | Capture a request; prioritize work; turn a request into a project |
| Regulated/approval-heavy | Manage controlled roles, members, workflows, and settings | Receive only task/file access granted by company permissions | Set an approver; share with a controlled group; review activity history |

The preset does not make legal, billing, external-client access, data-retention,
data-residency, or regulatory-compliance decisions. Those are explicit product
and customer-admin decisions and remain deferred in v1. In particular, the
catalog does not claim that a workflow is legally compliant or that a timer is
a billable record.

The catalog metadata columns make the policy machine-readable: `owner_scope`,
`classification`, `permission_boundary`, `customization_policy`,
`update_policy`, `cloneable`, `editable`, `replaceable`, and
`existing_companies_affected`. The `company_catalog_installations` ledger stores
the immutable source hash, materialized references, creation path, and selector.

## Versioning policy

- `(catalog_key, version)` is immutable. Updates are new versions, never edits
  or deletes. A database trigger rejects same-version payload changes, UUID-like
  tenant identifiers, and non-monotonic versions.
- The onboarding manifest is currently published at v2. v2 adds `visible_when`
  predicates for gates, time tracking, and FileHub questions; v1 remains a
  readable historical snapshot and is never edited in place.
- `platform_catalog_heads` separates the recommended version from the
  published version. Runtime resolvers only return the published head.
- `content_hash` and `baseline_hash` identify the exact source used for a
  company copy. An installation has one unique `(company, key, version)` row.
- Default installation is idempotent under a company/key lock. Explicit
  upgrade is a separate action and installs alongside an existing version; it
  never switches, overwrites, or silently replaces company data. The explicit
  `rpc_adopt_platform_catalog_version` coordinator creates real company-owned
  resources and repairs legacy empty-reference ledger rows in one transaction.
- Company-owned copies may be edited, cloned, disabled, or replaced according
  to their existing product controls. Such edits do not mutate the platform
  entry or cause a future catalog version to overwrite the copy.

## Migration strategy

1. Catalog migrations publish semantic payloads with no company, pipeline,
   stage, team, channel, or user IDs.
2. Fresh company creation calls the one bootstrap path. It seeds roles and the
   standard workflow deterministically, then seeds company notification rules
   when an owner exists. The owner-insert trigger makes the notification step
   safe when bootstrap runs before the first user is linked.
3. Project starter selection is explicit and uses the catalog resolver plus the
   existing starter-template writer. Bulk project creation continues to use
   `rpc_instantiate_template` as its bulk writer.
4. FileHub system roots are not backfilled and no channels are seeded. The
   first feature that needs a root resolves and materializes it lazily through
   the existing folder RPC.
5. Existing companies receive no automatic rewrites or newly selected
   defaults. Administrators can opt into a later catalog version through an
   explicit `rpc_install_platform_catalog_upgrade` operation, preserving the
   old copy for comparison or rollback. The adoption coordinator dispatches to
   type-specific materializers; it does not merely write provenance.

Database contract checks cover catalog immutability, publication, ACLs, UUID
absence, idempotent bootstrap, editable company copies, onboarding checklist
content, real version adoption, owner preservation, pipeline consumers,
company-scoped notification rules, lazy FileHub folders, and the no-default-
channels invariant.
