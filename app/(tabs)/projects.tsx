import React, { useEffect, useState, useMemo } from 'react';
import { 
  View, 
  Text, 
  ScrollView, 
  RefreshControl, 
  TouchableOpacity, 
  ActivityIndicator, 
  Alert, 
  Platform,
  Switch
} from 'react-native';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import ProjectFolderModal from '@/components/projects/ProjectFolderModal';
import { useAuth } from '@/contexts/AuthContext';

type Project = {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'closed' | 'archived';
  expiry_date: string | null;
  total_tasks: number;
  completed_tasks: number;
  overdue_tasks: number;
  completion_rate: number;
};

export default function ProjectsScreen() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | undefined>();
  

  const { hasPermission } = useAuth();
  const isWeb = Platform.OS === 'web';

  const fetchProjects = async () => {
    try {
      // 1. Fetch raw project data
      const { data: rawProjects, error: projError } = await supabase
        .from('projects')
        .select('*')
        .order('is_featured', { ascending: false })
        .order('created_at', { ascending: false });

      if (projError) throw projError;

      if (!rawProjects || rawProjects.length === 0) {
        setProjects([]);
        return;
      }

      // 2. Fetch stats via RPC
      const projectIds = rawProjects.map(p => p.id);
      const { data: stats, error: statsError } = await supabase.rpc('rpc_get_project_stats', {
        p_project_ids: projectIds
      });

      if (statsError) throw statsError;

      // 3. Merge data
      const merged = rawProjects.map(p => {
        const s = stats?.find((stat: any) => stat.project_id === p.id) || {
          total_tasks: 0,
          completed_tasks: 0,
          overdue_tasks: 0,
          completion_rate: 0
        };
        return { ...p, ...s };
      });

      setProjects(merged);
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

  const filteredProjects = useMemo(() => {
    if (showClosed) return projects;
    return projects.filter(p => p.status === 'active');
  }, [projects, showClosed]);

  const handleEdit = (project: Project) => {
    if (!hasPermission('project.edit')) {
      Alert.alert('Permission Denied', 'You do not have permission to edit projects.');
      return;
    }
    setSelectedProject(project);
    setModalVisible(true);
  };

  const handleCreateNew = () => {
    if (!hasPermission('project.create')) {
      Alert.alert('Permission Denied', 'You do not have permission to create projects.');
      return;
    }
    setSelectedProject(undefined);
    setModalVisible(true);
  };

  const renderProjectCard = (project: Project) => {
    const isOverdue = project.expiry_date && new Date(project.expiry_date) < new Date() && project.status === 'active';
    const progress = project.completion_rate / 100;
    
    return (
      <TouchableOpacity 
        key={project.id} 
        onPress={() => handleEdit(project)}
        className={`${isWeb ? 'w-[31%] mx-[1%]' : 'w-full'} bg-surface-card p-6 rounded-[24px] border border-surface-border mb-6 premium-shadow`}
      >
        <View className="flex-row items-center justify-between mb-4">
           <View className={`w-12 h-12 rounded-2xl items-center justify-center ${isOverdue ? 'bg-state-danger/10' : 'bg-brand-primary/10'}`}>
              <FontAwesome name="folder-open" size={20} color={isOverdue ? 'rgb(var(--state-danger))' : 'rgb(var(--brand-primary))'} />
           </View>
           <View className={`px-3 py-1 rounded-full border ${project.status === 'active' ? 'bg-state-success/10 border-state-success/30' : 'bg-surface-background border-surface-border'}`}>
              <Text className={`text-[10px] font-bold uppercase ${project.status === 'active' ? 'text-state-success' : 'text-typography-muted'}`}>
                {project.status}
              </Text>
           </View>
        </View>

        <View className="flex-row items-center gap-2 mb-1">
          {project.is_featured && <FontAwesome name="star" size={14} color="rgb(var(--state-warning))" />}
          <Text className="text-typography-main text-xl font-bold flex-1" numberOfLines={1}>{project.name}</Text>
        </View>
        
        <Text className="text-typography-muted text-sm mb-6 h-10" numberOfLines={2}>
          {project.description || 'Access documentation and team workflows.'}
        </Text>

        <View className="space-y-3">
           <View className="flex-row justify-between items-end mb-1">
              <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest">Efficiency</Text>
              <Text className="text-typography-main text-xs font-black">{Math.round(project.completion_rate)}%</Text>
           </View>
           <View className="h-2 w-full bg-surface-background rounded-full overflow-hidden">
              <View 
                style={{ width: `${project.completion_rate}%` }} 
                className={`h-full ${isOverdue ? 'bg-state-danger' : 'bg-brand-primary'}`} 
              />
           </View>
           <View className="flex-row justify-between pt-1">
              <Text className="text-typography-muted text-[10px]">
                {project.completed_tasks} / {project.total_tasks} Tasks
              </Text>
              {project.overdue_tasks > 0 && (
                <Text className="text-state-danger text-[10px] font-bold">
                  {project.overdue_tasks} Overdue
                </Text>
              )}
           </View>
        </View>

        {project.expiry_date && (
           <View className="flex-row items-center mt-4 pt-4 border-t border-surface-border/50">
              <FontAwesome name="calendar" size={12} color={isOverdue ? 'rgb(var(--state-danger))' : 'rgb(var(--typography-muted))'} />
              <Text className={`ml-2 text-[10px] font-medium ${isOverdue ? 'text-state-danger' : 'text-typography-muted'}`}>
                {isOverdue ? 'Expired' : 'Expires'}: {new Date(project.expiry_date).toLocaleDateString()}
              </Text>
           </View>
        )}
      </TouchableOpacity>
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
      {/* Dynamic Navigation / Header */}
      <View className={`flex-row items-center justify-between px-6 ${isWeb ? 'py-8 border-b border-surface-border' : 'pt-4 pb-2'}`}>
        <View>
          <Text className={`${isWeb ? 'text-5xl' : 'text-3xl'} text-typography-main font-black tracking-tighter`}>Projects</Text>
          <Text className="text-typography-muted text-sm font-medium">Organizational clusters for team productivity</Text>
        </View>
        
        <View className="flex-row items-center gap-4">
          <View className="flex-row items-center gap-2 mr-2">
            <Text className="text-typography-muted text-[10px] font-bold uppercase">Show Closed</Text>
            <Switch 
              value={showClosed} 
              onValueChange={setShowClosed}
              trackColor={{ false: 'rgb(var(--surface-border))', true: 'rgb(var(--brand-primary))' }}
              thumbColor={showClosed ? 'white' : 'rgb(var(--typography-muted))'}
            />
          </View>
          
          <TouchableOpacity 
            onPress={handleCreateNew}
            className="bg-brand-primary p-4 rounded-2xl premium-shadow"
          >
            <FontAwesome name="plus" size={18} color="white" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView 
        className="flex-1 px-6 pt-6"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="rgb(var(--brand-primary))" />}
      >
        <View className={`${isWeb ? 'flex-row flex-wrap mt-2' : ''}`}>
          {filteredProjects.length === 0 ? (
            <View className="w-full items-center justify-center py-24 bg-surface-card rounded-[32px] border border-dashed border-surface-border">
               <View className="w-20 h-20 bg-surface-background rounded-full items-center justify-center mb-4">
                <FontAwesome name="folder-o" size={32} color="rgb(var(--typography-muted))" style={{ opacity: 0.5 }} />
               </View>
               <Text className="text-typography-main text-lg font-bold">No projects available</Text>
               <Text className="text-typography-muted text-sm text-center px-10 mt-2">
                 Active projects will appear here. Toggle 'Show Closed' to view completed work.
               </Text>
            </View>
          ) : (
            filteredProjects.map(renderProjectCard)
          )}
        </View>
        <View className="h-20" />
      </ScrollView>

      <ProjectFolderModal 
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onSuccess={fetchProjects}
        project={selectedProject}
      />
    </View>
  );
}
