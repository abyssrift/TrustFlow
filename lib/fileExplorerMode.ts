export type ExplorerOrigin = 'workspace' | 'deliverable' | 'shared' | 'brief' | 'submission';

export type ExplorerMode =
  | { kind: 'project-workspace'; projectId: string }
  | { kind: 'global-browse'; projectId?: string | null; origin: ExplorerOrigin };

export type ExplorerCapabilityName =
  | 'view' | 'create' | 'rename' | 'move' | 'delete' | 'restore' | 'upload' | 'replace' | 'version';

export type ExplorerServerCapabilities = Partial<Record<ExplorerCapabilityName, boolean>>;

export type ExplorerCapabilities = {
  canView: boolean;
  canCreate: boolean;
  canRename: boolean;
  canMove: boolean;
  canDelete: boolean;
  canRestore: boolean;
  canUpload: boolean;
  canReplace: boolean;
  canVersion: boolean;
};

const CAPABILITY_KEYS: readonly [ExplorerCapabilityName, keyof ExplorerCapabilities][] = [
  ['view', 'canView'], ['create', 'canCreate'], ['rename', 'canRename'], ['move', 'canMove'],
  ['delete', 'canDelete'], ['restore', 'canRestore'], ['upload', 'canUpload'],
  ['replace', 'canReplace'], ['version', 'canVersion'],
];

/** Server grants are opt-in; Browse never gains mutation authority from them. */
export function deriveExplorerCapabilities(
  mode: ExplorerMode,
  serverCapabilities: ExplorerServerCapabilities = {},
): ExplorerCapabilities {
  const projectWritable = mode.kind === 'project-workspace';
  return CAPABILITY_KEYS.reduce((result, [serverKey, publicKey]) => {
    result[publicKey] = Boolean(serverCapabilities[serverKey]) && (serverKey === 'view' || projectWritable);
    return result;
  }, {} as ExplorerCapabilities);
}

export const getExplorerCapabilities = deriveExplorerCapabilities;
