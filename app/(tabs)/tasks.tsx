import React, { useEffect, useState } from 'react';
import { 
  View, Text, ScrollView, RefreshControl, 
  TouchableOpacity, ActivityIndicator, Alert, 
  useWindowDimensions, SectionList, FlatList 
} from 'react-native';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

type Stage = {
  id: string;
  name: string;
  color: string;
  position: number;
  requires_submission: boolean;
};

type Task = {
  id: string;
  title: string;
  description: string;
  current_stage_id: string;
  priority: string;
  created_at: string;
  category: string;
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
  
  const { width } = useWindowDimensions();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'dark'];
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

      // 2. Get stages
      const { data: stagesData, error: sError } = await supabase
        .from('pipeline_stages')
        .select('*')
        .eq('pipeline_id', pipelineData.id)
        .order('position', { ascending: true });

      if (sError) throw sError;
      setStages(stagesData || []);

      // 3. Get tasks
      const { data: tasksData, error: tError } = await supabase
        .from('tasks')
        .select('*')
        .eq('pipeline_id', pipelineData.id)
        .order('created_at', { ascending: false });

      if (tError) throw tError;
      setTasks(tasksData || []);

      console.log('Successfully fetched pipeline, stages, and tasks.');
    } catch (err: any) {
      console.error('[DATABASE ERROR] Error fetching task data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
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
      alert(`Error moving task: ${err.message}`);
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
      <View 
        key={task.id} 
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
        </View>
        <Text className="text-typography-main font-bold text-base mb-1">{task.title}</Text>
        <Text className="text-typography-muted text-xs leading-4 mb-3" numberOfLines={2}>
          {task.description || 'No description provided.'}
        </Text>
        
        <View className="flex-row items-center justify-between pt-3 border-t border-surface-border/50">
           <View className="flex-row -space-x-2">
              <View className="w-6 h-6 rounded-full bg-brand-primary/20 items-center justify-center border border-surface-card">
                 <FontAwesome name="user-o" size={10} color={theme.tint} />
              </View>
           </View>
           <TouchableOpacity className="bg-surface-background p-1.5 rounded-lg border border-surface-border">
              <FontAwesome name="chevron-right" size={10} color={theme.text} />
           </TouchableOpacity>
        </View>
      </View>
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
           <TouchableOpacity>
              <FontAwesome name="ellipsis-h" size={14} color={theme.tabIconDefault} />
           </TouchableOpacity>
        </View>
        
        <View className="flex-1 bg-surface-background/50 rounded-3xl p-2">
          {stageTasks.length === 0 ? (
            <View className="py-10 items-center justify-center opacity-30">
               <FontAwesome name="inbox" size={32} color={theme.tabIconDefault} />
               <Text className="text-typography-muted text-xs mt-2">Empty</Text>
            </View>
          ) : (
            stageTasks.map(renderTaskCard)
          )}
        </View>
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
      <View className="flex-row items-center justify-between px-5 pt-4 pb-4">
        <View>
          <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-wider mb-0.5">
            {pipeline?.name || 'Pipeline'}
          </Text>
          <Text className="text-typography-main text-3xl font-black">Board</Text>
        </View>
        <TouchableOpacity 
          onPress={handleCreateTask}
          className="bg-brand-primary px-6 py-3 rounded-2xl premium-shadow"
        >
          <Text className="text-white font-black text-sm">Create Task</Text>
        </TouchableOpacity>
      </View>

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
