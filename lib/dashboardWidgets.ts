// Pure logic behind the dashboard widget system (#213, Wave 1), split out so
// the branchy bits — storage migration, role seeding, size cycling, reorder
// bounds — can be asserted standalone via `npx tsx lib/dashboardWidgets.check.ts`
// without pulling in react-native. Same split as lib/multiViewList.ts and
// lib/imports/spreadsheetMapping.ts.
//
// No React, no react-native, no AsyncStorage in this file. The React half is
// hooks/useDashboardLayout.ts (persistence) and
// components/dashboard/widgets/registry.tsx (WidgetDef = WidgetMeta + component).

import type { OverviewMetricKey } from '@/hooks/usePipelineOverviewData';

// ── Sizes ────────────────────────────────────────────────────────────────

export type WidgetSize = 's' | 'm' | 'l';

/** Canonical order — cycleSize walks this, filtered by a type's allowedSizes. */
export const ALL_WIDGET_SIZES: readonly WidgetSize[] = ['s', 'm', 'l'];

/** flexBasis in px per size. 'l' is a full row. */
export const WIDGET_BASIS: Record<WidgetSize, number | '100%'> = { s: 230, m: 480, l: '100%' };

/** ui-consistency.md §5 "Section gaps: gap-4 or gap-6" — 16px is gap-4. */
export const WIDGET_GAP = 16;

/** Row cap a list widget slices to, unless it declares a `limit` config field. */
export const ROWS_BY_SIZE: Record<WidgetSize, number> = { s: 3, m: 6, l: 10 };

// ── Height tiers ─────────────────────────────────────────────────────────

/**
 * The vertical grid every card snaps to. 180px is not arbitrary: it is what the
 * shortest real card already measures — a 72px shell header (px-4 pt-4 pb-3
 * around a 44px control row) plus a hero StatTile and its meter plus pb-4 comes
 * to ~178px in `pipeline-completion` at 's'. Anything smaller would be a floor
 * nothing ever hits; anything larger would pad that card out on day one.
 *
 * Two units (360) is then close to the natural height of a 6-row list, the
 * five-lane projection strip (~322) and the 'm' completion card (~350), which
 * is why those land on the grid without being stretched to reach it.
 */
export const WIDGET_HEIGHT_UNIT = 180;

/** Units of WIDGET_HEIGHT_UNIT a card is at least tall. Never more than 3. */
export type WidgetHeightTier = 1 | 2 | 3;

/**
 * The tier a type gets when it declares none — which is every type the moment
 * someone adds one, so it has to be defensible on its own. A bigger size
 * preference is a request for more room, so 's' is one unit and 'm'/'l' are
 * two. A type whose content genuinely does not grow with its size overrides it
 * (see `facts` and `blocked-exceptions` in WIDGET_META).
 */
const DEFAULT_HEIGHT_TIER: Record<WidgetSize, WidgetHeightTier> = { s: 1, m: 2, l: 2 };

export function widgetHeightTier(type: WidgetType, size: WidgetSize): WidgetHeightTier {
  return WIDGET_META[type].heightTier?.[size] ?? DEFAULT_HEIGHT_TIER[size];
}

/**
 * The card's `minHeight` — a FLOOR, never a fixed height. Combined with the
 * ROWS_BY_SIZE caps it pins the bottoms of a row of cards without ever clipping
 * content that wraps at a narrow width, and without any widget scrolling
 * internally (which registry.tsx forbids: both dashboards are one page-level
 * ScrollView).
 *
 * Zero for a `bare` type: it draws its own card inside the shell's wrapper, so
 * a floor on the wrapper would add empty space UNDER that card rather than
 * making it taller.
 *
 * That exemption is also the reason `bare` is now down to ONE type. A bare
 * widget is the only card on its row with no floor, so it renders at its own
 * content height while every neighbour is quantized — "the pipeline graph is
 * sometimes shorter than the other widgets", reported and fixed by taking
 * `bare` off pipeline-overview. The remaining bare type (pending-time-approvals)
 * wants no floor anyway: it self-hides when its queue is empty, and 360px of
 * card around two approval rows is the bug, not the fix.
 */
export function widgetMinHeight(type: WidgetType, size: WidgetSize): number {
  if (WIDGET_META[type].bare) return 0;
  return widgetHeightTier(type, size) * WIDGET_HEIGHT_UNIT;
}

/**
 * Rows a list widget actually shows: an explicit `limit` from the config sheet
 * if there is one, otherwise the size default. One definition, because the
 * widget body slices by it and the header's subtitle reports it — two copies of
 * this arithmetic is a header that lies about the list underneath it.
 */
