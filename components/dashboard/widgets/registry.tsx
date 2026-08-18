// The widget registry (#213, Wave 2b): WIDGET_META from lib/dashboardWidgets.ts
// joined to the component that renders each type, plus the thin adapters that do
// the joining. It is a lookup table, not a framework — everything branchy is
// either in the lib (seeding, migration, sizing) or in the panel being wrapped.
//
// ADAPTERS WRAP, THEY DO NOT REWRITE. Every panel here already exists, already
// shipped and already carries its own design decisions in its own header
// comments. An adapter's whole job is to turn { instance, size } into that
// panel's real props. The only edits made to a wrapped panel were the two
// optional `className` props on ProjectionStrip / BlockedExceptionsPanel, so
// their hardcoded `mb-8` can be switched off inside a gap-16 grid.
//
// THE CORRECTNESS RULE: shared data comes from useDashboardData(), never from a
// per-widget query. N instances with per-widget hooks means N copies of the
// 500-row rpc_projects_table read that useDashboardProjects exists specifically
// to deduplicate ("they used to fire the same 500-row call twice",
// _index_desktop.tsx:98-101). A type may self-fetch only when the shared context
// cannot answer its question, and then it is a SINGLETON so the dashboard pays
// once: pending-time-approvals, my-work, my-deadlines, last-worked-on, live-now
// and filehub-inbox. The two exceptions are pipeline-overview and
// my-performance, which go through AnalyticsContext's dedup cache and may
// therefore appear twice on different params. Every one of them takes
// `refreshKey` so pull-to-refresh still reaches it.
//
// SCALE: no widget scrolls internally — both dashboards are one page-level
// ScrollView, and a vertical scroller inside a vertical scroller is a gesture
// conflict on native and an overflow trap on web. Lists cap at ROWS_BY_SIZE and
// link out instead, which is the house pattern already (ProjectionStrip's
// MAX_LANES = 5, BlockedExceptionsPanel's MAX_SHOWN = 3). A 200-row dataset
// therefore renders 3, 6 or 10 rows plus one "see all" line, whatever the data
// does. MultiViewList is NOT usable here: it needs a bounded-height parent.

import { ListRow } from '@/components/common/ListRow';
import PendingTimeApprovalsWidget from '@/components/common/PendingTimeApprovalsWidget';
import BlockedExceptionsPanel from '@/components/dashboard/BlockedExceptionsPanel';
import DashboardFacts, { type Fact } from '@/components/dashboard/DashboardFacts';
import ProjectionStrip from '@/components/dashboard/ProjectionStrip';
import StatTile from '@/components/dashboard/StatTile';
import FileHubInboxWidget from '@/components/dashboard/widgets/FileHubInboxWidget';
import LastWorkedOnWidget from '@/components/dashboard/widgets/LastWorkedOnWidget';
import LiveNowWidget from '@/components/dashboard/widgets/LiveNowWidget';
import MyDeadlinesWidget from '@/components/dashboard/widgets/MyDeadlinesWidget';
import MyPerformanceWidget from '@/components/dashboard/widgets/MyPerformanceWidget';
import MyWorkWidget from '@/components/dashboard/widgets/MyWorkWidget';
import PipelineOverviewWidget from '@/components/dashboard/widgets/PipelineOverviewWidget';
// The leaf of this tree: personalRows imports nothing from here, so the widget
// bodies above (which take WidgetBodyProps as a TYPE-only import) close no cycle.
import { QuietLine, SeeAllRow, WidgetList } from '@/components/dashboard/widgets/personalRows';
import { EntityGlyph, ProgressMeter } from '@/components/entities/EntityUI';
// The app's one avatar face, shared with the task-detail presence stack — so a
// person in the activity feed is the same face they are on a task.
import { Avatar } from '@/components/task-detail/activeSessionAvatarsCore';
import Tooltip from '@/components/common/Tooltip';
import { useAuth } from '@/contexts/AuthContext';
import { useDashboardData } from '@/contexts/DashboardDataContext';
import type { DashboardLayout } from '@/hooks/useDashboardLayout';
import {
  DEFAULT_OVERVIEW_METRICS,
  type OverviewMetricKey,
  type OverviewPeriod,
} from '@/hooks/usePipelineOverviewData';
import { useThemeColors } from '@/hooks/useThemeColors';
import {
  ROWS_BY_SIZE,
  WIDGET_META,
  rowLimit,
  type WidgetInstance,
  type WidgetMeta,
  type WidgetSize,
  type WidgetType,
} from '@/lib/dashboardWidgets';
import { hasProjection } from '@/lib/projectTimeline';
import { formatCompact, formatRelative } from '@/lib/time';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { Platform, Text, View, useWindowDimensions } from 'react-native';

