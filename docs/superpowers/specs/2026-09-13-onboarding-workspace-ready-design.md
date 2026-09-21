# Onboarding workspace-ready step

## Goal

Make the catalog-backed defaults visible during fresh-company onboarding and
make recommended project starters usable before entering the workspace.

## Design

After `rpc_create_company_and_link` succeeds, onboarding refreshes the full
auth metadata snapshot and stays on an explicit `ready` step instead of routing
immediately to the dashboard. The step shows the installed Owner access and
`Main Workflow` defaults, offers the existing `StarterTemplatePickerSheet`, and
lets the user skip or continue. Selecting a starter uses the existing
catalog-backed materializer, so the resulting template remains company-owned,
editable, and governed by the catalog versioning policy.

The join-existing-company path is unchanged. Existing companies are not
rewritten. The web and native onboarding screens share one small presentation
component while retaining their existing outer layout differences.

## Failure and retry behavior

If starter loading or materialization fails, the existing picker displays its
error and the user can close it and continue without a starter. The workspace
creation RPC remains the only company bootstrap writer; the UI adds no default
rows directly.

## Verification

Add a component regression test for the ready-step copy and actions, run the
focused test, Babel syntax checks, the checkout-only Vitest suite, and the web
export.
