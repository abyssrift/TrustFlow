import { getShortcut, shortcutVisible } from '@/components/sidebar/constants';

export type GuideId =
  | 'profile'
  | 'top-bar'
  | 'tasks'
  | 'task-workflow'
  | 'deadlines'
  | 'projects'
  | 'portfolios'
  | 'filehub'
  | 'filehub-sharing'
  | 'team-people'
  | 'team-assignments'
  | 'workflow-pipelines'
  | 'intelligence';
export type GuideStatus = 'not_started' | 'in_progress' | 'done';
/** Read-only states accepted by checklist selectors for older/familiar records. */
export type GuideRowStatus = GuideStatus | 'familiar';
export type GuideScope = 'universal' | 'capability';
export type GuidePhaseId = 'start' | 'get-work-done' | 'organize-workspace' | 'understand-results';
export type GuideAnchorId = `${GuideId}:${string}`;
export type GuideStep = { id: string; title: string; body: string; anchorId?: GuideAnchorId };
export type GuideDefinition = {
  id: GuideId;
  version: number;
  title: string;
  summary: string;
  route: string;
  scope: GuideScope;
  eligibilityPermission?: string;
  phaseId: GuidePhaseId;
  order: number;
  shortcutId?: 'tasks' | 'deadlines' | 'projects' | 'portfolios' | 'filehub' | 'team' | 'pipelines-admin' | 'radar';
  steps: readonly GuideStep[];
};
export type GuidePhase = { id: GuidePhaseId; title: string; order: number };
export type GuideProgress = {
  guideId: GuideId;
  guideVersion: number;
  status: GuideStatus;
  currentStep: number;
  firstEligibleAt: string;
  acknowledgedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};
export type GuideEligibilityContext = {
  authenticated: boolean;
  profileReady: boolean;
  accessReady: boolean;
  hasPermission: (key: string) => boolean;
  isOwner: boolean;
  isMobile: boolean;
};

export const GUIDE_PHASES: readonly GuidePhase[] = [
  { id: 'start', title: 'Start here', order: 0 },
  { id: 'get-work-done', title: 'Get work done', order: 1 },
  { id: 'organize-workspace', title: 'Organize your workspace', order: 2 },
  { id: 'understand-results', title: 'Understand results', order: 3 },
];

const universal: GuideScope = 'universal';
const capability: GuideScope = 'capability';

/**
 * Screen-first curriculum. Surface guides share the same destination visibility
 * rule as navigation; universal guides remain at the head of the catalog when
 * a workspace gains new capabilities.
 */