// ── Contract ─────────────────────────────────────────────────────────────

/**
 * What a widget body receives. Deliberately tiny: everything else it needs is
 * either shared data (useDashboardData) or a layout mutator (useWidgetLayout).
 * `size` is the instance's OWN stored size — the same value the shell's size
 * control shows. The grid does render a full-width CELL until its first
 * onLayout lands, but that fallback is cell geometry only and is deliberately
 * not passed down here: a body's row limits must not flip between the first
 * frame and the second.
 */
export type WidgetBodyProps = { instance: WidgetInstance; size: WidgetSize };

export type WidgetDef = WidgetMeta & { component: React.ComponentType<WidgetBodyProps> };

/**
 * The layout mutators, for the widgets that write their own config back — today
 * only pipeline-overview, whose inline period switch must write the same place
 * the config sheet does or the two controls disagree.
 *
 * A separate context rather than a prop because WidgetBodyProps is shared with
 * the grid and the shell, and thirteen of the fourteen types have nothing to write.
 * The screen wraps <WidgetGrid> in this.
 */
const WidgetLayoutContext = createContext<DashboardLayout | null>(null);

export function WidgetLayoutProvider({ layout, children }: { layout: DashboardLayout; children: React.ReactNode }) {
  return <WidgetLayoutContext.Provider value={layout}>{children}</WidgetLayoutContext.Provider>;
}

/** Throws rather than no-opping: a period toggle that silently does nothing is worse than a crash. */
function useWidgetLayout(): DashboardLayout {
  const ctx = useContext(WidgetLayoutContext);
  if (!ctx) throw new Error('Widget bodies must render inside a <WidgetLayoutProvider layout={...}>');
  return ctx;
}

/**
 * "This body is about to draw nothing."
 *
 * Four of the fourteen types legitimately render null — an empty approvals
 * queue, a dataset with no forecast, a viewer who cannot see projects, the
 * platform gate below. The personal set deliberately does NOT join them: a
 * widget you added that then vanishes reads as broken, and "nothing is assigned
 * to you" is an answer. React gives a parent no signal that a child rendered null,
 * and measuring the result is a frame late on both platforms, so the bodies say
 * so instead. WidgetGrid turns the answer into a real titled cell in edit mode
 * (an empty `bare` widget's floating control strip otherwise paints over the
 * NEXT widget's header, and Remove hits the wrong one) and into a
 * `display: 'none'` cell outside edit mode, which occupies no width, no row and
 * no gap. The body stays mounted either way.
 *
 * The reporter is a useState setter, so it is referentially stable and the
 * effect below only fires when the answer actually changes.
 */
const WidgetEmptyContext = createContext<((empty: boolean) => void) | null>(null);

export function WidgetEmptyProvider({ report, children }: {
  report: (empty: boolean) => void;
  children: React.ReactNode;
}) {
  return <WidgetEmptyContext.Provider value={report}>{children}</WidgetEmptyContext.Provider>;
}

/** Call unconditionally, with the same condition the body renders nothing on. */
export function useReportWidgetEmpty(empty: boolean) {
  const report = useContext(WidgetEmptyContext);
  useEffect(() => { report?.(empty); }, [empty, report]);
}

// ── Adapters ─────────────────────────────────────────────────────────────

/**
 * `facts` — DashboardFacts wants a Fact[], which the screen used to build. The
 * array below is _index_desktop.tsx:356-370 verbatim, comments included: the
 * "presence, not a tally" exemption and the 1.5x flap threshold are decisions,
 * not incidental formatting.
 */
