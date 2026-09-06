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
import RoleEditorContainer from '@/components/admin/RoleEditorContainer';
import UploadComposerModal from '@/components/filehub/UploadComposerModal';

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

    // new-role (#338): create mode only. RoleEditorContainer owns the role
    // state RoleBuilder normally feeds RoleEditorSheet and brings its own
    // RoleManagerProvider (live permission list + rpc_create_role).
    case 'new-role':
      return <RoleEditorContainer visible onClose={dismiss} />;

    // #323 follow-up: create-portfolio has NO standalone modal.
    // PortfolioEditModal is edit-only (needs an existing portfolio row, saves
    // via rpc_update_portfolio). Portfolios are only born today as a side
    // effect of BulkCreateProjectsSheet / SpreadsheetImportSheet / template
    // instantiation. Needs a real rpc_create_portfolio + a create modal first.
    case 'create-portfolio':
      return null;

    // #340: the FileHub upload composer, lifted out of _filehub_desktop.tsx's
    // screen-local UploadModal into components/filehub/UploadComposerModal.
    // Web variant routes through UploadManagerContext (already an ancestor here
    // via app/_layout.web.tsx) — no extra provider. Native variant is a stub
    // that redirects to /filehub (no UploadManagerProvider on native; see the
    // component's own #340 follow-up note).
    case 'upload':
      return (
        <UploadComposerModal
          visible
          onClose={dismiss}
          folderId={active.payload.folderId}
          taskId={active.payload.taskId}
        />
      );

    default: {
      // Compile-time totality guard: a new ModalType with no case above fails
      // here. Keep every ModalType represented in the switch.
      const _exhaustive: never = active;
      return _exhaustive ?? null;
    }
  }
}