export const GUIDE_REGISTRY: readonly GuideDefinition[] = [
  {
    id: 'profile', version: 1, scope: universal, phaseId: 'start', order: 0,
    title: 'Your profile', summary: 'Keep your identity and contact details current.', route: '/profile',
    steps: [
      { id: 'identity', title: 'Make yourself recognizable', body: 'Keep your name and profile image current so teammates can recognize you.', anchorId: 'profile:identity' },
      { id: 'contact', title: 'Keep contact details current', body: 'Update the details teammates use when they need to reach you.' },
      { id: 'preferences', title: 'Choose a comfortable workspace', body: 'Set your display preferences from your profile settings.' },
    ],
  },
  {
    id: 'top-bar', version: 1, scope: universal, phaseId: 'start', order: 1,
    title: 'Navigate TrustFlow', summary: 'Reach pages, dates, and recent activity from the app shell.', route: '/',
    steps: [
      { id: 'navigation', title: 'Jump to a page or action', body: 'Use search and the command palette to reach destinations and common actions.', anchorId: 'top-bar:navigation' },
      { id: 'deadlines', title: 'Keep upcoming dates in view', body: 'Open the deadlines view to review work coming due.' },
      { id: 'activity', title: 'Catch up on recent activity', body: 'Use the activity area to return to updates that need your attention.', anchorId: 'top-bar:activity' },
    ],
  },
  {
    id: 'tasks', version: 1, scope: capability, phaseId: 'get-work-done', order: 0,
    title: 'Work through tasks', summary: 'Find assigned work and move it through the board.', route: '/tasks', shortcutId: 'tasks',
    steps: [
      { id: 'board', title: 'Find assigned work', body: 'Use the board to see the work that needs your attention.', anchorId: 'tasks:board' },
      { id: 'move', title: 'Move work forward', body: 'Advance a task when its next stage is ready.', anchorId: 'tasks:move' },
      { id: 'empty-board', title: 'Use the board as work changes', body: 'Return to the board as assignments and stages change through a project.' },
    ],
  },
  {
    id: 'task-workflow', version: 1, scope: capability, phaseId: 'get-work-done', order: 1,
    title: 'Keep task work moving', summary: 'Use task stages, assignments, and due dates to coordinate next steps.', route: '/tasks', shortcutId: 'tasks',
    steps: [
      { id: 'stages', title: 'Read the stage', body: 'A task stage shows where work sits in its workflow.' },
      { id: 'next-step', title: 'Choose the next step', body: 'Move a task when its current work is ready for the next stage.' },
      { id: 'ownership', title: 'Keep ownership clear', body: 'Check who is assigned and when the work is due before handing it along.' },
    ],
  },
  {
    id: 'deadlines', version: 1, scope: capability, phaseId: 'get-work-done', order: 2,
    title: 'Plan around deadlines', summary: 'Scan due dates and open the work behind them.', route: '/deadlines', shortcutId: 'deadlines',
    steps: [
      { id: 'scan', title: 'Scan what is coming up', body: 'Use the calendar view to review upcoming due dates.' },
      { id: 'open-work', title: 'Open the underlying work', body: 'Select an item to return to the task or project that needs attention.' },
      { id: 'plan', title: 'Use dates to plan', body: 'Review due dates alongside your assigned work before deciding what to do next.' },
    ],
  },
  {
    id: 'projects', version: 1, scope: capability, phaseId: 'get-work-done', order: 3,
    title: 'Track projects', summary: 'Review project progress and open the work that needs attention.', route: '/projects', shortcutId: 'projects',
    steps: [
      { id: 'overview', title: 'Scan project progress', body: 'Use the projects list to compare stage, due date, and completion at a glance.' },
      { id: 'details', title: 'Open a project', body: 'Open a project to see its overview, work, and related files.' },
      { id: 'board', title: 'Choose a useful view', body: 'Switch between the projects table and board to review the same work in different ways.' },
    ],
  },
  {
    id: 'portfolios', version: 1, scope: capability, phaseId: 'get-work-done', order: 4,
    title: 'Group projects into portfolios', summary: 'Review related projects together and follow a shared program.', route: '/portfolios', shortcutId: 'portfolios',
    steps: [
      { id: 'browse', title: 'Browse portfolios', body: 'Open a portfolio to see the projects grouped within it.' },
      { id: 'progress', title: 'Review the group', body: 'Use portfolio totals to understand progress across related projects.' },
      { id: 'open-project', title: 'Follow an individual project', body: 'Open a project from the portfolio when you need its detailed work.' },
    ],
  },
  {
    id: 'filehub', version: 1, scope: capability, phaseId: 'organize-workspace', order: 0,
    title: 'Find shared files', summary: 'Browse shared files and use the actions available to you.', route: '/filehub', shortcutId: 'filehub',
    steps: [
      { id: 'navigation', title: 'Browse shared files', body: 'Use the navigation to find files shared with your team.', anchorId: 'filehub:navigation' },
      { id: 'primary-action', title: 'Work with a file', body: 'Use the available primary action to add or manage shared files.', anchorId: 'filehub:primary-action' },
      { id: 'details', title: 'Review file details', body: 'Open a file to see its details, activity, and available versions.' },
    ],
  },
  {
    id: 'filehub-sharing', version: 1, scope: capability, phaseId: 'organize-workspace', order: 1,
    title: 'Share and organize files', summary: 'Keep documents easy to find and available to the right people.', route: '/filehub', shortcutId: 'filehub',
    steps: [
      { id: 'folders', title: 'Use folders to organize', body: 'Browse the folder navigation to keep related files together.' },
      { id: 'sharing', title: 'Check where a file is shared', body: 'Review a file’s details before sharing or moving it.' },
      { id: 'history', title: 'Return to earlier versions', body: 'Open version history when you need to review or restore a previous file version.' },
    ],
  },
  {
    id: 'team-people', version: 1, scope: capability, phaseId: 'organize-workspace', order: 2,
    title: 'Find your team', summary: 'Browse people and teams from one place.', route: '/people?section=teams', shortcutId: 'team',
    steps: [
      { id: 'list', title: 'Find your teammates', body: 'Browse people and teams from one place.', anchorId: 'team-people:list' },
      { id: 'primary-action', title: 'Manage your team', body: 'Use the available team action to keep assignments up to date.', anchorId: 'team-people:primary-action' },
      { id: 'directory', title: 'Follow team membership', body: 'Use the team list to see who works together and keep ownership clear.' },
    ],
  },
  {
    id: 'team-assignments', version: 1, scope: capability, phaseId: 'organize-workspace', order: 3,
    eligibilityPermission: 'role.manage',
    title: 'Coordinate team assignments', summary: 'Use team membership to make work ownership clear.', route: '/people?section=teams', shortcutId: 'team',
    steps: [
      { id: 'teams', title: 'Start from a team', body: 'Choose a team to review its members and current assignments.' },
      { id: 'ownership', title: 'Check who owns the work', body: 'Review member and team assignments when coordinating shared work.' },
      { id: 'keep-current', title: 'Keep the directory current', body: 'Update team membership when people join or change responsibilities.' },
    ],
  },
  {
    id: 'workflow-pipelines', version: 1, scope: capability, phaseId: 'organize-workspace', order: 4,
    title: 'Shape your workflow', summary: 'Find a workflow and adjust how work progresses.', route: '/admin/pipelines', shortcutId: 'pipelines-admin',
    steps: [
      { id: 'list', title: 'Choose a workflow', body: 'Find the workflow that organizes your team’s work.', anchorId: 'workflow-pipelines:list' },
      { id: 'configuration', title: 'Shape the stages', body: 'Adjust stages so the workflow reflects how work moves forward.', anchorId: 'workflow-pipelines:configuration' },
      { id: 'review', title: 'Review the path', body: 'Check the stage order so teammates can tell what should happen next.' },
    ],
  },
  {
    id: 'intelligence', version: 1, scope: capability, phaseId: 'understand-results', order: 0,
    title: 'Understand workspace insights', summary: 'Use the intelligence hub to review trends and team outcomes.', route: '/intelligence', shortcutId: 'radar',
    steps: [
      { id: 'overview', title: 'Start with the overview', body: 'Use the hub to find the available views for performance, reports, and targets.' },
      { id: 'compare', title: 'Look for patterns', body: 'Compare trends over time to spot changes in workload and delivery.' },
      { id: 'follow-up', title: 'Return to the work', body: 'Use an insight to decide which project or workflow needs a closer look.' },
    ],
  },
];