function FactsWidget() {
  const { stats, pulse, openLiveSessions } = useDashboardData();
  const c = useThemeColors();
  const router = useRouter();

  const completionRate = stats.totalTasks > 0 ? Math.round((stats.completed / stats.totalTasks) * 100) : 0;
  const failedRate = stats.totalTasks > 0 ? Math.round((stats.failed / stats.totalTasks) * 100) : 0;

  const facts: Fact[] = [
    { value: stats.totalTasks > 0 ? String(stats.totalTasks) : null, label: 'in pipeline', onPress: () => router.push('/tasks' as any) },
    { value: stats.activeNow > 0 ? String(stats.activeNow) : null, label: 'in progress', onPress: () => router.push('/tasks' as any) },
    { value: stats.completed > 0 ? String(stats.completed) : null, label: `done · ${completionRate}%`, tone: c.success, onPress: () => router.push('/intelligence/archives' as any) },
    { value: stats.failed > 0 ? String(stats.failed) : null, label: `failed · ${failedRate}%`, tone: c.danger, onPress: () => router.push('/intelligence/archives' as any) },
    // Presence, not a tally — so it does NOT follow the hide-when-zero rule the
    // other facts do. "0 working now" answers the question you asked; a missing
    // row leaves you wondering whether nobody is working or the dot is broken.
    { value: String(stats.activeSessions), label: 'working now', live: true, onPress: openLiveSessions },
    { value: pulse && pulse.daily_points > 0 ? String(pulse.daily_points) : null, label: 'pts today' },
    { value: pulse && pulse.active_seconds_today > 0 ? formatCompact(pulse.active_seconds_today) : null, label: 'active' },
    // A good flap score is not news. It appears only when it is a problem —
    // the same threshold the old band coloured it red at.
    { value: pulse && pulse.flap_rate_score > 1.5 ? `${pulse.flap_rate_score}x` : null, label: 'task switching', tone: c.danger },
  ];

  // DashboardFacts renders null when every value is null (:36). In practice
  // "working now" is presence rather than a tally and is never suppressed, so
  // this is always false today — reported anyway, because the day someone makes
  // that fact conditional is not the day to rediscover the phantom-cell bug.
  useReportWidgetEmpty(!facts.some(f => f.value != null));

  // No size branch here either: DashboardFacts lays its tiles out with the same
  // flexBasis + flexWrap arithmetic the grid uses, so the SAME eight facts are
  // 4 columns wide in an 'm' cell and one line of 8 at 'l' — a real difference
  // in density off the measured container, not the same row padded out. 's' is
  // withheld by the type (see WIDGET_META): at 230px a tile column is ~91px,
  // which truncates both "3h 20m" and "TASK SWITCHING".
  return <DashboardFacts facts={facts} />;
}

/**
 * `pending-time-approvals` — the one widget that owns its own fetch AND its own
 * realtime channel, hence singleton. It renders null while loading and when the
 * queue is empty, which is why it is `bare`.
 */
function PendingTimeApprovalsAdapter() {
  const { refreshKey } = useDashboardData();
  const { width } = useWindowDimensions();

  // Desktop web (>=768) surfaces this via the topbar island instead
  // (IslandTimeApprovalsBridge). The gate lives here and NOT in the registry's
  // requiredPermission: "you may not see this" and "you see this somewhere else
  // on this platform" are different things, and the picker must still list it.
  const shownElsewhere = Platform.OS === 'web' && width >= 768;

  // The other half of "renders nothing" — an empty or still-loading queue — is
  // only knowable inside the widget, which owns the fetch and the realtime
  // channel. Hence its one optional callback prop; nothing else could tell us.
  const [queueEmpty, setQueueEmpty] = useState(true);
  useReportWidgetEmpty(shownElsewhere || queueEmpty);

  if (shownElsewhere) return null;

  return <PendingTimeApprovalsWidget refreshKey={refreshKey} onEmptyChange={setQueueEmpty} />;
}

/** `projection-strip` — same props the two screens pass today, minus the mb-8. */
function ProjectionStripWidget() {
  const { dashProjects } = useDashboardData();
  // The strip's own gate (ProjectionStrip.tsx:110), evaluated through the very
  // same exported predicate it uses — a call, not a second derivation, so the
  // two cannot disagree about whether anything is going to be drawn.
  useReportWidgetEmpty(dashProjects.state === 'loading' || !dashProjects.rows.some(hasProjection));
  // `embedded`: the shell draws the card and the title now, so the strip drops
  // its own card and its 10px eyebrow. Two nested cards with a dim eyebrow for
  // a heading was what made this widget read as small text in a faint box.
  return (
    <ProjectionStrip
      rows={dashProjects.rows}
      loading={dashProjects.state === 'loading'}
      className=""
      embedded
    />
  );
}