export function rowLimit(config: Record<string, string>, size: WidgetSize): number {
  const configured = Number(config.limit);
  return Number.isFinite(configured) && configured > 0 ? configured : ROWS_BY_SIZE[size];
}

/**
 * Style for one cell of the flexWrap grid. Three details here are load-bearing
 * and must NOT be "cleaned up":
 *
 * - `flexShrink: 0` — Yoga and react-native-web default flexShrink differently
 *   from the CSS spec. If cells may shrink they never wrap, and eight widgets
 *   end up as eight slivers on one line instead of a grid.
 * - `maxWidth: '100%'` — with flexShrink 0 and flexBasis 480, an 'm' widget
 *   inside a 335px content column (390px viewport minus p-5) overflows the
 *   screen horizontally. This is the single most likely mobile bug here.
 * - `flexGrow: 1` — so the last row has no ragged right edge. Consequence: an
 *   's' alone on a row becomes full width. Intended; sizes are a minimum
 *   preference, not a fixed width.
 */
export function sizeToFlex(size: WidgetSize) {
  return {
    flexGrow: 1,
    flexShrink: 0,
    flexBasis: WIDGET_BASIS[size],
    maxWidth: '100%' as const,
  };
}

export function isWidgetSize(raw: unknown): raw is WidgetSize {
  return raw === 's' || raw === 'm' || raw === 'l';
}

/**
 * Next size in canonical order, wrapping, restricted to the sizes this widget
 * type allows. A size outside the allowed set (persisted before the type
 * narrowed its allowedSizes) falls back to the first allowed one.
 */
export function cycleSize(size: WidgetSize, allowed: readonly WidgetSize[] = ALL_WIDGET_SIZES): WidgetSize {
  if (allowed.length === 0) return size;
  const i = allowed.indexOf(size);
  if (i === -1) return allowed[0];
  return allowed[(i + 1) % allowed.length];
}

// ── Instances ────────────────────────────────────────────────────────────

export type WidgetType =
  | 'facts'
  | 'projection-strip'
  | 'blocked-exceptions'
  | 'pipeline-overview'
  | 'pipeline-completion'
  | 'recent-activity'
  | 'active-projects'
  | 'pending-time-approvals'
  // Seed generation 2 — the personal set. See the block in WIDGET_META.
  | 'my-work'
  | 'my-deadlines'
  | 'last-worked-on'
  | 'live-now'
  | 'filehub-inbox'
  | 'my-performance';

export type WidgetInstance = {
  /** Stable, unique within a dashboard. NOT the type — a type may appear twice. */
  id: string;
  type: WidgetType;
  size: WidgetSize;
  /** Only keys declared in the type's configFields. Values are ALWAYS strings. */
  config: Record<string, string>;
};

// ── Registry metadata (pure half) ────────────────────────────────────────

/**
 * BOUNDED on purpose: a select, and nothing else. No free text, no numeric
 * input, no query builder — this is not a form engine, and only three of the
 * fourteen widget types declare a field at all.
 */
export type WidgetConfigField = {
  key: string;
  label: string;
  options: { value: string; label: string }[];
  default: string;
};

export type WidgetCategory = 'overview' | 'projects' | 'analytics' | 'activity';

/** Order the Add-widget picker groups its sections in. */
export const WIDGET_CATEGORY_ORDER: readonly WidgetCategory[] = ['overview', 'projects', 'analytics', 'activity'];

