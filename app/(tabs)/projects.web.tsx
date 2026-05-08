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
import { useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useTimer } from '@/contexts/TimerContext';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import ProjectFolderModal from '@/components/projects/ProjectFolderModal';

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

export default function ProjectsScreenWeb() {
  const { hasPermission } = useAuth();
  const { activeSession, lastStoppedAt } = useTimer();
  
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | undefined>();
  
  // Archival State
  const [archiveModal, setArchiveModal] = useState<{ visible: boolean, projectId: string | null }>({ visible: false, projectId: null });
  const [archiving, setArchiving] = useState(false);
  


  const fetchProjects = async () => {
    try {
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

      const projectIds = rawProjects.map(p => p.id);
      const { data: stats, error: statsError } = await supabase.rpc('rpc_get_project_stats', {
        p_project_ids: projectIds
      });

      if (statsError) throw statsError;

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
      return;
    }
    setSelectedProject(project);
    setModalVisible(true);
  };

  const handleCreateNew = () => {
    if (!hasPermission('project.create')) {
      return;
    }
    setSelectedProject(undefined);
    setModalVisible(true);
  };

  const handleArchiveProject = async () => {
    const projectId = archiveModal.projectId;
    if (!projectId) return;

    try {
      setArchiving(true);
      const { error } = await supabase.rpc('rpc_archive_project', { p_project_id: projectId });
      if (error) throw error;
      
      setArchiveModal({ visible: false, projectId: null });
      fetchProjects();
    } catch (err: any) {
      if (Platform.OS === 'web') {
        alert('Archival Failed: ' + err.message);
      } else {
        Alert.alert('Archival Failed', err.message);
      }
    } finally {
      setArchiving(false);
    }
  };

  const renderProjectCard = (project: Project) => {
    const isOverdue = project.expiry_date && new Date(project.expiry_date) < new Date() && project.status === 'active';
    const isCoolingDown = lastStoppedAt && (Date.now() - new Date(lastStoppedAt).getTime() < 35000);
    
    return (
      <TouchableOpacity 
        key={project.id} 
        onPress={() => handleEdit(project)}
        className="w-[calc(33.33%-20px)] bg-surface-card p-8 rounded-[32px] border border-surface-border mb-8 premium-shadow hover:border-brand-primary/50 transition-all group"
      >
        <View className="flex-row items-center justify-between mb-6">
           <View className={`w-14 h-14 rounded-2xl items-center justify-center ${isOverdue ? 'bg-state-danger/10' : 'bg-brand-primary/10'} group-hover:scale-110 transition-transform`}>
              <FontAwesome name="folder-open" size={24} color={isOverdue ? 'rgb(var(--state-danger))' : 'rgb(var(--brand-primary))'} />
           </View>
           <View className="flex-row items-center gap-2">
              {hasPermission('archive:create') && (
                <TouchableOpacity 
                  onPress={(e) => {
                    e.stopPropagation();
                    if (activeSession || isCoolingDown) {
                      Alert.alert('Archival Locked', 'Cannot archive while agents are recording time. Please stop all timers and wait 30 seconds for strategic sync.');
                      return;
                    }
                    setArchiveModal({ visible: true, projectId: project.id });
                  }}
                  className={`w-10 h-10 items-center justify-center rounded-xl border border-surface-border transition-colors ${activeSession || isCoolingDown ? 'bg-surface-card opacity-30 cursor-not-allowed' : 'bg-surface-background hover:bg-state-warning/10'}`}
                >
                  <FontAwesome name="archive" size={14} className="text-typography-muted hover:text-state-warning" />
                </TouchableOpacity>
              )}
              <View className={`px-4 py-1.5 rounded-full border ${project.status === 'active' ? 'bg-state-success/10 border-state-success/30' : 'bg-surface-background border-surface-border'}`}>
                  <Text className={`text-[10px] font-black uppercase tracking-widest ${project.status === 'active' ? 'text-state-success' : 'text-typography-muted'}`}>
                    {project.status}
                  </Text>
              </View>
           </View>
        </View>

        <View className="flex-row items-center gap-3 mb-2">
          {project.is_featured && <FontAwesome name="star" size={16} color="rgb(var(--state-warning))" />}
          <Text className="text-typography-main text-2xl font-black tracking-tight flex-1" numberOfLines={1}>{project.name}</Text>
        </View>
        
        <Text className="text-typography-muted text-sm leading-relaxed mb-8 h-12" numberOfLines={2}>
          {project.description || 'Enterprise-grade documentation and operational workflows for this project sector.'}
        </Text>

        <View className="space-y-4">
           <View className="flex-row justify-between items-end mb-2">
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em]">Progress</Text>
              <Text className="text-typography-main text-sm font-black">{Math.round(project.completion_rate)}%</Text>
           </View>
           <View className="h-3 w-full bg-surface-background rounded-full overflow-hidden border border-surface-border/50">
              <View 
                style={{ width: `${project.completion_rate}%` }} 
                className={`h-full ${isOverdue ? 'bg-state-danger' : 'bg-brand-primary'} rounded-full`} 
              />
           </View>
           <View className="flex-row justify-between pt-2">
              <View className="flex-row items-center">
                 <FontAwesome name="tasks" size={10} className="text-typography-dim mr-2" />
                 <Text className="text-typography-muted text-[10px] font-bold">
                    {project.completed_tasks} / {project.total_tasks} Tasks
                 </Text>
              </View>
              {project.overdue_tasks > 0 && (
                <View className="flex-row items-center">
                   <View className="w-1.5 h-1.5 rounded-full bg-state-danger mr-2" />
                   <Text className="text-state-danger text-[10px] font-black uppercase">
                     {project.overdue_tasks} Overdue
                   </Text>
                </View>
              )}
           </View>
        </View>

        {project.expiry_date && (
           <View className="flex-row items-center mt-6 pt-6 border-t border-surface-border/50">
              <FontAwesome name="calendar" size={12} color={isOverdue ? 'rgb(var(--state-danger))' : 'rgb(var(--text-muted))'} />
              <Text className={`ml-3 text-[10px] font-black uppercase tracking-widest ${isOverdue ? 'text-state-danger' : 'text-typography-muted'}`}>
                {isOverdue ? 'Overdue' : 'Deadline'}: {new Date(project.expiry_date).toLocaleDateString()}
              </Text>
           </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View className="flex-1 bg-surface-background p-10">
      <View className="max-w-[1600px] mx-auto w-full">
        {/* Header */}
        <View className="flex-row items-center justify-between mb-12">
          <View>
            <Text className="text-typography-main text-5xl font-black tracking-tighter">Projects</Text>
            <Text className="text-typography-muted text-lg mt-2 font-medium">Manage your projects and team initiatives</Text>
          </View>
          
          <View className="flex-row items-center gap-6">
            <View className="flex-row items-center bg-surface-card px-6 py-3 rounded-2xl border border-surface-border premium-shadow">
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mr-4">Archive View</Text>
              <Switch 
                value={showClosed} 
                onValueChange={setShowClosed}
                trackColor={{ false: 'rgb(var(--surface-border))', true: 'rgb(var(--brand-primary))' }}
                thumbColor="white"
              />
            </View>
            
            <TouchableOpacity 
              onPress={handleCreateNew}
              className="bg-brand-primary px-8 py-4 rounded-2xl premium-shadow active:scale-95 transition-transform flex-row items-center"
            >
              <FontAwesome name="plus" size={14} color="white" className="mr-3" />
              <Text className="text-white font-black uppercase tracking-widest text-sm">Create Project</Text>
            </TouchableOpacity>
          </View>
        </View>

        {loading ? (
          <View className="py-20 items-center justify-center">
            <ActivityIndicator size="large" color="rgb(var(--brand-primary))" />
          </View>
        ) : (
          <ScrollView 
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="rgb(var(--brand-primary))" />}
          >
            <View className="flex-row flex-wrap gap-x-[30px]">
              {filteredProjects.length === 0 ? (
                <View className="w-full items-center justify-center py-32 bg-surface-card/50 rounded-[48px] border border-dashed border-surface-border">
                   <View className="w-24 h-24 bg-surface-background rounded-full items-center justify-center mb-6 border border-surface-border">
                    <FontAwesome name="folder-open-o" size={40} className="text-typography-dim" />
                   </View>
                   <Text className="text-typography-main text-2xl font-black">No active projects</Text>
                   <Text className="text-typography-muted text-center max-w-md mt-4 leading-relaxed font-medium">
                     Your project list is currently empty. Create a new project to start tracking team productivity and tasks.
                   </Text>
                   <TouchableOpacity 
                     onPress={handleCreateNew}
                     className="mt-10 bg-surface-background px-8 py-4 rounded-xl border border-brand-primary/30"
                   >
                      <Text className="text-brand-primary font-black uppercase tracking-widest text-xs">Create First Project</Text>
                   </TouchableOpacity>
                </View>
              ) : (
                filteredProjects.map(renderProjectCard)
              )}
            </View>
            <View className="h-20" />
          </ScrollView>
        )}
      </View>

      <ProjectFolderModal 
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onSuccess={fetchProjects}
        project={selectedProject}
      />

      <ConfirmModal
        visible={archiveModal.visible}
        title="Deep Archive Project"
        description="This will move the project and ALL associated tasks to cold storage. This operation is recursive and will clear all active items from the pipeline."
        confirmLabel="Confirm Deep Archive"
        variant="warning"
        loading={archiving}
        onConfirm={handleArchiveProject}
        onCancel={() => setArchiveModal({ visible: false, projectId: null })}
      />
    </View>
  );
}

import ConfirmModal from '@/components/common/ConfirmModal';