/** `blocked-exceptions` — the same dashProjects object, spread exactly as before. */
function BlockedExceptionsWidget() {
  const { dashProjects } = useDashboardData();
  // The panel's only null path (:76). `requiredPermission` normally prevents
  // the instance existing at all, so this is the defence-in-depth case.
  useReportWidgetEmpty(!dashProjects.canView);
  // `embedded` for the same reason as the strip, plus one the strip does not
  // have: this panel's all-clear and error branches are single quiet lines by
  // design (its own header explains why they are not boxes). `bare` left those
  // lines floating in the grid with no card around them at all — the shell's
  // card is what they were missing, not a louder empty state.
  return (
    <BlockedExceptionsPanel
      rows={dashProjects.rows}
      state={dashProjects.state}
      reload={dashProjects.reload}
      canView={dashProjects.canView}
      className=""
      embedded
    />
  );
}

/**
 * `pipeline-overview` — the platform-split chart. Config field: `period`.
 *
 * Two writers for one concept were the risk here (spec §12 #3): the chart has
 * its own inline Weekly/Monthly switch and the config sheet has a select. Both
 * now write the SAME per-instance `config.period`, so they cannot disagree, and
 * the old global DashboardConfig.overviewPeriod is seed-only (see
 * seedDefaultInstances) so nobody loses the choice they already made.
 */
function PipelineOverviewAdapter({ instance }: WidgetBodyProps) {
  const { trackedPipelineIds, refreshKey } = useDashboardData();
  const layout = useWidgetLayout();

  const period: OverviewPeriod = instance.config.period === 'month' ? 'month' : 'week';

  // Asymmetry, on purpose: `period` is per-instance (one weekly and one monthly
  // chart side by side is a real layout) while `metrics` stays global on
  // DashboardConfig — it is multi-select, and configFields are bounded to a
  // single select. Documented, not an oversight.
  const metrics = layout.config?.overviewMetrics ?? DEFAULT_OVERVIEW_METRICS;

  const toggleMetric = (key: OverviewMetricKey) => {
    const next = metrics.includes(key) ? metrics.filter(k => k !== key) : [...metrics, key];
    void layout.saveConfig({ overviewMetrics: next });
  };

  // ponytail: no `onCustomize` — that button ("Customize metrics") opened the
  // pipeline-settings modal, and the metric chips directly beneath it already
  // do the same job inline. Pass onConfigure down through WidgetLayoutContext
  // if a route back to the config sheet is ever wanted outside edit mode.
  return (
    <PipelineOverviewWidget
      pipelineIds={trackedPipelineIds}
      metrics={metrics}
      period={period}
      onToggleMetric={toggleMetric}
      onSetPeriod={p => layout.setConfig(instance.id, 'period', p)}
      refreshKey={refreshKey}
      className=""
    />
  );
}

/**
 * `pipeline-completion` — the plain bars that used to be the no-analytics
 * fallback (_index_desktop.tsx:458-513 / _index_adaptive.tsx:410-465, which were
 * identical bar `p-6` vs `p-5` and "of" vs "/"). One copy now, inside a shell
 * that draws the card and the title, so the panel's own card and eyebrow are
 * gone from this body.
 */
function PipelineCompletionWidget({ size }: WidgetBodyProps) {
  const c = useThemeColors();
  const { stats } = useDashboardData();

  const completionRate = stats.totalTasks > 0 ? Math.round((stats.completed / stats.totalTasks) * 100) : 0;
  const failedRate = stats.totalTasks > 0 ? Math.round((stats.failed / stats.totalTasks) * 100) : 0;
  const activeRate = stats.totalTasks > 0 ? (stats.activeNow / stats.totalTasks) * 100 : 0;

  // What the extra width actually buys. 's' is the number and the meter it
  // measures — the whole answer, at a glance, in 230px. 'm' spends the room on
  // the per-state breakdown, which is a different question ("where is the rest
  // of the work?") rather than the same one set in a wider column. There is no
  // 'l': three progress bars at full width are three longer progress bars, so
  // the type withholds it (WIDGET_META) instead of padding one out.
  const showBreakdown = size !== 's';

  const bar = (label: string, count: number, percent: number, fill: string, labelTone?: string) => (
    <View key={label}>
      <View className="flex-row justify-between mb-1.5">
        <Text className="text-xs font-semibold" style={{ color: labelTone ?? c.textMain }}>{label}</Text>
        <Text className="text-typography-muted text-xs">{count} of {stats.totalTasks}</Text>
      </View>
      <View className="w-full h-1.5 bg-surface-background rounded-full overflow-hidden border border-surface-border/50">
        <View className={`h-full rounded-full ${fill}`} style={{ width: `${percent}%` }} />
      </View>
    </View>
  );

  return (
    <View>
      {/* The one number this card leads with. It used to be `text-base
          font-bold text-right` — the same 16px as the body copy under it,
          floated to a corner, so nothing in the card was bigger than anything
          else in it. */}
      {/* The hero's bar is StatTile's own `meter` now, not a hand-rolled
          track+fill pair under it — one definition of "a completion bar" for
          the whole app (EntityUI's ProgressMeter), which is what every project
          surface already draws. */}
      <StatTile
        hero
        label="Complete"
        value={`${completionRate}%`}
        detail={`${stats.completed} of ${stats.totalTasks} tasks`}
        meter={{ percent: completionRate }}
      />

      {showBreakdown && (
        <View className="gap-4 mt-5">
          {bar('In progress', stats.activeNow, activeRate, 'bg-state-warning')}
          {bar('Completed', stats.completed, completionRate, 'bg-state-success')}
          {/* Semantic colour, and only here: a failure count is the one line in
              this card that carries state rather than magnitude. */}
          {stats.failed > 0 && bar('Failed / rejected', stats.failed, failedRate, 'bg-state-danger', c.danger)}
        </View>
      )}
    </View>
  );
}