export type WidgetMeta = {
  title: string;
  /** FontAwesome name. */
  icon: string;
  /** One line, shown in the Add picker. */
  blurb: string;
  defaultSize: WidgetSize;
  /** Permission key for useAuth().hasPermission. null = always allowed. */
  requiredPermission: string | null;
  category: WidgetCategory;
  /** Empty => WidgetShell renders no configure button. */
  configFields: WidgetConfigField[];
  /**
   * One line under the title, whose only job is to tell two instances of the
   * SAME type apart at a glance. It must read as a VALUE — "Monthly", "Top 10" —
   * never as a form label ("Time period: Monthly"), which is what a generic
   * walk of `configFields` produces and why this is per-type instead. A type
   * with nothing that varies between instances declares none, which is the same
   * signal as its missing gear button.
   */
  subtitle?: (instance: WidgetInstance) => string | undefined;
  /** Defaults to all three. cycleSize cycles within this. */
  allowedSizes?: WidgetSize[];
  /**
   * Per-size height tier, in WIDGET_HEIGHT_UNIT multiples. Omit a size (or the
   * whole field) to take DEFAULT_HEIGHT_TIER — which is what every new type
   * gets, so declaring this is the exception. Only worth setting when a type's
   * content does NOT grow with its size preference.
   */
  heightTier?: Partial<Record<WidgetSize, WidgetHeightTier>>;
  /** Seed generation this type shipped in. Omitted = 1, the original set. */
  seedVersion?: number;
  /** At most one instance; the picker disables the entry once one exists. */
  singleton?: boolean;
  /**
   * Component draws its own card AND its own heading; WidgetShell renders bare.
   *
   * A high bar, and it was set too low once: four types were marked `bare`, but
   * only two of them actually drew a card. The other two got no surface, no
   * border, no radius and no title bigger than 10px — they read as loose text
   * in a grid of cards, which is what users reported. If a panel does not draw
   * `bg-surface-card` + `border-surface-border` + `rounded-2xl` AND a real
   * heading, it is not `bare`; give it the shell and let it render `embedded`.
   *
   * Second cost, and the one that took pipeline-overview out of this set: a
   * bare type gets NO height floor (see `widgetMinHeight`), because the floor
   * would land on the wrapper and pad under the child's card instead of
   * stretching it. Only mark a type bare when it wants to be the short one.
   */
  bare?: boolean;
  /** Drop WidgetShell body padding (edge-to-edge rows). */
  flush?: boolean;
};

/**
 * `my-performance`'s windows, declared once: the config sheet's options and the
 * subtitle naming the chosen one are the same three labels. The widget body maps
 * the VALUE to a day count itself and never needs the labels, which is why they
 * do not travel with it.
 */
const PERFORMANCE_PERIODS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

/**
 * The metadata half of the registry. The React half (`WidgetDef = WidgetMeta &
 * { component }`) lives in components/dashboard/widgets/registry.tsx and merges
 * a component onto each of these — one source of truth for what a widget IS,
 * importable by the self-check without a react-native bundle.
 */
