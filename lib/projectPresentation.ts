// Phase 8 (#187, plan §14/§17) — the presentation vocabulary shared by every
// projects surface.
//
// WHY THIS IS A PLAIN .ts AND NOT PART OF components/entities/EntityUI.tsx:
// §17's diagnosis is that users cannot tell a portfolio from a project from a
// pipeline from a task. The fix is a fixed mapping from entity -> identity
// (shape, icon, hue, wording) plus a fixed mapping from project state ->
// health. Both are pure data/branches, and branches are the part that can
// silently drift, so they live here where `projectPresentation.check.ts` can
// assert them under plain `npx tsx` (same split as lib/imports/
// spreadsheetMapping.ts vs spreadsheetIntake.ts). EntityUI.tsx is the
// react-native rendering layer on top; it holds no thresholds of its own.
//
// Deliberately imports NOTHING — not even useThemeColors — so the check file
// stays runnable. Colours arrive as a structural argument that
// `useThemeColors()`'s return value already satisfies.

export type PresentationColors = {
  primary: string;
  secondary: string;
  accent: string;
  muted: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  textMain: string;
  textMuted: string;
  textDim: string;
  border: string;
  card: string;
  background: string;
};

export type EntityKind = 'project' | 'portfolio' | 'client' | 'board' | 'task' | 'template';

/**
 * The glyph shape. Shape is not decoration — it encodes what class of thing
 * this is, so the four entities §17 says users confuse are distinguishable
 * before a single word is read:
 *
 * - `circle`    — a who (a person or an organisation)
 * - `square`    — a container of work (one project)
 * - `stack`     — a container of containers (a portfolio: many projects)
 * - `flow`      — a route work travels along (a board / pipeline)
 * - `blueprint` — not a real instance, a pattern instances are cut from
 *                 (a template); rendered with a dashed edge
 * - `tick`      — one unit of work (a task)
 */
export type EntityShape = 'circle' | 'square' | 'stack' | 'flow' | 'blueprint' | 'tick';

export type EntityMeta = {
  /** Singular, user-facing. The ONLY spelling any screen may use for this entity. */
  label: string;
  plural: string;
  /** FontAwesome 4 name. Empty string means "render a monogram instead". */
  icon: string;
  shape: EntityShape;
  /** Which `PresentationColors` key is this entity's fixed hue. */
  tone: keyof PresentationColors;
  /** One sentence that explains the ENTITY. §17: never "No projects." */
  blurb: string;
};

export const ENTITY_META: Record<EntityKind, EntityMeta> = {
  project: {
    label: 'Project',
    plural: 'Projects',
    icon: 'briefcase',
    shape: 'square',
    tone: 'primary',
    blurb: 'A project is one piece of work for one client — its own tasks, its own deadline, and one stage it currently sits in.',
  },
  portfolio: {
    label: 'Portfolio',
    plural: 'Portfolios',
    icon: 'th-large',
    shape: 'stack',
    tone: 'secondary',
    blurb: 'A portfolio is a group of projects created together — one intake, one client office, one season.',
  },
  client: {
    label: 'Client',
    plural: 'Clients',
    icon: '',
    shape: 'circle',
    tone: 'info',
    blurb: 'A client is the organisation the work is for. Its standing files stay put year after year.',
  },
  board: {
    label: 'Board',
    plural: 'Boards',
    icon: 'columns',
    shape: 'flow',
    tone: 'muted',
    blurb: 'A board is the run of stages work moves through. Projects travel across it; it is not a thing you deliver.',
  },
  task: {
    label: 'Task',
    plural: 'Tasks',
    icon: 'check',
    shape: 'tick',
    tone: 'textMuted',
    blurb: 'A task is one unit of work inside a project — assigned to a person, tracked with a timer.',
  },
  template: {
    label: 'Template',
    plural: 'Templates',
    icon: 'clone',
    shape: 'blueprint',
    tone: 'accent',
    blurb: 'A template is the task list a project starts from — captured once from real work, reused every year.',
  },
};

// ── Ageing / deadline thresholds ───────────────────────────────────────────
// Moved here from ProjectsTable.tsx (they were exported from a screen file and
// already imported by two others). One definition, one place to change them.
// ponytail: fixed thresholds, not a config value — revisit if a company wants
// a custom ageing scale.

export function ageColor(days: number | null, c: PresentationColors): string {
  if (days == null) return c.textMuted;
  if (days >= 14) return c.danger;
  if (days >= 7) return c.warning;
  return c.textMuted;
}

export function dueColor(daysRemaining: number | null, c: PresentationColors): string {
  if (daysRemaining == null) return c.textMuted;
  if (daysRemaining < 0) return c.danger;
  if (daysRemaining <= 3) return c.warning;
  return c.textMuted;
}

export function fmtDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtDue(daysRemaining: number | null, dueDate: string | null): string {
  if (!dueDate) return 'No due date';
  if (daysRemaining == null) return fmtDate(dueDate);
  if (daysRemaining < 0) return `${Math.abs(daysRemaining)}d overdue`;
  if (daysRemaining === 0) return 'Due today';
  return `${daysRemaining}d left`;
}

export function initials(name: string | null): string {
  if (!name) return '?';
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?';
}

// ── Health ─────────────────────────────────────────────────────────────────
// One badge answers "should I look at this?" across the table, the board, the
// detail header and (Phase 10) five more surfaces. Precedence matters: a
// blocked project that is also overdue reads "Blocked", because blocked is
// the thing a human can act on.

export type HealthTone = 'danger' | 'warning' | 'success' | 'muted';

export type ProjectHealth = {
  key: 'blocked' | 'overdue' | 'awaiting-client' | 'at-risk' | 'due-soon' | 'on-track';
  label: string;
  tone: HealthTone;
  icon: string;
  /** Always answerable — a badge that says nothing is the bare text §14.1 bans. */
  detail: string;
};

export function projectHealth(input: {
  blocked?: boolean | null;
  blockedReason?: string | null;
  flags?: readonly string[] | null;
  daysRemaining?: number | null;
}): ProjectHealth {
  const flags = input.flags ?? [];
  if (input.blocked || flags.includes('blocked')) {
    return { key: 'blocked', label: 'Blocked', tone: 'danger', icon: 'ban', detail: input.blockedReason?.trim() || 'Blocked, no reason given' };
  }
  if (input.daysRemaining != null && input.daysRemaining < 0) {
    return { key: 'overdue', label: 'Overdue', tone: 'danger', icon: 'exclamation-circle', detail: `${Math.abs(input.daysRemaining)}d past its due date` };
  }
  if (flags.includes('awaiting_client')) {
    return { key: 'awaiting-client', label: 'Awaiting client', tone: 'warning', icon: 'hourglass-half', detail: 'Waiting on something from the client' };
  }
  if (flags.includes('at_risk')) {
    return { key: 'at-risk', label: 'At risk', tone: 'warning', icon: 'exclamation-triangle', detail: 'Flagged as at risk by the team' };
  }
  if (input.daysRemaining != null && input.daysRemaining <= 3) {
    return { key: 'due-soon', label: 'Due soon', tone: 'warning', icon: 'clock-o', detail: input.daysRemaining === 0 ? 'Due today' : `${input.daysRemaining}d left` };
  }
  return { key: 'on-track', label: 'On track', tone: 'success', icon: 'check', detail: 'Not blocked, nothing overdue' };
}

export function toneColor(tone: HealthTone, c: PresentationColors): string {
  return tone === 'danger' ? c.danger : tone === 'warning' ? c.warning : tone === 'success' ? c.success : c.textMuted;
}