/**
 * `recent-activity` — config field `limit`, and the only widget where a config
 * value and the size preference both have a claim on the row count.
 */
function RecentActivityWidget({ instance, size }: WidgetBodyProps) {
  const { activity } = useDashboardData();
  const { hasPermission } = useAuth();
  const c = useThemeColors();
  const router = useRouter();

  // ROWS_BY_SIZE is the default, so an 's' widget really is smaller than an 'l'
  // one; an explicit `limit` from the config sheet is the user overriding that.
  // Either way this only ever slices — the fetch is fixed at 20 rows on both
  // platforms, deliberately independent of layout state. `rowLimit` is shared
  // with the type's subtitle so the header cannot claim a count the list isn't.
  const rows = activity.slice(0, rowLimit(instance.config, size));

  // A quiet line, not a dashed box. Nothing happened; that needs one sentence.
  if (rows.length === 0) return <QuietLine text="Nothing has moved yet." />;

  // WidgetList grows, so SeeAllRow's `mt-auto` has free space to push against
  // and the link lands on the card's bottom edge.
  return (
    <WidgetList type={instance.type}>
      {rows.map((entry, idx) => (
        <ListRow
          key={entry.id}
          className="gap-3"
          isLast={idx === rows.length - 1}
          disabled={!entry.taskId}
          onPress={() => entry.taskId && router.push(`/task/${entry.taskId}` as any)}
          accessibilityLabel={`${entry.taskTitle}, moved to ${entry.toStage} by ${entry.movedBy}`}
        >
          {/* WHO, as a face. An activity feed is a list of people doing things,
              and the actor was previously a 10px name in the corner that 's'
              dropped entirely. The avatar survives every size — it is the only
              per-row identity here, and unlike the name it stays legible at
              230px. The image falls back to a monogram in a box of identical
              dimensions, so a broken or missing avatar never shifts the row.
              The tooltip is what replaces the name text at 's'; the row's own
              accessibilityLabel already carries it for screen readers. */}
          <Tooltip label={entry.movedBy}>
            <Avatar user={{ name: entry.movedBy, avatar: entry.movedByAvatar }} size={24} />
          </Tooltip>
          <View className="flex-1 pr-3 min-w-0">
            <Text className="text-typography-main font-semibold text-xs" numberOfLines={1}>
              {entry.taskTitle}
            </Text>
            <View className="flex-row items-center gap-1">
              <Text className="text-typography-dim text-[10px] flex-shrink" numberOfLines={1}>{entry.fromStage}</Text>
              <FontAwesome name="long-arrow-right" size={8} color={c.textDim} />
              <Text className="text-typography-muted text-[10px] flex-shrink" numberOfLines={1}>{entry.toStage}</Text>
            </View>
          </View>
          <Text className="text-typography-dim text-[10px]">{formatRelative(entry.movedAt)}</Text>
        </ListRow>
      ))}

      {/* Same gate the old header chevron had (_index_desktop.tsx:519). */}
      {activity.length > rows.length && hasPermission('report.view') && (
        <SeeAllRow label="Open Intelligence" onPress={() => router.push('/intelligence' as any)} />
      )}
    </WidgetList>
  );
}

/**
 * `active-projects` — desktop-only until now. ProgressMeter and EntityGlyph are
 * EntityUI's, kept so this reads identically to the meter on every other project
 * surface (_index_desktop.tsx:576-578).
 */
