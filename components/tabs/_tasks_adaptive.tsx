import AnimatedTaskCard from '@/components/common/AnimatedTaskCard';
import ConfirmModal from '@/components/common/ConfirmModal';
import HorizontalScroll from '@/components/common/HorizontalScroll';
import { FileDropOverlay } from '@/components/common/FileDropOverlay';
import LinkifiedText from '@/components/common/LinkifiedText';
import LoadingOverlay from '@/components/common/LoadingOverlay';
import SlideDownPanel from '@/components/common/SlideDownPanel';
import { FilterDropdown } from '@/components/common/FilterPanel';
import Tooltip from '@/components/common/Tooltip';
import BoardSwitcherPopup from '@/components/kanban/BoardSwitcherPopup';
import KanbanPersonalizer from '@/components/kanban/KanbanPersonalizer';
import SkeletonBlock, { SkeletonList } from '@/components/Skeleton';
import ActiveSessionAvatars from '@/components/task-detail/ActiveSessionAvatars';
import TaskCardActions, { type ActiveSessionUser } from '@/components/task-detail/TaskCardActions';
import { boardCacheMeta, prefetchOtherBoards, taskCache, type BoardSnapshot, TASK_SORT_OPTIONS, compareTasksBySortKey, fetchLinkedTasks, type LinkedTask, type TaskSortKey } from '@/components/tabs/taskBoardCache';
import LinkedTasksStrip from '@/components/tabs/LinkedTasksStrip';
import TaskPingButton from '@/components/task-detail/TaskPingButton';
import AssignmentModal from '@/components/tasks/AssignmentModal';
import CreateTaskModal from '@/components/tasks/CreateTaskModal';
import TaskMobilityModal from '@/components/tasks/TaskMobilityModal';
import { useBoardPicker } from '@/hooks/useBoardPicker';
import { useAlert } from '@/contexts/AlertContext';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { usePingHighlight } from '@/contexts/PingHighlightContext';
import { TaskCreationProvider, type StagedBriefFile } from '@/contexts/TaskCreationContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useTimer } from '@/contexts/TimerContext';
import { useNavBarPosition } from '@/hooks/useNavBarPosition';
import { useThemeColors } from '@/hooks/useThemeColors';
import { useFileDrop, useSmartPaste } from '@/hooks/useWebDnd';
import { offerForceStopOnArchiveError } from '@/lib/archiveForceStop';
import { TAB_BAR_HEIGHT } from '@/lib/layout';
import { fileToStaged } from '@/lib/pasteImage';
import { supabase } from '@/lib/supabase';
import { addPinnedTaskId, emptyColumnPage, mergeTasksById, stagePageQuery, TASK_PAGE_SIZE, type BoardFilters, type ColumnPage } from '@/lib/taskBoardPage';
import { formatCompact, formatRelative } from '@/lib/time';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  InteractionManager,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View
} from 'react-native';

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
  weight?: number;
  estimated_hours?: number | null;
};

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

// Board data cache + prefetch live in the shared module so the desktop board
// reuses the exact same warm cache (see taskBoardCache.ts).

// #194: one definition of "a task row on this board", shared by the per-stage
// page fetch, the other-board prefetch and the pinned-task top-up. The adaptive
// card doesn't show submission/comment counts, so unlike the desktop board's
// TASK_SELECT this one doesn't ask for them.
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
  )