export const WIDGET_META: Record<WidgetType, WidgetMeta> = {
  'facts': {
    title: 'At a glance',
    icon: 'dashboard',
    blurb: "Today's numbers as stat tiles — hides anything that is zero.",
    defaultSize: 'l',
    requiredPermission: null,
    category: 'overview',
    configFields: [],
    // NOT bare. DashboardFacts draws no card of its own — never did; it was
    // written as the full-width strip under the greeting — so `bare` gave this
    // widget no surface, no border and no radius at all, which is exactly the
    // "it doesn't look like a card" the users reported.
    // 's' is withheld: a 230px cell is two ~91px tile columns, too narrow for
    // either a formatted duration or the longest label.
    allowedSizes: ['m', 'l'],
    // OVERRIDE: a KPI row does not get taller with more room, it gets WIDER —
    // the same eight tiles are two wrapped rows at 'm' and one line at 'l'. The
    // default two units would be ~230px of empty card under the tiles at 'l'.
    heightTier: { m: 1, l: 1 },
    singleton: true,
  },
  'pipeline-completion': {
    title: 'Pipeline completion',
    icon: 'tasks',
    blurb: 'Plain progress bars for in-progress, completed and failed work.',
    defaultSize: 'm',
    requiredPermission: null,
    category: 'overview',
    configFields: [],
    // 's' = the headline percentage and the meter it measures; 'm' adds the
    // per-state breakdown. 'l' is withheld because it would be 'm' with longer
    // bars — the size has to buy content, not width (see the widget body).
    allowedSizes: ['s', 'm'],
    singleton: true,
  },
  'projection-strip': {
    title: 'Landing',
    icon: 'calendar',
    blurb: 'Where the server thinks your projects will actually land.',
    defaultSize: 'l',
    requiredPermission: 'project.view',
    category: 'projects',
    configFields: [],
    // ProjectionStrip sizes its labels from useWindowDimensions, not its
    // container, so a 230px cell on a wide desktop would use the 168px
    // desktop label. 's' is withheld rather than rewriting that component.
    allowedSizes: ['m', 'l'],
    singleton: true,
    // NOT bare, and `flush` instead: the shell draws the card and the title,
    // the strip draws only the axis and the lanes (its `embedded` prop). It
    // used to nest its own card inside the shell's cell with a 10px dim eyebrow
    // as its only heading — two radii and nothing that read as a title.
    flush: true,
  },
  'blocked-exceptions': {
    title: 'Needs attention',
    icon: 'exclamation-triangle',
    blurb: 'Projects the server flagged as blocked or slipping.',
    defaultSize: 'l',
    requiredPermission: 'project.view',
    category: 'projects',
    configFields: [],
    // Full-width ProjectCards do not become smaller in a 230px cell — the
    // panel's MAX_SHOWN and its card layout are both server/design decisions
    // this widget may not re-derive. Same call as projection-strip and
    // pipeline-overview: withhold 's' rather than rewrite the panel.
    allowedSizes: ['m', 'l'],
    // OVERRIDE: "the empty state is the state it is in most of the time" is
    // this panel's own header comment. Its all-clear is one line; the exception
    // list, when it fires, is far past any tier anyway. One unit is the floor
    // that matches the common case instead of the rare one.
    heightTier: { m: 1, l: 1 },
    singleton: true,
    // NOT bare. The ProjectCards it lists carry their own chrome, but its
    // all-clear, error and loading branches are single quiet lines by design —
    // `bare` left those floating in a grid of cards with no card around them.
    // The shell supplies the surface; the panel's `embedded` prop drops only
    // its duplicate eyebrow, and its count moves into a badge.
  },
  'active-projects': {
    title: 'Active projects',
    icon: 'folder-open',
    blurb: 'Your four featured projects with their completion meters.',
    defaultSize: 'l',
    requiredPermission: 'project.view',
    category: 'projects',
    configFields: [],
    singleton: true,
    flush: true,
  },
  'pipeline-overview': {
    title: 'Pipeline overview',
    icon: 'line-chart',
    blurb: 'Throughput, points and success rate across tracked pipelines.',
    defaultSize: 'l',
    requiredPermission: 'analytics.view',
    category: 'analytics',
    configFields: [{
      key: 'period',
      label: 'Time period',
      options: [{ value: 'week', label: 'Weekly' }, { value: 'month', label: 'Monthly' }],
      default: 'week',
    }],
    // The option's own label, not "Time period: Weekly" — the field name is
    // already the gear button's job, and a card header has room for one word.
    subtitle: i => (i.config.period === 'month' ? 'Monthly' : 'Weekly'),
    // Same reason as projection-strip: the chart is unusable in a 230px cell.
    allowedSizes: ['m', 'l'],
    // Deliberately NOT a singleton — one weekly and one monthly side by side is
    // a real use, and AnalyticsContext dedup-caches identical params anyway.
    //
    // NOT bare, for the same reason `facts` and `projection-strip` stopped
    // being: a bare type is exempt from `widgetMinHeight`, so the chart was the
    // one card on its row rendering at its own content height while every
    // neighbour was floored to a 180/360 tier — the reported "the graph is
    // sometimes shorter than the other widgets". The shell owns the card, the
    // title and the Weekly/Monthly subtitle now; the chart draws only its
    // controls, legend and plot, and its plot flexes into whatever height the
    // tier gives it. Not `flush`: legend and plot want the body's px-4 pb-4.
  },
  'recent-activity': {
    title: 'Recent activity',
    icon: 'history',
    blurb: 'The last stage moves across your tracked pipelines.',
    defaultSize: 'm',
    requiredPermission: null,
    category: 'activity',
    configFields: [{
      key: 'limit',
      label: 'Rows shown',
      options: [{ value: '5', label: '5' }, { value: '10', label: '10' }, { value: '20', label: '20' }],
      default: '5',
    }],
    // The real row count, size default included — not the config field's
    // `default`, which lies whenever the size is what decided the number.
    subtitle: i => `Top ${rowLimit(i.config, i.size)}`,
    flush: true,
  },
  'pending-time-approvals': {
    title: 'Time approvals',
    icon: 'hourglass-end',
    blurb: 'Manual time entries waiting on your decision.',
    defaultSize: 'l',
    requiredPermission: null,
    category: 'activity',
    configFields: [],
    // Singleton because each mount opens its own realtime channel — two
    // instances would be two subscriptions for one list.
    singleton: true,
    bare: true,
  },

  // ── Seed generation 2: the personal set ────────────────────────────────
  // The hole these fill: everything above is a COMPANY aggregate. A member with
  // no special permissions saw `facts`, `pipeline-completion` and
  // `recent-activity` and nothing at all about their own work. All of them are
  // `requiredPermission: null` except the FileHub inbox, so they are exactly the
  // ones that survive the permission filter that strips the rest for that user.
  //
  // None of them is `bare` (they wear the shell, which draws the card and the
  // title) and none declares a `heightTier`: a list genuinely does get taller
  // when given more room, which is what the default already says. They are
  // `flush` because ListRow draws its own padding edge to edge — the exception
  // is `my-performance`, whose stat tiles want the shell's body padding.
  //
  // They also deliberately do NOT report empty (useReportWidgetEmpty): a
  // personal widget that vanishes reads as broken, and "nothing is assigned to
  // you" is an answer worth seeing.
  'my-work': {
    title: 'My work',
    icon: 'check-square-o',
    blurb: 'Every open task assigned to you, dated or not.',
    defaultSize: 'm',
    requiredPermission: null,
    category: 'overview',
    configFields: [],
    seedVersion: 2,
    // One useMyTasks read per mount; nothing about a second copy of your own
    // plate is useful, and the config sheet has nothing to vary it by.
    singleton: true,
    flush: true,
  },
  'my-deadlines': {
    title: 'My deadlines',
    icon: 'calendar-check-o',
    blurb: 'What of yours is late, and what lands next.',
    defaultSize: 'm',
    requiredPermission: null,
    category: 'overview',
    configFields: [],
    seedVersion: 2,
    // MANDATORY, not a preference: useUpcomingTasks opens a three-table realtime
    // channel (tasks + task_assignments + projects), a 60s poll AND a
    // focus/AppState listener per mount (useUpcomingTasks.ts:294). Two instances
    // would be two of each for one list.
    singleton: true,
    flush: true,
    // Registered but NOT in SEED_ORDER — see the note there. It is the urgent
    // dated subset of `my-work`, which is seeded instead.
  },
  'last-worked-on': {
    title: 'Last worked on',
    icon: 'clock-o',
    blurb: 'Pick up where you left off — your most recent timers.',
    defaultSize: 'm',
    requiredPermission: null,
    category: 'activity',
    configFields: [],
    seedVersion: 2,
    // Singleton for the reason pending-time-approvals is: it owns its own
    // task_work_sessions read, and one dashboard should pay for it once.
    singleton: true,
    flush: true,
  },
  'live-now': {
    title: 'Live now',
    icon: 'users',
    blurb: 'Who is tracking time right now, and for how long.',
    // 's' by default and by nature: a presence list is a name, a dot and a
    // ticking clock. The wider sizes buy the task title, not a different answer.
    defaultSize: 's',
    requiredPermission: null,
    category: 'activity',
    configFields: [],
    seedVersion: 2,
    singleton: true,
    flush: true,
  },
  'filehub-inbox': {
    title: 'File inbox',
    icon: 'inbox',
    blurb: 'Files people sent you, unread ones first.',
    defaultSize: 'm',
    // COLON family. FileHub's keys are `filehub:view` / `filehub:view_all_files`;
    // there is no `filehub.view` row in `permissions`, and hasPermission is a
    // plain includes() with no wildcard, so the dotted spelling would hide this
    // widget from everyone forever. Do not "normalize" it.
    requiredPermission: 'filehub:view',
    category: 'activity',
    configFields: [],
    seedVersion: 2,
    singleton: true,
    flush: true,
  },
  'my-performance': {
    title: 'My performance',
    icon: 'bar-chart',
    blurb: 'Your points, completions and tracked time over a window.',
    defaultSize: 'm',
    // Null because this is the viewer's OWN row. There is deliberately no
    // "pick a person" field — that would need user.view_all and would turn a
    // personal widget into a surveillance one.
    requiredPermission: null,
    category: 'analytics',
    configFields: [{
      key: 'period',
      label: 'Window',
      options: PERFORMANCE_PERIODS,
      default: '30',
    }],
    subtitle: i =>
      (PERFORMANCE_PERIODS.find(o => o.value === i.config.period) ?? PERFORMANCE_PERIODS[1]).label,
    seedVersion: 2,
    // OVERRIDE, same reasoning as `facts`: a row of stat tiles gets WIDER with
    // room, not taller — the four tiles wrap to two lines at 'm' and sit on one
    // at 'l'. The default two units would be ~200px of empty card under them.
    heightTier: { m: 1, l: 1 },
    // Deliberately NOT a singleton — a 7-day and a 90-day card side by side is
    // the real use, and AnalyticsContext dedup-caches on the date range, so the
    // second one is a second call only because it asks a different question.
  },
};