function ActiveProjectsWidget({ instance, size }: WidgetBodyProps) {
  const { projects } = useDashboardData();
  const router = useRouter();

  // The query is already .limit(4); the slice is what makes an 's' instance
  // shorter than an 'l' one, and what would hold if that limit ever rose.
  const rows = projects.slice(0, ROWS_BY_SIZE[size]);

  if (rows.length === 0) return <QuietLine text="No active projects yet." />;

  // A 120px meter COLUMN does not fit a 230px cell — but the meter itself is
  // the point of this widget, so 's' no longer drops it: it moves under the
  // name and runs the row's width instead. What 's' still drops is the
  // `done/total` count, which the percentage already summarises.
  const wide = size !== 's';

  // WidgetList grows for the same reason as RecentActivityWidget: "All
  // projects" pins to the bottom edge rather than floating under four rows.
  return (
    <WidgetList type={instance.type}>
      {rows.map((project, idx) => (
        <ListRow
          key={project.id}
          isLast={idx === rows.length - 1}
          onPress={() => router.push(`/projects/${project.id}` as any)}
          accessibilityLabel={`Open ${project.name}, ${Math.round(project.completionRate)} percent complete`}
          className="gap-4"
          style={{ minHeight: 44 }}
        >
          <EntityGlyph kind="project" size={18} />
          <View className="flex-1 min-w-0">
            <Text className="text-typography-main text-xs font-semibold" numberOfLines={1}>{project.name}</Text>
            {!wide && (
              <View className="mt-1.5">
                <ProgressMeter percent={project.completionRate} showCaption={false} height={3} />
              </View>
            )}
          </View>
          {wide && (
            <>
              <Text className="text-typography-dim text-[10px]">{project.completedTasks}/{project.totalTasks}</Text>
              <View style={{ width: 120 }}>
                <ProgressMeter percent={project.completionRate} showCaption={false} height={4} />
              </View>
            </>
          )}
          <Text className="text-typography-muted text-[10px] font-semibold" style={{ width: 32, textAlign: 'right' }}>
            {Math.round(project.completionRate)}%
          </Text>
        </ListRow>
      ))}

      {/* Replaces the header link the desktop screen carried. */}
      <SeeAllRow label="All projects" onPress={() => router.push('/projects' as any)} />
    </WidgetList>
  );
}

// ── The table ────────────────────────────────────────────────────────────

/**
 * WIDGET_META (what a widget IS) joined to its component (how it draws). The
 * metadata deliberately stays in lib/dashboardWidgets.ts so the self-check can
 * import it without pulling in react-native; this file adds the only thing that
 * cannot live there.
 */
export const WIDGET_REGISTRY: Record<WidgetType, WidgetDef> = {
  'facts': { ...WIDGET_META['facts'], component: FactsWidget },
  'pipeline-completion': { ...WIDGET_META['pipeline-completion'], component: PipelineCompletionWidget },
  'projection-strip': { ...WIDGET_META['projection-strip'], component: ProjectionStripWidget },
  'blocked-exceptions': { ...WIDGET_META['blocked-exceptions'], component: BlockedExceptionsWidget },
  'active-projects': { ...WIDGET_META['active-projects'], component: ActiveProjectsWidget },
  'pipeline-overview': { ...WIDGET_META['pipeline-overview'], component: PipelineOverviewAdapter },
  'recent-activity': { ...WIDGET_META['recent-activity'], component: RecentActivityWidget },
  'pending-time-approvals': { ...WIDGET_META['pending-time-approvals'], component: PendingTimeApprovalsAdapter },

  // The personal set. No adapters: these bodies already take WidgetBodyProps and
  // read useDashboardData()/useAnalytics() themselves, so there is nothing left
  // for a wrapper to translate. Five of the six self-fetch and are singletons
  // for it; my-performance goes through AnalyticsContext's dedup cache, which is
  // why it is the one type here that may appear twice.
  'my-work': { ...WIDGET_META['my-work'], component: MyWorkWidget },
  'my-deadlines': { ...WIDGET_META['my-deadlines'], component: MyDeadlinesWidget },
  'last-worked-on': { ...WIDGET_META['last-worked-on'], component: LastWorkedOnWidget },
  'live-now': { ...WIDGET_META['live-now'], component: LiveNowWidget },
  'filehub-inbox': { ...WIDGET_META['filehub-inbox'], component: FileHubInboxWidget },
  'my-performance': { ...WIDGET_META['my-performance'], component: MyPerformanceWidget },
};

export function getWidget(type: WidgetType): WidgetDef {
  return WIDGET_REGISTRY[type];
}