`;

// What a page load was for — lets the filter/search effect skip the load
// fetchData just did instead of firing a duplicate round of queries.
const loadSignature = (pipelineId: string, stageList: { id: string }[], f: BoardFilters) =>
  JSON.stringify([pipelineId, stageList.map(s => s.id), f.priorities, f.categories, f.projectIds, f.managerIds, f.dueDates, (f.search || '').trim()]);

// Board picker state (favourites / recents / counts) lives in useBoardPicker,
// shared with the desktop layout so preferences carry across both.

// Pulsing "activity" dot — the web build uses a CSS `pulse-animation` class that
// no-ops on native, so this drives the pulse with Animated for cross-platform parity.
function ActivityDot({ color }: { color: string }) {
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.6, duration: 700, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [scale]);
  return (
    <Animated.View
      style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, transform: [{ scale }] }}
    />
  );
}

function getPriorityInfo(priority: string, colors: ReturnType<typeof useThemeColors>) {
  switch (priority) {
    case 'urgent': return { color: colors.danger, label: 'Urgent' };
    case 'high':   return { color: colors.warning, label: 'High' };
    case 'low':    return { color: colors.success, label: 'Low' };
    default:       return { color: colors.textMuted, label: 'Normal' };
  }
}

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

// Hover/long-press peek that previews the neighbouring boards (prev/next in the
// pipeline list, wrapping around) so the user knows where switching lands them.
function BoardPeekCard({
  prevBoard,
  nextBoard,
  counts,
  onSelect,
  onHoverIn,
  onHoverOut,
}: {
  prevBoard: Pipeline | null;
  nextBoard: Pipeline | null;
  counts: Record<string, number>;
  onSelect: (id: string) => void;
  onHoverIn: () => void;
  onHoverOut: () => void;
}) {
  const colors = useThemeColors();
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: 130, useNativeDriver: true }).start();
  }, [anim]);

  // With only two boards the prev and next neighbour are the same board — show it once.
  const sameBoard = !!prevBoard && !!nextBoard && prevBoard.id === nextBoard.id;
  const showPrev = !sameBoard ? prevBoard : null;

  const renderRow = (board: Pipeline | null, dir: 'prev' | 'next') => {
    if (!board) return null;
    const count = counts[board.id];
    return (
      <Pressable
        onPress={() => onSelect(board.id)}
        className="flex-row items-center px-3 py-2.5 active:bg-brand-primary/10"
      >
        <View className="w-5 items-center">
          <FontAwesome name={dir === 'prev' ? 'arrow-up' : 'arrow-down'} size={11} className="text-brand-primary" />
        </View>
        <View className="ml-2 flex-1 min-w-0">
          <Text className="text-typography-muted text-[8px] font-black uppercase tracking-widest mb-0.5">
            {dir === 'prev' ? 'Previous' : 'Next'}
          </Text>
          <Text className="text-typography-main text-sm font-bold" numberOfLines={1}>{board.name}</Text>
        </View>
        <Text className="text-typography-muted text-[10px] font-bold ml-2">
          {count === undefined ? '…' : `${count} ${count === 1 ? 'task' : 'tasks'}`}
        </Text>
      </Pressable>
    );
  };

  return (
    <Animated.View
      {...({ onHoverIn, onHoverOut } as any)}
      style={{
        position: 'absolute',
        top: '100%',
        left: 0,
        right: 0,
        marginTop: 8,
        zIndex: 60,
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderWidth: 1,
        opacity: anim,
        transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) }],
      }}
      className="rounded-2xl premium-shadow overflow-hidden"
    >
      {renderRow(showPrev, 'prev')}
      {showPrev && nextBoard && <View className="h-px bg-surface-border/60" />}
      {renderRow(nextBoard, 'next')}
    </Animated.View>
  );
}

function TasksScreen() {
  const { pipelineId: paramPipelineId } = useLocalSearchParams();

  // Seed initial state from the cache so a revisit renders instantly. Key by the
  // pipeline we're about to show (param, else the last board we loaded).
  const seedKey = (Array.isArray(paramPipelineId) ? paramPipelineId[0] : paramPipelineId) || boardCacheMeta.lastPipelineId || undefined;
  const seed = seedKey ? taskCache.get(seedKey) : undefined;

  const [pipeline, setPipeline] = useState<Pipeline | null>(seed?.pipeline ?? null);
  const [stages, setStages] = useState<Stage[]>(seed?.stages ?? []);
  const [tasks, setTasks] = useState<Task[]>(seed?.tasks ?? []);
  // #194: `tasks` stays ONE flat array bucketed by stage at render time — that
  // is what makes a cross-column move safe (see lib/taskBoardPage.ts). It is
  // now filled a bounded page per stage; `columns` is each stage's cursor.
  const [columns, setColumns] = useState<Record<string, ColumnPage>>(seed?.columns ?? {});
  const [linkedTasks, setLinkedTasks] = useState<LinkedTask[]>(seed?.linkedTasks ?? []);
  const [loading, setLoading] = useState(!seed); // cache hit → skip the skeleton
  const [switchingBoard, setSwitchingBoard] = useState(false); // overlay while an uncached board loads
  const [refreshing, setRefreshing] = useState(false);
  const [availablePipelines, setAvailablePipelines] = useState<Pipeline[]>(seed?.availablePipelines ?? []);
  const [showPipelinePicker, setShowPipelinePicker] = useState(false);
  const [activeSessions, setActiveSessions] = useState<Record<string, ActiveSessionUser[]>>(seed?.activeSessions ?? {}); // task_id -> [{name, avatar}]
  const [pulse, setPulse] = useState<PersonalPulse | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showAssignmentModal, setShowAssignmentModal] = useState(false);
  const [stageActions, setStageActions] = useState<any[]>(seed?.stageActions ?? []);
  const [stageTransitions, setStageTransitions] = useState<{ id: string; to_stage_id: string }[]>(seed?.stageTransitions ?? []);
  const [showPersonalizer, setShowPersonalizer] = useState(false);
  const [showMobility, setShowMobility] = useState(false);
  const [showCreateSheet, setShowCreateSheet] = useState(false);
  // Phase 3: content pasted/dropped on the screen with no composer open, handed
  // to CreateTaskModal as seed data on the next open (web only in practice).
  const [seedText, setSeedText] = useState<string | null>(null);
  const [seedFiles, setSeedFiles] = useState<StagedBriefFile[] | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<FilterState>({ priorities: [], categories: [], projectIds: [], managerIds: [], dueDates: [] });
  const [sortKey, setSortKey] = useState<TaskSortKey>('default');
  const [archiveModal, setArchiveModal] = useState<{ visible: boolean; taskId: string | null }>({ visible: false, taskId: null });
  const [archiving, setArchiving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [myTeamIds, setMyTeamIds] = useState<string[]>(seed?.myTeamIds ?? []);
  const [skeletonBg, setSkeletonBg] = useState<string | null>(null);

  // #194 paging refs. fetchData and the loaders are plain closures called from
  // effects, focus handlers and realtime callbacks, so anything they must read
  // "as of now" goes through a ref rather than a dependency array.
  const { activeSession } = useTimer();
  const pinnedIdsRef = useRef<string[]>([]);
  const activeSessionTaskRef = useRef<string | null>(null);
  const filtersRef = useRef<BoardFilters>({ priorities: [], categories: [], projectIds: [], managerIds: [], dueDates: [], search: '' });
  const pipelineIdRef = useRef<string | null>(null);
  const loadSigRef = useRef<string>('');
  activeSessionTaskRef.current = activeSession?.task_id ?? null;
  // Every filter that is a plain column predicate is served by the query, not
  // by narrowing the rows already in memory (see lib/taskBoardPage.ts).
  // `mineOnly` is the exception and stays a render-time narrowing.
  filtersRef.current = { ...filters, search: searchQuery };
  pipelineIdRef.current = pipeline?.id ?? null;

  // A task the user just moved, and the task their timer is running on, must
  // stay on the board even when they'd fall outside their column's page.
  const pinTask = (taskId: string) => { pinnedIdsRef.current = addPinnedTaskId(pinnedIdsRef.current, taskId); };

  // Board picker state — shared with the desktop layout via useBoardPicker.
  const boardPicker = useBoardPicker(availablePipelines, pipeline?.id);
  const { recordBoardVisit } = boardPicker;

  const { kanban } = useTheme();

   const { width } = useWindowDimensions();
   const { theme: activeTheme } = useTheme();
   const colors = useThemeColors();
   const router = useRouter();
   const { user, hasPermission, profile } = useAuth();
   const { showAlert, showConfirm } = useAlert();
   const { errorToast } = useToast();
   const isLargeScreen = width > 768;
   const { position: navPosition } = useNavBarPosition();

  const { pingedTasks, removePingedTask } = usePingHighlight();

  // Board peek (hover on web / long-press on native): preview neighbouring boards.
  const [showBoardPeek, setShowBoardPeek] = useState(false);
  const [peekCounts, setPeekCounts] = useState<Record<string, number>>({});
  const peekCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Peek walks the same stable order the desktop layout cycles through — this
  // used to use raw `availablePipelines` order, so the two layouts disagreed
  // about which board was "next".
  const { prev: prevBoard, next: nextBoard } = boardPicker.neighbours;

  const openPeek = useCallback(() => {
    if (peekCloseTimer.current) { clearTimeout(peekCloseTimer.current); peekCloseTimer.current = null; }
    setShowBoardPeek(true);
  }, []);

  // Delay close so the cursor can travel from the selector onto the card without it vanishing.
  const closePeekSoon = useCallback(() => {
    if (peekCloseTimer.current) clearTimeout(peekCloseTimer.current);
    peekCloseTimer.current = setTimeout(() => setShowBoardPeek(false), 140);
  }, []);

  useEffect(() => () => { if (peekCloseTimer.current) clearTimeout(peekCloseTimer.current); }, []);

  // Swap to a board: if we have it cached, paint it instantly (background refetch
  // still runs via the paramPipelineId effect); otherwise show the switching overlay.
  const applySnapshot = useCallback((snap: BoardSnapshot) => {
    setPipeline(snap.pipeline);
    setStages(snap.stages);
    setTasks(snap.tasks);
    setAvailablePipelines(snap.availablePipelines);
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

  const switchBoard = useCallback(async (id: string) => {
    setShowBoardPeek(false);
    prepareBoardSwitch(id);
    // Not an explicit pick — marks the board visited (so "new since last visit"
    // stays accurate) without pushing it into Recents.
    recordBoardVisit(id);
    await AsyncStorage.setItem('@TrustFlow_tasks_pipeline', id);
    router.setParams({ pipelineId: id });
  }, [router, prepareBoardSwitch, recordBoardVisit]);

  // Lazily fetch task counts for the two neighbours when the peek opens.
  useEffect(() => {
    if (!showBoardPeek) return;
    const ids = [prevBoard?.id, nextBoard?.id].filter(Boolean) as string[];
    const missing = ids.filter(id => peekCounts[id] === undefined);
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const results = await Promise.all(missing.map(async (id) => {
        const { count } = await supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('pipeline_id', id).is('deleted_at', null);
        return [id, count ?? 0] as const;
      }));
      if (!cancelled) setPeekCounts(prev => ({ ...prev, ...Object.fromEntries(results) }));
    })();
    return () => { cancelled = true; };
    // peekCounts intentionally omitted: re-running on its change would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBoardPeek, prevBoard?.id, nextBoard?.id]);

  // Favourites, recents, counts, live count updates and last-visit times are all
  // hydrated and persisted by useBoardPicker.

  // Select a board from the picker: track it as recent, mark visited, switch, and close.
  // `explicit` separates a deliberate pick from cycling past a board via peek —
  // only the former should land in Recents.
  const handleSelectBoard = useCallback(async (boardId: string, opts?: { explicit?: boolean }) => {
    try {
      recordBoardVisit(boardId, { explicit: opts?.explicit });
      prepareBoardSwitch(boardId);
      await AsyncStorage.setItem('@TrustFlow_tasks_pipeline', boardId);
      router.setParams({ pipelineId: boardId });
      setShowPipelinePicker(false);
    } catch (e) {
      console.error('Failed to select board:', e);
    }
  }, [recordBoardVisit, router, prepareBoardSwitch]);

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
   * Returns rows AND cursors so fetchData can snapshot both into taskCache: a
   * board painted from cache has to know which columns still have rows behind
   * them, or its "Show more" goes missing until the background refetch lands.
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

    // Top-up. The task this user's timer is running on, and anything they just
    // moved, can legitimately sit outside their column's first page — one extra
    // bounded request by id, only when one of them is actually missing.
    const pinned = Array.from(new Set(
      [...pinnedIdsRef.current, activeSessionTaskRef.current].filter(Boolean) as string[]
    ));
    const missing = pinned.filter(id => !rows.some(r => r.id === id));
    if (missing.length > 0) {
      const { data } = await supabase.from('tasks').select(TASK_SELECT).eq('pipeline_id', targetPipelineId).in('id', missing).is('deleted_at', null);
      rows = rows.concat((data as any[]) || []);
    }

    setColumns(nextColumns);
    setTasks(rows as Task[]);
    return { rows: rows as Task[], columns: nextColumns };
  };
  const loadColumnsRef = useRef(loadColumns);
  loadColumnsRef.current = loadColumns;

  // "Show 30 more" for one column. Offset paging over a column whose membership
  // can change under it may hand back a row that is already loaded — merging by
  // id kills the duplicate. (A row can conversely be skipped if a task moved IN
  // since page 0; the next reload picks it up. ponytail: keyset paging on
  // (created_at, id) is the fix if that ever surfaces as a real complaint.)
  const loadMoreStage = async (stageId: string) => {
    const pid = pipelineIdRef.current;
    const col = columns[stageId];
    if (!pid || !col || col.loading || !col.hasMore) return;
    const offset = col.offset + TASK_PAGE_SIZE;
    setColumns(prev => ({ ...prev, [stageId]: { ...prev[stageId], loading: true } }));
    const { data } = await stagePage(pid, stageId, offset);
    const rows = (data as any[]) || [];
    setTasks(prev => mergeTasksById(prev, rows as Task[]));
    setColumns(prev => ({ ...prev, [stageId]: { offset, hasMore: rows.length === TASK_PAGE_SIZE, loading: false } }));
  };

  const fetchData = async () => {
    try {
      console.log('[TasksScreen] fetchData started');

      // 1. Resolve Pipeline
      let targetPipelineId = paramPipelineId;
      let pipelineData: any = null;

      console.log('[TasksScreen] paramPipelineId:', paramPipelineId);

      if (!targetPipelineId) {
        console.log('[TasksScreen] No paramPipelineId, trying storage...');
        // Try to restore from storage
        const savedPipelineId = await AsyncStorage.getItem('@TrustFlow_tasks_pipeline');
        console.log('[TasksScreen] savedPipelineId from storage:', savedPipelineId);

        if (savedPipelineId) {
          console.log('[TasksScreen] Fetching saved pipeline...');
          const { data: pSaved } = await supabase.from('pipelines').select('id, name, task_visibility_mode, is_default').eq('id', savedPipelineId).is('deleted_at', null).maybeSingle();
          console.log('[TasksScreen] Saved pipeline data:', pSaved);
          if (pSaved) {
            targetPipelineId = pSaved.id;
            pipelineData = pSaved;
          }
        }
        // Fall back to default if saved pipeline not found
        if (!targetPipelineId) {
          console.log('[TasksScreen] Fetching default pipeline...');
          const { data: pDefault } = await supabase.from('pipelines').select('id, name, task_visibility_mode, is_default').eq('is_default', true).is('deleted_at', null).limit(1).maybeSingle();
          console.log('[TasksScreen] Default pipeline data:', pDefault);
          if (pDefault) {
            targetPipelineId = pDefault.id;
            pipelineData = pDefault;
          }
        }
        // Final fallback: no param, no saved, no default flagged → use the first
        // available pipeline so the user is never dropped into a blank state.
        if (!targetPipelineId) {
          console.log('[TasksScreen] No default pipeline, falling back to first available...');
          const { data: pFirst } = await supabase
            .from('pipelines')
            .select('id, name, task_visibility_mode, is_default')
            .is('deleted_at', null)
            .order('name')
            .limit(1)
            .maybeSingle();
          console.log('[TasksScreen] First available pipeline:', pFirst);
          if (pFirst) {
            targetPipelineId = pFirst.id;
            pipelineData = pFirst;
            // Persist so subsequent loads restore the same pipeline.
            try { await AsyncStorage.setItem('@TrustFlow_tasks_pipeline', pFirst.id); } catch {}
          }
        }
      } else {
        console.log('[TasksScreen] Using paramPipelineId, fetching specific pipeline...');
        const { data: pSpecific } = await supabase.from('pipelines').select('id, name, task_visibility_mode, is_default').eq('id', targetPipelineId).single();
        console.log('[TasksScreen] Specific pipeline data:', pSpecific);
        targetPipelineId = pSpecific?.id;
        pipelineData = pSpecific;
      }

      console.log('[TasksScreen] Pipeline resolved:', { targetPipelineId, pipelineData });
      setPipeline(pipelineData);

      if (!targetPipelineId) {
        console.log('[TasksScreen] No targetPipelineId found, returning early');
        return;
      }

      // Wave 2: all queries that only depend on the pipeline ID run in parallel
      console.log('[TasksScreen] Starting Promise.all for parallel queries...');
      // #194: the pipeline-wide task query is gone. Stages have to resolve
      // before the columns can be paged, so this wave no longer carries tasks —
      // loadColumns below fetches one bounded page per stage, in parallel.
      const [
        { data: allPipes },
        { data: stagesData, error: sError },
        { data: myTeams },
        { data: sessions },
      ] = await Promise.all([
        supabase.from('pipelines').select('id, name, task_visibility_mode, is_default').is('deleted_at', null),
        supabase.from('pipeline_stages')
          .select('*, linked_pipeline:linked_pipeline_id(id, name)')
          .eq('pipeline_id', targetPipelineId)
          .order('position', { ascending: true }),
        supabase.from('team_members')
          .select('team_id')
          .eq('user_id', user?.id)
          .is('removed_at', null),
        supabase.from('task_work_sessions')
          .select('task_id, user_id, started_at, last_heartbeat_at, user:user_id(full_name, avatar_url)')
          .eq('status', 'active'),
      ]);

      console.log('[TasksScreen] Promise.all completed:', { stagesData: stagesData?.length, sError });

      if (sError) throw sError;

      setAvailablePipelines(allPipes as Pipeline[] || []);
      setStages(stagesData || []);
      console.log('[TasksScreen] Stages and pipelines set');

      // Wave 3: stage actions depend on stage IDs from wave 2
      console.log('[TasksScreen] Fetching stage actions...');
      const { data: actionsData } = await supabase
        .from('pipeline_stage_actions')
        .select('*')
        .in('stage_id', (stagesData || []).map(s => s.id));
      console.log('[TasksScreen] Stage actions fetched:', actionsData?.length);
      setStageActions(actionsData || []);

      // Transitions let card buttons resolve their target stage (for directional arrows).
      const { data: transitionsData } = await supabase
        .from('pipeline_stage_transitions')
        .select('id, to_stage_id')
        .in('from_stage_id', (stagesData || []).map(s => s.id));
      setStageTransitions(transitionsData || []);

      const resolvedTeamIds = myTeams?.map(mt => mt.team_id) || [];
      setMyTeamIds(resolvedTeamIds);
      console.log('[TasksScreen] Team IDs resolved:', resolvedTeamIds);

      // #194: one bounded page per stage column, in parallel. The
      // `assigned_only` visibility mode is NOT re-filtered in the client any
      // more — `tasks_select_visibility` (RLS) already enforces exactly that
      // predicate, and re-filtering a bounded page is what makes it ragged
      // (30 fetched, 3 shown). See lib/taskBoardPage.ts.
      const { rows: filteredTasks, columns: finalColumns } =
        await loadColumns(targetPipelineId as string, (stagesData || []) as Stage[]);
      console.log('[TasksScreen] Tasks paged:', filteredTasks.length);

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
      console.log('[TasksScreen] Session map created');
      setActiveSessions(sessionMap);

      // Tasks linked onto this board from elsewhere (#203) — read-only
      // reference cards, shown separately from the real stage columns.
      const linkedTasksData = await fetchLinkedTasks(supabase, targetPipelineId as string);
      setLinkedTasks(linkedTasksData);

      // Snapshot into the module cache so the next mount paints instantly.
      taskCache.set(targetPipelineId as string, {
        pipeline: pipelineData,
        stages: stagesData || [],
        tasks: filteredTasks as Task[],
        availablePipelines: (allPipes as Pipeline[]) || [],
        stageActions: actionsData || [],
        stageTransitions: transitionsData || [],
        activeSessions: sessionMap,
        myTeamIds: resolvedTeamIds,
        columns: finalColumns,
        linkedTasks: linkedTasksData,
      });
      boardCacheMeta.lastPipelineId = targetPipelineId as string;

      console.log('[TasksScreen] fetchData completed successfully');
    } catch (err: any) {
      console.error('[TasksScreen] ERROR fetching task data:', err);
    } finally {
      console.log('[TasksScreen] finally block: setting loading=false');
      setLoading(false);
      setRefreshing(false);
      setSwitchingBoard(false);
    }
  };

  // Load one board's data into a cache snapshot without touching component state.
  // Mirrors fetchData's per-board queries; used to warm other boards in the
  // background so switching to them is instant. Reuses the current global
  // sessions + team ids (both board-independent).
  const loadBoardSnapshot = useCallback(async (boardId: string): Promise<BoardSnapshot | null> => {
    const board = availablePipelines.find(p => p.id === boardId);
    if (!board) return null;
    const { data: stagesData } = await supabase.from('pipeline_stages')
      .select('*, linked_pipeline:linked_pipeline_id(id, name)')
      .eq('pipeline_id', boardId)
      .order('position', { ascending: true });
    const stages = stagesData || [];
    const stageIds = stages.map((s: any) => s.id);
    // #194: the warm-up is paged exactly like the live board. It used to pull
    // every OTHER board's entire task list in the background — the same
    // unbounded query, multiplied by the board count. Filters aren't applied:
    // this is a cold snapshot of a board the user hasn't opened, and opening it
    // triggers a filtered refetch anyway.
    const [{ data: actionsData }, { data: transitionsData }, ...pages] = await Promise.all([
      supabase.from('pipeline_stage_actions').select('*').in('stage_id', stageIds),
      supabase.from('pipeline_stage_transitions').select('id, to_stage_id').in('from_stage_id', stageIds),
      ...stages.map((s: any) => stagePageQuery(
        supabase.from('tasks').select(TASK_SELECT).eq('pipeline_id', boardId).eq('current_stage_id', s.id).is('deleted_at', null),
        0,
      )),
    ]);
    const columns: Record<string, ColumnPage> = {};
    let filteredTasks: any[] = [];
    stages.forEach((s: any, i: number) => {
      const rows = ((pages[i] as any)?.data as any[]) || [];
      columns[s.id] = { offset: 0, hasMore: rows.length === TASK_PAGE_SIZE, loading: false };
      filteredTasks = filteredTasks.concat(rows);
    });
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
  }, [availablePipelines, myTeamIds, activeSessions]);

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

  useEffect(() => {
    console.log('[TasksScreen] useEffect with paramPipelineId:', paramPipelineId);
    if (!paramPipelineId) {
      console.log('[TasksScreen] No paramPipelineId, skipping');
      return;
    }
    // On web, InteractionManager.runAfterInteractions can hang indefinitely
    // (its handle never clears with ongoing subscriptions/animations), so the
    // callback never fires and loading stays true forever. Run directly on web.
    if (Platform.OS === 'web') {
      console.log('[TasksScreen] Web: calling fetchData directly');
      fetchDataRef.current();
      return;
    }
    const task = InteractionManager.runAfterInteractions(() => {
      console.log('[TasksScreen] InteractionManager calling fetchData');
      fetchDataRef.current();
    });
    return () => task.cancel();
  }, [paramPipelineId]);

  const fetchPulse = async () => {
    const { data } = await supabase.rpc('rpc_get_personal_pulse');
    if (data) setPulse(data);
  };

  // Refs always hold the latest fetch functions so useFocusEffect never captures stale closures.
  const fetchDataRef = useRef(fetchData);
  fetchDataRef.current = fetchData;
  const fetchPulseRef = useRef(fetchPulse);
  fetchPulseRef.current = fetchPulse;

  // Track whether the initial mount load has already run, so useFocusEffect skips it.
  const didMountRef = useRef(false);
  // Track whether the screen is currently focused (for polling control)
  const isFocusedRef = useRef(false);

  useEffect(() => {
    console.log('[TasksScreen] Initial mount useEffect');
    // See note above: InteractionManager never resolves on web, leaving the
    // screen stuck on the loading skeleton. Run the initial load directly there.
    if (Platform.OS === 'web') {
      console.log('[TasksScreen] Initial mount (web): calling fetchPulse and fetchData directly');
      fetchPulse();
      fetchData();
      return;
    }
    const task = InteractionManager.runAfterInteractions(() => {
      console.log('[TasksScreen] Initial mount: InteractionManager calling fetchPulse and fetchData');
      fetchPulse();
      fetchData();
    });
    return () => task.cancel();
  }, []);

  // Load locally-stored kanban settings early for skeleton background
  useEffect(() => {
    let mounted = true;
    const loadLocalKanban = async () => {
      try {
        const saved = await AsyncStorage.getItem('kanban_settings');
        if (!saved) return;
        const parsed = JSON.parse(saved);
        // ThemeContext filters out blob: URIs — follow same rule
        if (parsed.backgroundUrl && typeof parsed.backgroundUrl === 'string' && !parsed.backgroundUrl.startsWith('blob:')) {
          if (mounted) setSkeletonBg(parsed.backgroundUrl);
        }
      } catch (e) {
        // ignore
      }
    };
    loadLocalKanban();
    return () => { mounted = false; };
  }, []);

  // Refresh when the screen regains focus (e.g. returning from task detail).
  // Replaces the old realtime subscription — cheaper and avoids the
  // "Cannot add postgres_changes callbacks after subscribe()" crash.
  useFocusEffect(
    useCallback(() => {
      // Mark focused state for the polling effect
      isFocusedRef.current = true;
      if (!didMountRef.current) {
        didMountRef.current = true;
      } else {
        fetchDataRef.current();
        fetchPulseRef.current();
      }
      return () => {
        isFocusedRef.current = false;
      };
    }, [])
  );

  // Lightweight polling for mobile to reflect remote changes without realtime
  useEffect(() => {
    if (Platform.OS === 'web' || isLargeScreen) return; // only enable on small/mobile screens

    let intervalId: NodeJS.Timeout | null = null;
    const startPolling = () => {
      // Poll every 60 seconds while focused
      if (intervalId) return;
      intervalId = setInterval(() => {
        if (isFocusedRef.current) fetchDataRef.current();
      }, 60000);
    };

    startPolling();

    return () => {
      if (intervalId) clearInterval(intervalId as any);
      intervalId = null;
    };
  }, [isLargeScreen]);

  // Realtime board updates — mirrors the desktop board so mobile is live, not
  // 60s-polled. All .on() callbacks are registered before .subscribe() and the
  // channel name is unique per mount; that avoids the old "Cannot add
  // postgres_changes callbacks after subscribe()" crash. The polling effect
  // above stays as a backstop for when the websocket drops on flaky mobile nets.
  useEffect(() => {
    const channel = supabase
      .channel(`adaptive-board-realtime-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => fetchDataRef.current())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_work_sessions' }, () => fetchDataRef.current())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_comments' }, () => fetchDataRef.current())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_submissions' }, () => fetchDataRef.current())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_pipeline_links' }, () => fetchDataRef.current())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pipeline_stage_history' }, () => fetchDataRef.current())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchDataRef.current();
    fetchPulseRef.current();
  }, []);

  // Used by task cards after actions — refreshes data without pull-to-refresh indicator.
  const silentRefresh = useCallback(() => {
    fetchDataRef.current();
  }, []);

  // #194: the filters and the search box are served by the query now, so a
  // change to either has to re-page every column — narrowing the rows already
  // in memory would silently miss matches on page 2. The signature check makes
  // this a no-op for the load fetchData just did (mount, board switch, refocus),
  // so it only fires on a real filter change. 250ms so typing a word is one
  // round of requests, not one per keystroke.
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

  const handleSetDefault = async (pipelineId: string) => {
    try {
      // Step 1: clear existing default — only rows currently marked true (avoids unique constraint conflict)
      await supabase.from('pipelines').update({ is_default: false }).eq('is_default', true);
      // Step 2: mark the chosen pipeline as default
      await supabase.from('pipelines').update({ is_default: true }).eq('id', pipelineId);
      const { data: allPipes } = await supabase.from('pipelines').select('id, name, task_visibility_mode, is_default').is('deleted_at', null);
      setAvailablePipelines(allPipes as Pipeline[] || []);
    } catch (err: any) {
      showAlert('Error', err.message || 'Could not update default pipeline.');
    }
  };

  const handleCreateTask = () => {
    if (!hasPermission('task.create')) {
      errorToast('Your current authorization level does not permit task initialization.', 'Access denied');
      return;
    }
    setShowCreateSheet(true);
  };

  // Phase 3: screen-level OS-file drop / Ctrl+V with no composer open → open it
  // pre-seeded. useFileDrop/useSmartPaste Platform-gate to web, so this whole
  // block is an inert no-op on native — only narrow-web hits it.
  const openWithSeed = () => setShowCreateSheet(true);
  const { ref: taskDropRef, isOver: taskDropOver, isDragActive: taskDropActive } = useFileDrop(
    (files) => { setSeedFiles(files.map(fileToStaged)); openWithSeed(); },
    !showCreateSheet,
  );
  useSmartPaste(
    {
      onFiles: (files) => { setSeedFiles(files.map(fileToStaged)); openWithSeed(); },
      onText:  (text)  => { setSeedText(text); openWithSeed(); },
    },
    !showCreateSheet,
  );

  // handleAdvanceTask removed — logic moved to TaskCardActions component

  const handleArchiveTask = async () => {
    if (!archiveModal.taskId) return;
    try {
      setArchiving(true);
      const { error } = await supabase.rpc('rpc_archive_task', { p_task_id: archiveModal.taskId });
      if (error) throw error;
      setArchiveModal({ visible: false, taskId: null });
      fetchData();
    } catch (err: any) {
      if (offerForceStopOnArchiveError(err, { hasPermission, showConfirm, errorToast, retry: handleArchiveTask })) return;
      errorToast(err.message || 'Could not archive task.', 'Archival failed');
    } finally {
      setArchiving(false);
    }
  };

  const handleOpenAssignments = useCallback((task: Task) => {
    setSelectedTask(task);
    setShowAssignmentModal(true);
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
    filters.priorities.length + filters.categories.length +
    filters.projectIds.length + filters.managerIds.length + filters.dueDates.length;

  const toggleFilter = (key: keyof FilterState, value: string) => {
    setFilters(prev => {
      const list = prev[key] as string[];
      return { ...prev, [key]: list.includes(value) ? list.filter(v => v !== value) : [...list, value] };
    });
  };

  const clearFilters = () =>
    setFilters({ priorities: [], categories: [], projectIds: [], managerIds: [], dueDates: [] });

  const renderTaskCard = useCallback((task: Task) => {
    const prio = getPriorityInfo(task.priority, colors);
    const pinggedAt = pingedTasks.get(task.id);
    const isPinged = pinggedAt !== undefined;
    return (
      <AnimatedTaskCard key={task.id}>
      <TouchableOpacity
        onPress={() => {
          if (isPinged) removePingedTask(task.id);
          router.push(`/task/${task.id}`);
        }}
        activeOpacity={0.7}
        className="bg-surface-card p-4 rounded-2xl mb-3 premium-shadow relative hover:z-50"
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
            <PingTimeBadge pingedAt={pinggedAt} />
          </>
        )}
        <View className="flex-row items-start justify-between gap-2 mb-3">
          <View className="flex-1 flex-row flex-wrap items-center gap-2 min-w-0">
            <View className="bg-surface-background px-2 py-0.5 rounded-md border border-surface-border">
              <Text style={{ color: prio.color }} className="text-[9px] font-black uppercase tracking-tighter">
                {prio.label}
              </Text>
            </View>
            {task.parent_task_id && (
              <View className="bg-brand-primary/20 px-1.5 py-0.5 rounded-md">
                <Text className="text-brand-primary text-[8px] font-black italic">SUB</Text>
              </View>
            )}
          </View>
          <View className="flex-row items-center gap-1.5 shrink-0">
            <TaskPingButton task={task} userId={user?.id || ''} />
            {hasPermission('task.assign') && (
              <Tooltip label="Manage assignments">
                <TouchableOpacity
                  onPress={() => handleOpenAssignments(task)}
                  className="w-7 h-7 items-center justify-center rounded-xl bg-surface-background border border-surface-border"
                >
                  <FontAwesome name="user-plus" size={10} className="text-typography-muted" />
                </TouchableOpacity>
              </Tooltip>
            )}
            {(profile?.is_owner || hasPermission('archive:create') || hasPermission('pipeline.edit')) && (
              <Tooltip label="Archive task">
                <TouchableOpacity
                  onPress={() => setArchiveModal({ visible: true, taskId: task.id })}
                  className="w-7 h-7 items-center justify-center rounded-xl bg-surface-background border border-surface-border"
                >
                  <FontAwesome name="archive" size={10} className="text-typography-muted" />
                </TouchableOpacity>
              </Tooltip>
            )}
          </View>
        </View>

        {/* TEAM ASSIGNMENT BADGES */}
        {task.assignments?.some(a => a.assignee_team_id) && (
          <View className="flex-row flex-wrap gap-1 mb-2">
            {task.assignments?.filter(a => a.assignee_team_id).map((a, idx) => (
              <View key={idx} className="bg-surface-overlay px-1.5 py-0.5 rounded-md border border-surface-border">
                <Text className="text-typography-muted text-[8px] font-bold uppercase tracking-tight">{a.team?.name}</Text>
              </View>
            ))}
          </View>
        )}

        <Text className="text-typography-main font-bold text-base mb-0.5">{task.title}</Text>
        {task.category && (
          <Text className="text-typography-dim text-[9px] font-bold uppercase tracking-wider mb-1">{task.category}</Text>
        )}
        
         {/* ACTIVE WORK INDICATOR — avatar stack + hover session detail */}
        {kanban.showAvatars && activeSessions[task.id] && activeSessions[task.id].length > 0 && (
          <ActiveSessionAvatars sessions={activeSessions[task.id]} />
        )}

        {!!task.description && (
          <LinkifiedText className="text-typography-muted text-xs leading-4 mb-3" numberOfLines={2}>
            {task.description}
          </LinkifiedText>
        )}
        
        <View className="pt-3 border-t border-surface-border/50">
          <TaskCardActions
            task={task}
            stages={stages}
            stageActions={stageActions}
            transitions={stageTransitions}
            activeSessions={activeSessions}
            userId={user?.id || ''}
            myTeamIds={myTeamIds}
            onRefresh={silentRefresh}
            onMoved={(taskId, toStageId) => {
              // #194: re-bucket the row in place (it can neither vanish nor
              // duplicate — one flat array, one entry per id) and pin it, so
              // the silentRefresh that follows can't drop it for landing
              // outside its new column's first page.
              pinTask(taskId);
              setTasks(prev => prev.map(t => (t.id === taskId ? { ...t, current_stage_id: toStageId } : t)));
            }}
          />
        </View>
      </TouchableOpacity>
      </AnimatedTaskCard>
    );
  }, [router, hasPermission, profile?.is_owner, kanban, activeSessions, stages, stageActions, stageTransitions, user?.id, handleOpenAssignments, silentRefresh, colors, pingedTasks, removePingedTask]);

  const renderStageColumn = (stage: Stage) => {
    const stageTasks = tasks.filter(t => {
      if (t.current_stage_id !== stage.id) return false;
      if (filters.priorities.length > 0 && !filters.priorities.includes(t.priority)) return false;
      if (filters.categories.length > 0 && !filters.categories.includes(t.category)) return false;
      if (filters.projectIds.length > 0 && !filters.projectIds.includes(t.project_id || '')) return false;
      if (filters.managerIds.length > 0 && !filters.managerIds.includes(t.manager_id || '')) return false;
      if (filters.dueDates.length > 0 && !filters.dueDates.includes(getDueBucket(t.due_date))) return false;
      if (searchQuery && !t.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (mineOnly && t.manager_id !== user?.id && !t.assignments?.some(a =>
        a.assignee_user_id === user?.id ||
        (a.assignee_team_id && myTeamIds.includes(a.assignee_team_id))
      )) return false;
      return true;
    });
    if (sortKey !== 'default') stageTasks.sort((a, b) => compareTasksBySortKey(sortKey, a, b));
    const col = columns[stage.id] ?? emptyColumnPage();
    return (
      <View
        key={stage.id}
        style={{ width: isLargeScreen ? 320 : width * 0.85 }} 
        className="mr-4 h-full"
        // @ts-ignore - for web-only smart scroll
        dataSet={Platform.OS === 'web' ? { 'vertical-scroll': 'true' } : {}}
      >
        <View className="flex-row items-center justify-between mb-4 px-2">
           <View className="flex-row items-center">
              <View style={{ backgroundColor: stage.color }} className="w-2 h-2 rounded-full mr-2" />
              <Text className="text-typography-main font-black text-xs uppercase tracking-widest">{stage.name}</Text>
              {kanban.showStageTotals && (
                // "30+" while the column is paginated: this counts the rows
                // actually loaded, and an exact count would mean the
                // full-pipeline scan #194 exists to remove.
                <View className="ml-2 bg-surface-overlay px-1.5 rounded-md">
                  <Text className="text-typography-muted text-[10px] font-bold">{stageTasks.length}{col.hasMore ? '+' : ''}</Text>
                </View>
              )}
           </View>
           
           {/* STAGE PUSH BADGE */}
            {stage.linked_pipeline && (
               <View className="flex-row items-center border border-brand-primary/30 bg-brand-primary/10 px-2 py-0.5 rounded-full">
                  <FontAwesome name="bolt" size={8} color={colors.primary} />
                  <Text className="text-brand-primary text-[8px] font-black ml-1 uppercase">Pushes to {stage.linked_pipeline.name}</Text>
               </View>
            )}

            <Tooltip label="Configure stage">
              <TouchableOpacity
                onPress={async () => {
                  if (pipeline?.id) {
                    await AsyncStorage.setItem('@TrustFlow_selected_pipeline', pipeline.id);
                  }
                  router.push('/admin/pipelines' as any);
                }}
                className="p-1.5"
              >
                 <FontAwesome name="ellipsis-h" size={14} className="text-typography-muted" />
              </TouchableOpacity>
            </Tooltip>
        </View>
        
        <ScrollView 
          className={`flex-1 rounded-3xl p-2 ${
            kanban.isVibrant ? 'bg-brand-primary/10 border border-brand-primary/20' : 'bg-surface-background/50'
          }`} 
          showsVerticalScrollIndicator={false}
        >
          {stageTasks.length === 0 && !col.hasMore ? (
            <View className="py-10 items-center justify-center opacity-30">
               <FontAwesome name="inbox" size={32} className="text-typography-muted" />
               <Text className="text-typography-muted text-xs mt-2">Empty</Text>
            </View>
          ) : (
            stageTasks.map(renderTaskCard)
          )}
          {/* Manual page-in, matching ProjectBoard.tsx and the desktop board —
              never an infinite scroll: a stage column is a work queue, and
              growing one under the user costs them their place in it. 44px
              minimum touch target (ui-style-guide §4). */}
          {col.hasMore && (
            <TouchableOpacity
              onPress={() => loadMoreStage(stage.id)}
              disabled={col.loading}
              className="items-center justify-center py-3 mb-2 rounded-2xl border border-surface-border active:opacity-70"
              style={{ minHeight: 44 }}
            >
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">
                {col.loading ? 'Loading…' : `Show ${TASK_PAGE_SIZE} more`}
              </Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>
    );
  };

  if (loading && !refreshing) {
    return (
      <>
        {(skeletonBg || kanban.backgroundUrl) && (
          <View className="absolute inset-0 overflow-hidden">
            <Image 
              source={{ uri: skeletonBg || kanban.backgroundUrl || undefined }} 
              className="absolute inset-0 w-full h-full"
              resizeMode="cover"
              style={{ opacity: 1 }}
            />
            <View 
              className="absolute inset-0" 
              style={{ 
                backgroundColor: `rgba(0,0,0,${kanban.bgOverlay})`,
                ...(Platform.OS === 'web' ? { backdropFilter: `blur(${kanban.bgBlur}px)` } : {})
              } as any} 
            />
          </View>
        )}

        <View className="flex-1 bg-surface-background px-4 pt-6">
          <View className="flex-row gap-4 mb-4">
            <SkeletonBlock height={20} style={{ width: 120 }} />
            <SkeletonBlock height={20} style={{ width: 80 }} />
            <SkeletonBlock height={20} style={{ width: 40 }} />
          </View>
          <HorizontalScroll className="px-1">
            {[0,1,2].map(col => (
              <View key={col} style={{ width: 260, marginRight: 12 }}>
                <SkeletonBlock height={18} borderRadius={8} style={{ width: '60%', marginBottom: 12 }} />
                <SkeletonList count={3} itemHeight={110} />
              </View>
            ))}
          </HorizontalScroll>
        </View>
      </>
    );
  }

  // EMPTY STATE: NO PIPELINES
  if (!loading && availablePipelines.length === 0) {
    const canManage = profile?.is_owner || hasPermission('pipeline.edit');
    return (
      <View className="flex-1 bg-surface-background items-center justify-center px-6">
        <View className="bg-surface-card w-full p-8 rounded-[32px] border border-surface-border items-center premium-shadow">
          <View className="w-20 h-20 bg-brand-primary/10 rounded-full items-center justify-center mb-6">
            <FontAwesome name="sitemap" size={32} color={colors.primary} />
          </View>
          
          {canManage ? (
            <>
              <Text className="text-typography-main text-xl font-black mt-2 text-center">Setup Required</Text>
              <Text className="text-typography-muted text-sm mt-3 text-center leading-5">
                No workflow pipelines found. You need to create a pipeline before you can manage tasks.
              </Text>
              <TouchableOpacity
                onPress={() => router.push('/admin/pipelines')}
                className="bg-brand-primary px-8 py-4 rounded-2xl mt-8 active:scale-95 transition-all"
              >
                <Text className="text-typography-main font-black uppercase tracking-widest text-xs">Create First Pipeline</Text>
              </TouchableOpacity>
            </>
          ) : (
            <View className="bg-state-info-dim border border-state-info/20 p-5 rounded-2xl w-full">
              <View className="flex-row items-start">
                <FontAwesome name="info-circle" size={16} color={colors.info} style={{ marginTop: 2 }} />
                <Text className="text-typography-main text-sm font-bold ml-3 flex-1 leading-5">
                  Either no pipelines exist now, or they're not privileged enough to see them, contact company Admin
                </Text>
              </View>
            </View>
          )}
        </View>
      </View>
    );
  }

   return (
     <View ref={taskDropRef} className="flex-1 bg-surface-background">
      {/* Phase 3 / 3.5: drop-to-create affordance (web only — taskDropOver /
          taskDropActive never trip on native). Dim on drag-enter-window,
          full-strength while the cursor is over this screen. */}
      <FileDropOverlay active={taskDropActive && !showCreateSheet} over={taskDropOver} label="Drop to create a task" />

      {Platform.OS === 'web'
        ? (!isLargeScreen && navPosition === 'top' && <View style={{ height: TAB_BAR_HEIGHT.web }} />)
        : <View style={{ height: TAB_BAR_HEIGHT.native }} />}

      {/* BOARD SWITCH OVERLAY — shown while an uncached board loads (cached boards swap instantly) */}
      <LoadingOverlay visible={switchingBoard} message="Switching board…" />

      {/* KANBAN BACKGROUND LAYER */}
      {kanban.backgroundUrl && (
        <View className="absolute inset-0 overflow-hidden">
          <Image 
            source={{ uri: kanban.backgroundUrl }} 
            className="absolute inset-0 w-full h-full"
            resizeMode="cover"
            style={{ opacity: 1 }}
          />
          <View 
            className="absolute inset-0" 
            style={{ 
               backgroundColor: `rgba(0,0,0,${kanban.bgOverlay})`,
               ...(Platform.OS === 'web' ? { backdropFilter: `blur(${kanban.bgBlur}px)` } : {})
            } as any} 
          />
        </View>
      )}

      {/* PERFORMANCE PULSE HEADER */}
      {kanban.showPulse && pulse && (
         <View className={`px-5 py-3 ${kanban.backgroundUrl ? 'bg-surface-background/40' : 'bg-brand-primary/5'} border-b border-surface-border`}>
            <View className="flex-row items-center justify-between">
            <View className="flex-row items-center flex-wrap gap-x-8 gap-y-4">
               <View>
                  <Text className="text-[9px] text-brand-primary font-black uppercase tracking-tighter mb-0.5">Today's Pulse</Text>
                  <View className="flex-row items-baseline">
                     <Text className="text-lg font-black text-brand-primary">{pulse.daily_points}</Text>
                     <Text className="text-[9px] text-brand-primary/60 ml-0.5 font-bold">PTS</Text>
                  </View>
               </View>

               <View>
                  <Text className="text-[9px] text-typography-muted font-black uppercase tracking-tighter mb-0.5">Velocity</Text>
                  <View className="flex-row items-baseline">
                      <Text className="text-lg font-black text-typography-main">{formatCompact(pulse.active_seconds_today)}</Text>
                     <Text className="text-[9px] text-typography-muted ml-0.5 font-bold">{Math.floor((pulse.active_seconds_today % 3600) / 60)}m</Text>
                  </View>
               </View>

               <View>
                  <Text className="text-[9px] text-typography-muted font-black uppercase tracking-tighter mb-0.5">Quality (Flap)</Text>
                  <View className="flex-row items-baseline">
                     <Text className={`text-lg font-black ${pulse.flap_rate_score > 1.5 ? 'text-state-danger' : 'text-state-success'}`}>
                        {pulse.flap_rate_score}x
                     </Text>
                  </View>
               </View>
            </View>

               {pulse.is_working && (
                  <View className="ml-3 bg-state-success/10 px-2 py-0.5 rounded-full flex-row items-center border border-state-success/20">
                     <View className="w-1.5 h-1.5 rounded-full bg-state-success mr-1" />
                     <Text className="text-[8px] text-state-success font-black uppercase tracking-widest">On</Text>
                  </View>
               )}
            </View>
         </View>
      )}

      <View className="px-4 pt-3 pb-3">
        {/* Row 1: Pipeline title + tools toggle */}
        <View className="flex-row items-center gap-3" style={{ zIndex: 50 }}>
          <View className="flex-1 min-w-0" style={{ position: 'relative', zIndex: 50 }}>
            <Pressable
              onPress={() => { if (showBoardPeek) setShowBoardPeek(false); else setShowPipelinePicker(true); }}
              onLongPress={() => { if (prevBoard || nextBoard) setShowBoardPeek(true); }}
              delayLongPress={300}
              {...(Platform.OS === 'web' ? ({ onHoverIn: openPeek, onHoverOut: closePeekSoon } as any) : {})}
            >
              <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-wider mb-0.5" numberOfLines={1}>
                {pipeline?.name || 'Pipeline'}  ▾
              </Text>
              <Text className="text-typography-main text-2xl font-black" numberOfLines={1}>Board</Text>
            </Pressable>

            {showBoardPeek && (prevBoard || nextBoard) && (
              <BoardPeekCard
                prevBoard={prevBoard}
                nextBoard={nextBoard}
                counts={peekCounts}
                onSelect={switchBoard}
                onHoverIn={openPeek}
                onHoverOut={closePeekSoon}
              />
            )}
          </View>

          {/* Tools toggle */}
          <Tooltip label="Toggle tools tray">
            <TouchableOpacity
              onPress={() => setShowTools(v => !v)}
              className={`p-2.5 rounded-xl border ${showTools ? 'bg-brand-primary border-brand-primary' : 'bg-brand-primary/10 border-brand-primary/20'}`}
            >
              <FontAwesome name="wrench" size={15} color={showTools ? 'white' : colors.primary} />
            </TouchableOpacity>
          </Tooltip>
        </View>

        {/* Row 2: tools tray — only visible when toggled */}
        {showTools && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: 8, alignItems: 'center', paddingTop: 10 }}
          >
            {hasPermission('manage_notifications') && (
              <Tooltip label="Manage notifications">
                <TouchableOpacity
                  onPress={() => router.push('/admin/notifications' as any)}
                  className="bg-brand-primary/10 p-2.5 rounded-xl border border-brand-primary/20"
                >
                  <FontAwesome name="bell-o" size={15} className="text-brand-primary" />
                </TouchableOpacity>
              </Tooltip>
            )}
            {hasPermission('role.manage') && (
              <Tooltip label="Manage roles">
                <TouchableOpacity
                  onPress={() => router.push('/admin/roles')}
                  className="bg-brand-primary/10 p-2.5 rounded-xl border border-brand-primary/20"
                >
                  <FontAwesome name="shield" size={15} className="text-brand-primary" />
                </TouchableOpacity>
              </Tooltip>
            )}
            <Tooltip label="Show only my tasks">
              <TouchableOpacity
                onPress={() => setMineOnly(v => !v)}
                className={`p-2.5 rounded-xl border ${mineOnly ? 'bg-brand-primary border-brand-primary' : 'bg-brand-primary/10 border-brand-primary/20'}`}
              >
                <FontAwesome name="user" size={13} color={mineOnly ? 'white' : colors.primary} />
              </TouchableOpacity>
            </Tooltip>
            <Tooltip label="Search tasks">
              <TouchableOpacity
                onPress={() => {
                  const next = !showSearch;
                  setShowSearch(next);
                  if (!next) { setSearchQuery(''); Keyboard.dismiss(); }
                }}
                className={`p-2.5 rounded-xl border ${showSearch || searchQuery ? 'bg-brand-primary/10 border-brand-primary' : 'bg-brand-primary/10 border-brand-primary/20'}`}
              >
                <FontAwesome name="search" size={13} color={showSearch || searchQuery ? colors.primary : colors.textMuted} />
              </TouchableOpacity>
            </Tooltip>
            <Tooltip label="Filter tasks">
              <TouchableOpacity
                onPress={() => setShowFilters(v => !v)}
                className={`relative p-2.5 rounded-xl border flex-row items-center gap-1.5 ${showFilters || activeFilterCount > 0 ? 'bg-brand-primary/10 border-brand-primary' : 'bg-brand-primary/10 border-brand-primary/20'}`}
              >
                <FontAwesome name="filter" size={15} color={colors.primary} />
                {activeFilterCount > 0 && (
                  <View className="absolute -top-1 -right-1 bg-brand-primary rounded-full min-w-[16px] h-[16px] px-1 items-center justify-center border-2 border-surface-card">
                    <Text className="text-white text-[8px] font-black">{activeFilterCount > 9 ? '9+' : activeFilterCount}</Text>
                  </View>
                )}
              </TouchableOpacity>
            </Tooltip>
            <Tooltip label="Customize board">
              <TouchableOpacity
                onPress={() => setShowPersonalizer(true)}
                className="bg-brand-primary/10 p-2.5 rounded-xl border border-brand-primary/20"
              >
                <FontAwesome name="paint-brush" size={15} className="text-brand-primary" />
              </TouchableOpacity>
            </Tooltip>
            {hasPermission('pipeline.edit') && (
              <Tooltip label="Configure pipeline">
                <TouchableOpacity
                  onPress={() => router.push('/admin/pipelines')}
                  className="bg-brand-primary/10 p-2.5 rounded-xl border border-brand-primary/20"
                >
                  <FontAwesome name="gear" size={15} className="text-brand-primary" />
                </TouchableOpacity>
              </Tooltip>
            )}
            {(hasPermission('task.create') || hasPermission('report.export') || hasPermission('task.view_all')) && (
              <Tooltip label="Import tasks">
                <TouchableOpacity
                  onPress={() => setShowMobility(true)}
                  className="bg-brand-primary/10 p-2.5 rounded-xl border border-brand-primary/20"
                >
                  <FontAwesome name="exchange" size={15} className="text-brand-primary" />
                </TouchableOpacity>
              </Tooltip>
            )}
            {hasPermission('task.create') && (
              <Tooltip label="Create task">
                <TouchableOpacity
                  onPress={handleCreateTask}
                  className="bg-brand-primary w-9 h-9 rounded-xl items-center justify-center"
                >
                  <FontAwesome name="plus" size={15} color="white" />
                </TouchableOpacity>
              </Tooltip>
            )}
          </ScrollView>
        )}
      </View>

      {/* Search Bar — only shown when toggled */}
      {showSearch && (
        <View className="mx-4 mb-2 flex-row items-center bg-surface-card border border-surface-border rounded-xl px-4 py-2.5 gap-3">
          <FontAwesome name="search" size={13} className="text-typography-muted" />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search tasks..."
            placeholderTextColor={colors.textDim}
            className="flex-1 text-typography-main text-sm font-bold"
            returnKeyType="search"
            clearButtonMode="while-editing"
            autoFocus
            onBlur={() => { if (!searchQuery) setShowSearch(false); }}
          />
          {searchQuery.length > 0 && Platform.OS !== 'ios' && (
            <Tooltip label="Clear search">
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <FontAwesome name="times-circle" size={14} className="text-typography-muted" />
              </TouchableOpacity>
            </Tooltip>
          )}
        </View>
      )}

      {/* Board peek dismiss layer (native only — web closes on hover-out) */}
      {showBoardPeek && Platform.OS !== 'web' && (
        <Pressable
          onPress={() => setShowBoardPeek(false)}
          className="absolute inset-0"
          style={{ zIndex: 45 }}
        />
      )}

      {/* PIPELINE PICKER MODAL */}
      <BoardSwitcherPopup
        visible={showPipelinePicker}
        onClose={() => setShowPipelinePicker(false)}
        picker={boardPicker}
        currentBoardId={pipeline?.id}
        onSelectBoard={(id) => handleSelectBoard(id, { explicit: true })}
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

      <ConfirmModal
        visible={archiveModal.visible}
        title="Move to Cold Storage"
        description="This will snapshot the task and remove it from the active pipeline. It can be restored from Intelligence > Archives."
        confirmLabel="Archive Task"
        variant="warning"
        loading={archiving}
        onConfirm={handleArchiveTask}
        onCancel={() => setArchiveModal({ visible: false, taskId: null })}
      />

      {/* Filter Panel — animated slide-down (issue #208) */}
      <SlideDownPanel isOpen={showFilters} maxHeight={330}>
        <View className="mx-4 mb-3 bg-surface-card border border-surface-border rounded-2xl p-4">
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-typography-main font-black text-xs uppercase tracking-widest">Filters</Text>
            <Tooltip label={activeFilterCount > 0 ? 'Clear all filters' : 'No active filters'}>
              <TouchableOpacity
                onPress={clearFilters}
                disabled={activeFilterCount === 0}
                className="flex-row items-center gap-1 px-2.5 py-1 rounded-xl border"
                style={{
                  borderColor: activeFilterCount > 0 ? colors.danger : colors.border,
                  backgroundColor: activeFilterCount > 0 ? colors.danger + '0F' : undefined,
                  opacity: activeFilterCount > 0 ? 1 : 0.4,
                }}
              >
                <FontAwesome name="times" size={9} color={activeFilterCount > 0 ? colors.danger : colors.textMuted} />
                <Text
                  className="text-[9px] font-black uppercase tracking-wider"
                  style={{ color: activeFilterCount > 0 ? colors.danger : colors.textMuted }}
                >
                  Clear Filters
                </Text>
              </TouchableOpacity>
            </Tooltip>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View className="gap-3">
            {/* Priority & Category side by side */}
            <View className="flex-row flex-wrap gap-2">
              <View className="flex-1 min-w-[150px]">
                <Text className="text-typography-muted font-black uppercase tracking-widest text-[9px] mb-1.5">Priority</Text>
                <View className="flex-row flex-wrap gap-1.5">
                  {(['urgent', 'high', 'normal', 'low'] as const).map(p => {
                    const colorClass = ({ urgent: 'text-state-danger', high: 'text-state-warning', normal: 'text-typography-muted', low: 'text-state-success' } as Record<string, string>)[p];
                    const active = filters.priorities.includes(p);
                    return (
                      <TouchableOpacity
                        key={p}
                        onPress={() => toggleFilter('priorities', p)}
                        className={`flex-row items-center gap-1.5 px-3 py-2.5 rounded-xl border ${active ? 'bg-brand-primary/10 border-brand-primary' : 'bg-surface-card border-surface-border'}`}
                      >
                        <Text className={`text-[9px] font-black uppercase tracking-widest ${active ? 'text-brand-primary' : colorClass}`}>{p.charAt(0).toUpperCase() + p.slice(1)}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
              {filterOptions.categories.length > 0 && (
                <View className="flex-1 min-w-[150px]">
                  <Text className="text-typography-muted font-black uppercase tracking-widest text-[10px] mb-1.5">Category</Text>
                  <View className="flex-row flex-wrap gap-1.5">
                    {filterOptions.categories.map(cat => {
                      const active = filters.categories.includes(cat);
                      return (
                        <TouchableOpacity
                          key={cat}
                          onPress={() => toggleFilter('categories', cat)}
                          className={`px-3 py-2.5 rounded-xl border ${active ? 'bg-brand-primary/10 border-brand-primary' : 'bg-surface-card border-surface-border'}`}
                        >
                          <Text className={`text-[9px] font-black uppercase tracking-widest ${active ? 'text-brand-primary' : 'text-typography-muted'}`}>{cat}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}
            </View>
            {filterOptions.projects.length > 0 && (
              <FilterDropdown
                label="Project"
                count={filters.projectIds.length}
                selected={filters.projectIds}
                options={filterOptions.projects.map(proj => ({ value: proj.id, label: proj.name }))}
                onToggle={v => toggleFilter('projectIds', v)}
              />
            )}
            {filterOptions.managers.length > 0 && (
              <FilterDropdown
                label="Manager"
                count={filters.managerIds.length}
                selected={filters.managerIds}
                options={filterOptions.managers.map(mgr => ({ value: mgr.id, label: mgr.full_name }))}
                onToggle={v => toggleFilter('managerIds', v)}
              />
            )}
            <FilterDropdown
              label="Due Date"
              count={filters.dueDates.length}
              selected={filters.dueDates}
              options={DUE_DATE_BUCKETS.map(({ key, label }) => ({ value: key, label }))}
              onToggle={v => toggleFilter('dueDates', v)}
            />
            <FilterDropdown
              label="Sort By"
              single
              count={0}
              selected={[sortKey]}
              options={TASK_SORT_OPTIONS.map(({ key, label }) => ({ value: key, label }))}
              onToggle={v => setSortKey(v as TaskSortKey)}
            />
            </View>
          </ScrollView>
        </View>
      </SlideDownPanel>

      <View className="px-5">
        <LinkedTasksStrip tasks={linkedTasks} />
      </View>

      <HorizontalScroll
        className="flex-1 px-5"
        contentContainerStyle={{ paddingBottom: 20 }}
      >
        {stages.map(renderStageColumn)}
        <View className="w-10" />
      </HorizontalScroll>

      {showPersonalizer && (
        <KanbanPersonalizer onClose={() => setShowPersonalizer(false)} />
      )}

      {hasPermission('task.create') && (
        <Tooltip label="Create task">
          <TouchableOpacity
            onPress={handleCreateTask}
            className="absolute right-6 w-16 h-16 bg-brand-primary rounded-full items-center justify-center premium-shadow z-40 active:scale-90 transition-transform"
            style={{ bottom: TAB_BAR_HEIGHT.native + 16 }}
          >
            <FontAwesome name="plus" size={24} color="white" />
          </TouchableOpacity>
        </Tooltip>
      )}

      <CreateTaskModal
        visible={showCreateSheet}
        initialPipelineId={pipeline?.id}
        initialText={seedText}
        initialFiles={seedFiles}
        onClose={() => {
          setShowCreateSheet(false);
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
    </View>
  );
}

export default function TasksScreenWrapper() {
  return (
    <TaskCreationProvider>
      <TasksScreen />
    </TaskCreationProvider>
  );
}
