import React, { useEffect, useState, useRef } from 'react';
import { 
  View, Text, ScrollView, RefreshControl, 
  TouchableOpacity, ActivityIndicator, Alert, 
  useWindowDimensions, Platform 
} from 'react-native';
import HorizontalScroll from '@/components/common/HorizontalScroll';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import TaskCardActions, { type ActiveSessionUser } from '@/components/task-detail/TaskCardActions';
import { useTheme } from '@/contexts/ThemeContext';
import KanbanPersonalizer from '@/components/kanban/KanbanPersonalizer';
import { Image } from 'react-native';
import { getPrimaryColor, getMutedColor } from '@/lib/themeColors';
import CreateTaskSheet from '@/components/tasks/CreateTaskSheet';
import { TaskCreationProvider, useTaskCreation } from '@/contexts/TaskCreationContext';
import AssignmentModal from '@/components/tasks/AssignmentModal';

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
};

type Pipeline = {
  id: string;
  name: string;
};

function TasksScreen() {
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [availablePipelines, setAvailablePipelines] = useState<Pipeline[]>([]);
  const [showPipelinePicker, setShowPipelinePicker] = useState(false);
  const [activeSessions, setActiveSessions] = useState<Record<string, ActiveSessionUser[]>>({}); // task_id -> [{name, avatar}]
  const [pulse, setPulse] = useState<PersonalPulse | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showAssignmentModal, setShowAssignmentModal] = useState(false);
  const [stageActions, setStageActions] = useState<any[]>([]);
  const [showPersonalizer, setShowPersonalizer] = useState(false);
  const [showCreateSheet, setShowCreateSheet] = useState(false);
  
  const { kanban } = useTheme();
  
   const { width } = useWindowDimensions();
   const { theme: activeTheme } = useTheme();
   const router = useRouter();
   const { user, hasPermission } = useAuth();
   const { pipelineId: paramPipelineId } = useLocalSearchParams();
   const isLargeScreen = width > 768;



  const fetchData = async () => {
    try {
      // 1. Get default pipeline
      const { data: pipelineData, error: pError } = await supabase
        .from('pipelines')
        .select('id, name')
        .eq('is_default', true)
        .limit(1)
        .single();

      if (pError) throw pError;
      setPipeline(pipelineData);
      
      const { data: allPipes } = await supabase.from('pipelines').select('id, name').is('deleted_at', null);
      setAvailablePipelines(allPipes || []);

      // 2. Get stages
      const { data: stagesData, error: sError } = await supabase
        .from('pipeline_stages')
        .select('*, linked_pipeline:linked_pipeline_id(name)')
        .eq('pipeline_id', pipelineData.id)
        .order('position', { ascending: true });

      if (sError) throw sError;
      setStages(stagesData || []);

      // 3. Get stage actions
      const { data: actionsData } = await supabase
        .from('pipeline_stage_actions')
        .select('*')
        .in('stage_id', (stagesData || []).map(s => s.id));
      setStageActions(actionsData || []);

      // 4. Get tasks with assignments
      const { data: tasksData, error: tError } = await supabase
        .from('tasks')
        .select(`
          *,
          assignments:task_assignments(
            assignee_user_id,
            assignee_team_id,
            team:assignee_team_id(name),
            user:assignee_user_id(full_name)
          )
        `)
        .eq('pipeline_id', pipelineData.id)
        .order('created_at', { ascending: false });

      if (tError) throw tError;
      setTasks(tasksData || [] as any);

      // 5. Get Active Work Sessions with User details
      const { data: sessions } = await supabase
        .from('task_work_sessions')
        .select(`
          task_id,
          user_id,
          started_at,
          user:user_id(full_name, avatar_url)
        `)
        .eq('status', 'active');
      
      const sessionMap: Record<string, ActiveSessionUser[]> = {};
      sessions?.forEach(s => {
         if (!sessionMap[s.task_id]) sessionMap[s.task_id] = [];
         sessionMap[s.task_id].push({ 
           userId: s.user_id,
           name: (s.user as any)?.full_name || 'User', 
           avatar: (s.user as any)?.avatar_url,
           startedAt: s.started_at,
         });
      });
      setActiveSessions(sessionMap);

      console.log('Successfully fetched pipeline, stages, actions, and tasks.');
    } catch (err: any) {
      console.error('[DATABASE ERROR] Error fetching task data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Effect to handle pipelineId changes from search params
  useEffect(() => {
    if (paramPipelineId && typeof paramPipelineId === 'string') {
      const switchPipeline = async () => {
        setLoading(true);
        const { data } = await supabase.from('pipelines').select('id, name').eq('id', paramPipelineId).single();
        if (data) {
          setPipeline(data);
          // Fetch stages and tasks for this specific pipeline
          const { data: sData } = await supabase.from('pipeline_stages').select('*, linked_pipeline:linked_pipeline_id(name)').eq('pipeline_id', data.id).order('position');
          setStages(sData || []);
          const { data: tData } = await supabase.from('tasks').select('*, assignments:task_assignments(*, team:assignee_team_id(name), user:assignee_user_id(full_name))').eq('pipeline_id', data.id);
          setTasks(tData || [] as any);
        }
        setLoading(false);
      };
      switchPipeline();
    }
  }, [paramPipelineId]);

  const fetchPulse = async () => {
    const { data } = await supabase.rpc('rpc_get_personal_pulse');
    if (data) setPulse(data);
  };

  useEffect(() => {
    fetchPulse();
    fetchData();

    // REALTIME SUBSCRIPTIONS
    const tasksChannel = supabase
      .channel('tasks-board-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, (payload) => {
        console.log('Task change detected:', payload.event);
        fetchData(); // Simplest approach: refetch on any task change for consistency
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_work_sessions' }, (payload) => {
        console.log('Work session change detected');
        fetchData();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pipeline_stage_history' }, (payload) => {
        console.log('Stage history insertion detected');
        fetchData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(tasksChannel);
    };
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchPulse();
    fetchData();
  };

  const handleCreateTask = () => {
    if (!hasPermission('task.create')) {
      Alert.alert('Access Denied', 'Your current authorization level does not permit task initialization.');
      return;
    }
    setShowCreateSheet(true);
  };

  // handleAdvanceTask removed — logic moved to TaskCardActions component

  const handleOpenAssignments = (task: Task) => {
    setSelectedTask(task);
    setShowAssignmentModal(true);
  };

  const getPriorityInfo = (priority: string) => {
    switch (priority) {
      case 'urgent': return { color: 'rgb(var(--state-danger))', label: 'Urgent' };
      case 'high': return { color: 'rgb(var(--state-warning))', label: 'High' };
      case 'low': return { color: 'rgb(var(--state-success))', label: 'Low' };
      default: return { color: 'rgb(var(--text-muted))', label: 'Normal' };
    }
  };

  const renderTaskCard = (task: Task) => {
    const prio = getPriorityInfo(task.priority);
    return (
      <TouchableOpacity
        key={task.id}
        onPress={() => router.push(`/task/${task.id}`)}
        activeOpacity={0.7}
        className="bg-surface-card p-4 rounded-2xl border border-surface-border mb-3 premium-shadow"
      >
        <View className="flex-row items-center justify-between mb-2">
           <View className="bg-surface-background px-2 py-0.5 rounded-md border border-surface-border">
              <Text style={{ color: prio.color }} className="text-[9px] font-black uppercase tracking-tighter">
                {prio.label}
              </Text>
           </View>
           {task.category && (
              <Text className="text-typography-dim text-[10px] font-bold">{task.category}</Text>
           )}
            {task.parent_task_id && (
              <View className="bg-brand-primary/20 px-1 rounded-sm ml-2">
                <Text className="text-brand-primary text-[8px] font-black italic">SUB</Text>
              </View>
            )}
        </View>

        {/* TEAM ASSIGNMENT BADGES */}
        <View className="flex-row flex-wrap gap-1 mb-2">
           {task.assignments?.filter(a => a.assignee_team_id).map((a, idx) => (
              <View key={idx} className="bg-surface-overlay px-1.5 py-0.5 rounded-md border border-surface-border">
                 <Text className="text-typography-muted text-[8px] font-bold uppercase tracking-tight">Team: {a.team?.name}</Text>
              </View>
           ))}
        </View>

        <Text className="text-typography-main font-bold text-base mb-1">{task.title}</Text>
        
         {/* ACTIVE WORK INDICATOR - Avatar Refined */}
        {kanban.showAvatars && activeSessions[task.id] && activeSessions[task.id].length > 0 && (
          <View className="flex-row items-center mb-3">
             <View className="relative">
                <View className="w-6 h-6 rounded-full bg-brand-primary/10 overflow-hidden border-2 border-state-success">
                   {activeSessions[task.id][0].avatar ? (
                      <Image source={{ uri: activeSessions[task.id][0].avatar }} className="w-full h-full" />
                   ) : (
                      <View className="flex-1 items-center justify-center bg-brand-primary/20">
                         <Text className="text-brand-primary text-[8px] font-black">{activeSessions[task.id][0].name.charAt(0)}</Text>
                      </View>
                   )}
                </View>
                <View className="absolute -right-0.5 -bottom-0.5 w-2 h-2 rounded-full bg-state-success border-2 border-surface-card" />
             </View>
             <Text className="text-state-success text-[10px] font-bold ml-2">
                {activeSessions[task.id][0].name} {activeSessions[task.id].length > 1 ? `+${activeSessions[task.id].length - 1} more` : 'is active'}
             </Text>
          </View>
        )}

        <Text className="text-typography-muted text-xs leading-4 mb-3" numberOfLines={2}>
          {task.description || 'No description provided.'}
        </Text>
        
        <View className="pt-3 border-t border-surface-border/50">
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

  const renderStageColumn = (stage: Stage) => {
    const stageTasks = tasks.filter(t => t.current_stage_id === stage.id);
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
                <View className="ml-2 bg-surface-overlay px-1.5 rounded-md">
                  <Text className="text-typography-muted text-[10px] font-bold">{stageTasks.length}</Text>
                </View>
              )}
           </View>
           
           {/* STAGE PUSH BADGE */}
            {stage.linked_pipeline && (
               <View className="flex-row items-center border border-brand-primary/30 bg-brand-primary/10 px-2 py-0.5 rounded-full">
                  <FontAwesome name="bolt" size={8} color={getPrimaryColor(activeTheme)} />
                  <Text className="text-brand-primary text-[8px] font-black ml-1 uppercase">Pushes to {stage.linked_pipeline.name}</Text>
               </View>
            )}

            <TouchableOpacity>
               <FontAwesome name="ellipsis-h" size={14} className="text-typography-muted" />
            </TouchableOpacity>
        </View>
        
        <ScrollView 
          className={`flex-1 rounded-3xl p-2 ${
            kanban.isVibrant ? 'bg-brand-primary/10 border border-brand-primary/20' : 'bg-surface-background/50'
          }`} 
          showsVerticalScrollIndicator={false}
        >
          {stageTasks.length === 0 ? (
            <View className="py-10 items-center justify-center opacity-30">
               <FontAwesome name="inbox" size={32} className="text-typography-muted" />
               <Text className="text-typography-muted text-xs mt-2">Empty</Text>
            </View>
          ) : (
            stageTasks.map(renderTaskCard)
          )}
        </ScrollView>
      </View>
    );
  };

  if (loading && !refreshing) {
    return (
      <View className="flex-1 bg-surface-background items-center justify-center">
        <ActivityIndicator size="large" color="rgb(var(--brand-primary))" />
      </View>
    );
  }

   return (
     <View className="flex-1 bg-surface-background">
      
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
              backdropFilter: Platform.OS === 'web' ? `blur(${kanban.bgBlur}px)` : undefined
            }} 
          />
        </View>
      )}

      {/* PERFORMANCE PULSE HEADER */}
      {kanban.showPulse && pulse && (
         <View className={`px-5 py-3 ${kanban.backgroundUrl ? 'bg-surface-background/40' : 'bg-brand-primary/5'} border-b border-surface-border`}>
            <View className="flex-row items-center justify-between">
               <View className="flex-row items-center space-x-6">
                  <View>
                     <Text className="text-[9px] text-brand-primary font-black uppercase tracking-tighter mb-0.5">Today''s Pulse</Text>
                     <View className="flex-row items-baseline">
                        <Text className="text-lg font-black text-brand-primary">{pulse.daily_points}</Text>
                        <Text className="text-[9px] text-brand-primary/60 ml-0.5 font-bold">PTS</Text>
                     </View>
                  </View>

                  <View className="ml-6">
                     <Text className="text-[9px] text-typography-muted font-black uppercase tracking-tighter mb-0.5">Velocity</Text>
                     <View className="flex-row items-baseline">
                        <Text className="text-lg font-black text-typography-main">{Math.floor(pulse.active_seconds_today / 3600)}h</Text>
                        <Text className="text-[9px] text-typography-muted ml-0.5 font-bold">{Math.floor((pulse.active_seconds_today % 3600) / 60)}m</Text>
                     </View>
                  </View>

                  <View className="ml-6">
                     <Text className="text-[9px] text-typography-muted font-black uppercase tracking-tighter mb-0.5">Quality (Flap)</Text>
                     <View className="flex-row items-baseline">
                        <Text className={`text-lg font-black ${pulse.flap_rate_score > 1.5 ? 'text-state-danger' : 'text-state-success'}`}>
                           {pulse.flap_rate_score}x
                        </Text>
                     </View>
                  </View>
               </View>

               {pulse.is_working && (
                  <View className="bg-state-success/10 px-2 py-0.5 rounded-full flex-row items-center border border-state-success/20">
                     <View className="w-1 h-1 rounded-full bg-state-success mr-1.5" />
                     <Text className="text-[8px] text-state-success font-black uppercase tracking-widest">Active</Text>
                  </View>
               )}
            </View>
         </View>
      )}

      <View className="flex-row items-center justify-between px-5 pt-4 pb-4">
        <TouchableOpacity onPress={() => setShowPipelinePicker(true)}>
          <View className="flex-row items-center">
            <View>
              <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-wider mb-0.5">
                {pipeline?.name || 'Pipeline'} <FontAwesome name="chevron-down" size={8} className="text-brand-primary" />
              </Text>
              <Text className="text-typography-main text-3xl font-black">Board</Text>
            </View>
          </View>
        </TouchableOpacity>
        <View className="flex-row items-center gap-2">
           {hasPermission('role.manage') && (
             <TouchableOpacity
               onPress={() => router.push('/admin/roles')}
               className="bg-brand-primary/10 p-3 rounded-2xl border border-brand-primary/20"
             >
               <FontAwesome name="shield" size={16} className="text-brand-primary" />
             </TouchableOpacity>
           )}
           <TouchableOpacity
             onPress={() => setShowPersonalizer(true)}
             className="bg-brand-primary/10 p-3 rounded-2xl border border-brand-primary/20"
           >
             <FontAwesome name="paint-brush" size={16} className="text-brand-primary" />
           </TouchableOpacity>
           <TouchableOpacity
             onPress={() => router.push('/admin/pipelines')}
             className="bg-brand-primary/10 p-3 rounded-2xl border border-brand-primary/20"
           >
             <FontAwesome name="cog" size={16} className="text-brand-primary" />
           </TouchableOpacity>
          <TouchableOpacity
            onPress={handleCreateTask}
            className="bg-brand-primary px-5 py-3 rounded-xl shadow-lg shadow-brand-primary/30 flex-row items-center active:bg-brand-primary-active"
          >
            <FontAwesome name="plus" size={12} color="white" className="mr-2" />
            <Text className="text-white font-bold text-xs uppercase tracking-widest">Create Task</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* PIPELINE PICKER MODAL */}
      {showPipelinePicker && (
         <View className="absolute inset-0 bg-surface-background/80 z-50 items-center justify-center px-10">
            <View className="bg-surface-card w-full rounded-3xl border border-surface-border p-6">
                <Text className="text-typography-main font-bold text-xl mb-4">Switch Pipeline</Text>
                <ScrollView className="max-h-80">
                   {availablePipelines.map(p => (
                      <TouchableOpacity 
                        key={p.id} 
                        className="py-4 border-b border-surface-border"
                        onPress={() => {
                           setPipeline(p);
                           setLoading(true);
                           setShowPipelinePicker(false);
                           // Force refresh with specific ID
                           supabase.from('pipeline_stages').select('*').eq('pipeline_id', p.id).order('position').then(res => {
                              setStages(res.data || []);
                              supabase.from('tasks').select('*').eq('pipeline_id', p.id).then(tres => {
                                 setTasks(tres.data || []);
                                 setLoading(false);
                              });
                           });
                        }}
                      >
                         <Text className="text-typography-main font-bold">{p.name}</Text>
                      </TouchableOpacity>
                   ))}
                </ScrollView>
                <TouchableOpacity onPress={() => setShowPipelinePicker(false)} className="mt-4 pt-4 items-center">
                   <Text className="text-typography-muted font-bold">Cancel</Text>
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
        <TouchableOpacity
          onPress={handleCreateTask}
          className="absolute bottom-10 right-6 w-16 h-16 bg-brand-primary rounded-full items-center justify-center premium-shadow z-40 active:scale-90 transition-transform"
        >
          <FontAwesome name="plus" size={24} color="white" />
        </TouchableOpacity>
      )}

      <CreateTaskSheet 
        visible={showCreateSheet} 
        initialPipelineId={pipeline?.id}
        onClose={() => {
          setShowCreateSheet(false);
          fetchData();
        }} 
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