export const WIDGET_TYPES = Object.keys(WIDGET_META) as WidgetType[];

export function isWidgetType(raw: unknown, knownTypes: readonly WidgetType[] = WIDGET_TYPES): raw is WidgetType {
  return typeof raw === 'string' && (knownTypes as readonly string[]).includes(raw);
}

// ── Persisted config ─────────────────────────────────────────────────────

/**
 * The SAME object already persisted by both dashboard screens. Two new
 * OPTIONAL fields; every pre-existing field keeps its meaning and its readers.
 *
 * Flagged limitation, inherited deliberately: this key is per-DEVICE, not
 * per-user (`overviewMetrics` already said "Local per-device"). Two accounts
 * sharing a browser share a layout. Per-user later = a `users.dashboard_layout`
 * jsonb column + an RPC, not a second AsyncStorage key.
 */
export type DashboardConfig = {
  pipelineIds: string[];
  successStageIds: string[];
  useAllPipelines?: boolean;
  /** Overview graph customization (analytics.view holders only). Local per-device. */
  overviewMetrics?: OverviewMetricKey[];
  /** @deprecated seed source only — a pipeline-overview instance's `config.period` wins. */
  overviewPeriod?: 'week' | 'month';
  /** NEW. Absent => this device has never customized; seed from role defaults. */
  widgets?: WidgetInstance[];
  /** NEW. Bump only for a breaking instance-shape change. */
  widgetsVersion?: 1;
  /** NEW. Seed generation this layout was last topped up from. Absent = 1. */
  widgetsSeedVersion?: number;
};

