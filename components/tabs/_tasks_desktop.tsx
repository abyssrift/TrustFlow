import AnimatedTaskCard from '@/components/common/AnimatedTaskCard';
import { FileDropOverlay } from '@/components/common/FileDropOverlay';
import LinkifiedText from '@/components/common/LinkifiedText';
import LoadingOverlay from '@/components/common/LoadingOverlay';
import Tooltip from '@/components/common/Tooltip';
import BoardSwitcherPopup from '@/components/kanban/BoardSwitcherPopup';
import KanbanPersonalizer from '@/components/kanban/KanbanPersonalizer';
import RightSidebar from '@/components/kanban/RightSidebar.web';
import { IdleConveyor } from '@/components/tabs/IdleConveyor';
import LinkedTasksStrip from '@/components/tabs/LinkedTasksStrip';
import StageCountOdometer from '@/components/tabs/StageCountOdometer';
import { StageTrailLayer, useStageTransitionFX } from '@/components/tabs/StageTransitionFX';
import { boardCacheMeta, compareTasksBySortKey, fetchLinkedTasks, prefetchOtherBoards, TASK_SORT_OPTIONS, taskCache, type BoardSnapshot, type LinkedTask, type TaskSortKey } from '@/components/tabs/taskBoardCache';
import ActiveSessionAvatars from '@/components/task-detail/ActiveSessionAvatars';
import TaskCardActions, { type ActiveSessionUser } from '@/components/task-detail/TaskCardActions';
import TaskPingButton from '@/components/task-detail/TaskPingButton';
import AssignmentModal from '@/components/tasks/AssignmentModal';
import CreateTaskModal from '@/components/tasks/CreateTaskModal.web';
import TaskMobilityModal from '@/components/tasks/TaskMobilityModal';
import { useAlert } from '@/contexts/AlertContext';
import { useAuth } from '@/contexts/AuthContext';
import { usePingHighlight } from '@/contexts/PingHighlightContext';
import { TaskCreationProvider, type StagedBriefFile } from '@/contexts/TaskCreationContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useTimer } from '@/contexts/TimerContext';
import { useToast } from '@/contexts/ToastContext';
import { BOARD_PICKER_KEYS, useBoardPicker } from '@/hooks/useBoardPicker';
import { useFileDrop, useSmartPaste } from '@/hooks/useWebDnd';
import { offerForceStopOnArchiveError } from '@/lib/archiveForceStop';
import { fileToStaged } from '@/lib/pasteImage';
import { supabase } from '@/lib/supabase';
import { addPinnedTaskId, emptyColumnPage, mergeTasksById, stagePageQuery, TASK_PAGE_SIZE, type BoardFilters, type ColumnPage } from '@/lib/taskBoardPage';
import { formatCompact, formatRelative } from '@/lib/time';
import { createWheelStepper } from '@/lib/wheelGesture';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View
} from 'react-native';
import { cssInterop } from 'react-native-css-interop';

cssInterop(FontAwesome, {
  className: {
    target: 'style',
    nativeStyleToProp: { color: true, size: true },
  },
} as any);

type Stage = {
  id: string;
  name: string;
  color: string;
  position: number;
  requires_timer?: boolean;
  is_terminal?: boolean;
  terminal_type?: string | null;
  linked_pipeline?: { name: string } | null;
};

type PersonalPulse = {
  daily_points: number;
  monthly_points: number;
  active_seconds_today: number;
  flap_rate_score: number;
  is_working: boolean;
};

type Task = {
  id: string;
  title: string;
  description: string;
  current_stage_id: string;
  priority: string;
  created_at: string;
  category: string;
  parent_task_id?: string;
  manager_id?: string;
  project_id?: string;
  due_date?: string | null;
  project?: { id: string; name: string } | null;
  manager?: { id: string; full_name: string } | null;
  assignments?: {
    assignee_user_id: string | null;
    assignee_team_id: string | null;
    team?: { name: string } | null;
    user?: { full_name: string } | null;
  }[];
  total_seconds?: number;
  my_seconds?: number;
  submission_count?: { count: number }[];
  comment_count?: { count: number }[];
  has_mention?: boolean;
  weight?: number;
  estimated_hours?: number | null;
};

// Focus-mode (single-stage fullscreen) sort order: most urgent/heaviest first.
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

type FilterState = {
  priorities: string[];
  categories: string[];
  projectIds: string[];
  managerIds: string[];
  dueDates: string[];
};

const DUE_DATE_BUCKETS = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Due Today' },
  { key: 'week', label: 'This Week' },
  { key: 'none', label: 'No Due Date' },
] as const;

function getDueBucket(dueDate?: string | null): string {
  if (!dueDate) return 'none';
  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((new Date(dueDate).getTime() - startToday.getTime()) / 86400000);
  if (diffDays < 0) return 'overdue';
  if (diffDays === 0) return 'today';
  if (diffDays <= 7) return 'week';
  return 'later';
}

type Pipeline = {
  id: string;
  name: string;
  task_visibility_mode: 'all' | 'assigned_only';
  is_default?: boolean;
};

const STORAGE_KEYS = {
  LAST_BOARD: '@TrustFlow_last_board_id',
} as const;

// One definition of "a task row on this board" — the page fetch, the
// warm-the-other-boards prefetch and the pinned-task top-up all select the same
// columns, so a card can't render differently depending on which of the three
// loaded it (#194).
const TASK_SELECT = `
  *,
  project:project_id(id, name),
  manager:manager_id(id, full_name),
  claimed_by_user:claimed_by(full_name),
  assignments:task_assignments(
    assignee_user_id,
    assignee_team_id,
    team:assignee_team_id(name, enforce_single_claimant),
    user:assignee_user_id(full_name)
  ),
  submission_count:task_submissions(count),
  comment_count:task_comments(count)
`;

// What a page load was for. Comparing it lets the filter/search effect skip the
// load fetchData just performed instead of firing a duplicate round of queries.
const loadSignature = (pipelineId: string, stageList: { id: string }[], f: BoardFilters) =>
  JSON.stringify([pipelineId, stageList.map(s => s.id), f.priorities, f.categories, f.projectIds, f.managerIds, f.dueDates, (f.search || '').trim()]);

function PingTimeBadge({ pingedAt }: { pingedAt: number }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const label = formatRelative(new Date(pingedAt));
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute', top: -10, right: 10, zIndex: 20,
        flexDirection: 'row', alignItems: 'center', gap: 3,
        backgroundColor: 'rgba(224, 120, 0, 0.95)',
        paddingHorizontal: 7, paddingVertical: 2.5, borderRadius: 20,
        borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)',
      }}
    >
      <FontAwesome name="bullhorn" size={7} color="white" />
      <Text style={{ color: 'white', fontSize: 8, fontWeight: '900' }}>{label}</Text>
    </View>
  );
}

// Hover preview that shows the boards a wheel-scroll (or Ctrl+[ / Ctrl+]) would
// land on — the previous and next board, wrapping around the sorted list.
function BoardPeekCard({
  prevBoard,
  nextBoard,
  counts,
  newCounts,
  onSelect,
  onMouseEnter,
  onMouseLeave,
}: {
  prevBoard: Pipeline | null;
  nextBoard: Pipeline | null;
  counts: Record<string, number>;
  newCounts: Record<string, number>;
  onSelect: (id: string) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const colors = useThemeColors();
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: 130, useNativeDriver: true }).start();
  }, [anim]);

  // Two-board lists collapse prev/next onto the same board — show it once.
  const sameBoard = !!prevBoard && !!nextBoard && prevBoard.id === nextBoard.id;
  const showPrev = !sameBoard ? prevBoard : null;

  const renderRow = (board: Pipeline | null, dir: 'prev' | 'next') => {
    if (!board) return null;
    const count = counts[board.id];
    const hasNew = (newCounts[board.id] || 0) > 0;
    const isPrev = dir === 'prev';
    return (
      <Pressable
        onPress={(e) => {
          // The card lives inside the pill's TouchableOpacity; stop the press
          // from bubbling up and also opening the full board picker.
          e.stopPropagation();
          onSelect(board.id);
        }}
        className={`flex-row items-center rounded-2xl border px-3 py-2.5 transition-colors ${
          hasNew
            ? 'border-state-danger/40 bg-state-danger/5 hover:border-state-danger/70'
            : 'border-surface-border bg-surface-background hover:border-brand-primary/50'
        }`}
      >
        <View className={`h-8 w-8 items-center justify-center rounded-lg ${isPrev ? 'bg-brand-primary/10' : 'bg-brand-primary/15'}`}>
          <FontAwesome name={isPrev ? 'arrow-up' : 'arrow-down'} size={12} className="text-brand-primary" />
        </View>
        <View className="ml-2.5 flex-1 min-w-0">
          <Text className="mb-0.5 text-typography-muted text-[7.5px] font-black uppercase tracking-[0.16em]">
            {isPrev ? 'Previous' : 'Next'}
          </Text>
          <Text className="text-typography-main text-[13.5px] font-black tracking-tight" numberOfLines={1}>{board.name}</Text>
        </View>
        {count !== undefined && (
          <View className={`ml-2 min-w-8 items-center rounded-full border px-2 py-0.5 ${hasNew ? 'border-state-danger bg-state-danger' : 'border-surface-border bg-surface-overlay'}`}>
            <Text className={`text-[10px] font-black ${hasNew ? 'text-white' : 'text-typography-muted'}`}>{count}</Text>
          </View>
        )}
      </Pressable>
    );
  };

  return (
    <Animated.View
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: 'absolute',
        top: '100%',
        left: 0,
        // Sits a touch above the "Task Board" heading so the card fully covers it.
        marginTop: 4,
        zIndex: 60,
        width: 320,
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: 16, // rounded-2xl
        overflow: 'hidden',
        boxShadow: '0px 4px 8px rgba(0, 0, 0, 0.3)', // premium-shadow
        opacity: anim,
        transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }],
      }}
    >
      <View className="flex-row items-center gap-2 border-b border-surface-border/70 px-4 py-3">
        <View className="h-6 w-6 items-center justify-center rounded-lg bg-brand-primary/10">
          <FontAwesome name="exchange" size={10} className="text-brand-primary" />
        </View>
        <Text className="text-typography-muted text-[9px] font-black uppercase tracking-[0.18em]">Switch board</Text>
        <View className="ml-auto flex-row items-center gap-1">
          <FontAwesome name="mouse-pointer" size={9} className="text-typography-muted/70" />
          <Text className="text-typography-muted text-[8px] font-bold">wheel · ctrl+[ ]</Text>
        </View>
      </View>
      <View className="gap-2 p-2.5">
        {renderRow(showPrev, 'prev')}
        {renderRow(nextBoard, 'next')}
      </View>
    </Animated.View>
  );
}

