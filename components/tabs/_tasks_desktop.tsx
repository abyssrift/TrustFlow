import KanbanPersonalizer from '@/components/kanban/KanbanPersonalizer';
import TaskCardActions, { type ActiveSessionUser } from '@/components/task-detail/TaskCardActions';
import AssignmentModal from '@/components/tasks/AssignmentModal';
import CreateTaskModal from '@/components/tasks/CreateTaskModal.web';
import { useAuth } from '@/contexts/AuthContext';
import { usePingHighlight } from '@/contexts/PingHighlightContext';
import { TaskCreationProvider } from '@/contexts/TaskCreationContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useTimer } from '@/contexts/TimerContext';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
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
};

type FilterState = {
  priorities: string[];
  categories: string[];
  projectIds: string[];
  managerIds: string[];
};

type Pipeline = {
  id: string;
  name: string;
  task_visibility_mode: 'all' | 'assigned_only';
  is_default?: boolean;
};

type BoardPickerState = {
  favorites: Set<string>;
  recentlyUsed: Array<{ id: string; timestamp: number }>;
  taskCounts: Record<string, number>;
};

const STORAGE_KEYS = {
  LAST_BOARD: '@TrustFlow_last_board_id',
  FAVORITE_BOARDS: '@TrustFlow_favorite_boards',
  RECENTLY_USED_BOARDS: '@TrustFlow_recently_used_boards',
  BOARD_TASK_COUNTS: '@TrustFlow_board_task_counts',
} as const;

const MAX_RECENTLY_USED = 5;

function PingTimeBadge({ pingedAt }: { pingedAt: number }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const secs = Math.floor((Date.now() - pingedAt) / 1000);
  const label = secs < 60 ? 'just now' : secs < 3600 ? `${Math.floor(secs / 60)}m ago` : `${Math.floor(secs / 3600)}h ago`;
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

async function loadBoardPickerState() {
  try {
    const [favStr, recentStr] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEYS.FAVORITE_BOARDS),
      AsyncStorage.getItem(STORAGE_KEYS.RECENTLY_USED_BOARDS),
    ]);
    return {
      favorites: new Set(favStr ? JSON.parse(favStr) : []),
      recentlyUsed: recentStr ? JSON.parse(recentStr) : [],
    };
  } catch {
    return { favorites: new Set(), recentlyUsed: [] };
  }
}

async function saveBoardPickerState(favorites: Set<string>, recentlyUsed: Array<{ id: string; timestamp: number }>) {
  try {
    await Promise.all([
      AsyncStorage.setItem(STORAGE_KEYS.FAVORITE_BOARDS, JSON.stringify(Array.from(favorites))),
      AsyncStorage.setItem(STORAGE_KEYS.RECENTLY_USED_BOARDS, JSON.stringify(recentlyUsed)),
    ]);
  } catch (e) {
    console.error('Failed to save board picker state:', e);
  }
}

function trackBoardSelection(boardId: string, current: Array<{ id: string; timestamp: number }>) {
  const now = Date.now();
  const filtered = current.filter(b => b.id !== boardId);
  const updated = [{ id: boardId, timestamp: now }, ...filtered].slice(0, MAX_RECENTLY_USED);
  return updated;
}

