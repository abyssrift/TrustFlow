import React, { useEffect, useState } from 'react';
import { 
  View, Text, ScrollView, RefreshControl, 
  TouchableOpacity, ActivityIndicator, Alert, 
  useWindowDimensions, SectionList, FlatList 
} from 'react-native';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/contexts/AuthContext';

type Stage = {
  id: string;
  name: string;
  color: string;
  position: number;
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

export default function TasksScreen() {
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [availablePipelines, setAvailablePipelines] = useState<Pipeline[]>([]);
  const [showPipelinePicker, setShowPipelinePicker] = useState(false);
  const [activeSessions, setActiveSessions] = useState<Record<string, { name: string, avatar: string | null }[]>>({}); // task_id -> [{name, avatar}]
  const [pulse, setPulse] = useState<PersonalPulse | null>(null);
  const [showAssignmentModal, setShowAssignmentModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [teams, setTeams] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<{users: string[], teams: string[]}>({users: [], teams: []});
  
  const { width } = useWindowDimensions();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'dark'];
  const router = useRouter();
  const { hasPermission } = useAuth();
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

      // 3. Get tasks with assignments
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

      // 4. Get Active Work Sessions with User details
      const { data: sessions } = await supabase
        .from('task_work_sessions')
        .select(`
          task_id, 
          user:user_id(full_name, avatar_url)
        `)
        .eq('status', 'active');
      
      const sessionMap: Record<string, { name: string, avatar: string | null }[]> = {};
      sessions?.forEach(s => {
         if (!sessionMap[s.task_id]) sessionMap[s.task_id] = [];
         sessionMap[s.task_id].push({ 
           name: (s.user as any)?.full_name || 'User', 
           avatar: (s.user as any)?.avatar_url 
         });
      });
      setActiveSessions(sessionMap);

      console.log('Successfully fetched pipeline, stages, and tasks.');
    } catch (err: any) {
      console.error('[DATABASE ERROR] Error fetching task data:', err);
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
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchPulse();
    fetchData();
  };

  const handleCreateTask = async () => {
    try {
      setLoading(true);
      const { error } = await supabase.rpc('rpc_create_task', {
        p_title: `Task #${Math.floor(Math.random() * 9000) + 1000}`,
        p_description: 'Standard task created via the global board.',
        p_priority: 'medium',
        p_pipeline_id: pipeline?.id
      });

      if (error) throw error;
      console.log('Successfully created task via RPC.');
      fetchData();
    } catch (err: any) {
      console.error('[RPC ERROR] Error creating task:', err);
      // Fallback for visual feedback on Web
      alert(`Error creating task: ${err.message}`);
      setLoading(false);
    }
  };

  const handleAdvanceTask = async (task: Task) => {
    try {
      const currentIndex = stages.findIndex(s => s.id === task.current_stage_id);
      if (currentIndex === -1) {
        console.error('Current stage not found in local stages list');
        return;
      }
      
      if (currentIndex === stages.length - 1) {
        alert('This task is already in the final stage.');
        return;
      }

      const nextStage = stages[currentIndex + 1];
      console.log(`Advancing task ${task.id} to stage ${nextStage.name}`);

      const { error } = await supabase.rpc('rpc_advance_stage', {
        p_task_id: task.id,
        p_to_stage_id: nextStage.id
      });

      if (error) throw error;
      console.log('Successfully advanced task stage.');
      fetchData();
    } catch (err: any) {
      console.error('[RPC ERROR] Error advancing stage:', err);
      Alert.alert(
        'Error moving task',
        `${err.message}\n\nHint: Check transition rules or required permissions.`
      );
    }
  };

  const handleOpenAssignments = async (task: Task) => {
    try {
      setSelectedTask(task);
      setLoading(true);
      
      // Get manageable teams
      const { data: teamData } = await supabase.from('teams').select('*').is('deleted_at', null);
      setTeams(teamData || []);

      // Get users
      const { data: userData } = await supabase.from('users').select('id, full_name, avatar_url').is('deleted_at', null);
      setUsers(userData || []);

      // Get current assignments
      const { data: current } = await supabase.from('task_assignments').select('*').eq('task_id', task.id);
      setSelectedIds({
        users: current?.filter(a => a.assignee_user_id).map(a => a.assignee_user_id) || [],
        teams: current?.filter(a => a.assignee_team_id).map(a => a.assignee_team_id) || []
      });

      setShowAssignmentModal(true);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateAssignments = async () => {
    if (!selectedTask) return;
    try {
      setLoading(true);
      const { error } = await supabase.rpc('rpc_update_task_assignments', {
        p_task_id: selectedTask.id,
        p_user_ids: selectedIds.users,
        p_team_ids: selectedIds.teams
      });
      if (error) throw error;
      setShowAssignmentModal(false);
      fetchData();
    } catch (err: any) {
      Alert.alert('Assignment Error', err.message);
    } finally {
      setLoading(false);
    }
  };

  const getPriorityInfo = (priority: string) => {
    switch (priority) {
      case 'urgent': return { color: '#ef4444', label: 'Urgent' };
      case 'high': return { color: '#f59e0b', label: 'High' };
      case 'low': return { color: '#10b981', label: 'Low' };
      default: return { color: theme.tabIconDefault, label: 'Normal' };
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
        {activeSessions[task.id] && activeSessions[task.id].length > 0 && (
          <View className="flex-row items-center mb-3">
             <View className="relative">
                <View className="w-6 h-6 rounded-full bg-brand-primary/10 overflow-hidden border-2 border-green-500">
                   {activeSessions[task.id][0].avatar ? (
                      <View className="bg-slate-500 w-full h-full" /> // Placeholder for Image implementation
                   ) : (
                      <View className="flex-1 items-center justify-center bg-brand-primary/20">
                         <Text className="text-brand-primary text-[8px] font-black">{activeSessions[task.id][0].name.charAt(0)}</Text>
                      </View>
                   )}
                </View>
                <View className="absolute -right-0.5 -bottom-0.5 w-2 h-2 rounded-full bg-green-500 border-2 border-surface-card" />
             </View>
             <Text className="text-green-500 text-[10px] font-bold ml-2">
                {activeSessions[task.id][0].name} {activeSessions[task.id].length > 1 ? `+${activeSessions[task.id].length - 1} more` : 'is active'}
             </Text>
          </View>
        )}

        <Text className="text-typography-muted text-xs leading-4 mb-3" numberOfLines={2}>
          {task.description || 'No description provided.'}
        </Text>
        
        <View className="flex-row items-center justify-between pt-3 border-t border-surface-border/50">
            <View className="flex-row items-center space-x-2">
               <View className="flex-row -space-x-2 mr-3">
                  <TouchableOpacity 
                    onPress={() => handleOpenAssignments(task)}
                    className="w-6 h-6 rounded-full bg-brand-primary/20 items-center justify-center border border-surface-card"
                  >
                     <FontAwesome name="user-plus" size={10} color={theme.tint} />
                  </TouchableOpacity>
               </View>

               {/* TIMER ACTIONS */}
               <TouchableOpacity 
                  onPress={async () => {
                     const isActive = activeSessions[task.id]?.length > 0; // Simplified check for current user
                     setLoading(true);
                     const { error } = await supabase.rpc(isActive ? 'rpc_pause_work' : 'rpc_start_work', { p_task_id: task.id });
                     if (error) Alert.alert('Timer Error', error.message);
                     fetchData();
                  }}
                  className="bg-brand-primary/10 p-1.5 rounded-lg border border-brand-primary/30 mr-2"
                >
                  <FontAwesome name={activeSessions[task.id]?.length > 0 ? "pause" : "play"} size={10} color="#6366f1" />
                </TouchableOpacity>

                <TouchableOpacity 
                  onPress={() => handleAdvanceTask(task)}
                  className="bg-surface-background p-1.5 rounded-lg border border-surface-border active:opacity-50"
                >
                  <FontAwesome name="chevron-right" size={10} color={theme.text} />
                </TouchableOpacity>
            </View>

            {/* ONE-CLICK REVIEW ACTIONS */}
            {task.parent_task_id && (
               <View className="flex-row space-x-2">
                  <TouchableOpacity 
                    onPress={async () => {
                       setLoading(true);
                       const { error } = await supabase.rpc('rpc_resolve_sub_task', { p_task_id: task.id, p_terminal_type: 'failure' });
                       if (error) {
                          console.error('Rejection failed:', error);
                          Alert.alert('Action Error', `Failed to reject task: ${error.message}`);
                       }
                       fetchData();
                    }}
                    className="bg-state-danger/10 px-3 py-1.5 rounded-lg border border-state-danger/30"
                  >
                     <Text className="text-state-danger text-[10px] font-black uppercase">Reject</Text>
                  </TouchableOpacity>

                  <TouchableOpacity 
                    onPress={async () => {
                       setLoading(true);
                       const { error } = await supabase.rpc('rpc_resolve_sub_task', { p_task_id: task.id, p_terminal_type: 'success' });
                       if (error) {
                          console.error('Approval failed:', error);
                          Alert.alert('Action Error', `Failed to approve task: ${error.message}`);
                       }
                       fetchData();
                    }}
                    className="bg-state-success/10 px-3 py-1.5 rounded-lg border border-state-success/30"
                  >
                     <Text className="text-state-success text-[10px] font-black uppercase">Approve</Text>
                  </TouchableOpacity>
               </View>
            )}
        </View>
      </TouchableOpacity>
    );
  };

  const renderStageColumn = (stage: Stage) => {
    const stageTasks = tasks.filter(t => t.current_stage_id === stage.id);
    return (
      <View key={stage.id} style={{ width: isLargeScreen ? 320 : width * 0.85 }} className="mr-4">
        <View className="flex-row items-center justify-between mb-4 px-2">
           <View className="flex-row items-center">
              <View style={{ backgroundColor: stage.color }} className="w-2 h-2 rounded-full mr-2" />
              <Text className="text-typography-main font-black text-xs uppercase tracking-widest">{stage.name}</Text>
              <View className="ml-2 bg-surface-overlay px-1.5 rounded-md">
                <Text className="text-typography-muted text-[10px] font-bold">{stageTasks.length}</Text>
              </View>
           </View>
           
           {/* STAGE PUSH BADGE */}
           {stage.linked_pipeline && (
              <View className="flex-row items-center border border-brand-primary/30 bg-brand-primary/10 px-2 py-0.5 rounded-full">
                 <FontAwesome name="bolt" size={8} color="#6366f1" />
                 <Text className="text-brand-primary text-[8px] font-black ml-1 uppercase">Pushes to {stage.linked_pipeline.name}</Text>
              </View>
           )}

           <TouchableOpacity>
              <FontAwesome name="ellipsis-h" size={14} color={theme.tabIconDefault} />
           </TouchableOpacity>
        </View>
        
        <ScrollView className="flex-1 bg-surface-background/50 rounded-3xl p-2" showsVerticalScrollIndicator={false}>
          {stageTasks.length === 0 ? (
            <View className="py-10 items-center justify-center opacity-30">
               <FontAwesome name="inbox" size={32} color={theme.tabIconDefault} />
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
        <ActivityIndicator size="large" color={theme.tint} />
      </View>
    );
  }

   return (
    <View className="flex-1 bg-surface-background">
      
      {/* PERFORMANCE PULSE HEADER */}
      {pulse && (
         <View className="px-5 py-3 bg-brand-primary/5 border-b border-surface-border">
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
                {pipeline?.name || 'Pipeline'} <FontAwesome name="chevron-down" size={8} />
              </Text>
              <Text className="text-typography-main text-3xl font-black">Board</Text>
            </View>
          </View>
        </TouchableOpacity>
        <View className="flex-row items-center gap-3">
          {hasPermission('role.manage') && (
            <TouchableOpacity
              onPress={() => router.push('/admin/roles')}
              className="bg-brand-primary/10 p-3 rounded-2xl border border-brand-primary/30"
            >
              <FontAwesome name="shield" size={16} color="#6366f1" />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => router.push('/admin/pipelines')}
            className="bg-surface-card p-3 rounded-2xl border border-surface-border"
          >
            <FontAwesome name="cog" size={16} color="#64748b" />
          </TouchableOpacity>
          <TouchableOpacity 
            onPress={handleCreateTask}
            className="bg-brand-primary px-6 py-3 rounded-2xl premium-shadow"
          >
            <Text className="text-white font-black text-sm">Create Task</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* PIPELINE PICKER MODAL */}
      {showPipelinePicker && (
         <View className="absolute inset-0 bg-black/60 z-50 items-center justify-center px-10">
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
      {showAssignmentModal && (
         <View className="absolute inset-0 bg-black/60 z-50 items-center justify-center px-6">
            <View className="bg-surface-card w-full rounded-3xl border border-surface-border p-6">
                <Text className="text-typography-main font-bold text-xl mb-4">Assign Task</Text>
                
                <Text className="text-typography-muted font-bold text-xs uppercase mb-2">Teams</Text>
                <ScrollView className="max-h-40 mb-4">
                   {teams.map(t => (
                      <TouchableOpacity 
                        key={t.id} 
                        onPress={() => {
                           const exists = selectedIds.teams.includes(t.id);
                           setSelectedIds(prev => ({
                              ...prev,
                              teams: exists ? prev.teams.filter(id => id !== t.id) : [...prev.teams, t.id]
                           }));
                        }}
                        className={`flex-row items-center justify-between py-2 border-b border-surface-border ${selectedIds.teams.includes(t.id) ? 'bg-brand-primary/10' : ''}`}
                      >
                         <Text className="text-typography-main text-sm">{t.name}</Text>
                         {selectedIds.teams.includes(t.id) && <FontAwesome name="check-circle" size={14} color="#6366f1" />}
                      </TouchableOpacity>
                   ))}
                </ScrollView>

                <Text className="text-typography-muted font-bold text-xs uppercase mb-2">Individuals</Text>
                <ScrollView className="max-h-60">
                   {users.map(u => (
                      <TouchableOpacity 
                        key={u.id} 
                        onPress={() => {
                           const exists = selectedIds.users.includes(u.id);
                           setSelectedIds(prev => ({
                              ...prev,
                              users: exists ? prev.users.filter(id => id !== u.id) : [...prev.users, u.id]
                           }));
                        }}
                        className={`flex-row items-center justify-between py-2 border-b border-surface-border ${selectedIds.users.includes(u.id) ? 'bg-brand-primary/10' : ''}`}
                      >
                         <Text className="text-typography-main text-sm">{u.full_name || u.email}</Text>
                         {selectedIds.users.includes(u.id) && <FontAwesome name="check-circle" size={14} color="#6366f1" />}
                      </TouchableOpacity>
                   ))}
                </ScrollView>

                <View className="flex-row space-x-3 mt-6">
                   <TouchableOpacity 
                     onPress={() => setShowAssignmentModal(false)}
                     className="flex-1 bg-surface-background py-3 rounded-xl border border-surface-border items-center"
                   >
                      <Text className="text-typography-muted font-bold">Cancel</Text>
                   </TouchableOpacity>
                   <TouchableOpacity 
                     onPress={handleUpdateAssignments}
                     className="flex-1 bg-brand-primary py-3 rounded-xl items-center"
                   >
                      <Text className="text-white font-bold">Save</Text>
                   </TouchableOpacity>
                </View>
            </View>
         </View>
      )}

      <ScrollView 
        horizontal 
        showsHorizontalScrollIndicator={false}
        className="flex-1 px-5"
      >
        {stages.map(renderStageColumn)}
        <View className="w-10" />
      </ScrollView>
    </View>
  );
}