/**
 * The seed generation this build ships. Bump it — and stamp the same number on
 * the new type's `seedVersion` — whenever a widget type is added that existing
 * dashboards should pick up.
 *
 * Why it exists: `widgets` is written to storage on the first real edit, and
 * from that moment the role-based seed never ran again. That made the first
 * edit a one-way door out of every future default, and "first edit" includes
 * the overview chart's inline Weekly/Monthly switch — nobody flipping a chart
 * period thinks they are customizing their dashboard. Seeding is now ADDITIVE:
 * types introduced in a LATER version than the one stored with a layout get
 * appended on load and the version is stamped, so it happens exactly once.
 * Types the user deliberately removed were introduced at or below their stored
 * version, so they are never candidates and never come back.
 */
export const WIDGET_SEED_VERSION = 2;

export const DASHBOARD_CONFIG_KEY = '@TrustFlow_dashboard_config';

/** What a device with nothing stored (or an unparseable blob) starts from. */
export const EMPTY_DASHBOARD_CONFIG: DashboardConfig = {
  pipelineIds: [],
  successStageIds: [],
  useAllPipelines: true,
};

const asStringArray = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];

/**
 * Validates what came back from storage — a string written by an older build.
 * Required, not optional, for the reason usePersistedState's docstring gives:
 * a removed widget type, a renamed key or a half-written value would otherwise
 * restore state the UI can no longer render.
 *
 * Returns null when `raw` is not an object at all; the caller then starts from
 * EMPTY_DASHBOARD_CONFIG and seeds.
 */
export function migrateDashboardConfig(raw: unknown, knownTypes: readonly WidgetType[] = WIDGET_TYPES): DashboardConfig | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;

  const out: DashboardConfig = {
    pipelineIds: asStringArray(src.pipelineIds),
    successStageIds: asStringArray(src.successStageIds),
  };
  if (typeof src.useAllPipelines === 'boolean') out.useAllPipelines = src.useAllPipelines;
  if (Array.isArray(src.overviewMetrics)) out.overviewMetrics = src.overviewMetrics as OverviewMetricKey[];
  if (src.overviewPeriod === 'week' || src.overviewPeriod === 'month') out.overviewPeriod = src.overviewPeriod;

  // Absent or malformed `widgets` stays ABSENT — never synthesized here, so
  // "never customized" survives and the seed stays role-derived on every load.
  // See seedDefaultInstances' write-back rule.
  if (!Array.isArray(src.widgets)) return out;

  const seen = new Set<string>();
  const widgets: WidgetInstance[] = [];
  for (const entry of src.widgets) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== 'string' || e.id === '') continue;
    if (!isWidgetType(e.type, knownTypes)) continue;

    const config: Record<string, string> = {};
    if (typeof e.config === 'object' && e.config !== null && !Array.isArray(e.config)) {
      for (const [k, v] of Object.entries(e.config as Record<string, unknown>)) {
        if (typeof v === 'string') config[k] = v;
      }
    }

    const id = seen.has(e.id) ? newInstanceId(e.type, widgets) : e.id;
    seen.add(id);
    widgets.push({
      id,
      type: e.type,
      size: storedSize(e.type, e.size),
      config,
    });
  }

  // An intentionally empty dashboard survives as [] and must not re-seed.
  out.widgets = widgets;
  out.widgetsVersion = 1;
  out.widgetsSeedVersion = typeof src.widgetsSeedVersion === 'number' ? src.widgetsSeedVersion : 1;
  return out;
}