export function eligibleGuides(ctx: GuideEligibilityContext): GuideDefinition[] {
  if (!ctx.authenticated || !ctx.profileReady || !ctx.accessReady) return [];
  return GUIDE_REGISTRY.filter((guide) => {
    if (guide.scope === 'universal') return true;
    if (guide.eligibilityPermission && !ctx.hasPermission(guide.eligibilityPermission)) return false;
    if (!guide.shortcutId) return false;
    const shortcut = getShortcut(guide.shortcutId);
    return !!shortcut && shortcutVisible(shortcut, ctx);
  });
}

export function eligibleGuidePhases(definitions: readonly GuideDefinition[]): (GuidePhase & { guides: GuideDefinition[] })[] {
  const byPhase = new Map<GuidePhaseId, GuideDefinition[]>();
  for (const guide of definitions) byPhase.set(guide.phaseId, [...(byPhase.get(guide.phaseId) ?? []), guide]);
  return GUIDE_PHASES
    .filter(({ id }) => byPhase.has(id))
    .map((phase) => ({
      ...phase,
      guides: (byPhase.get(phase.id) ?? []).sort((left, right) => left.order - right.order),
    }));
}

export function getGuideStatusLabel(status: GuideRowStatus): 'Not started' | 'In progress' | 'Done' | 'Familiar' {
  if (status === 'not_started') return 'Not started';
  if (status === 'in_progress') return 'In progress';
  return status === 'familiar' ? 'Familiar' : 'Done';
}

