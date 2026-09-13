import {
  deriveExplorerCapabilities,
  type ExplorerServerCapabilities,
} from './fileExplorerMode';

const project = { kind: 'project-workspace', projectId: 'project-1' } as const;
const browse = { kind: 'global-browse', origin: 'shared' } as const;
const deliverableBrowse = { kind: 'global-browse', origin: 'deliverable' } as const;
const capabilityKeys = ['canView', 'canCreate', 'canRename', 'canMove', 'canDelete', 'canRestore', 'canUpload', 'canReplace', 'canVersion'] as const;
const browseMutationKeys = ['canCreate', 'canRename', 'canMove', 'canDelete', 'canRestore', 'canUpload', 'canReplace', 'canVersion'] as const;

const denied = deriveExplorerCapabilities(project);
if (capabilityKeys.some((key) => denied[key])) {
  throw new Error('Explorer capabilities must be closed by default.');
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
if (capabilityKeys.some((key) => !writable[key])) {
  throw new Error('Explicit project server capabilities should be preserved.');
}

const browseCapabilities = deriveExplorerCapabilities(browse, granted);
if (!browseCapabilities.canView) {
  throw new Error('Explicit view capability should be preserved for Browse.');
}
if (browseMutationKeys.some((key) => browseCapabilities[key])) {
  throw new Error('Global Browse must remain read-mostly.');
}
if (!deriveExplorerCapabilities(deliverableBrowse, { view: true }).canView) {
  throw new Error('Sealed deliverable Browse origin should be supported.');
}

console.log('fileExplorerMode checks passed');