/**
 * The size a stored instance may actually render at. Not just "is it s/m/l":
 * a type can NARROW its allowedSizes after shipping (blocked-exceptions did),
 * and a layout saved before that still carries the size it no longer renders
 * properly at. Falls back to 'm', or to the first size the type does allow.
 */
function storedSize(type: WidgetType, raw: unknown): WidgetSize {
  const allowed = WIDGET_META[type].allowedSizes ?? ALL_WIDGET_SIZES;
  if (isWidgetSize(raw) && allowed.includes(raw)) return raw;
  return allowed.includes('m') ? 'm' : allowed[0];
}

/** `${type}-${lowest free integer}`, so ids stay readable in a storage dump. */
export function newInstanceId(type: WidgetType, existing: readonly WidgetInstance[]): string {
  const taken = new Set(existing.map(i => i.id));
  for (let n = 1; ; n++) {
    const id = `${type}-${n}`;
    if (!taken.has(id)) return id;
  }
}

// ── Seeding ──────────────────────────────────────────────────────────────

/**
 * Seed order — top to bottom, most actionable first. It is also the list
 * `appendNewSeeds` walks, so a registered type that is NOT here is one users may
 * add but that is never seeded and never topped up. Four types sit out
 * deliberately (see below); `pipeline-completion` is conditional.
 */
const SEED_ORDER: WidgetType[] = [
  'facts',
  'pending-time-approvals',
  // The personal pair, above the company panels because "what is on my plate"
  // and "what was I doing" are the two things a member can act on immediately.
  'my-work',
  'last-worked-on',
  'projection-strip',
  'blocked-exceptions',
  'pipeline-overview',
  'pipeline-completion',
  'recent-activity',
  'active-projects',

  // NOT SEEDED, on purpose — all four stay one tap away in the Add picker:
  //
  // `live-now` is the only widget whose entire content comes from a function
  // this release ADDS (rpc_company_live_sessions). Seeding it means the code
  // shipping ahead of the migration puts a card reading "No one is tracking
  // time right now." on every existing dashboard, permanently for anyone who
  // never edits theirs — a widget that is wrong rather than empty. Ambient
  // rather than actionable in the first place ("who else is here" is a glance,
  // not a task), so it is the cheapest one to make opt-in. Put it back in this
  // list, at the bottom, once the migration is applied everywhere.
  //
  // `my-deadlines` overlaps `my-work`, which is the whole plate INCLUDING the
  // undated tail a deadline surface can never show; the dated half is already on
  // the topbar strip (web) and the Deadlines tab (native). Seeding both would
  // print most of the same rows twice, and it is the expensive one (a three-table
  // realtime channel plus a poll per mount), so `my-work` is the one seeded.
  //
  // `my-performance` is the ranged version of `facts`' `pts today` / `active`,
  // and the only new type with a config field — a card you tune is a card you
  // choose. `filehub-inbox` is one more RPC per dashboard load for a surface
  // FileHub already owns, and its permission means it could never fill the
  // permissionless-member gap these were added for.
];

/**
 * The dashboard a user who has never customized sees, derived from their
 * permissions at read time.
 *
 * **This result is NEVER written back to storage.** Persist `widgets` only on
 * the first real user edit. Writing the seed on first load would freeze the
 * defaults at whatever permissions the user had on day one, and a widget type
 * shipped in a later release could never appear for an existing user.
 *
 * `can` must be permission-aware AND loaded — AuthContext's `permissions`
 * starts `[]`, so every hasPermission call returns false until
 * `permissionsLoaded` flips. Seeding in that window produces a stripped
 * dashboard. useDashboardLayout gates on `hydrated` for exactly this.
 */
export function seedDefaultInstances(
  can: (permission: string | null) => boolean,
  config?: DashboardConfig | null,
): WidgetInstance[] {
  const hasAnalytics = can('analytics.view');
  const out: WidgetInstance[] = [];
  for (const type of SEED_ORDER) {
    const meta = WIDGET_META[type];
    if (!can(meta.requiredPermission)) continue;
    // The plain bars are today's no-analytics fallback, so they are seeded only
    // when the chart is not. Still offered in the picker to everyone.
    if (type === 'pipeline-completion' && hasAnalytics) continue;
    out.push({
      id: `${type}-1`,
      type,
      size: meta.defaultSize,
      // Inherit the device's old global period so nobody loses their choice
      // when it becomes per-instance. Every other field falls back to its
      // declared `default` at read time, so `config` starts empty.
      config: type === 'pipeline-overview' ? { period: config?.overviewPeriod ?? 'week' } : {},
    });
  }
  return out;
}