/** Legacy acknowledgement check; prefer getSubtleNewGuideIds for checklist badges. */
export function isGuideNew(progress: Pick<GuideProgress, 'acknowledgedAt'>): boolean {
  return progress.acknowledgedAt === null;
}

export function clampGuideStep(id: GuideId, step: number): number {
  const definition = GUIDE_REGISTRY.find((guide) => guide.id === id);
  if (!definition) return Math.max(0, Math.trunc(Number.isFinite(step) ? step : 0));
  return Math.max(0, Math.min(definition.steps.length - 1, Math.trunc(Number.isFinite(step) ? step : 0)));
}

export function filterEligibleProgress(
  progressById: Partial<Record<GuideId, GuideProgress>>,
  eligibleDefinitions: readonly GuideDefinition[],
): Partial<Record<GuideId, GuideProgress>> {
  const eligibleIds = new Set(eligibleDefinitions.map(({ id }) => id));
  return Object.fromEntries(Object.entries(progressById).filter(([id, progress]) => !!progress && eligibleIds.has(id as GuideId))) as Partial<Record<GuideId, GuideProgress>>;
}

export type GuideRowProgress = { status?: GuideRowStatus; acknowledgedAt?: string | null };
export type GuideRowOptions = { rediscoverIds?: readonly GuideId[]; hideCompleted?: boolean; hideFamiliar?: boolean };

/** Hides finished/familiar rows by default while allowing an explicit rediscovery list to reveal them. */
export function visibleGuides<T extends GuideDefinition>(
  definitions: readonly T[],
  progressById: Partial<Record<GuideId, GuideRowProgress>> = {},
  options: GuideRowOptions = {},
): T[] {
  const rediscover = new Set(options.rediscoverIds ?? []);
  const hideCompleted = options.hideCompleted ?? true;
  const hideFamiliar = options.hideFamiliar ?? true;
  return definitions.filter((guide) => {
    if (rediscover.has(guide.id)) return true;
    const status = progressById[guide.id]?.status;
    if (hideCompleted && status === 'done') return false;
    if (hideFamiliar && status === 'familiar') return false;
    return true;
  });
}

/** Newly eligible capability entries with a newly discovered, unacknowledged, unfinished record. */
export function getSubtleNewGuideIds(
  previousEligible: readonly GuideDefinition[],
  currentEligible: readonly GuideDefinition[],
  progressById: Partial<Record<GuideId, GuideRowProgress>>,
): GuideId[] {
  const previousIds = new Set(previousEligible.map(({ id }) => id));
  return currentEligible
    .filter((guide) => !previousIds.has(guide.id) && guide.scope === 'capability')
    .filter((guide) => {
      const progress = progressById[guide.id];
      return !!progress && progress.acknowledgedAt === null && progress.status !== 'done' && progress.status !== 'familiar';
    })
    .map(({ id }) => id);
}

/** A simple eligibility diff for callers that need to reconcile newly visible records. */
export function getNewGuideIds(previousEligible: readonly GuideDefinition[], currentEligible: readonly GuideDefinition[]): GuideId[] {
  const previousIds = new Set(previousEligible.map(({ id }) => id));
  return currentEligible.filter(({ id }) => !previousIds.has(id)).map(({ id }) => id);
}