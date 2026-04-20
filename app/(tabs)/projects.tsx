import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

type Project = {
  id: string;
  name: string;
  description: string;
  status: string;
  task_count?: number;
  completed_count?: number;
};

export default function ProjectsScreen() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'dark'];

  const fetchProjects = async () => {
    try {
      // Fetch projects
      const { data, error } = await supabase
        .from('projects')
        .select(`
          *,
          tasks(id, current_stage_id, pipeline_stages(is_terminal, terminal_type))
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Process stats manually for now (or use a view later)
      const processed = (data || []).map((p: any) => {
        const total = p.tasks?.length || 0;
        const completed = p.tasks?.filter((t: any) => 
          t.pipeline_stages?.is_terminal === true && t.pipeline_stages?.terminal_type === 'success'
        ).length || 0;
        
        return {
          ...p,
          task_count: total,
          completed_count: completed
        };
      });

      setProjects(processed);
    } catch (err: any) {
      console.error('Error fetching projects:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchProjects();
  };

  const handleCreateDummyProject = async () => {
    try {
      setLoading(true);
      const { error } = await supabase
        .from('projects')
        .insert({
          name: `Project Alpha ${Math.floor(Math.random() * 100)}`,
          description: 'A newly generated exploration project.',
          status: 'active'
        });

      if (error) throw error;
      fetchProjects();
    } catch (err: any) {
      Alert.alert("Error", err.message);
      setLoading(false);
    }
  };

  const renderProjectCard = (project: Project) => {
    const progress = project.task_count ? (project.completed_count || 0) / project.task_count : 0;
    
    return (
      <View key={project.id} className="bg-surface-card p-5 rounded-3xl border border-surface-border mb-4 premium-shadow">
        <View className="flex-row items-center justify-between mb-4">
           <View className="w-12 h-12 bg-brand-primary/10 rounded-2xl items-center justify-center">
              <FontAwesome name="folder-open" size={20} color={theme.tint} />
           </View>
           <View className="bg-surface-background px-2 py-1 rounded-full border border-surface-border">
              <Text className="text-typography-muted text-[10px] font-bold uppercase">{project.status}</Text>
           </View>
        </View>

        <Text className="text-typography-main text-xl font-bold mb-1">{project.name}</Text>
        <Text className="text-typography-muted text-sm mb-6" numberOfLines={2}>
          {project.description || 'No project description available.'}
        </Text>

        <View className="space-y-2">
           <View className="flex-row justify-between items-end">
              <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest">Progress</Text>
              <Text className="text-typography-main text-xs font-bold">{Math.round(progress * 100)}%</Text>
           </View>
           <View className="h-1.5 w-full bg-surface-background rounded-full overflow-hidden border border-surface-border/30">
              <View 
                style={{ width: `${progress * 100}%` }} 
                className="h-full bg-brand-primary" 
              />
           </View>
           <Text className="text-typography-dim text-[10px] font-medium">
             {project.completed_count} of {project.task_count} tasks completed
           </Text>
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
      <View className="flex-row items-center justify-between px-6 pt-4 pb-4">
        <View>
          <Text className="text-typography-main text-3xl font-black">Projects</Text>
          <Text className="text-typography-muted text-xs font-medium">High-level strategic goals</Text>
        </View>
        <TouchableOpacity 
          onPress={handleCreateDummyProject}
          className="bg-brand-secondary/20 p-3 rounded-2xl border border-brand-secondary/30"
        >
          <FontAwesome name="plus" size={18} color="#6366f1" />
        </TouchableOpacity>
      </View>

      <ScrollView 
        className="flex-1 px-6 pt-2"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.tint} />}
      >
        {projects.length === 0 ? (
          <View className="items-center justify-center py-20 bg-surface-card rounded-3xl border border-dashed border-surface-border mt-4">
             <FontAwesome name="briefcase" size={48} color={theme.tabIconDefault} style={{ opacity: 0.3 }} />
             <Text className="text-typography-muted mt-4 font-medium">No projects found. Create one!</Text>
          </View>
        ) : (
          projects.map(renderProjectCard)
        )}
        <View className="h-10" />
      </ScrollView>
    </View>
  );
}
