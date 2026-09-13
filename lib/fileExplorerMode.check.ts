import {
  deriveExplorerCapabilities,
  type ExplorerServerCapabilities,
} from './fileExplorerMode';

const project = { kind: 'project-workspace', projectId: 'project-1' } as const;
const browse = { kind: 'global-browse', origin: 'shared' } as const;
const deliverableBrowse = { kind: 'global-browse', origin: 'deliverable' } as const;

const denied = deriveExplorerCapabilities(project);
if (Object.values(denied).some(Boolean)) {
  throw new Error('Explorer capabilities must be closed by default.');
}
if (denied.canView) {
  throw new Error('Default canView must be false.');
}

const granted: ExplorerServerCapabilities = {
  view: true,
  upload: true,
  create: true,
  rename: true,
  move: true,
  delete: true,
  restore: true,
  replace: true,
  version: true,
};
const writable = deriveExplorerCapabilities(project, granted);
if (!writable.canUpload || !writable.canCreate || !writable.canDelete || !writable.canVersion) {
  throw new Error('Explicit project server capabilities should be preserved.');
}

const browseCapabilities = deriveExplorerCapabilities(browse, granted);
if (browseCapabilities.canUpload || browseCapabilities.canCreate || browseCapabilities.canDelete || browseCapabilities.canRename || browseCapabilities.canMove || browseCapabilities.canRestore || browseCapabilities.canReplace || browseCapabilities.canVersion) {
  throw new Error('Global Browse must remain read-mostly.');
}
if (!browseCapabilities.canView) {
  throw new Error('Explicit view capability should be preserved for Browse.');
}
if (!deriveExplorerCapabilities(deliverableBrowse, { view: true }).canView) {
  throw new Error('Sealed deliverable Browse origin should be supported.');
}

console.log('fileExplorerMode checks passed');
