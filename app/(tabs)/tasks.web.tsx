import KanbanPersonalizer from '@/components/kanban/KanbanPersonalizer';
import TaskCardActions, { type ActiveSessionUser } from '@/components/task-detail/TaskCardActions';
import AssignmentModal from '@/components/tasks/AssignmentModal';
import CreateTaskModal from '@/components/tasks/CreateTaskModal.web';
import { useAuth } from '@/contexts/AuthContext';
import { TaskCreationProvider } from '@/contexts/TaskCreationContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useTimer } from '@/contexts/TimerContext';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { cssInterop } from 'react-native-css-interop';

cssInterop(FontAwesome, {
  className: {
    target: 'style',
    nativeStyleToProp: { color: true, size: true },
  },
} as any);
import {
    ActivityIndicator,
    Image,
    Platform,
    ScrollView,
    Text,
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

type Pipeline = {
  id: string;
  name: string;
  task_visibility_mode: 'all' | 'assigned_only';
};

export function TasksScreenWeb() {
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
  
  // Archival State
  const [archiveModal, setArchiveModal] = useState<{ visible: boolean, taskId: string | null }>({ visible: false, taskId: null });
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  
  const { kanban, theme: activeTheme } = useTheme();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const { user, hasPermission, profile } = useAuth();
  const { pipelineId: paramPipelineId } = useLocalSearchParams();

  const fetchData = async () => {
    try {
      // 1. Resolve Pipeline
      let targetPipelineId = paramPipelineId;
      let pipelineData: any = null;
      if (!targetPipelineId) {
        // Try to restore from storage
        const savedPipelineId = await AsyncStorage.getItem('@TrustFlow_tasks_pipeline');
        if (savedPipelineId) {
          const { data: pSaved } = await supabase.from('pipelines').select('id, name, task_visibility_mode').eq('id', savedPipelineId).single();
          if (pSaved) {
            targetPipelineId = pSaved.id;
            pipelineData = pSaved;
            setPipeline(pSaved);
          }
        }
        // Fall back to default if saved pipeline not found
        if (!targetPipelineId) {
          const { data: pDefault } = await supabase.from('pipelines').select('id, name, task_visibility_mode').eq('is_default', true).limit(1).single();
          targetPipelineId = pDefault?.id;
          pipelineData = pDefault;
          setPipeline(pDefault);
        }
      } else {
        const { data: pSpecific } = await supabase.from('pipelines').select('id, name, task_visibility_mode').eq('id', targetPipelineId).single();
        targetPipelineId = pSpecific?.id;
        pipelineData = pSpecific;
        setPipeline(pSpecific);
      }

      const { data: allPipes } = await supabase.from('pipelines').select('id, name, task_visibility_mode').is('deleted_at', null);
      setAvailablePipelines(allPipes as Pipeline[] || []);

      if (!targetPipelineId) return;

      // 2. Get stages
      const { data: stagesData } = await supabase
        .from('pipeline_stages')
        .select('*, linked_pipeline:linked_pipeline_id(name)')
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

      // 5. Get tasks with time metrics
      const { data: tasksData } = await supabase
        .from('tasks')
        .select(`
          *,
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

  useEffect(() => {
    fetchPulse();
    fetchData();

    const tasksChannel = supabase
      .channel('tasks-board-realtime-web')
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

    return (
      <TouchableOpacity
        key={task.id}
        onPress={() => router.push(`/task/${task.id}`)}
        className="bg-surface-card p-5 rounded-2xl border border-surface-border mb-4 premium-shadow hover:border-brand-primary/50 transition-all relative"
      >
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
                <FontAwesome name="clock-o" size={9} color="var(--color-primary)" />
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
                <FontAwesome name="user-plus" size={10} color="var(--color-text-muted)" />
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
                <FontAwesome name="archive" size={10} color="var(--color-text-muted)" />
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
                      <Text className="text-[10px] text-typography-muted font-black uppercase tracking-widest mb-1">Active Velocity</Text>
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
            <TouchableOpacity onPress={() => setShowPipelinePicker(true)}>
              <View>
                <View className="flex-row items-center mb-2">
                   <View className="bg-brand-primary/10 px-3 py-1 rounded-full border border-brand-primary/20 flex-row items-center">
                      <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest mr-2">{pipeline?.name || 'Pipeline'}</Text>
                      <FontAwesome name="chevron-down" size={8} className="text-brand-primary" />
                   </View>
                </View>
                <Text className="text-typography-main text-5xl font-black tracking-tighter">Task Board</Text>
              </View>
            </TouchableOpacity>
            
            <View className="flex-row gap-4">
               <TouchableOpacity 
                 onPress={() => setShowPersonalizer(true)}
                 className="h-14 w-14 items-center justify-center bg-surface-card border border-surface-border rounded-2xl premium-shadow hover:bg-surface-overlay"
               >
                  <FontAwesome name="paint-brush" size={16} color="var(--color-primary)" />
               </TouchableOpacity>
               <TouchableOpacity 
                 onPress={onRefresh}
                 className="h-14 w-14 items-center justify-center bg-surface-card border border-surface-border rounded-2xl premium-shadow hover:bg-surface-overlay"
               >
                  <FontAwesome name="refresh" size={16} color="var(--color-primary)" />
               </TouchableOpacity>
               {hasPermission('task.create') && (
                 <TouchableOpacity 
                   onPress={handleCreateTask}
                   className="bg-brand-primary px-8 py-4 rounded-2xl premium-shadow active:scale-95 transition-transform flex-row items-center"
                 >
                    <FontAwesome name="plus" size={12} color="white" />
                    <Text className="text-white font-black uppercase tracking-widest text-xs">Create Task</Text>
                 </TouchableOpacity>
               )}
            </View>
          </View>

          {loading ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator size="large" color="var(--color-primary)" />
            </View>
          ) : availablePipelines.length === 0 ? (
            <View className="flex-1 items-center justify-center">
              <View className="bg-surface-card p-12 rounded-[3rem] border border-surface-border items-center max-w-[600px] premium-shadow">
                <View className="w-20 h-20 bg-brand-primary/10 rounded-full items-center justify-center mb-6">
                  <FontAwesome name="sitemap" size={32} color="var(--color-primary)" />
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
                      <FontAwesome name="info-circle" size={20} color="var(--color-info)" style={{ marginTop: 4 }} />
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
                const stageTasks = tasks.filter(t => t.current_stage_id === stage.id);
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
                            <FontAwesome name="bolt" size={8} color="var(--color-primary)" />
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
                           <FontAwesome name="inbox" size={48} color="var(--color-text-muted)" />
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

      {/* PIPELINE PICKER */}
      {showPipelinePicker && (
         <View className="absolute inset-0 bg-surface-background/80 z-[100] items-center justify-center backdrop-blur-md">
            <View className="bg-surface-card w-[500px] rounded-[3rem] border border-surface-border p-10 premium-shadow">
                <Text className="text-typography-main font-black text-3xl mb-2 tracking-tighter">Switch Pipeline</Text>
                <Text className="text-typography-muted text-sm mb-8 font-medium">Select a pipeline to reconfigure the dashboard.</Text>
                
                <ScrollView className="max-h-[400px]">
                   {availablePipelines.map(p => (
                      <TouchableOpacity 
                        key={p.id} 
                        className={`p-6 rounded-2xl mb-3 border transition-all ${pipeline?.id === p.id ? 'bg-brand-primary/10 border-brand-primary' : 'bg-surface-background border-surface-border hover:bg-surface-overlay'}`}
                        onPress={async () => {
                           await AsyncStorage.setItem('@TrustFlow_tasks_pipeline', p.id);
                           router.setParams({ pipelineId: p.id });
                           setShowPipelinePicker(false);
                        }}
                      >
                         <Text className={`font-black text-lg ${pipeline?.id === p.id ? 'text-brand-primary' : 'text-typography-main'}`}>{p.name}</Text>
                      </TouchableOpacity>
                   ))}
                </ScrollView>
                
                <TouchableOpacity onPress={() => setShowPipelinePicker(false)} className="mt-8 py-4 items-center bg-surface-background border border-surface-border rounded-2xl">
                   <Text className="text-typography-muted font-black uppercase tracking-widest text-xs">Cancel Navigation</Text>
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
          <FontAwesome name="exclamation-circle" size={14} color="var(--color-danger)" />
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

export default function TasksScreenWebWrapper() {
  return (
    <TaskCreationProvider>
      <TasksScreenWeb />
    </TaskCreationProvider>
  );
}
