import React, { useEffect, useState, useMemo } from 'react';
import SkeletonBlock, { SkeletonList } from '@/components/Skeleton';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  InteractionManager,
  Platform,
  Switch,
  useWindowDimensions
} from 'react-native';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import ProjectFolderModal from '@/components/projects/ProjectFolderModal';
import { useAuth } from '@/contexts/AuthContext';
import { TAB_BAR_HEIGHT } from '@/lib/layout';
import { useThemeColors } from '@/hooks/useThemeColors';

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
  is_featured: boolean;
};

export default function ProjectsScreen() {
  const colors = useThemeColors();
  const { width } = useWindowDimensions();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | undefined>();

  const { hasPermission } = useAuth();
  const isWeb = Platform.OS === 'web';
  const isLargeScreen = width > 768;

  // Permission check: user must have project.view permission
  if (!hasPermission('project.view')) {
    return (
      <View className="flex-1 bg-surface-background items-center justify-center p-10">
        <FontAwesome name="lock" size={48} color={colors.textMuted} />
        <Text className="text-typography-main text-xl font-black mt-4">Access Denied</Text>
        <Text className="text-typography-muted text-sm text-center mt-2">You don't have permission to view projects.</Text>
      </View>
    );
  }

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
    const task = InteractionManager.runAfterInteractions(() => {
      fetchProjects();
    });
    return () => task.cancel();
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
              <FontAwesome name="folder-open" size={20} color={isOverdue ? colors.danger : colors.primary} />
           </View>
           <View className={`px-3 py-1 rounded-full border ${project.status === 'active' ? 'bg-state-success/10 border-color-success/30' : 'bg-surface-background border-surface-border'}`}>
              <Text className={`text-[10px] font-bold uppercase ${project.status === 'active' ? 'text-state-success' : 'text-typography-muted'}`}>
                {project.status}
              </Text>
           </View>
        </View>

        <View className="flex-row items-center gap-2 mb-1">
          {project.is_featured && <FontAwesome name="star" size={14} color={colors.warning} />}
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
              <FontAwesome name="calendar" size={12} color={isOverdue ? colors.danger : colors.textMuted} />
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
      <View className="flex-1 bg-surface-background px-6 pt-6">
        <View className="flex-row items-center justify-between mb-6">
          <SkeletonBlock height={28} style={{ width: '40%' }} />
          <SkeletonBlock height={36} style={{ width: 90 }} />
        </View>

        <ScrollView className="flex-1 px-0">
          <View style={{ gap: 16 }}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <SkeletonBlock height={160} borderRadius={20} />
              </View>
              <View style={{ flex: 1 }}>
                <SkeletonBlock height={160} borderRadius={20} />
              </View>
              <View style={{ flex: 1 }}>
                <SkeletonBlock height={160} borderRadius={20} />
              </View>
            </View>

            <SkeletonList count={3} itemHeight={80} />
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-surface-background">
      {/* Header */}
      <View className={`flex-row items-center justify-between px-6 ${isWeb ? 'py-8 border-b border-surface-border' : 'pb-3'}`} style={(Platform.OS !== 'web' || !isLargeScreen) ? { paddingTop: Platform.OS === 'web' ? TAB_BAR_HEIGHT.web : TAB_BAR_HEIGHT.native } : undefined}>
        <View className="flex-1 mr-3">
          <Text className={`${isWeb ? 'text-5xl' : 'text-2xl'} text-typography-main font-black tracking-tighter`}>Projects</Text>
          {isWeb && (
            <Text className="text-typography-muted text-sm font-medium">Manage your projects and team initiatives</Text>
          )}
        </View>

        <View className="flex-row items-center gap-3 flex-shrink-0">
          <View className="flex-row items-center gap-2">
            {isWeb && (
              <Text className="text-typography-muted text-[10px] font-bold uppercase">Show Closed</Text>
            )}
            <Switch
              value={showClosed}
              onValueChange={setShowClosed}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="white"
            />
          </View>

          <TouchableOpacity
            onPress={handleCreateNew}
            className="bg-brand-primary p-3 rounded-xl"
          >
            <FontAwesome name="plus" size={16} color="white" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        className="flex-1 px-6 pt-6"
        contentContainerStyle={{ paddingBottom: isWeb ? 32 : TAB_BAR_HEIGHT.native + 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <View className={`${isWeb ? 'flex-row flex-wrap mt-2' : ''}`}>
          {filteredProjects.length === 0 ? (
            <View className="w-full items-center justify-center py-24 bg-surface-card rounded-[32px] border border-dashed border-surface-border">
               <View className="w-20 h-20 bg-surface-background rounded-full items-center justify-center mb-4">
                <FontAwesome name="folder-o" size={32} color={colors.textMuted} style={{ opacity: 0.5 }} />
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