export function TasksScreenWeb() {
  const colors = useThemeColors();
  const { activeSession, lastStoppedAt } = useTimer();

  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [availablePipelines, setAvailablePipelines] = useState<Pipeline[]>([]);
  const [showPipelinePicker, setShowPipelinePicker] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [activeSessions, setActiveSessions] = useState<Record<string, ActiveSessionUser[]>>({});
  const [pulse, setPulse] = useState<PersonalPulse | null>(null);
  const [showAssignmentModal, setShowAssignmentModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [stageActions, setStageActions] = useState<any[]>([]);
  const [showPersonalizer, setShowPersonalizer] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<FilterState>({ priorities: [], categories: [], projectIds: [], managerIds: [] });
  const [searchQuery, setSearchQuery] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const [myTeamIds, setMyTeamIds] = useState<string[]>([]);
  const [myDefaultPipelineId, setMyDefaultPipelineId] = useState<string | null>(null);

  // Archival State
  const [archiveModal, setArchiveModal] = useState<{ visible: boolean, taskId: string | null }>({ visible: false, taskId: null });
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  // Smart Board Picker State
  const [favoriteBoardIds, setFavoriteBoardIds] = useState<Set<string>>(new Set());
  const [recentlyUsedBoards, setRecentlyUsedBoards] = useState<Array<{ id: string; timestamp: number }>>([]);
  const [boardTaskCounts, setBoardTaskCounts] = useState<Record<string, number>>({});
  const [boardLastVisitedTime, setBoardLastVisitedTime] = useState<Record<string, number>>({});
  const [boardNewTaskCount, setBoardNewTaskCount] = useState<Record<string, number>>({});
  const [boardPickerSearchQuery, setBoardPickerSearchQuery] = useState('');

  // Refs for event handlers
  const boardPickerButtonRef = React.useRef<any>(null);
  const wheelTimeoutRef = React.useRef<ReturnType<typeof setTimeout>>();
  
  const { kanban, theme: activeTheme } = useTheme();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const { user, hasPermission, profile } = useAuth();
  const { pipelineId: paramPipelineId } = useLocalSearchParams();

  const { pingedTasks, removePingedTask } = usePingHighlight();

  const fetchData = async () => {
    try {
      // 1. Resolve Pipeline
      let targetPipelineId = paramPipelineId;
      let pipelineData: any = null;
      if (!targetPipelineId) {
        // Try to restore personal default first
        if (!myDefaultPipelineId) {
          const savedMyDefault = await AsyncStorage.getItem('@TrustFlow_my_default_pipeline');
          if (savedMyDefault) {
            setMyDefaultPipelineId(savedMyDefault);
          }
        }
        if (myDefaultPipelineId) {
          const { data: pMyDefault } = await supabase.from('pipelines').select('id, name, task_visibility_mode, is_default').eq('id', myDefaultPipelineId).single();
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

      // 4. Get User Teams (for filtering)
      const { data: myTeams } = await supabase
        .from('team_members')
        .select('team_id')
        .eq('user_id', user?.id)
        .is('removed_at', null);
      const myTeamIds = myTeams?.map(mt => mt.team_id) || [];
      setMyTeamIds(myTeamIds);

      // 5. Get tasks with time metrics
      const { data: tasksData } = await supabase
        .from('tasks')
        .select(`
          *,
          project:project_id(id, name),
          manager:manager_id(id, full_name),
          assignments:task_assignments(
            assignee_user_id,
            assignee_team_id,
            team:assignee_team_id(name),
            user:assignee_user_id(full_name)
          ),
          submission_count:task_submissions(count),
          comment_count:task_comments(count)
        `)
        .eq('pipeline_id', targetPipelineId)
        .order('created_at', { ascending: false });

      const { data: timeMetrics } = await supabase
        .from('view_task_time_metrics')
        .select('*')
        .in('task_id', (tasksData || []).map(t => t.id));

      const timeMap = (timeMetrics || []).reduce((acc, curr) => {
        acc[curr.task_id] = curr;
        return acc;
      }, {} as any);

      // Filter tasks based on visibility mode and attach time metrics
      let filteredTasks = (tasksData || []).map(t => ({
        ...t,
        total_seconds: timeMap[t.id]?.total_seconds || 0,
        my_seconds: timeMap[t.id]?.my_seconds || 0
      }));
      
      const canViewAll = hasPermission('task.view_all') || hasPermission('tasks.view_all') || hasPermission('system.view_all_data') || hasPermission('pipeline.edit');

      if (pipelineData?.task_visibility_mode === 'assigned_only' && !canViewAll) {
        filteredTasks = filteredTasks.filter(t => {
          const isManager = t.manager_id === user?.id;
          const isAssigned = t.assignments?.some((a: any) => 
            (a.assignee_user_id && a.assignee_user_id === user?.id) || 
            (a.assignee_team_id && myTeamIds.includes(a.assignee_team_id))
          );
          return isManager || isAssigned;
        });
      }

      let mentionTaskIds = new Set<string>();
      if (filteredTasks.length > 0) {
        // Fetch mention acknowledgements for this user
        const { data: acks } = await supabase
          .from('task_mention_acks')
          .select('task_id, acknowledged_at')
          .eq('user_id', user?.id)
          .in('task_id', filteredTasks.map(t => t.id));

        const ackMap = new Map(acks?.map(a => [a.task_id, a.acknowledged_at]));

        const variants = Array.from(new Set([
          profile?.full_name,
          profile?.display_name,
          user?.user_metadata?.full_name,
          user?.email?.split('@')[0]
        ].filter(Boolean) as string[]));

        const searchTerms = new Set<string>();
        variants.forEach(v => {
          searchTerms.add(v);
          const first = v.split(' ')[0];
          if (first && first.length > 2) searchTerms.add(first);
        });

        const orQuery = Array.from(searchTerms)
          .map(term => `content.ilike.%@${term}%`)
          .join(',');

        const { data: mentions } = await supabase
          .from('task_comments')
          .select('task_id, created_at')
          .or(orQuery)
          .in('task_id', filteredTasks.map(t => t.id));
        
        mentions?.forEach(m => {
          const lastAck = ackMap.get(m.task_id);
          if (!lastAck || new Date(m.created_at) > new Date(lastAck)) {
            mentionTaskIds.add(m.task_id);
          }
        });
      }

      setTasks(filteredTasks.map(t => ({
        ...t,
        has_mention: mentionTaskIds.has(t.id)
      })) as any);

      // 6. Active Sessions
      const { data: sessions } = await supabase
        .from('task_work_sessions')
        .select('task_id, user_id, started_at, user:user_id(full_name, avatar_url)')
        .eq('status', 'active');
      
      const sessionMap: Record<string, ActiveSessionUser[]> = {};
      sessions?.forEach(s => {
         if (!sessionMap[s.task_id]) sessionMap[s.task_id] = [];
         sessionMap[s.task_id].push({ 
           userId: s.user_id, 
           name: (s.user as any)?.full_name || 'User', 
           avatar: (s.user as any)?.avatar_url,
           startedAt: s.started_at 
         });
      });
      setActiveSessions(sessionMap);

    } catch (err) {
      console.error('[WEB TASK ERROR] Data fetch failed:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchPulse = async () => {
    const { data } = await supabase.rpc('rpc_get_personal_pulse');
    if (data) setPulse(data);
  };

  // Load personal default pipeline on mount
  useEffect(() => {
    const loadPersonalDefault = async () => {
      const saved = await AsyncStorage.getItem('@TrustFlow_my_default_pipeline');
      if (saved) {
        setMyDefaultPipelineId(saved);
      }
    };
    loadPersonalDefault();
  }, []);

  // Load board picker state on mount
  useEffect(() => {
    const initBoardPicker = async () => {
      const state = await loadBoardPickerState();
      setFavoriteBoardIds(state.favorites);
      setRecentlyUsedBoards(state.recentlyUsed);
    };
    initBoardPicker();
  }, []);

  useEffect(() => {
    fetchPulse();
    fetchData();

    const channelName = `tasks-board-realtime-web-${Date.now()}`;
    const tasksChannel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_work_sessions' }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_comments' }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_submissions' }, () => fetchData())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pipeline_stage_history' }, () => fetchData())
      .subscribe();

    return () => {
      supabase.removeChannel(tasksChannel);
    };
  }, [paramPipelineId]);

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
      setArchiveError(err.message || 'Could not update default pipeline.');
      setTimeout(() => setArchiveError(null), 6000);
    }
  };

  const handleCreateTask = () => {
    if (!hasPermission('task.create')) {
      setArchiveError('You do not have permission to create tasks.');
      setTimeout(() => setArchiveError(null), 6000);
      return;
    }
    setShowCreateModal(true);
  };

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
      fetchData();
    } catch (err: any) {
      setArchiveModal({ visible: false, taskId: null });
      setArchiveError(err.message || 'Could not archive task.');
      setTimeout(() => setArchiveError(null), 8000);
    } finally {
      setArchiving(false);
    }
  };

  const handleSelectBoard = async (boardId: string) => {
    try {
      const updated = trackBoardSelection(boardId, recentlyUsedBoards);
      setRecentlyUsedBoards(updated);
      await saveBoardPickerState(favoriteBoardIds, updated);
      await AsyncStorage.setItem(STORAGE_KEYS.LAST_BOARD, boardId);

      // Track when this board was last visited
      setBoardLastVisitedTime(prev => ({
        ...prev,
        [boardId]: Date.now()
      }));

      setShowPipelinePicker(false);
    } catch (e) {
      console.error('Failed to track board selection:', e);
    }
  };

  const toggleFavoriteBoard = async (boardId: string) => {
    try {
      const updated = new Set(favoriteBoardIds);
      if (updated.has(boardId)) {
        updated.delete(boardId);
      } else {
        updated.add(boardId);
      }
      setFavoriteBoardIds(updated);
      await saveBoardPickerState(updated, recentlyUsedBoards);
    } catch (e) {
      console.error('Failed to toggle favorite:', e);
    }
  };

  const getSortedBoards = () => {
    let sorted = [...availablePipelines];

    // Filter by search
    if (boardPickerSearchQuery) {
      const query = boardPickerSearchQuery.toLowerCase();
      sorted = sorted.filter(b => b.name.toLowerCase().includes(query));
    }

    // Sort: favorites first, then recently used, then by name
    return sorted.sort((a, b) => {
      const aFav = favoriteBoardIds.has(a.id) ? 0 : 1;
      const bFav = favoriteBoardIds.has(b.id) ? 0 : 1;
      if (aFav !== bFav) return aFav - bFav;

      const aRecent = recentlyUsedBoards.findIndex(r => r.id === a.id);
      const bRecent = recentlyUsedBoards.findIndex(r => r.id === b.id);
      const aRecentVal = aRecent >= 0 ? aRecent : Infinity;
      const bRecentVal = bRecent >= 0 ? bRecent : Infinity;
      if (aRecentVal !== bRecentVal) return aRecentVal - bRecentVal;

      return a.name.localeCompare(b.name);
    });
  };

  const getCurrentBoardIndex = () => {
    if (!pipeline) return -1;
    return getSortedBoards().findIndex(b => b.id === pipeline.id);
  };

  // Keyboard shortcuts: Ctrl+] (next board), Ctrl+[ (prev board)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const sorted = getSortedBoards();
      if (sorted.length <= 1) return; // Don't navigate if only one board

      // Check if it's actually the bracket keys (not affected by keyboard layout)
      const isCloseBracket = e.key === ']' || e.code === 'BracketRight';
      const isOpenBracket = e.key === '[' || e.code === 'BracketLeft';

      if ((e.ctrlKey || e.metaKey) && isCloseBracket) {
        e.preventDefault();
        const currentIndex = getCurrentBoardIndex();
        const nextIndex = (currentIndex + 1) % sorted.length;
        const nextBoard = sorted[nextIndex];
        if (nextBoard) {
          router.push({ pathname: '/tasks', params: { pipelineId: nextBoard.id } });
          handleSelectBoard(nextBoard.id);
        }
      } else if ((e.ctrlKey || e.metaKey) && isOpenBracket) {
        e.preventDefault();
        const currentIndex = getCurrentBoardIndex();
        const nextIndex = currentIndex === 0 ? sorted.length - 1 : currentIndex - 1;
        const nextBoard = sorted[nextIndex];
        if (nextBoard) {
          router.push({ pathname: '/tasks', params: { pipelineId: nextBoard.id } });
          handleSelectBoard(nextBoard.id);
        }
      }
    };

    if (Platform.OS === 'web') {
      window.addEventListener('keydown', handleKeyDown, true);
      return () => window.removeEventListener('keydown', handleKeyDown, true);
    }
  }, []);

  // Wheel navigation: scroll on board picker button to cycle boards
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (!boardPickerButtonRef.current) return;

      const sorted = getSortedBoards();
      if (sorted.length <= 1) return; // Don't navigate if only one board

      // Check if wheel event target is the board picker button or a child
      const boardPickerElement = boardPickerButtonRef.current;
      const target = e.target as Node;

      if (!boardPickerElement.contains?.(target) && boardPickerElement !== target) return;

      e.preventDefault();

      if (wheelTimeoutRef.current) clearTimeout(wheelTimeoutRef.current);

      wheelTimeoutRef.current = setTimeout(() => {
        const currentIndex = getCurrentBoardIndex();
        const direction = e.deltaY > 0 ? 'next' : 'prev';
        let nextIndex: number;

        if (direction === 'next') {
          nextIndex = (currentIndex + 1) % sorted.length;
        } else {
          nextIndex = currentIndex === 0 ? sorted.length - 1 : currentIndex - 1;
        }

        const nextBoard = sorted[nextIndex];
        if (nextBoard) {
          router.push({ pathname: '/tasks', params: { pipelineId: nextBoard.id } });
          handleSelectBoard(nextBoard.id);
        }
      }, 50);
    };

    if (Platform.OS === 'web') {
      window.addEventListener('wheel', handleWheel, { passive: false, capture: true });
      return () => window.removeEventListener('wheel', handleWheel, true);
    }
  }, []);

  // Fetch task counts for all boards on page load and when pipelines change
  useEffect(() => {
    if (availablePipelines.length === 0) return;

    const updateTaskCounts = async () => {
      try {
        const counts: Record<string, number> = {};
        const newCounts: Record<string, number> = {};

        for (const board of availablePipelines) {
          const { count } = await supabase
            .from('tasks')
            .select('id', { count: 'exact', head: true })
            .eq('pipeline_id', board.id);
          counts[board.id] = count || 0;

          // Count new tasks created after last visit
          const lastVisit = boardLastVisitedTime[board.id] || 0;
          if (lastVisit > 0) {
            const { count: newCount } = await supabase
              .from('tasks')
              .select('id', { count: 'exact', head: true })
              .eq('pipeline_id', board.id)
              .gt('created_at', new Date(lastVisit).toISOString());
            newCounts[board.id] = newCount || 0;
          }
        }
        setBoardTaskCounts(counts);
        setBoardNewTaskCount(newCounts);
      } catch (e) {
        console.error('Failed to fetch task counts:', e);
      }
    };

    updateTaskCounts();
  }, [availablePipelines, boardLastVisitedTime]);

  // Real-time task count updates - listen to task creation/deletion across all pipelines
  useEffect(() => {
    if (availablePipelines.length === 0) return;

    const countChannelName = `board-task-counts-${Date.now()}`;
    const countChannel = supabase
      .channel(countChannelName)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'tasks' },
        (payload) => {
          setBoardTaskCounts(prev => {
            const pipelineId = (payload.new as any).pipeline_id;
            return {
              ...prev,
              [pipelineId]: (prev[pipelineId] || 0) + 1
            };
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'tasks' },
        (payload) => {
          setBoardTaskCounts(prev => {
            const pipelineId = (payload.old as any).pipeline_id;
            return {
              ...prev,
              [pipelineId]: Math.max(0, (prev[pipelineId] || 0) - 1)
            };
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(countChannel);
    };
  }, [availablePipelines]);

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
    filters.managerIds.length;

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
    setFilters({ priorities: [], categories: [], projectIds: [], managerIds: [] });

  const getPriorityInfo = (priority: string) => {
    switch (priority) {
      case 'urgent': return { textClass: 'text-state-danger', label: 'Urgent' };
      case 'high': return { textClass: 'text-state-warning', label: 'High' };
      case 'low': return { textClass: 'text-state-success', label: 'Low' };
      default: return { textClass: 'text-typography-muted', label: 'Normal' };
    }
  };

  const formatSeconds = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
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
    return (
      <TouchableOpacity
        key={task.id}
        onPress={() => {
          if (isPinged) removePingedTask(task.id);
          router.push(`/task/${task.id}`);
        }}
        className="bg-surface-card p-5 rounded-2xl mb-4 premium-shadow hover:border-brand-primary/50 transition-all relative"
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
        <View className="flex-row items-center justify-between mb-3">
          <View className="flex-row items-center gap-2">
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
              <View className="bg-brand-primary/10 px-2.5 py-1 rounded-lg border border-brand-primary/20 flex-row items-center gap-1">
                <FontAwesome name="clock-o" size={9} className="text-brand-primary" />
                <Text className="text-brand-primary text-[10px] font-black">{formatSeconds(displayMySeconds)}</Text>
              </View>
            )}
            {canViewAllData && displayTotalSeconds > 0 && displayMySeconds !== displayTotalSeconds && (
              <View className="bg-surface-background px-2.5 py-1 rounded-lg border border-surface-border flex-row items-center gap-1">
                <FontAwesome name="users" size={9} className="text-typography-muted" />
                <Text className="text-typography-muted text-[10px] font-black">{formatSeconds(displayTotalSeconds)}</Text>
              </View>
            )}
            {(task.submission_count?.[0]?.count ?? 0) > 0 && (
              <View className="bg-brand-primary/10 px-2.5 py-1 rounded-lg border border-brand-primary/20 flex-row items-center gap-1">
                <FontAwesome name="send" size={9} className="text-brand-primary" />
                <Text className="text-brand-primary text-[10px] font-black">{task.submission_count?.[0]?.count}</Text>
              </View>
            )}
            {(task.comment_count?.[0]?.count ?? 0) > 0 && (
              <View className="bg-surface-background px-2.5 py-1 rounded-lg border border-surface-border flex-row items-center gap-1">
                <FontAwesome name="comment-o" size={9} className="text-typography-muted" />
                <Text className="text-typography-muted text-[10px] font-black">{task.comment_count?.[0]?.count}</Text>
              </View>
            )}
          </View>

          <View className="flex-row items-center gap-1.5">
            {hasPermission('task.assign') && (
              <TouchableOpacity
                onPress={() => handleOpenAssignments(task)}
                className="w-7 h-7 items-center justify-center rounded-xl bg-surface-background border border-surface-border hover:bg-brand-primary/10 transition-colors"
              >
                <FontAwesome name="user-plus" size={10} className="text-typography-muted" />
              </TouchableOpacity>
            )}
            {(profile?.is_owner || hasPermission('archive:create') || hasPermission('pipeline.edit')) && (
              <TouchableOpacity
                onPress={() => {
                  const isCoolingDown = lastStoppedAt && (Date.now() - new Date(lastStoppedAt).getTime() < 35000);
                  if (activeSession?.task_id === task.id || isCoolingDown) {
                    setArchiveError('System is finalizing work logs. Please wait 30 seconds after stopping your timer before archiving.');
                    setTimeout(() => setArchiveError(null), 6000);
                    return;
                  }
                  setArchiveModal({ visible: true, taskId: task.id });
                }}
                className={`w-7 h-7 items-center justify-center rounded-xl border border-surface-border transition-colors ${activeSession?.task_id === task.id ? 'opacity-30 cursor-not-allowed bg-surface-card' : 'bg-surface-background hover:bg-state-warning/10'}`}
              >
                <FontAwesome name="archive" size={10} className="text-typography-muted" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        <Text className="text-typography-main font-black text-lg mb-1">{task.title}</Text>
        {task.category && (
          <Text className="text-typography-dim text-[10px] font-bold uppercase tracking-wider mb-2">{task.category}</Text>
        )}
        <Text className="text-typography-muted text-sm leading-relaxed mb-4" numberOfLines={2}>
          {task.description || 'No description.'}
        </Text>
        
        {kanban.showAvatars && activeSessions[task.id] && activeSessions[task.id].length > 0 && (
          <View className="flex-row items-center mb-4 bg-state-success/10 p-2 rounded-xl border border-state-success/20">
            <View className="w-2 h-2 rounded-full bg-state-success mr-3 pulse-animation" />
            <Text className="text-state-success text-[10px] font-black uppercase tracking-widest">
              {activeSessions[task.id][0].name} {activeSessions[task.id].length > 1 ? `+${activeSessions[task.id].length - 1}` : 'is active'}
            </Text>
          </View>
        )}

        <View className="pt-4 border-t border-surface-border/50">
          <TaskCardActions
            task={task}
            stages={stages}
            stageActions={stageActions}
            activeSessions={activeSessions}
            userId={user?.id || ''}
            onRefresh={fetchData}
          />
        </View>
      </TouchableOpacity>
    );
  };


  return (
    <View className="flex-1 bg-surface-background">
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
                         <Text className="text-2xl font-black text-typography-main">{Math.floor(pulse.active_seconds_today / 3600)}h</Text>
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
          <View className="mb-10 flex-row items-center justify-between">
            <TouchableOpacity
              ref={boardPickerButtonRef}
              onPress={() => setShowPipelinePicker(true)}
              onWheel={(e: any) => {
                const event = e as WheelEvent;
                if (!boardPickerButtonRef.current) return;
                const sorted = getSortedBoards();
                if (sorted.length === 0) return;
                const currentIndex = getCurrentBoardIndex();
                const direction = event.deltaY > 0 ? 'next' : 'prev';
                let nextIndex: number;

                if (direction === 'next') {
                  nextIndex = (currentIndex + 1) % sorted.length;
                } else {
                  nextIndex = currentIndex === 0 ? sorted.length - 1 : currentIndex - 1;
                }

                const nextBoard = sorted[nextIndex];
                if (nextBoard) {
                  router.push({ pathname: '/tasks', params: { pipelineId: nextBoard.id } });
                  handleSelectBoard(nextBoard.id);
                }
              }}
            >
              <View>
                <View className="flex-row items-center mb-2">
                   <View className="bg-brand-primary/10 px-3 py-1 rounded-full border border-brand-primary/20 flex-row items-center relative">
                      <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest mr-2">{pipeline?.name || 'Pipeline'}</Text>
                      <FontAwesome name="chevron-down" size={8} className="text-brand-primary" />
                      {Object.values(boardTaskCounts).some((count, idx) => {
                        const boardId = availablePipelines[idx]?.id;
                        return boardId !== pipeline?.id && count > 0;
                      }) && (
                        <View className="absolute -top-2 -right-2 bg-state-danger rounded-full w-5 h-5 items-center justify-center border-2 border-surface-card">
                          <Text className="text-white text-[9px] font-black">!</Text>
                        </View>
                      )}
                   </View>
                </View>
                <Text className="text-typography-main text-5xl font-black tracking-tighter">Task Board</Text>
              </View>
            </TouchableOpacity>
            
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
                   <TouchableOpacity onPress={() => setSearchQuery('')}>
                     <FontAwesome name="times" size={12} className="text-typography-muted" />
                   </TouchableOpacity>
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
               <TouchableOpacity
                 onPress={() => setShowPersonalizer(true)}
                 className="h-14 w-14 items-center justify-center bg-surface-card border border-surface-border rounded-2xl premium-shadow hover:bg-surface-overlay"
               >
                 <FontAwesome name="paint-brush" size={16} className="text-brand-primary" />
               </TouchableOpacity>
               <TouchableOpacity
                 onPress={() => setShowFilters(v => !v)}
                 className={`h-14 px-4 items-center justify-center flex-row gap-2 border rounded-2xl premium-shadow transition-all ${showFilters || activeFilterCount > 0 ? 'bg-brand-primary/10 border-brand-primary' : 'bg-surface-card border-surface-border hover:bg-surface-overlay'}`}
               >
                 <FontAwesome name="sliders" size={14} className={showFilters || activeFilterCount > 0 ? 'text-brand-primary' : 'text-typography-muted'} />
                 {activeFilterCount > 0 && (
                   <View className="bg-brand-primary rounded-full w-5 h-5 items-center justify-center">
                     <Text className="text-white text-[10px] font-black">{activeFilterCount}</Text>
                   </View>
                 )}
               </TouchableOpacity>
               <TouchableOpacity
                 onPress={onRefresh}
                 className="h-14 w-14 items-center justify-center bg-surface-card border border-surface-border rounded-2xl premium-shadow hover:bg-surface-overlay"
               >
                 <FontAwesome name="refresh" size={16} className="text-brand-primary" />
               </TouchableOpacity>
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

          {/* Filter Panel */}
          {showFilters && (
            <View className="mb-6 bg-surface-card border border-surface-border rounded-2xl p-5 premium-shadow">
              <View className="flex-row items-center justify-between mb-4">
                <Text className="text-typography-main font-black text-sm uppercase tracking-widest">Filters</Text>
                {activeFilterCount > 0 && (
                  <TouchableOpacity onPress={clearFilters} className="flex-row items-center gap-1.5 bg-state-danger/10 border border-state-danger/20 px-3 py-1.5 rounded-xl">
                    <FontAwesome name="times" size={10} className="text-state-danger" />
                    <Text className="text-state-danger text-[10px] font-black uppercase tracking-wider">Clear All</Text>
                  </TouchableOpacity>
                )}
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View className="flex-row gap-8">
                  {/* Priority */}
                  <View>
                    <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Priority</Text>
                    <View className="flex-row gap-2">
                      {(['urgent', 'high', 'normal', 'low'] as const).map(p => {
                        const active = filters.priorities.includes(p);
                        const info = getPriorityInfo(p);
                        return (
                          <TouchableOpacity
                            key={p}
                            onPress={() => toggleFilter('priorities', p)}
                            className={`px-3 py-1.5 rounded-xl border transition-all ${active ? 'bg-brand-primary/10 border-brand-primary' : 'bg-surface-background border-surface-border hover:border-brand-primary/40'}`}
                          >
                            <Text className={`text-[11px] font-black uppercase tracking-wider ${active ? 'text-brand-primary' : info.textClass}`}>{info.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>

                  {/* Category */}
                  {filterOptions.categories.length > 0 && (
                    <View>
                      <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Category</Text>
                      <View className="flex-row gap-2">
                        {filterOptions.categories.map(cat => {
                          const active = filters.categories.includes(cat);
                          return (
                            <TouchableOpacity
                              key={cat}
                              onPress={() => toggleFilter('categories', cat)}
                              className={`px-3 py-1.5 rounded-xl border transition-all ${active ? 'bg-brand-primary/10 border-brand-primary' : 'bg-surface-background border-surface-border hover:border-brand-primary/40'}`}
                            >
                              <Text className={`text-[11px] font-black uppercase tracking-wider ${active ? 'text-brand-primary' : 'text-typography-muted'}`}>{cat}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                  )}

                  {/* Project */}
                  {filterOptions.projects.length > 0 && (
                    <View>
                      <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Project</Text>
                      <View className="flex-row gap-2">
                        {filterOptions.projects.map(proj => {
                          const active = filters.projectIds.includes(proj.id);
                          return (
                            <TouchableOpacity
                              key={proj.id}
                              onPress={() => toggleFilter('projectIds', proj.id)}
                              className={`px-3 py-1.5 rounded-xl border transition-all ${active ? 'bg-brand-primary/10 border-brand-primary' : 'bg-surface-background border-surface-border hover:border-brand-primary/40'}`}
                            >
                              <Text className={`text-[11px] font-black uppercase tracking-wider ${active ? 'text-brand-primary' : 'text-typography-muted'}`}>{proj.name}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                  )}

                  {/* Manager */}
                  {filterOptions.managers.length > 0 && (
                    <View>
                      <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Manager</Text>
                      <View className="flex-row gap-2">
                        {filterOptions.managers.map(mgr => {
                          const active = filters.managerIds.includes(mgr.id);
                          return (
                            <TouchableOpacity
                              key={mgr.id}
                              onPress={() => toggleFilter('managerIds', mgr.id)}
                              className={`px-3 py-1.5 rounded-xl border transition-all ${active ? 'bg-brand-primary/10 border-brand-primary' : 'bg-surface-background border-surface-border hover:border-brand-primary/40'}`}
                            >
                              <Text className={`text-[11px] font-black uppercase tracking-wider ${active ? 'text-brand-primary' : 'text-typography-muted'}`}>{mgr.full_name}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                  )}
                </View>
              </ScrollView>
            </View>
          )}

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
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={true}
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
                  if (searchQuery && !t.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
                  if (mineOnly && t.manager_id !== user?.id && !t.assignments?.some((a: any) =>
                    a.assignee_user_id === user?.id ||
                    (a.assignee_team_id && myTeamIds.includes(a.assignee_team_id))
                  )) return false;
                  return true;
                });
                return (
                  <View key={stage.id} className="w-[380px] mr-8 h-full">
                    <View className="flex-row items-center justify-between mb-6 px-3">
                      <View className="flex-row items-center">
                        <View style={{ backgroundColor: stage.color }} className="w-3 h-3 rounded-full mr-3 shadow-sm shadow-black/50" />
                        <Text className="text-typography-main font-black text-sm uppercase tracking-[0.2em]">{stage.name}</Text>
                        {kanban.showStageTotals && (
                          <View className="ml-3 bg-surface-card border border-surface-border px-2 py-0.5 rounded-lg">
                            <Text className="text-typography-muted text-[10px] font-black">{stageTasks.length}</Text>
                          </View>
                        )}
                      </View>
                      
                      {stage.linked_pipeline && (
                         <View className="flex-row items-center border border-brand-primary/30 bg-brand-primary/10 px-2 py-0.5 rounded-full">
                            <FontAwesome name="bolt" size={8} className="text-brand-primary" />
                            <Text className="text-brand-primary text-[8px] font-black ml-1 uppercase">Pushes to {stage.linked_pipeline.name}</Text>
                         </View>
                      )}
                    </View>
                    
                    <ScrollView 
                      className={`flex-1 rounded-[2.5rem] p-4 border ${
                        kanban.isVibrant ? 'bg-brand-primary/5 border-brand-primary/20' : 'bg-surface-card/30 border-surface-border/50'
                      }`}
                      showsVerticalScrollIndicator={false}
                    >
                      {stageTasks.length === 0 ? (
                        <View className="py-20 items-center justify-center opacity-20">
                           <FontAwesome name="inbox" size={48} className="text-typography-muted" />
                           <Text className="text-typography-muted text-xs mt-6 font-black uppercase tracking-widest">No Active Tasks</Text>
                        </View>
                      ) : (
                        stageTasks.map(renderTaskCard)
                      )}
                    </ScrollView>
                  </View>
                );
              })}
            </ScrollView>
          )}
        </View>
      </View>

      {/* PIPELINE PICKER - SMART BOARD SELECTOR */}
      {showPipelinePicker && (
         <View className="absolute inset-0 bg-surface-background/80 z-[100] items-center justify-center backdrop-blur-md p-6">
            <View className="bg-surface-card w-full max-w-[900px] rounded-[3rem] border border-surface-border p-10 premium-shadow max-h-[90vh] flex-1 flex-col">
                <View className="mb-6">
                  <Text className="text-typography-main font-black text-3xl mb-2 tracking-tighter">Switch Board</Text>
                  <Text className="text-typography-muted text-sm font-medium">Tip: Use Ctrl+] / Ctrl+[ or scroll on the board name to switch</Text>
                </View>

                {/* Search Input */}
                <View className="mb-6 h-11 px-4 flex-row items-center bg-surface-background border border-surface-border rounded-2xl">
                  <FontAwesome name="search" size={12} className="text-typography-muted" />
                  <TextInput
                    value={boardPickerSearchQuery}
                    onChangeText={setBoardPickerSearchQuery}
                    placeholder="Search boards..."
                    placeholderTextColor={colors.textDim}
                    className="flex-1 ml-3 text-typography-main text-sm font-bold"
                  />
                  {boardPickerSearchQuery.length > 0 && (
                    <TouchableOpacity onPress={() => setBoardPickerSearchQuery('')}>
                      <FontAwesome name="times" size={10} className="text-typography-muted" />
                    </TouchableOpacity>
                  )}
                </View>

                {/* Boards List */}
                <ScrollView className="flex-1 min-h-[400px]">
                    {getSortedBoards().map((p, index) => {
                       const isCurrent = pipeline?.id === p.id;
                       const isFavorite = favoriteBoardIds.has(p.id);
                       const isRecent = recentlyUsedBoards.some(r => r.id === p.id);
                       const taskCount = boardTaskCounts[p.id] || 0;
                       const hasActivity = taskCount > 0;

                       return (
                         <View
                           key={p.id}
                           className={`flex-row items-center mb-3 rounded-2xl border overflow-hidden transition-all ${isCurrent ? 'bg-brand-primary/10 border-brand-primary' : hasActivity ? 'bg-surface-background border-state-warning/50 hover:border-state-warning' : 'bg-surface-background border-surface-border hover:border-brand-primary/50'}`}
                         >
                           <TouchableOpacity
                             className="flex-1 p-4"
                             onPress={async () => {
                                await AsyncStorage.setItem('@TrustFlow_tasks_pipeline', p.id);
                                router.push({ pathname: '/tasks', params: { pipelineId: p.id } });
                                await handleSelectBoard(p.id);
                             }}
                           >
                             <View className="flex-row items-center justify-between">
                               <View className="flex-1">
                                 <View className="flex-row items-center gap-2">
                                   {hasActivity && !isCurrent && (
                                     <View className="w-2 h-2 rounded-full bg-state-warning pulse-animation" />
                                   )}
                                   <Text className={`font-black text-base ${isCurrent ? 'text-brand-primary' : 'text-typography-main'}`}>{p.name}</Text>
                                 </View>
                                 <View className="flex-row gap-2 mt-1.5">
                                   {isFavorite && (
                                     <View className="bg-brand-primary/10 px-2 py-0.5 rounded-full border border-brand-primary/20">
                                       <Text className="text-brand-primary text-[9px] font-black uppercase">⭐ Favorited</Text>
                                     </View>
                                   )}
                                   {p.is_default && (
                                     <View className="bg-surface-overlay px-2 py-0.5 rounded-full border border-surface-border">
                                       <Text className="text-typography-muted text-[9px] font-bold uppercase">Workspace Default</Text>
                                     </View>
                                   )}
                                   {myDefaultPipelineId === p.id && (
                                     <View className="bg-state-success/10 px-2 py-0.5 rounded-full border border-state-success/20">
                                       <Text className="text-state-success text-[9px] font-bold uppercase">My Default</Text>
                                     </View>
                                   )}
                                 </View>
                               </View>
                               {!isCurrent && boardTaskCounts[p.id] !== undefined && boardTaskCounts[p.id] > 0 && (
                                 <View className={`ml-3 px-4 py-1.5 rounded-full border-2 ${boardNewTaskCount[p.id] && boardNewTaskCount[p.id] > 0 ? 'bg-state-danger border-state-danger' : 'bg-state-warning border-state-warning'}`}>
                                   <Text className={`text-[13px] font-black ${boardNewTaskCount[p.id] && boardNewTaskCount[p.id] > 0 ? 'text-white' : 'text-black'}`}>{boardTaskCounts[p.id]}</Text>
                                 </View>
                               )}
                             </View>
                           </TouchableOpacity>

                           {/* Star/Favorite Button */}
                           <TouchableOpacity
                             onPress={() => toggleFavoriteBoard(p.id)}
                             className="px-3 py-4 items-center justify-center hover:bg-surface-overlay transition-colors"
                             title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                           >
                             <FontAwesome
                               name={isFavorite ? 'star' : 'star-o'}
                               size={14}
                               color={isFavorite ? colors.primary : colors.textMuted}
                             />
                           </TouchableOpacity>

                           {/* Personal Default Heart */}
                           <TouchableOpacity
                             onPress={async () => {
                               await AsyncStorage.setItem('@TrustFlow_my_default_pipeline', p.id);
                               setMyDefaultPipelineId(p.id);
                             }}
                             className="px-3 py-4 items-center justify-center border-l border-surface-border/50 hover:bg-surface-overlay transition-colors"
                             title="Set as my default"
                           >
                             <FontAwesome
                               name={myDefaultPipelineId === p.id ? 'heart' : 'heart-o'}
                               size={14}
                               color={myDefaultPipelineId === p.id ? colors.success : colors.textMuted}
                             />
                           </TouchableOpacity>

                         </View>
                       );
                    })}
                 </ScrollView>

                {/* Icon Legend */}
                <View className="mt-6 p-4 bg-surface-background rounded-2xl border border-surface-border/50">
                  <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-3">Icon Guide (Clickable)</Text>
                  <View className="gap-2">
                    <View className="flex-row items-center gap-2">
                      <FontAwesome name="star" size={12} className="text-brand-primary" />
                      <Text className="text-typography-muted text-[10px] font-medium">Star = Add to favorites (sort to top)</Text>
                    </View>
                    <View className="flex-row items-center gap-2">
                      <FontAwesome name="heart" size={12} className="text-state-success" />
                      <Text className="text-typography-muted text-[10px] font-medium">Heart = Set as your personal default</Text>
                    </View>
                  </View>
                </View>

                <TouchableOpacity onPress={() => {
                  setShowPipelinePicker(false);
                  setBoardPickerSearchQuery('');
                }} className="mt-4 py-4 items-center bg-surface-background border border-surface-border rounded-2xl hover:border-brand-primary/30 transition-colors">
                   <Text className="text-typography-muted font-black uppercase tracking-widest text-xs">Close</Text>
                </TouchableOpacity>
            </View>
         </View>
      )}

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
        onClose={() => {
          setShowCreateModal(false);
          fetchData();
        }} 
      />

      {archiveError && (
        <View className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-state-danger/10 border border-state-danger/30 rounded-2xl px-6 py-4 flex-row items-center gap-3 premium-shadow">
          <FontAwesome name="exclamation-circle" size={14} className="text-state-danger" />
          <Text className="text-state-danger font-bold text-sm">
            <Text className="font-black uppercase tracking-wider">Archival Failed: </Text>
            {archiveError}
          </Text>
        </View>
      )}

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
    </View>
  );
}

import ConfirmModal from '@/components/common/ConfirmModal';
import { useThemeColors } from '@/hooks/useThemeColors';

export default function TasksScreenWebWrapper() {
  const colors = useThemeColors();
  return (
    <TaskCreationProvider>
      <TasksScreenWeb />
    </TaskCreationProvider>
  );
}