export function TasksScreenWeb() {
  const colors = useThemeColors();
  const { activeSession, lastStoppedAt } = useTimer();
  const { pipelineId: paramPipelineId } = useLocalSearchParams();

  // Seed initial state from the shared cache so a revisit / warmed board paints
  // instantly instead of reloading. Keyed by the board we're about to show.
  const seedKey = (Array.isArray(paramPipelineId) ? paramPipelineId[0] : paramPipelineId) || boardCacheMeta.lastPipelineId || undefined;
  const seed = seedKey ? taskCache.get(seedKey) : undefined;

  const [pipeline, setPipeline] = useState<Pipeline | null>((seed?.pipeline as Pipeline) ?? null);
  const [stages, setStages] = useState<Stage[]>((seed?.stages as Stage[]) ?? []);
  const [tasks, setTasks] = useState<Task[]>((seed?.tasks as Task[]) ?? []);
  // #194: `tasks` is still ONE flat array bucketed by stage at render time —
  // that is deliberate and is what makes a cross-column move safe (see
  // lib/taskBoardPage.ts). What changed is that it is now filled a bounded page
  // per stage at a time; `columns` is each stage's paging cursor.
  const [columns, setColumns] = useState<Record<string, ColumnPage>>(seed?.columns ?? {});
  const [linkedTasks, setLinkedTasks] = useState<LinkedTask[]>(seed?.linkedTasks ?? []);
  const [loading, setLoading] = useState(!seed);
  const [switchingBoard, setSwitchingBoard] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [availablePipelines, setAvailablePipelines] = useState<Pipeline[]>((seed?.availablePipelines as Pipeline[]) ?? []);
  const [showPipelinePicker, setShowPipelinePicker] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  // Phase 3: content pasted/dropped on the screen with no composer open, handed
  // to CreateTaskModal as seed data on the next open.
  const [seedText, setSeedText] = useState<string | null>(null);
  const [seedFiles, setSeedFiles] = useState<StagedBriefFile[] | null>(null);
  const [activeSessions, setActiveSessions] = useState<Record<string, ActiveSessionUser[]>>(seed?.activeSessions ?? {});
  const [pulse, setPulse] = useState<PersonalPulse | null>(null);
  const [showAssignmentModal, setShowAssignmentModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [stageActions, setStageActions] = useState<any[]>(seed?.stageActions ?? []);
  const [stageTransitions, setStageTransitions] = useState<{ id: string; to_stage_id: string }[]>(seed?.stageTransitions ?? []);
  const [showPersonalizer, setShowPersonalizer] = useState(false);
  const [showMobility, setShowMobility] = useState(false);
  const [fullscreenStageId, setFullscreenStageId] = useState<string | null>(null);
  const [settledFullscreenId, setSettledFullscreenId] = useState<string | null>(null);
  const [boardTransitioning, setBoardTransitioning] = useState(false);
  const [boardWidth, setBoardWidth] = useState(0);
  const boardWidthRef = useRef(0);
  const boardContainerRef = useRef<View>(null);
  const boardScrollRef = useRef<ScrollView>(null);
  const stageFX = useStageTransitionFX(boardContainerRef, colors.primary);
  const fetchDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // #194 paging refs. fetchData/loadColumns are plain (non-memoised) closures
  // called from effects, realtime handlers and refs, so anything they need to
  // read "as of now" goes through a ref rather than a dependency array.
  const pinnedIdsRef = useRef<string[]>([]);
  const activeSessionTaskRef = useRef<string | null>(null);
  activeSessionTaskRef.current = activeSession?.task_id ?? null;
  const filtersRef = useRef<BoardFilters>({ priorities: [], categories: [], projectIds: [], managerIds: [], dueDates: [], search: '' });
  const pipelineIdRef = useRef<string | null>(null);
  // Signature of the last page load actually performed, so the filter/search
  // effect below doesn't re-run the load fetchData just did.
  const loadSigRef = useRef<string>('');

  // Wait out the 300ms width transition before mounting the wrap-grid layout —
  // reflowing every card on each animation frame while the column resizes is what was dropping frames.
  // While transitioning (either direction) the cards' layout springs are turned
  // off so reanimated doesn't fight the CSS width transition frame-by-frame.
  useEffect(() => {
    if (fullscreenStageId) {
      // Re-measure fresh instead of trusting boardWidthRef, which may still be at
      // its initial 0 if this is the first layout pass since the app loaded (the
      // wrapping View's onLayout hasn't fired yet). Falling through to a stale 0
      // used to fall back to width: '100%', which blows out inside the horizontal
      // ScrollView's row content and pushes the column off-screen.
      boardContainerRef.current?.measure((_x, _y, width) => {
        if (width) {
          boardWidthRef.current = width;
          setBoardWidth(width);
        }
      });
      // scrollEnabled just disables further scrolling — it doesn't reset the
      // scrollLeft the board might already be sitting at (e.g. from scrolling
      // over to a later stage before hitting fullscreen). Left uncleared, the
      // fullscreen column renders shifted by that stale offset: clipped on the
      // left, empty space on the right where the collapsed columns used to be.
      boardScrollRef.current?.scrollTo({ x: 0, animated: false });
    }
    setBoardTransitioning(true);
    const t = setTimeout(() => {
      setBoardTransitioning(false);
      setSettledFullscreenId(fullscreenStageId);
    }, 300);
    return () => clearTimeout(t);
  }, [fullscreenStageId]);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<FilterState>({ priorities: [], categories: [], projectIds: [], managerIds: [], dueDates: [] });
  const [sortKey, setSortKey] = useState<TaskSortKey>('default');
  const [searchQuery, setSearchQuery] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const [myTeamIds, setMyTeamIds] = useState<string[]>(seed?.myTeamIds ?? []);

  // Every filter that is a plain column predicate is served by the query, not
  // by narrowing the 30 rows already in memory (see lib/taskBoardPage.ts).
  // `mineOnly` is the exception and stays a render-time narrowing.
  filtersRef.current = { ...filters, search: searchQuery };
  pipelineIdRef.current = pipeline?.id ?? null;

  // Archival State
  const [archiveModal, setArchiveModal] = useState<{ visible: boolean, taskId: string | null }>({ visible: false, taskId: null });
  const [archiving, setArchiving] = useState(false);
  // Cards currently playing their WAAPI exit animation (see AnimatedTaskCard)
  // — stay in `tasks` until that finishes, then patchTaskArchived drops them.
  const [exitingTaskIds, setExitingTaskIds] = useState<Set<string>>(new Set());

  // Smart Board Picker State — favourites, recents, counts and the stable
  // cycle order all live in the shared hook (see hooks/useBoardPicker.ts).
  const boardPicker = useBoardPicker(availablePipelines, pipeline?.id);

  // Refs for event handlers
  const boardPickerButtonRef = React.useRef<any>(null);
  
  const { kanban, theme: activeTheme } = useTheme();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const { user, hasPermission, profile } = useAuth();
  const { errorToast, warningToast } = useToast();
  const { showConfirm } = useAlert();

  const { pingedTasks, removePingedTask } = usePingHighlight();

  // Optimistic local patch so a card jumps columns the instant its own action
  // succeeds, instead of waiting on the realtime round-trip / fetchData reload.
  //
  // #194: with paginated columns this is also the *only* thing keeping the card
  // visible. The row stays in the flat array and simply re-buckets, so it can
  // neither vanish nor duplicate — but the reconcile fetch ~500ms later re-pages
  // every column from offset 0, and the task may now sit outside its new
  // column's first page. Pinning it makes that fetch top it up explicitly.
  const patchTaskStage = (taskId: string, toStageId: string) => {
    pinnedIdsRef.current = addPinnedTaskId(pinnedIdsRef.current, taskId);
    setTasks(prev => prev.map(t => (t.id === taskId ? { ...t, current_stage_id: toStageId } : t)));
  };

  // Same idea for archive, but two-phase: reanimated's declarative `exiting`
  // doesn't paint on this web build (same reason the stage FLIP is hand-rolled
  // — see AnimatedTaskCard), so a card removed from `tasks` immediately just
  // vanishes. beginArchiveExit only marks it "exiting" — AnimatedTaskCard
  // plays a WAAPI shrink+fade on that card's own DOM node, and patchTaskArchived
  // (the actual removal) runs from its onExited callback once that finishes.
  const beginArchiveExit = (taskId: string) =>
    setExitingTaskIds(prev => (prev.has(taskId) ? prev : new Set(prev).add(taskId)));

  const patchTaskArchived = (taskId: string) => {
    // Unpin first — otherwise the pinned top-up would fetch the archived task
    // straight back onto the board on the next reconcile.
    pinnedIdsRef.current = pinnedIdsRef.current.filter(id => id !== taskId);
    setTasks(prev => prev.filter(t => t.id !== taskId));
    setExitingTaskIds(prev => {
      if (!prev.has(taskId)) return prev;
      const next = new Set(prev);
      next.delete(taskId);
      return next;
    });
  };

  // And for starting a timer: rpc_start_work doesn't even land for up to 15s
  // (TimerContext's own optimistic-commit delay), so refetching immediately
  // just repaints the board with nothing new. Show this user's own session
  // locally; the debounced realtime reconcile below still runs once the RPC
  // actually commits, for other viewers.
  const patchTaskSessionStarted = (taskId: string) => {
    if (!user) return;
    setActiveSessions(prev => {
      const existing = prev[taskId] || [];
      if (existing.some(s => s.userId === user.id)) return prev;
      const now = new Date().toISOString();
      return {
        ...prev,
        [taskId]: [...existing, {
          userId: user.id,
          name: profile?.full_name || user.email || 'You',
          avatar: profile?.avatar_url ?? null,
          startedAt: now,
          lastHeartbeatAt: now,
        }],
      };
    });
  };

  // Time metrics + @-mention flags for a batch of rows. These were always
  // keyed off the fetched task ids, so bounding the pages bounded them too —
  // they no longer scan an entire pipeline's comments on every reconcile.
  const enrichTasks = async (rows: any[]): Promise<Task[]> => {
    if (rows.length === 0) return [];
    const ids = rows.map(t => t.id);

    const [{ data: timeMetrics }, { data: acks }] = await Promise.all([
      supabase.from('view_task_time_metrics').select('*').in('task_id', ids),
      supabase.from('task_mention_acks').select('task_id, acknowledged_at').eq('user_id', user?.id).in('task_id', ids),
    ]);

    const variants = Array.from(new Set([
      profile?.full_name,
      profile?.display_name,
      user?.user_metadata?.full_name,
      user?.email?.split('@')[0],
    ].filter(Boolean) as string[]));
    const searchTerms = new Set<string>();
    variants.forEach(v => {
      searchTerms.add(v);
      const first = v.split(' ')[0];
      if (first && first.length > 2) searchTerms.add(first);
    });
    const orQuery = Array.from(searchTerms).map(term => `content.ilike.%@${term}%`).join(',');
    const { data: mentions } = orQuery
      ? await supabase.from('task_comments').select('task_id, created_at').or(orQuery).in('task_id', ids)
      : { data: [] as any[] };

    const timeMap = (timeMetrics || []).reduce((acc, curr) => { acc[curr.task_id] = curr; return acc; }, {} as any);
    const ackMap = new Map((acks || []).map(a => [a.task_id, a.acknowledged_at]));
    const mentionTaskIds = new Set<string>();
    (mentions || []).forEach((m: any) => {
      const lastAck = ackMap.get(m.task_id);
      if (!lastAck || new Date(m.created_at) > new Date(lastAck)) mentionTaskIds.add(m.task_id);
    });

    return rows.map(t => ({
      ...t,
      total_seconds: timeMap[t.id]?.total_seconds || 0,
      my_seconds: timeMap[t.id]?.my_seconds || 0,
      has_mention: mentionTaskIds.has(t.id),
    })) as Task[];
  };

  const stagePage = (pipelineId: string, stageId: string, offset: number) =>
    stagePageQuery(
      supabase.from('tasks').select(TASK_SELECT).eq('pipeline_id', pipelineId).eq('current_stage_id', stageId).is('deleted_at', null),
      offset,
      filtersRef.current,
    );

  /**
   * #194: one bounded page per stage column, every stage in parallel — one
   * request per column, never one per task. The initial payload is
   * (stage count x TASK_PAGE_SIZE), not the pipeline's task count.
   *
   * Returns the rows and cursors it set, so fetchData can snapshot both into
   * taskCache — a board painted from cache has to know which columns still
   * have rows behind them, or its "Show more" buttons go missing until the
   * background refetch lands.
   */
  const loadColumns = async (targetPipelineId: string, stageList: Stage[]): Promise<{ rows: Task[]; columns: Record<string, ColumnPage> }> => {
    loadSigRef.current = loadSignature(targetPipelineId, stageList, filtersRef.current);
    setColumns(Object.fromEntries(stageList.map(s => [s.id, { ...emptyColumnPage(), loading: true }])));

    const pages = await Promise.all(stageList.map(s => stagePage(targetPipelineId, s.id, 0)));

    const nextColumns: Record<string, ColumnPage> = {};
    let rows: any[] = [];
    stageList.forEach((s, i) => {
      const data = (pages[i]?.data as any[]) || [];
      nextColumns[s.id] = { offset: 0, hasMore: data.length === TASK_PAGE_SIZE, loading: false };
      rows = rows.concat(data);
    });

    // Top-up. A user must always be able to see the task their timer is running
    // on, and a card someone just moved must not disappear a heartbeat later —
    // either can legitimately sit outside its column's first page. One extra
    // bounded request by id, only when one of them is actually missing.
    const pinned = Array.from(new Set(
      [...pinnedIdsRef.current, activeSessionTaskRef.current].filter(Boolean) as string[]
    ));
    const missing = pinned.filter(id => !rows.some(r => r.id === id));
    if (missing.length > 0) {
      const { data } = await supabase.from('tasks').select(TASK_SELECT).eq('pipeline_id', targetPipelineId).in('id', missing).is('deleted_at', null);
      rows = rows.concat((data as any[]) || []);
    }

    const enriched = await enrichTasks(rows);
    setColumns(nextColumns);
    setTasks(enriched);
    return { rows: enriched, columns: nextColumns };
  };
  const loadColumnsRef = useRef(loadColumns);
  loadColumnsRef.current = loadColumns;

  // "Show 30 more" for one column. Offset paging over a column whose membership
  // can change under it may hand back a row that is already loaded — merging by
  // id kills the duplicate. (A row can conversely be skipped if a task moved IN
  // since page 0; the next reconcile reload picks it up. ponytail: keyset paging
  // on (created_at, id) is the fix if that ever surfaces as a real complaint.)
  const loadMoreStage = async (stageId: string) => {
    const pid = pipelineIdRef.current;
    const col = columns[stageId];
    if (!pid || !col || col.loading || !col.hasMore) return;
    const offset = col.offset + TASK_PAGE_SIZE;
    setColumns(prev => ({ ...prev, [stageId]: { ...prev[stageId], loading: true } }));
    const { data } = await stagePage(pid, stageId, offset);
    const rows = (data as any[]) || [];
    const enriched = await enrichTasks(rows);
    setTasks(prev => mergeTasksById(prev, enriched));
    setColumns(prev => ({ ...prev, [stageId]: { offset, hasMore: rows.length === TASK_PAGE_SIZE, loading: false } }));
  };

  // Trailing debounce so one move — which triggers a card action refresh PLUS
  // realtime echoes on tasks + pipeline_stage_history — collapses into a
  // single ~4s reconcile fetch instead of three overlapping ones. The
  // optimistic patch above already updated the board; this is only the
  // eventual-consistency sweep, so nobody is waiting on it.
  const debouncedFetchData = () => {
    clearTimeout(fetchDebounceRef.current);
    fetchDebounceRef.current = setTimeout(() => fetchData(), 500);
  };

  const fetchData = async () => {
    const fxT0 = Date.now(); // TEMP diagnostics — see FX_DEBUG in StageTransitionFX
    try {
      // 1. Resolve Pipeline
      let targetPipelineId = paramPipelineId;
      let pipelineData: any = null;
      if (!targetPipelineId) {
        // Try to restore personal default first. Read straight from storage
        // rather than the picker hook's state — this runs on mount, and the
        // hook hydrates asynchronously, so its value isn't reliable yet.
        const savedMyDefault = await AsyncStorage.getItem(BOARD_PICKER_KEYS.MY_DEFAULT);
        if (savedMyDefault) {
          const { data: pMyDefault } = await supabase.from('pipelines').select('id, name, task_visibility_mode, is_default').eq('id', savedMyDefault).single();
          if (pMyDefault) {
            targetPipelineId = pMyDefault.id;
            pipelineData = pMyDefault;
            setPipeline(pMyDefault);
          }
        }
        // Fall back to last selected pipeline
        if (!targetPipelineId) {
          const savedPipelineId = await AsyncStorage.getItem('@TrustFlow_tasks_pipeline');
          if (savedPipelineId) {
            const { data: pSaved } = await supabase.from('pipelines').select('id, name, task_visibility_mode, is_default').eq('id', savedPipelineId).single();
            if (pSaved) {
              targetPipelineId = pSaved.id;
              pipelineData = pSaved;
              setPipeline(pSaved);
            }
          }
        }
        // Fall back to workspace default if nothing found
        if (!targetPipelineId) {
          try {
            const { data: pDefault } = await supabase.from('pipelines').select('id, name, task_visibility_mode, is_default').eq('is_default', true).limit(1).single();
            if (pDefault) {
              targetPipelineId = pDefault.id;
              pipelineData = pDefault;
              setPipeline(pDefault);
            }
          } catch (e) {
            // No default pipeline set, will use first available board
          }
        }
      } else {
        try {
          const { data: pSpecific } = await supabase.from('pipelines').select('id, name, task_visibility_mode, is_default').eq('id', targetPipelineId).single();
          if (pSpecific) {
            targetPipelineId = pSpecific.id;
            pipelineData = pSpecific;
            setPipeline(pSpecific);
          }
        } catch (e) {
          console.error('Failed to load specified pipeline:', e);
        }
      }

      const { data: allPipes } = await supabase.from('pipelines').select('id, name, task_visibility_mode, is_default').is('deleted_at', null);
      setAvailablePipelines(allPipes as Pipeline[] || []);

      // If still no pipeline, default to first available board
      if (!targetPipelineId && allPipes && allPipes.length > 0) {
        targetPipelineId = allPipes[0].id;
        pipelineData = allPipes[0];
        setPipeline(allPipes[0]);
      }

      if (!targetPipelineId) return;

      // 2. Get stages
      const { data: stagesData } = await supabase
        .from('pipeline_stages')
        .select('*, linked_pipeline:linked_pipeline_id(id, name)')
        .eq('pipeline_id', targetPipelineId)
        .order('position', { ascending: true });
      setStages(stagesData || []);

      // 3. Get stage actions
      const { data: actionsData } = await supabase
        .from('pipeline_stage_actions')
        .select('*')
        .in('stage_id', (stagesData || []).map(s => s.id));
      setStageActions(actionsData || []);

      // Transitions let card buttons resolve their target stage (for directional arrows).
      const { data: transitionsData } = await supabase
        .from('pipeline_stage_transitions')
        .select('id, to_stage_id')
        .in('from_stage_id', (stagesData || []).map(s => s.id));
      setStageTransitions(transitionsData || []);

      // 4. Get User Teams (for filtering)
      const { data: myTeams } = await supabase
        .from('team_members')
        .select('team_id')
        .eq('user_id', user?.id)
        .is('removed_at', null);
      const myTeamIds = myTeams?.map(mt => mt.team_id) || [];
      setMyTeamIds(myTeamIds);

      // 5. Get tasks — one bounded page per stage column, in parallel (#194).
      // The `assigned_only` visibility mode is NOT re-filtered here any more:
      // `tasks_select_visibility` (RLS) already enforces exactly that predicate,
      // so the page the server hands back is already visibility-filtered.
      // Re-filtering a bounded page in the client is what makes it ragged
      // (30 fetched, 3 shown) — see lib/taskBoardPage.ts.
      const { rows: finalTasks, columns: finalColumns } = await loadColumns(targetPipelineId as string, (stagesData || []) as Stage[]);

      // 6. Active Sessions
      const { data: sessions } = await supabase
        .from('task_work_sessions')
        .select('task_id, user_id, started_at, last_heartbeat_at, user:user_id(full_name, avatar_url)')
        .eq('status', 'active');

      const sessionMap: Record<string, ActiveSessionUser[]> = {};
      sessions?.forEach(s => {
         if (!sessionMap[s.task_id]) sessionMap[s.task_id] = [];
         sessionMap[s.task_id].push({
           userId: s.user_id,
           name: (s.user as any)?.full_name || 'User',
           avatar: (s.user as any)?.avatar_url,
           startedAt: s.started_at,
           lastHeartbeatAt: (s as any).last_heartbeat_at,
         });
      });
      setActiveSessions(sessionMap);

      // 7. Tasks linked onto this board from elsewhere (#203) — read-only
      // reference cards, shown separately from the real stage columns.
      const linkedTasksData = await fetchLinkedTasks(supabase, targetPipelineId as string);
      setLinkedTasks(linkedTasksData);

      // Snapshot into the shared cache so the next mount / board switch is instant.
      taskCache.set(targetPipelineId as string, {
        pipeline: pipelineData,
        stages: stagesData || [],
        tasks: finalTasks,
        availablePipelines: (allPipes as Pipeline[]) || [],
        stageActions: actionsData || [],
        stageTransitions: transitionsData || [],
        activeSessions: sessionMap,
        myTeamIds,
        columns: finalColumns,
        linkedTasks: linkedTasksData,
      });
      boardCacheMeta.lastPipelineId = targetPipelineId as string;

    } catch (err) {
      console.error('[WEB TASK ERROR] Data fetch failed:', err);
    } finally {
      console.log('[FXDBG] fetchData took', Date.now() - fxT0, 'ms');
      setLoading(false);
      setRefreshing(false);
      setSwitchingBoard(false);
    }
  };

  // Load one board's data into a cache snapshot without touching component state,
  // used to warm other boards so switching to them is instant. Mirrors fetchData's
  // core queries + time metrics; skips the expensive mention scan (it fills in on
  // the background refetch triggered when the board is actually opened).
  const loadBoardSnapshot = useCallback(async (boardId: string): Promise<BoardSnapshot | null> => {
    const board = availablePipelines.find(p => p.id === boardId);
    if (!board) return null;
    const { data: stagesData } = await supabase
      .from('pipeline_stages')
      .select('*, linked_pipeline:linked_pipeline_id(id, name)')
      .eq('pipeline_id', boardId)
      .order('position', { ascending: true });
    const stages = stagesData || [];
    const stageIds = stages.map((s: any) => s.id);
    // #194: the warm-up is paged exactly like the live board. It used to pull
    // every other board's ENTIRE task list in the background — the same
    // unbounded query as the board itself, multiplied by the board count.
    // Filters are deliberately not applied: this is a cold snapshot for a board
    // the user hasn't opened, and opening it triggers a filtered refetch anyway.
    const [{ data: actionsData }, { data: transitionsData }, ...pages] = await Promise.all([
      supabase.from('pipeline_stage_actions').select('*').in('stage_id', stageIds),
      supabase.from('pipeline_stage_transitions').select('id, to_stage_id').in('from_stage_id', stageIds),
      ...stages.map((s: any) => stagePageQuery(
        supabase.from('tasks').select(TASK_SELECT).eq('pipeline_id', boardId).eq('current_stage_id', s.id).is('deleted_at', null),
        0,
      )),
    ]);
    const columns: Record<string, ColumnPage> = {};
    let tasksData: any[] = [];
    stages.forEach((s: any, i: number) => {
      const rows = ((pages[i] as any)?.data as any[]) || [];
      columns[s.id] = { offset: 0, hasMore: rows.length === TASK_PAGE_SIZE, loading: false };
      tasksData = tasksData.concat(rows);
    });
    const { data: timeMetrics } = await supabase
      .from('view_task_time_metrics')
      .select('*')
      .in('task_id', tasksData.map(t => t.id));
    const timeMap = (timeMetrics || []).reduce((acc, curr) => { acc[curr.task_id] = curr; return acc; }, {} as any);
    const filteredTasks = tasksData.map(t => ({
      ...t,
      total_seconds: timeMap[t.id]?.total_seconds || 0,
      my_seconds: timeMap[t.id]?.my_seconds || 0,
    }));
    const linkedTasksData = await fetchLinkedTasks(supabase, boardId);
    return {
      pipeline: board,
      stages,
      tasks: filteredTasks,
      availablePipelines,
      stageActions: actionsData || [],
      stageTransitions: transitionsData || [],
      activeSessions,
      myTeamIds,
      columns,
      linkedTasks: linkedTasksData,
    };
  }, [availablePipelines, user?.id, myTeamIds, activeSessions]);

  // Warm every other board in the background once the current board is loaded.
  const prefetchedRef = useRef<Set<string>>(new Set());
  const loadBoardSnapshotRef = useRef(loadBoardSnapshot);
  loadBoardSnapshotRef.current = loadBoardSnapshot;
  useEffect(() => {
    if (availablePipelines.length < 2 || !pipeline?.id) return;
    let cancelled = false;
    prefetchOtherBoards({
      boards: availablePipelines,
      currentId: pipeline.id,
      prefetched: prefetchedRef.current,
      isCancelled: () => cancelled,
      loadOne: (id) => loadBoardSnapshotRef.current(id),
    });
    return () => { cancelled = true; };
  }, [availablePipelines, pipeline?.id]);

  const fetchPulse = async () => {
    const { data } = await supabase.rpc('rpc_get_personal_pulse');
    if (data) setPulse(data);
  };

  // Personal default, favourites, recents and last-visit times are all hydrated
  // and persisted by useBoardPicker.

  useEffect(() => {
    fetchPulse();
    fetchData();

    const channelName = `tasks-board-realtime-web-${Date.now()}`;
    const tasksChannel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => debouncedFetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_work_sessions' }, () => debouncedFetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_comments' }, () => debouncedFetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_submissions' }, () => debouncedFetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_pipeline_links' }, () => debouncedFetchData())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pipeline_stage_history' }, (payload: any) => {
        const row = payload?.new;
        console.log('[FXDBG] realtime stage_history', row?.task_id, '→', row?.to_stage_id, 'by', row?.transitioned_by, 'self?', row?.transitioned_by === user?.id);
        if (row?.task_id && row?.to_stage_id && row?.transitioned_by !== user?.id) {
          stageFX.noteActor(row.task_id, row.transitioned_by ?? null);
          patchTaskStage(row.task_id, row.to_stage_id);
        }
        debouncedFetchData();
      })
      .subscribe();

    return () => {
      clearTimeout(fetchDebounceRef.current);
      supabase.removeChannel(tasksChannel);
    };
  }, [paramPipelineId, user?.id]);

  // #194: the filters and the search box are served by the query now, so a
  // change to either has to re-page every column — narrowing the 30 rows
  // already in memory would silently miss matches sitting on page 2. The
  // signature check makes this a no-op for the load fetchData just did (mount,
  // board switch, reconcile), so it only ever fires on a real filter change.
  // 250ms so typing a word is one round of requests, not one per keystroke.
  useEffect(() => {
    const pid = pipeline?.id;
    if (!pid || stages.length === 0) return;
    if (loadSignature(pid, stages, { ...filters, search: searchQuery }) === loadSigRef.current) return;
    const t = setTimeout(() => {
      // Re-check at fire time: on a warm-cache mount fetchData's own load may
      // have landed inside these 250ms, and repeating it would be pure waste.
      if (loadSignature(pid, stages, filtersRef.current) === loadSigRef.current) return;
      loadColumnsRef.current(pid, stages);
    }, 250);
    return () => clearTimeout(t);
  }, [filters, searchQuery, pipeline?.id, stages]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchPulse();
    fetchData();
  };

  const handleSetDefault = async (pipelineId: string) => {
    try {
      // Step 1: clear existing default (only rows currently marked true) — avoids unique constraint conflict
      await supabase.from('pipelines').update({ is_default: false }).eq('is_default', true);
      // Step 2: mark the chosen pipeline as default
      await supabase.from('pipelines').update({ is_default: true }).eq('id', pipelineId);
      // Refresh the list in-place
      const { data: allPipes } = await supabase.from('pipelines').select('id, name, task_visibility_mode, is_default').is('deleted_at', null);
      setAvailablePipelines(allPipes as Pipeline[] || []);
    } catch (err: any) {
      errorToast(err.message || 'Could not update default pipeline.');
    }
  };

  const handleCreateTask = () => {
    if (!hasPermission('task.create')) {
      errorToast('You do not have permission to create tasks.', 'Access denied');
      return;
    }
    setShowCreateModal(true);
  };

  // Phase 3: screen-level OS-file drop / Ctrl+V with no composer open → open it
  // pre-seeded. useFileDrop/useSmartPaste Platform-gate to web (no-op elsewhere);
  // disabled while the modal is open so its own paste handler (Phase 2) wins.
  const openWithSeed = () => setShowCreateModal(true);
  const { ref: taskDropRef, isOver: taskDropOver, isDragActive: taskDropActive } = useFileDrop(
    (files) => { setSeedFiles(files.map(fileToStaged)); openWithSeed(); },
    !showCreateModal,
  );
  useSmartPaste(
    {
      onFiles: (files) => { setSeedFiles(files.map(fileToStaged)); openWithSeed(); },
      onText:  (text)  => { setSeedText(text); openWithSeed(); },
    },
    !showCreateModal,
  );

  const handleOpenAssignments = (task: Task) => {
    setSelectedTask(task);
    setShowAssignmentModal(true);
  };

  const handleArchiveTask = async () => {
    const taskId = archiveModal.taskId;
    if (!taskId) return;

    try {
      setArchiving(true);
      const { error } = await supabase.rpc('rpc_archive_task', { p_task_id: taskId });
      if (error) throw error;

      setArchiveModal({ visible: false, taskId: null });
      beginArchiveExit(taskId);
    } catch (err: any) {
      setArchiveModal({ visible: false, taskId: null });
      if (offerForceStopOnArchiveError(err, { hasPermission, showConfirm, errorToast, retry: handleArchiveTask })) return;
      errorToast(err.message || 'Could not archive task.', 'Archival failed');
    } finally {
      setArchiving(false);
    }
  };

  // Swap to a board: if warmed in the cache, paint it instantly (the
  // paramPipelineId effect still refetches in the background); else show the
  // switching overlay until fetchData lands.
  const applySnapshot = useCallback((snap: BoardSnapshot) => {
    setPipeline(snap.pipeline as any);
    setStages(snap.stages as any);
    setTasks(snap.tasks as any);
    setAvailablePipelines(snap.availablePipelines as any);
    setStageActions(snap.stageActions);
    setStageTransitions(snap.stageTransitions);
    setActiveSessions(snap.activeSessions);
    setMyTeamIds(snap.myTeamIds);
    setColumns(snap.columns ?? {});
    setLinkedTasks(snap.linkedTasks ?? []);
    setLoading(false);
  }, []);

  const prepareBoardSwitch = useCallback((id: string) => {
    const snap = taskCache.get(id);
    if (snap) applySnapshot(snap);
    else setSwitchingBoard(true);
  }, [applySnapshot]);

  /**
   * `explicit` distinguishes a deliberate pick from the switcher (which should
   * land in Recents) from cycling past a board with Ctrl+]/wheel/peek (which
   * should not — otherwise skimming four boards floods all five slots).
   */
  const handleSelectBoard = async (boardId: string, opts?: { explicit?: boolean }) => {
    try {
      prepareBoardSwitch(boardId);
      boardPicker.recordBoardVisit(boardId, { explicit: opts?.explicit });
      await AsyncStorage.setItem(STORAGE_KEYS.LAST_BOARD, boardId);
      setShowPipelinePicker(false);
    } catch (e) {
      console.error('Failed to track board selection:', e);
    }
  };

  // Board peek: hover the selector to preview the prev/next boards (same order the
  // wheel-scroll and Ctrl+[ / Ctrl+] shortcuts cycle through), wrapping around.
  const [showBoardPeek, setShowBoardPeek] = useState(false);
  const peekCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const boardPeekNeighbours = boardPicker.neighbours;

  const openPeek = () => {
    if (peekCloseTimer.current) { clearTimeout(peekCloseTimer.current); peekCloseTimer.current = null; }
    setShowBoardPeek(true);
  };
  // Delay close so the cursor can move from the selector onto the card.
  const closePeekSoon = () => {
    if (peekCloseTimer.current) clearTimeout(peekCloseTimer.current);
    peekCloseTimer.current = setTimeout(() => setShowBoardPeek(false), 140);
  };
  useEffect(() => () => { if (peekCloseTimer.current) clearTimeout(peekCloseTimer.current); }, []);

  const switchBoardPeek = (id: string) => {
    setShowBoardPeek(false);
    router.push({ pathname: '/tasks', params: { pipelineId: id } });
    handleSelectBoard(id);
  };

  // Step `offset` places through the stable order and switch. Cycling is not an
  // explicit pick, so it deliberately doesn't write to Recents.
  const cycleBoard = (offset: number) => {
    const target = boardPicker.getBoardAtOffset(offset);
    if (!target) return;
    router.push({ pathname: '/tasks', params: { pipelineId: target.id } });
    handleSelectBoard(target.id);
  };

  // The window listeners below are registered once, so they must not close over
  // `pipeline`/`boardPicker` directly — a `[]`-dep effect would freeze both at
  // their mount values and compute "next board" relative to whichever board was
  // active when the page loaded. The ref always holds the current closure.
  const cycleBoardRef = useRef(cycleBoard);
  cycleBoardRef.current = cycleBoard;

  // Keyboard shortcuts: Ctrl+] (next board), Ctrl+[ (prev board)
  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if it's actually the bracket keys (not affected by keyboard layout)
      const isCloseBracket = e.key === ']' || e.code === 'BracketRight';
      const isOpenBracket = e.key === '[' || e.code === 'BracketLeft';
      if (!(e.ctrlKey || e.metaKey) || (!isCloseBracket && !isOpenBracket)) return;

      e.preventDefault();
      cycleBoardRef.current(isCloseBracket ? 1 : -1);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  // Wheel navigation: scroll on the board picker button to cycle boards.
  // The gesture accumulator lives in lib/wheelGesture (with its own self-check) —
  // it turns the burst of events one trackpad flick produces into a single
  // deliberate step instead of the several a naive debounce would fire.
  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const stepper = createWheelStepper();

    const handleWheel = (e: WheelEvent) => {
      const boardPickerElement = boardPickerButtonRef.current;
      if (!boardPickerElement) return;

      // Check if wheel event target is the board picker button or a child
      const target = e.target as Node;
      if (!boardPickerElement.contains?.(target) && boardPickerElement !== target) return;

      // Swallow the event even when it doesn't step, so the page doesn't lurch
      // mid-gesture while we're accumulating or cooling down.
      e.preventDefault();

      const step = stepper.push(e.deltaY, e.deltaMode, Date.now());
      if (step !== 0) cycleBoardRef.current(step);
    };

    window.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    return () => window.removeEventListener('wheel', handleWheel, true);
  }, []);

  const filterOptions = useMemo(() => {
    const categories = Array.from(new Set(tasks.map(t => t.category).filter(Boolean)));
    const projects = Array.from(
      new Map(tasks.filter(t => t.project).map(t => [t.project!.id, t.project!])).values()
    );
    const managers = Array.from(
      new Map(tasks.filter(t => t.manager).map(t => [t.manager!.id, t.manager!])).values()
    );
    return { categories, projects, managers };
  }, [tasks]);

  const activeFilterCount =
    filters.priorities.length +
    filters.categories.length +
    filters.projectIds.length +
    filters.managerIds.length +
    filters.dueDates.length;

  const toggleFilter = (key: keyof FilterState, value: string) => {
    setFilters(prev => {
      const list = prev[key] as string[];
      return {
        ...prev,
        [key]: list.includes(value) ? list.filter(v => v !== value) : [...list, value],
      };
    });
  };

  const clearFilters = () =>
    setFilters({ priorities: [], categories: [], projectIds: [], managerIds: [], dueDates: [] });

  const getPriorityInfo = (priority: string) => {
    switch (priority) {
      case 'urgent': return { textClass: 'text-state-danger', label: 'Urgent' };
      case 'high': return { textClass: 'text-state-warning', label: 'High' };
      case 'low': return { textClass: 'text-state-success', label: 'Low' };
      default: return { textClass: 'text-typography-muted', label: 'Normal' };
    }
  };

  const formatSeconds = (seconds: number) => formatCompact(seconds);

  // The same manual page-in ProjectBoard.tsx uses on its paginated columns, and
  // deliberately not an infinite scroll: a stage column is a work queue, and
  // growing one under the user costs them their place in it.
  const renderLoadMore = (stageId: string, col: ColumnPage) => {
    if (!col.hasMore) return null;
    return (
      <TouchableOpacity
        onPress={() => loadMoreStage(stageId)}
        disabled={col.loading}
        className="items-center justify-center py-2.5 rounded-xl border border-surface-border mb-4 hover:bg-surface-overlay transition-colors"
        style={{ minHeight: 44 }}
      >
        <Text className="text-typography-muted text-[11px] font-black uppercase tracking-widest">
          {col.loading ? 'Loading…' : `Show ${TASK_PAGE_SIZE} more`}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderTaskCard = (task: Task) => {
    if (!task) return null;
    const prio = getPriorityInfo(task.priority);
    const canViewAllData = hasPermission('system.view_all_data') || user?.id === task.manager_id || (user as any)?.is_owner;
    
    // Calculate total time including active sessions if applicable
    let displayTotalSeconds = task.total_seconds || 0;
    let displayMySeconds = task.my_seconds || 0;

    // Add active session elapsed time (rough estimate until next refresh)
    const sessions = activeSessions[task.id] || [];
    sessions.forEach(s => {
      const elapsed = Math.floor((Date.now() - new Date(s.startedAt).getTime()) / 1000);
      displayTotalSeconds += elapsed;
      if (s.userId === user?.id) {
        displayMySeconds += elapsed;
      }
    });

    const pingedAt = pingedTasks.get(task.id);
    const isPinged = pingedAt !== undefined;
    // If this card just arrived from a different stage column, FLIP it in
    // from where it used to be instead of only fading in place, and fire
    // the connector trail once.
    const stageTransition = stageFX.peekTransition(task.id, task.current_stage_id);
    return (
      <AnimatedTaskCard
        key={task.id}
        disableLayoutAnimation={boardTransitioning}
        flipFrom={stageTransition?.flipFrom}
        onFlipMount={(landRect) => stageFX.commitMount(task.id, task.current_stage_id, stageTransition?.fromStageId ?? null, landRect)}
        exiting={exitingTaskIds.has(task.id)}
        onExited={() => patchTaskArchived(task.id)}
      >
      <TouchableOpacity
        onPress={() => {
          if (isPinged) removePingedTask(task.id);
          router.push(`/task/${task.id}`);
        }}
        // @ts-ignore - web-only hook for StageTransitionFX to find/measure this card
        dataSet={Platform.OS === 'web' ? { stageCardId: task.id } : undefined}
        className="bg-surface-card p-5 rounded-2xl mb-4 premium-shadow hover:border-brand-primary/50 hover:z-50 transition-all relative"
        style={isPinged ? {
          borderWidth: 1.5,
          borderColor: 'rgba(255, 140, 0, 0.6)',
        } : {
          borderWidth: 1,
          borderColor: 'rgba(128,128,128,0.15)',
        }}
      >
        {isPinged && (
          <>
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: 0, left: 0, right: 0, bottom: 0,
                borderRadius: 14,
                backgroundColor: 'rgba(255, 140, 0, 0.09)',
                zIndex: 0,
              }}
            />
            <PingTimeBadge pingedAt={pingedAt} />
          </>
        )}
        {task.has_mention && (
          <View className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-state-danger items-center justify-center border-2 border-surface-card z-[60] animate-vibrate shadow-lg">
            <Text className="text-white text-[10px] font-black">@</Text>
          </View>
        )}
        <View className="flex-row items-start justify-between gap-2 mb-3">
          <View className="flex-1 flex-row flex-wrap items-center gap-2 min-w-0">
            <View className="bg-surface-background px-3 py-1 rounded-lg border border-surface-border">
              <Text className={`${prio.textClass} text-[10px] font-black uppercase tracking-widest`}>
                {prio.label}
              </Text>
            </View>
            {task.parent_task_id && (
              <View className="bg-brand-primary/20 px-2 py-0.5 rounded-md">
                <Text className="text-brand-primary text-[8px] font-black italic">SUB</Text>
              </View>
            )}
            {displayMySeconds > 0 && (
              <Tooltip label="Your work time">
                <View className="bg-brand-primary/10 px-2.5 py-1 rounded-lg border border-brand-primary/20 flex-row items-center gap-1">
                  <FontAwesome name="clock-o" size={9} className="text-brand-primary" />
                  <Text className="text-brand-primary text-[10px] font-black">{formatSeconds(displayMySeconds)}</Text>
                </View>
              </Tooltip>
            )}
            {canViewAllData && displayTotalSeconds > 0 && displayMySeconds !== displayTotalSeconds && (
              <Tooltip label="Team work time">
                <View className="bg-surface-background px-2.5 py-1 rounded-lg border border-surface-border flex-row items-center gap-1">
                  <FontAwesome name="users" size={9} className="text-typography-muted" />
                  <Text className="text-typography-muted text-[10px] font-black">{formatSeconds(displayTotalSeconds)}</Text>
                </View>
              </Tooltip>
            )}
            {(task.submission_count?.[0]?.count ?? 0) > 0 && (
              <Tooltip label="Submissions">
                <View className="bg-brand-primary/10 px-2.5 py-1 rounded-lg border border-brand-primary/20 flex-row items-center gap-1">
                  <FontAwesome name="paper-plane-o" size={9} className="text-brand-primary" />
                  <Text className="text-brand-primary text-[10px] font-black">{task.submission_count?.[0]?.count}</Text>
                </View>
              </Tooltip>
            )}
            {(task.comment_count?.[0]?.count ?? 0) > 0 && (
              <Tooltip label="Comments">
                <View className="bg-surface-background px-2.5 py-1 rounded-lg border border-surface-border flex-row items-center gap-1">
                  <FontAwesome name="comment-o" size={9} className="text-typography-muted" />
                  <Text className="text-typography-muted text-[10px] font-black">{task.comment_count?.[0]?.count}</Text>
                </View>
              </Tooltip>
            )}
          </View>

          <View className="flex-row items-center gap-1.5 shrink-0">
            <TaskPingButton task={task} userId={user?.id || ''} className="hover:bg-brand-primary/10 transition-colors" />
            {hasPermission('task.assign') && (
              <TouchableOpacity
                onPress={() => handleOpenAssignments(task)}
                className="w-7 h-7 items-center justify-center rounded-xl bg-surface-background border border-surface-border hover:bg-brand-primary/10 transition-colors"
              >
                <FontAwesome name="user-plus" size={10} className="text-typography-muted" />
              </TouchableOpacity>
            )}
            {(profile?.is_owner || hasPermission('archive:create') || hasPermission('pipeline.edit')) && (
              <Tooltip label="Archive task" disabled={!!activeSession?.task_id}>
                <TouchableOpacity
                  onPress={() => {
                    const isCoolingDown = lastStoppedAt && (Date.now() - new Date(lastStoppedAt).getTime() < 35000);
                    if (activeSession?.task_id === task.id || isCoolingDown) {
                      warningToast('System is finalizing work logs. Please wait 30 seconds after stopping your timer before archiving.', 'Sync cooldown');
                      return;
                    }
                    setArchiveModal({ visible: true, taskId: task.id });
                  }}
                  className={`w-7 h-7 items-center justify-center rounded-xl border border-surface-border transition-colors ${activeSession?.task_id === task.id ? 'opacity-30 cursor-not-allowed bg-surface-card' : 'bg-surface-background hover:bg-state-warning/10'}`}
                >
                  <FontAwesome name="archive" size={10} className="text-typography-muted" />
                </TouchableOpacity>
              </Tooltip>
            )}
          </View>
        </View>

        <Text className="text-typography-main font-black text-lg mb-1">{task.title}</Text>
        {task.category && (
          <Text className="text-typography-dim text-[10px] font-bold uppercase tracking-wider mb-2">{task.category}</Text>
        )}
        {!!task.description && (
          <LinkifiedText className="text-typography-muted text-sm leading-relaxed mb-4" numberOfLines={2}>
            {task.description}
          </LinkifiedText>
        )}
        
        {kanban.showAvatars && activeSessions[task.id] && activeSessions[task.id].length > 0 && (
          <ActiveSessionAvatars sessions={activeSessions[task.id]} />
        )}

        <View className="pt-4 border-t border-surface-border/50">
          <TaskCardActions
            task={task}
            stages={stages}
            stageActions={stageActions}
            transitions={stageTransitions}
            activeSessions={activeSessions}
            userId={user?.id || ''}
            myTeamIds={myTeamIds}
            onRefresh={debouncedFetchData}
            onMoved={(taskId, toStageId) => {
              // Tag own moves too, so the actor chip shows for self-moves —
              // realtime only notes actors for teammates' moves (own echoes
              // are skipped, and they'd arrive after commitMount anyway).
              stageFX.noteActor(taskId, user?.id ?? null);
              patchTaskStage(taskId, toStageId);
            }}
            onSessionStarted={patchTaskSessionStarted}
            onArchived={beginArchiveExit}
          />
        </View>
      </TouchableOpacity>
      </AnimatedTaskCard>
    );
  };


  return (
    <View ref={taskDropRef} className="flex-1 bg-surface-background">
      {/* Phase 3 / 3.5: drop-to-create affordance — dim on every zone the instant
          a file drag enters the window, full-strength while it's over this
          screen. Web-only: taskDropOver / taskDropActive never trip on native. */}
      <FileDropOverlay active={taskDropActive && !showCreateModal} over={taskDropOver} label="Drop to create a task" />

      {/* BOARD SWITCH OVERLAY — shown while an uncached board loads (warmed boards swap instantly) */}
      <LoadingOverlay visible={switchingBoard} message="Switching board…" />

      {/* BACKGROUND LAYER */}
      {kanban.backgroundUrl && (
        <View className="absolute inset-0 overflow-hidden">
          <Image 
            source={{ uri: kanban.backgroundUrl }} 
            className="absolute inset-0 w-full h-full"
            resizeMode="cover"
          />
          <View 
            className="absolute inset-0" 
            style={{ 
              backgroundColor: `rgba(0,0,0,${kanban.bgOverlay})`,
              // @ts-ignore - Web backdrop filter
              backdropFilter: Platform.OS === 'web' ? `blur(${kanban.bgBlur}px)` : undefined
            }} 
          />
        </View>
      )}

      <View className="flex-1 p-10">
        <View className="max-w-[1800px] mx-auto w-full h-full flex-col">
          {/* Performance Pulse */}
          {kanban.showPulse && pulse && (
             <View className={`mb-8 p-4 rounded-2xl border border-surface-border ${kanban.backgroundUrl ? 'bg-surface-card/60' : 'bg-brand-primary/5'} flex-row items-center justify-between`}>
                <View className="flex-row gap-10">
                   <View>
                      <Text className="text-[10px] text-brand-primary font-black uppercase tracking-widest mb-1">Today''s Progress</Text>
                      <View className="flex-row items-baseline">
                         <Text className="text-2xl font-black text-brand-primary">{pulse.daily_points}</Text>
                         <Text className="text-xs text-brand-primary/60 ml-1 font-bold">PTS</Text>
                      </View>
                   </View>
                   <View>
                      <Text className="text-[10px] text-typography-muted font-black uppercase tracking-widest mb-1">Active Time</Text>
                      <View className="flex-row items-baseline">
                          <Text className="text-2xl font-black text-typography-main">{formatCompact(pulse.active_seconds_today)}</Text>
                         <Text className="text-xs text-typography-muted ml-1 font-bold">{Math.floor((pulse.active_seconds_today % 3600) / 60)}m</Text>
                      </View>
                   </View>
                   <View>
                      <Text className="text-[10px] text-typography-muted font-black uppercase tracking-widest mb-1">Flap Score</Text>
                      <Text className={`text-2xl font-black ${pulse.flap_rate_score > 1.5 ? 'text-state-danger' : 'text-state-success'}`}>
                         {pulse.flap_rate_score}x
                      </Text>
                   </View>
                </View>
                {pulse.is_working && (
                  <View className="flex-row items-center bg-state-success/10 px-4 py-2 rounded-full border border-state-success/20">
                     <View className="w-2 h-2 rounded-full bg-state-success mr-3 pulse-animation" />
                     <Text className="text-state-success text-[10px] font-black uppercase tracking-widest">User Active</Text>
                  </View>
                )}
             </View>
          )}

          {/* Header */}
          <View className="mb-10 flex-row items-center justify-between" style={{ zIndex: 50 }}>
           <View
              style={{ position: 'relative', zIndex: 50 }}
              onMouseEnter={openPeek}
              onMouseLeave={closePeekSoon}
            >
              <TouchableOpacity
                ref={boardPickerButtonRef}
                onPress={() => setShowPipelinePicker(true)}
              >
                <View>
                  <View className="flex-row items-center mb-2" style={{ position: 'relative', zIndex: 2 }}>
                    <View className="bg-brand-primary/10 px-3 py-1 rounded-full border border-brand-primary/20 flex-row items-center relative">
                        <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest mr-2">{pipeline?.name || 'Pipeline'}</Text>
                        <FontAwesome name="chevron-down" size={8} className="text-brand-primary" />
                        {availablePipelines.some(b => b.id !== pipeline?.id && (boardPicker.taskCounts[b.id] || 0) > 0) && (
                          <View className="absolute -top-2 -right-2 bg-state-danger rounded-full w-5 h-5 items-center justify-center border-2 border-surface-card">
                            <Text className="text-white text-[9px] font-black">!</Text>
                          </View>
                        )}
                    </View>
                    {showBoardPeek && (boardPeekNeighbours.prev || boardPeekNeighbours.next) && (
                     <>
                       {/* Pointer bridging the pill to the card so the hover path stays connected. */}
                       <View
                         pointerEvents="none"
                         style={{
                           position: 'absolute',
                           top: '100%',
                           left: 76,
                           marginTop: -1,
                           zIndex: 62,
                           width: 0,
                           height: 0,
                           borderLeftWidth: 6,
                           borderRightWidth: 6,
                           borderBottomWidth: 8,
                           borderLeftColor: 'transparent',
                           borderRightColor: 'transparent',
                           borderBottomColor: colors.card,
                         }}
                       />
                       <BoardPeekCard
                         prevBoard={boardPeekNeighbours.prev}
                         nextBoard={boardPeekNeighbours.next}
                         counts={boardPicker.taskCounts}
                         newCounts={boardPicker.newTaskCounts}
                         onSelect={switchBoardPeek}
                         onMouseEnter={openPeek}
                         onMouseLeave={closePeekSoon}
                       />
                     </>
                   )}
                  </View>
                  <Text className="text-typography-main text-5xl font-black tracking-tighter">Task Board</Text>
                </View>
              </TouchableOpacity>
            </View>

            <View className="flex-row gap-4 items-center">
               {/* Search */}
               <View className="h-14 px-4 flex-row items-center bg-surface-card border border-surface-border rounded-2xl premium-shadow gap-2" style={{ minWidth: 340 }}>
                 <FontAwesome name="search" size={14} className="text-typography-muted" />
                 <TextInput
                   value={searchQuery}
                   onChangeText={setSearchQuery}
                   placeholder="Search tasks..."
                   placeholderTextColor={colors.textDim}
                   className="flex-1 text-typography-main text-sm font-bold"
                 />
                 {searchQuery.length > 0 && (
                   <Tooltip label="Clear search">
                     <TouchableOpacity onPress={() => setSearchQuery('')}>
                       <FontAwesome name="times" size={12} className="text-typography-muted" />
                     </TouchableOpacity>
                   </Tooltip>
                 )}
               </View>
               {/* Mine toggle */}
               <TouchableOpacity
                 onPress={() => setMineOnly(v => !v)}
                 className={`h-14 px-5 items-center justify-center flex-row gap-2 border rounded-2xl premium-shadow transition-all ${mineOnly ? 'bg-brand-primary border-brand-primary' : 'bg-surface-card border-surface-border hover:bg-surface-overlay'}`}
               >
                 <FontAwesome name="user" size={14} className={mineOnly ? 'text-white' : 'text-typography-muted'} />
                 <Text className={`font-black text-xs uppercase tracking-widest ${mineOnly ? 'text-white' : 'text-typography-muted'}`}>Mine</Text>
               </TouchableOpacity>
               <Tooltip label="Customize board view">
                 <TouchableOpacity
                   onPress={() => setShowPersonalizer(true)}
                   className="h-14 w-14 items-center justify-center bg-surface-card border border-surface-border rounded-2xl premium-shadow hover:bg-surface-overlay"
                 >
                   <FontAwesome name="paint-brush" size={16} className="text-brand-primary" />
                 </TouchableOpacity>
               </Tooltip>
               <Tooltip label={`${showFilters ? 'Hide' : 'Show'} filters`}>
                 <TouchableOpacity
                   onPress={() => setShowFilters(v => !v)}
                   className={`relative h-14 w-14 items-center justify-center border rounded-2xl premium-shadow transition-all ${showFilters || activeFilterCount > 0 ? 'bg-brand-primary/10 border-brand-primary' : 'bg-surface-card border-surface-border hover:bg-surface-overlay'}`}
                 >
                   <FontAwesome name="filter" size={14} className={showFilters || activeFilterCount > 0 ? 'text-brand-primary' : 'text-typography-muted'} />
                   {activeFilterCount > 0 && (
                     <View className="absolute -top-1.5 -right-1.5 bg-brand-primary rounded-full min-w-[18px] h-[18px] px-1 items-center justify-center border-2 border-surface-card">
                       <Text className="text-white text-[9px] font-black">{activeFilterCount > 9 ? '9+' : activeFilterCount}</Text>
                     </View>
                   )}
                 </TouchableOpacity>
               </Tooltip>
               {/* Utility group — icon-only squares, tighter than the labeled primary actions */}
               <View className="flex-row items-center gap-2">
                 <Tooltip label="Refresh board">
                   <TouchableOpacity
                     onPress={onRefresh}
                     className="h-14 w-14 items-center justify-center bg-surface-card border border-surface-border rounded-2xl premium-shadow hover:bg-surface-overlay"
                   >
                     <FontAwesome name="refresh" size={16} className="text-brand-primary" />
                   </TouchableOpacity>
                 </Tooltip>
                 {(hasPermission('task.create') || hasPermission('report.export') || hasPermission('task.view_all')) && (
                   <Tooltip label="Import or export tasks">
                     <TouchableOpacity
                       onPress={() => setShowMobility(true)}
                       className="h-14 w-14 items-center justify-center bg-surface-card border border-surface-border rounded-2xl premium-shadow hover:bg-surface-overlay"
                     >
                       <FontAwesome name="exchange" size={16} className="text-brand-primary" />
                     </TouchableOpacity>
                   </Tooltip>
                 )}
               </View>
               {hasPermission('task.create') && (
                 <TouchableOpacity
                   onPress={handleCreateTask}
                   className="bg-brand-primary h-14 px-8 rounded-2xl premium-shadow active:scale-95 transition-transform flex-row items-center gap-2"
                 >
                   <FontAwesome name="plus" size={12} className="text-white" />
                   <Text className="text-white font-black uppercase tracking-widest text-xs">Create Task</Text>
                 </TouchableOpacity>
               )}
            </View>
          </View>

          {/* Filter Panel — animated slide-down (issue #208) */}
          <SlideDownPanel isOpen={showFilters}>
            <View className="mb-6 bg-surface-card border border-surface-border rounded-2xl p-5 premium-shadow">
              <View className="flex-row items-center justify-between mb-4">
                <View className="flex-row items-center gap-2">
                  <FontAwesome name="filter" size={13} className="text-brand-primary" />
                  <Text className="text-typography-main font-black text-sm uppercase tracking-widest">Filters</Text>
                </View>
                <Tooltip label={activeFilterCount > 0 ? 'Clear all filters' : 'No active filters'}>
                  <TouchableOpacity
                    onPress={clearFilters}
                    disabled={activeFilterCount === 0}
                    className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-xl border"
                    style={{
                      borderColor: activeFilterCount > 0 ? colors.danger : colors.border,
                      backgroundColor: activeFilterCount > 0 ? colors.danger + '0F' : undefined,
                      opacity: activeFilterCount > 0 ? 1 : 0.4,
                    }}
                  >
                    <FontAwesome name="times" size={10} color={activeFilterCount > 0 ? colors.danger : colors.textMuted} />
                    <Text
                      className="text-[10px] font-black uppercase tracking-wider"
                      style={{ color: activeFilterCount > 0 ? colors.danger : colors.textMuted }}
                    >
                      Clear Filters
                    </Text>
                  </TouchableOpacity>
                </Tooltip>
              </View>

              {/* ── Chip filters (always visible) — Priority & Category side by side ── */}
              <View className="flex-row flex-wrap gap-4">
                {/* Priority */}
                <View className="flex-1 min-w-[240px]">
                  <Text className="text-typography-muted font-black uppercase tracking-widest text-[10px] mb-2">Priority</Text>
                  <View className="flex-row flex-wrap gap-2">
                    {(['urgent', 'high', 'normal', 'low'] as const).map(p => {
                      const { label } = getPriorityInfo(p);
                      const colorClass = { urgent: 'text-state-danger', high: 'text-state-warning', normal: 'text-typography-muted', low: 'text-state-success' }[p];
                      const active = filters.priorities.includes(p);
                      return (
                        <TouchableOpacity
                          key={p}
                          onPress={() => toggleFilter('priorities', p)}
                          className={`flex-row items-center gap-2 px-4 py-3 rounded-2xl border transition-colors ${active ? 'border-brand-primary bg-brand-primary/10' : 'border-surface-border bg-surface-card hover:bg-surface-overlay'}`}
                        >
                          <Text className={`text-[10px] font-black uppercase tracking-widest ${active ? 'text-brand-primary' : colorClass}`}>{label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {/* Category */}
                {filterOptions.categories.length > 0 && (
                  <View className="flex-1 min-w-[240px]">
                    <Text className="text-typography-muted font-black uppercase tracking-widest text-[10px] mb-2">Category</Text>
                    <View className="flex-row flex-wrap gap-2">
                      {filterOptions.categories.map(cat => {
                        const active = filters.categories.includes(cat);
                        return (
                          <TouchableOpacity
                            key={cat}
                            onPress={() => toggleFilter('categories', cat)}
                            className={`flex-row items-center px-3 py-3 rounded-2xl border transition-colors ${active ? 'bg-brand-primary/10 border-brand-primary' : 'bg-surface-card border-surface-border hover:bg-surface-overlay'}`}
                          >
                            <Text className={`text-[10px] font-black uppercase tracking-widest ${active ? 'text-brand-primary' : 'text-typography-muted'}`}>{cat}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                )}
              </View>

              {/* ── Dropdown rows — side by side ── */}
              <View className="flex-row flex-wrap gap-4 mt-4">
                {filterOptions.projects.length > 0 && (
                  <View className="flex-1 min-w-[220px]">
                    <FilterDropdown
                      label="Project"
                      count={filters.projectIds.length}
                      selected={filters.projectIds}
                      options={filterOptions.projects.map(proj => ({ value: proj.id, label: proj.name }))}
                      onToggle={v => toggleFilter('projectIds', v)}
                    />
                  </View>
                )}
                {filterOptions.managers.length > 0 && (
                  <View className="flex-1 min-w-[220px]">
                    <FilterDropdown
                      label="Manager"
                      count={filters.managerIds.length}
                      selected={filters.managerIds}
                      options={filterOptions.managers.map(mgr => ({ value: mgr.id, label: mgr.full_name }))}
                      onToggle={v => toggleFilter('managerIds', v)}
                    />
                  </View>
                )}
                <View className="flex-1 min-w-[220px]">
                  <FilterDropdown
                    label="Due Date"
                    count={filters.dueDates.length}
                    selected={filters.dueDates}
                    options={DUE_DATE_BUCKETS.map(({ key, label }) => ({ value: key, label }))}
                    onToggle={v => toggleFilter('dueDates', v)}
                  />
                </View>
                <View className="flex-1 min-w-[220px]">
                  <FilterDropdown
                    label="Sort By"
                    single
                    count={0}
                    selected={[sortKey]}
                    options={TASK_SORT_OPTIONS.map(({ key, label }) => ({ value: key, label }))}
                    onToggle={v => setSortKey(v as TaskSortKey)}
                  />
                </View>
              </View>
            </View>
          </SlideDownPanel>

          {loading ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : availablePipelines.length === 0 ? (
            <View className="flex-1 items-center justify-center">
              <View className="bg-surface-card p-12 rounded-[3rem] border border-surface-border items-center max-w-[600px] premium-shadow">
                <View className="w-20 h-20 bg-brand-primary/10 rounded-full items-center justify-center mb-6">
                  <FontAwesome name="sitemap" size={32} className="text-brand-primary" />
                </View>
                
                {hasPermission('pipeline.edit') ? (
                  <>
                    <Text className="text-typography-main text-3xl font-black mb-2 text-center">Setup Required</Text>
                    <Text className="text-typography-muted text-center mb-8 leading-relaxed">
                      No pipelines detected. You must initialize at least one workflow pipeline to begin tracking tasks.
                    </Text>
                    <TouchableOpacity
                      onPress={() => router.push('/admin/pipelines')}
                      className="bg-brand-primary px-10 py-4 rounded-2xl active:scale-95 transition-all"
                    >
                      <Text className="text-typography-main font-black uppercase tracking-widest text-xs">Configure Pipelines</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <View className="bg-state-info-dim border border-state-info/20 p-8 rounded-3xl w-full">
                    <View className="flex-row items-start">
                      <FontAwesome name="info-circle" size={20} className="text-state-info" style={{ marginTop: 4 }} />
                      <View className="ml-5 flex-1">
                         <Text className="text-typography-main text-lg font-black mb-1">Access Restricted</Text>
                         <Text className="text-typography-muted text-sm font-bold leading-relaxed">
                           Either no pipelines exist now, or they're not privileged enough to see them, contact company Admin
                         </Text>
                      </View>
                    </View>
                  </View>
                )}
              </View>
            </View>
          ) : (
            <View ref={boardContainerRef} style={{ flex: 1 }} onLayout={(e) => {
              // Re-rendering the whole board per layout frame is only worth it
              // while a column is actually sized off boardWidth (fullscreen).
              boardWidthRef.current = e.nativeEvent.layout.width;
              if (fullscreenStageId) setBoardWidth(boardWidthRef.current);
            }}>
            {!fullscreenStageId && <LinkedTasksStrip tasks={linkedTasks} />}
            <ScrollView
              ref={boardScrollRef}
              horizontal
              showsHorizontalScrollIndicator={!fullscreenStageId}
              scrollEnabled={!fullscreenStageId}
              className="flex-1"
              contentContainerStyle={{ paddingBottom: 40 }}
            >
              {stages.map(stage => {
                const stageTasks = tasks.filter(t => {
                  if (t.current_stage_id !== stage.id) return false;
                  if (filters.priorities.length > 0 && !filters.priorities.includes(t.priority)) return false;
                  if (filters.categories.length > 0 && !filters.categories.includes(t.category)) return false;
                  if (filters.projectIds.length > 0 && !filters.projectIds.includes(t.project_id || '')) return false;
                  if (filters.managerIds.length > 0 && !filters.managerIds.includes(t.manager_id || '')) return false;
                  if (filters.dueDates.length > 0 && !filters.dueDates.includes(getDueBucket(t.due_date))) return false;
                  if (searchQuery && !t.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
                  if (mineOnly && t.manager_id !== user?.id && !t.assignments?.some((a: any) =>
                    a.assignee_user_id === user?.id ||
                    (a.assignee_team_id && myTeamIds.includes(a.assignee_team_id))
                  )) return false;
                  return true;
                });
                const col = columns[stage.id] ?? emptyColumnPage();
                const isFullscreen = fullscreenStageId === stage.id;
                const isHiddenByFullscreen = !!fullscreenStageId && !isFullscreen;
                // An explicit sort pick wins everywhere. Otherwise: focus mode surfaces
                // what matters most first (priority, then weight); the regular board
                // keeps the fetch order (newest first).
                const displayTasks = sortKey !== 'default'
                  ? [...stageTasks].sort((a, b) => compareTasksBySortKey(sortKey, a, b))
                  : isFullscreen
                    ? [...stageTasks].sort((a, b) => {
                        const pDiff = (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2);
                        if (pDiff !== 0) return pDiff;
                        return (b.weight ?? 1) - (a.weight ?? 1);
                      })
                    : stageTasks;
                return (
                  <View
                    key={stage.id}
                    ref={(el) => stageFX.registerColumn(stage.id, el)}
                    className="h-full transition-[width,margin-right,opacity] duration-300 ease-in-out"
                    style={{
                      width: isFullscreen ? (boardWidth || undefined) : isHiddenByFullscreen ? 0 : 380,
                      marginRight: isHiddenByFullscreen ? 0 : 32,
                      opacity: isHiddenByFullscreen ? 0 : 1,
                      overflow: 'hidden',
                    }}
                  >
                    <View className="flex-row items-center justify-between mb-6 px-3">
                      <View className="flex-row items-center">
                        <View style={{ backgroundColor: stage.color }} className="w-3 h-3 rounded-full mr-3 shadow-sm shadow-black/50" />
                        <Text className="text-typography-main font-black text-sm uppercase tracking-[0.2em]">{stage.name}</Text>
                        {kanban.showStageTotals && (
                          // "30+" while the column is paginated: this counts the
                          // rows actually loaded, and an exact count would mean
                          // the full-pipeline scan #194 exists to remove.
                          <View className="ml-3 bg-surface-card border border-surface-border px-2 py-0.5 rounded-lg flex-row items-center">
                            <StageCountOdometer value={stageTasks.length} />
                            {col.hasMore && (
                              <Text className="text-typography-muted text-[10px] font-black">+</Text>
                            )}
                          </View>
                        )}
                      </View>

                      <View className="flex-row items-center gap-2">
                        {stage.linked_pipeline && (
                           <View className="flex-row items-center border border-brand-primary/30 bg-brand-primary/10 px-2 py-0.5 rounded-full">
                              <FontAwesome name="bolt" size={8} className="text-brand-primary" />
                              <Text className="text-brand-primary text-[8px] font-black ml-1 uppercase">Pushes to {stage.linked_pipeline.name}</Text>
                           </View>
                        )}
                        <TouchableOpacity
                          onPress={() => setFullscreenStageId(isFullscreen ? null : stage.id)}
                          className="w-6 h-6 items-center justify-center rounded-lg bg-surface-card border border-surface-border active:opacity-70"
                        >
                          <FontAwesome name={isFullscreen ? 'compress' : 'expand'} size={10} className="text-typography-muted" />
                        </TouchableOpacity>
                      </View>
                    </View>
                    
                    <View
                      className={`flex-1 rounded-[2.5rem] p-4 border overflow-hidden ${
                        kanban.isVibrant ? 'bg-brand-primary/5 border-brand-primary/20' : 'bg-surface-card/30 border-surface-border/50'
                      }`}
                    >
                      {isHiddenByFullscreen ? null : (displayTasks.length === 0 && !col.hasMore) ? (
                        // The idle conveyor states "this stage is empty", so it must
                        // never stand in for data that simply hasn't arrived yet.
                        // `loading` already swaps the entire board out for a spinner
                        // above; `switchingBoard` is the one that matters here — an
                        // uncached board swap keeps the board mounted and sets the
                        // incoming board's `stages` several awaits before its `tasks`,
                        // so every column is transiently task-less while the previous
                        // board's tasks are still in state.
                        loading || switchingBoard ? null : (
                          <IdleConveyor accentColor={stage.color} />
                        )
                      ) : isFullscreen && settledFullscreenId === stage.id ? (
                        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
                          {displayTasks.map(t => (
                            <View key={t.id} style={{ flexGrow: 1, flexBasis: 380, maxWidth: 460 }}>
                              {renderTaskCard(t)}
                            </View>
                          ))}
                          {col.hasMore && <View style={{ width: '100%' }}>{renderLoadMore(stage.id, col)}</View>}
                        </ScrollView>
                      ) : boardTransitioning ? (
                        // `width` is a layout-triggering CSS property, so every frame of the column's
                        // 300ms transition forces the browser to reflow/repaint whatever is inside it —
                        // capping each card's width stopped them visibly stretching, but a whole stack of
                        // bordered, shadowed cards still got repainted every frame regardless, which is
                        // what was actually costing frames. Render nothing here for this brief window
                        // instead: an empty rounded box animating its width is nearly free to repaint.
                        // The real list (grid or plain) mounts the instant boardTransitioning clears.
                        null
                      ) : (
                        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
                          {displayTasks.map(renderTaskCard)}
                          {renderLoadMore(stage.id, col)}
                        </ScrollView>
                      )}
                    </View>
                  </View>
                );
              })}
            </ScrollView>
            <StageTrailLayer trails={stageFX.trails} color={stageFX.glowColor} actorInfo={stageFX.actorInfo} />
            </View>
          )}
        </View>
      </View>

      {/* PIPELINE PICKER - SMART BOARD SELECTOR */}
      <BoardSwitcherPopup
        visible={showPipelinePicker}
        onClose={() => setShowPipelinePicker(false)}
        picker={boardPicker}
        currentBoardId={pipeline?.id}
        onSelectBoard={(id) => {
          router.push({ pathname: '/tasks', params: { pipelineId: id } });
          handleSelectBoard(id, { explicit: true });
        }}
      />

      {/* ASSIGNMENT MODAL */}
      {selectedTask && (
        <AssignmentModal
          visible={showAssignmentModal}
          taskId={selectedTask.id}
          pipelineId={pipeline?.id || ''}
          initialSelectedIds={{
            users: selectedTask.assignments?.filter(a => a.assignee_user_id).map(a => a.assignee_user_id!) || [],
            teams: selectedTask.assignments?.filter(a => a.assignee_team_id).map(a => a.assignee_team_id!) || []
          }}
          onClose={() => setShowAssignmentModal(false)}
          onSave={fetchData}
        />
      )}

      {showPersonalizer && (
        <KanbanPersonalizer onClose={() => setShowPersonalizer(false)} />
      )}

      <CreateTaskModal
        visible={showCreateModal}
        initialPipelineId={pipeline?.id}
        initialText={seedText}
        initialFiles={seedFiles}
        onClose={() => {
          setShowCreateModal(false);
          setSeedText(null);
          setSeedFiles(null);
          fetchData();
        }}
      />

      <TaskMobilityModal
        visible={showMobility}
        onClose={() => setShowMobility(false)}
        onImported={fetchData}
        pipelineId={pipeline?.id}
      />


      <ConfirmModal
        visible={archiveModal.visible}
        title="Move to Cold Storage"
        description="Are you sure you want to archive this task? It will be removed from the active pipeline and moved to Intelligence > Archives for auditing."
        confirmLabel="Archive Task"
        variant="warning"
        loading={archiving}
        onConfirm={handleArchiveTask}
        onCancel={() => setArchiveModal({ visible: false, taskId: null })}
      />

      <RightSidebar
        pipelineId={pipeline?.id}
        pipelineName={pipeline?.name}
        // Board total, not "rows currently paged in" — useBoardPicker already
        // keeps an exact per-board count (and keeps it live over realtime), so
        // pagination doesn't make this sidebar stat quietly wrong (#194).
        taskCount={(pipeline?.id ? boardPicker.taskCounts[pipeline.id] : undefined) ?? tasks.length}
        visibilityMode={pipeline?.task_visibility_mode}
        tasks={tasks}
        activeSessions={activeSessions}
        currentUserId={user?.id}
      />
    </View>
  );
}

import ConfirmModal from '@/components/common/ConfirmModal';
import { FilterDropdown } from '@/components/common/FilterPanel';
import SlideDownPanel from '@/components/common/SlideDownPanel';
import { useThemeColors } from '@/hooks/useThemeColors';

export default function TasksScreenWebWrapper() {
  const colors = useThemeColors();
  return (
    <TaskCreationProvider>
      <TasksScreenWeb />
    </TaskCreationProvider>
  );
}
