// Global modal host (#323, command-palette Phase 2b).
//
// Always mounted once per layout, next to <TimerIsland />. Reads `active` from
// ModalDispatchContext (#322) and renders the one real create/compose modal it
// names, wrapped in whatever data provider that modal needs, seeded from
// `active.payload`. Nothing here owns modal state — summon()/dismiss() do.
//
// Platform variants (.web.tsx) of each modal are resolved by Metro, so this
// single file serves web + native.
import React from 'react';

import { useModalDispatch } from '@/contexts/ModalDispatchContext';
import { useModalQueryParam } from '@/hooks/useModalQueryParam';
import { TaskCreationProvider } from '@/contexts/TaskCreationContext';
import CreateTaskModal from '@/components/tasks/CreateTaskModal';
import ProjectFolderModal from '@/components/projects/ProjectFolderModal';
import ReportGenerator from '@/components/intelligence/_ReportGenerator_adaptive';

const noop = () => {};

export default function ModalHost() {
  const { active, dismiss } = useModalDispatch();

  // #324: separate concern — turns `/tasks?new=1&type=task` style deep links
  // into a summon() call, then strips the params. Lives here (not in each
  // layout) so it is mounted exactly where ModalHost already is, on web and
  // native both. Runs unconditionally, before the early return below.
  useModalQueryParam();

  if (!active) return null;

  switch (active.type) {
    // CreateTaskModal throws without TaskCreationProvider as an ancestor — it
    // lives outside any screen here, so the host supplies its own (same as
    // components/navigation/QuickCreateButton.tsx did before this).
    case 'create-task':
      // #323 follow-up: payload.projectId is not consumed — neither
      // CreateTaskModal variant nor lib/useCreateTaskWizard has a project seed
      // prop, only initialPipelineId. Pass it through once the wizard grows a
      // project selector/seed.
      return (
        <TaskCreationProvider>
          <CreateTaskModal
            visible
            onClose={dismiss}
            initialPipelineId={active.payload.pipelineId ?? null}
          />
        </TaskCreationProvider>
      );

    // ProjectFolderModal (create mode) only needs Alert/Toast, both global.
    case 'create-project':
      return (
        <ProjectFolderModal
          visible
          onClose={dismiss}
          onSuccess={dismiss}
          portfolioId={active.payload.portfolioId}
        />
      );

    // Self-contained adaptive Popup — loads its own filter data, no provider.
    // It calls onReportGenerated() then onClose() on success; dismiss handles
    // the unmount, so the refresh callback is a noop here.
    case 'generate-report':
      return <ReportGenerator visible onClose={dismiss} onReportGenerated={noop} />;

    // #323 follow-up: new-role is NOT wired. RoleEditorSheet(.web) is a fully
    // controlled ~20-prop presentational component; every bit of its state and
    // the create/update/template logic lives in components/admin/RoleBuilder.tsx
    // (useRoleManager, createRole, permission list + category derivation).
    // Summoning it needs that logic lifted into a self-contained modal or a
    // RoleManagerContext-backed container — a bigger refactor than #323 wants.
    case 'new-role':
      return null;

    // #323 follow-up: create-portfolio has NO standalone modal.
    // PortfolioEditModal is edit-only (needs an existing portfolio row, saves
    // via rpc_update_portfolio). Portfolios are only born today as a side
    // effect of BulkCreateProjectsSheet / SpreadsheetImportSheet / template
    // instantiation. Needs a real rpc_create_portfolio + a create modal first.
    case 'create-portfolio':
      return null;

    // #323 follow-up: upload has NO standalone modal. The FileHub UploadModal
    // is a non-exported local function inside
    // components/intelligence/_filehub_desktop.tsx, coupled to FileHubContext
    // (folder tree), the active group, and screen-level drop/goo-morph state.
    // The existing entry path is router.push('/filehub'). Wire this once the
    // upload composer is lifted out of the screen, or a /filehub?upload=1
    // param exists to trigger it.
    case 'upload':
      return null;

    default: {
      // Compile-time totality guard: a new ModalType with no case above fails
      // here. Keep every ModalType represented in the switch.
      const _exhaustive: never = active;
      return _exhaustive ?? null;
    }
  }
}