/**
 * Widget types introduced AFTER `storedSeedVersion`, appended to a layout the
 * user has already customized. This is the other half of the write-back rule
 * above: once `widgets` is in storage the seed no longer runs, so without this
 * a user who ever touched their dashboard would never see a new widget again.
 *
 * Everything they have stays where it is, and a type they removed is never
 * re-added — it was introduced at or below their stored version, so it is not a
 * candidate. `addInstance` supplies the rest of the gating for free: no
 * permission, no second copy of a singleton, and a fresh id.
 *
 * ponytail: appends at the end rather than at the type's SEED_ORDER position.
 * A new widget landing at the bottom of a hand-arranged dashboard is the least
 * surprising place for it; splice by SEED_ORDER index if that ever reads wrong.
 *
 * ponytail: the caller stamps `widgetsSeedVersion` unconditionally, so a type
 * `addInstance` refused on PERMISSION grounds is never retried — regaining the
 * permission later brings back instances already in storage (`visibleInstances`
 * is read-time) but not one that was never appended. Latent today: every type
 * in SEED_ORDER above generation 1 has `requiredPermission: null`. The fix is
 * not "don't stamp" — that would also un-stick every deliberate removal — it is
 * a per-type high-water mark, which is a schema change this does not earn yet.
 */
export function appendNewSeeds(
  widgets: readonly WidgetInstance[],
  storedSeedVersion: number,
  can: (permission: string | null) => boolean,
): WidgetInstance[] {
  let out = widgets as WidgetInstance[];
  for (const type of SEED_ORDER) {
    if ((WIDGET_META[type].seedVersion ?? 1) <= storedSeedVersion) continue;
    out = addInstance(out, type, can);
  }
  return out;
}

/**
 * Instances a viewer may actually render. Applied at READ time only — an
 * instance hidden because a permission was revoked stays in storage, so
 * getting the permission back brings the widget back rather than having
 * silently deleted it.
 */
export function visibleInstances(
  instances: readonly WidgetInstance[],
  can: (permission: string | null) => boolean,
): WidgetInstance[] {
  return instances.filter(i => can(WIDGET_META[i.type].requiredPermission));
}

// ── Instance mutations (pure; the hook and the UI share these) ────────────

/** Why the Add picker must refuse this type, or null when it may be added. */
export function addWidgetBlock(
  type: WidgetType,
  instances: readonly WidgetInstance[],
  can: (permission: string | null) => boolean,
): 'permission' | 'singleton' | null {
  const meta = WIDGET_META[type];
  if (!can(meta.requiredPermission)) return 'permission';
  if (meta.singleton && instances.some(i => i.type === type)) return 'singleton';
  return null;
}

/** Appends one instance. A singleton that already exists is a no-op. */
export function addInstance(
  instances: readonly WidgetInstance[],
  type: WidgetType,
  can: (permission: string | null) => boolean = () => true,
): WidgetInstance[] {
  if (addWidgetBlock(type, instances, can) !== null) return instances as WidgetInstance[];
  return [...instances, { id: newInstanceId(type, instances), type, size: WIDGET_META[type].defaultSize, config: {} }];
}

export function removeInstance(instances: readonly WidgetInstance[], id: string): WidgetInstance[] {
  return instances.filter(i => i.id !== id);
}

/** Swaps with the neighbour. Clamped at both ends — no wrap, no throw. */
export function moveInstance(instances: readonly WidgetInstance[], id: string, delta: -1 | 1): WidgetInstance[] {
  const from = instances.findIndex(i => i.id === id);
  if (from === -1) return instances as WidgetInstance[];
  const to = from + delta;
  if (to < 0 || to >= instances.length) return instances as WidgetInstance[];
  const next = [...instances];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** Cycles within the type's allowedSizes, so 's' stays unreachable where withheld. */
export function cycleInstanceSize(instances: readonly WidgetInstance[], id: string): WidgetInstance[] {
  return instances.map(i =>
    i.id === id ? { ...i, size: cycleSize(i.size, WIDGET_META[i.type].allowedSizes ?? ALL_WIDGET_SIZES) } : i,
  );
}

export function setInstanceConfig(
  instances: readonly WidgetInstance[],
  id: string,
  key: string,
  value: string,
): WidgetInstance[] {
  return instances.map(i => (i.id === id ? { ...i, config: { ...i.config, [key]: value } } : i));
}
