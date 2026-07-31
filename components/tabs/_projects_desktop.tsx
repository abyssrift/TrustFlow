import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useAlert } from '@/contexts/AlertContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import ProjectFolderModal from '@/components/projects/ProjectFolderModal';
import ProjectDashboard from '@/components/projects/ProjectDashboard';
import Tooltip from '@/components/common/Tooltip';
import BulkCreateProjectsSheet from '@/components/projects/BulkCreateProjectsSheet';
import ProjectsTable from '@/components/projects/ProjectsTable';

type Project = {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'closed' | 'archived';
  expiry_date: string | null;
};

export default function ProjectsScreenWeb() {
  const colors = useThemeColors();
  const { showAlert } = useAlert();
  const { hasPermission } = useAuth();

  // Raw project rows are still fetched for the edit modal (ProjectFolderModal
  // needs name/description/status/expiry_date, which the table RPC doesn't
  // carry) — the dense listing itself is fetched independently inside
  // ProjectsTable via rpc_projects_table.
  const [projects, setProjects] = useState<Project[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | undefined>();
  const [dashboardProjectId, setDashboardProjectId] = useState<string | null>(null);
  const [bulkCreateVisible, setBulkCreateVisible] = useState(false);
  const [tableRefreshKey, setTableRefreshKey] = useState(0);

  const canViewProjects = hasPermission('project.view');

  const fetchProjects = async () => {
    try {
      const { data, error: projError } = await supabase
        .from('projects')
        .select('id, name, description, status, expiry_date')
        .order('created_at', { ascending: false });
      if (projError) throw projError;
      setProjects(data || []);
    } catch (err: any) {
      console.error('Error fetching projects:', err);
    }
  };

  useEffect(() => {
    // Permission can still be loading (false) on the very first render and
    // flip true once auth resolves — depending on canViewProjects here means
    // the fetch fires once it does, instead of only ever firing (or not)
    // based on whatever the permission happened to be at mount time.
    if (!canViewProjects) return;
    fetchProjects();
  }, [canViewProjects]);

  // Permission check: user must have project.view permission. Placed after
  // every hook call above (never before) so the same hooks run on every
  // render regardless of when the permission itself resolves — an early
  // return before a hook call here previously caused "Rendered more hooks
  // than during the previous render" whenever permissions loaded async and
  // flipped false -> true between renders (issue #96).
  if (!canViewProjects) {
    return (
      <View className="flex-1 bg-surface-background items-center justify-center p-10">
        <FontAwesome name="lock" size={48} color={colors.textMuted} />
        <Text className="text-typography-main text-xl font-black mt-4">Access Denied</Text>
        <Text className="text-typography-muted text-sm text-center mt-2">You don't have permission to view projects.</Text>
      </View>
    );
  }

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

  const bumpTable = () => setTableRefreshKey(k => k + 1);

  return (
    <View className="flex-1 bg-surface-background p-10">
      <View className="max-w-[1600px] mx-auto w-full flex-1">
        {/* Header */}
        <View className="flex-row items-center justify-between mb-8">
          <View>
            <Text className="text-typography-main text-5xl font-black tracking-tighter">Projects</Text>
            <Text className="text-typography-muted text-lg mt-2 font-medium">Manage your projects and team initiatives</Text>
          </View>

          <View className="flex-row items-center gap-6">
            {hasPermission('project.create') && (
              <TouchableOpacity
                onPress={() => setBulkCreateVisible(true)}
                className="bg-surface-card border border-surface-border px-6 py-4 rounded-2xl premium-shadow active:scale-95 transition-transform flex-row items-center"
              >
                <FontAwesome name="magic" size={14} color={colors.primary} className="mr-3" />
                <Text className="text-typography-main font-black uppercase tracking-widest text-sm">Bulk Create</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              onPress={handleCreateNew}
              className="bg-brand-primary px-8 py-4 rounded-2xl premium-shadow active:scale-95 transition-transform flex-row items-center"
            >
              <FontAwesome name="plus" size={14} color="white" className="mr-3" />
              <Text className="text-white font-black uppercase tracking-widest text-sm">Create Project</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* View toggle — Board (#173 Phase 6) and Timeline are future phases, shown disabled rather than stubbed */}
        <View className="flex-row items-center gap-2 mb-6">
          <View className="px-5 py-2.5 rounded-xl bg-brand-primary/10 border border-brand-primary flex-row items-center gap-2">
            <FontAwesome name="table" size={12} color={colors.primary} />
            <Text className="text-brand-primary text-xs font-black uppercase tracking-widest">Table</Text>
          </View>
          <Tooltip label="Coming in Phase 6">
            <View className="px-5 py-2.5 rounded-xl border border-surface-border opacity-40 flex-row items-center gap-2">
              <FontAwesome name="columns" size={12} color={colors.textMuted} />
              <Text className="text-typography-muted text-xs font-black uppercase tracking-widest">Board</Text>
            </View>
          </Tooltip>
          <Tooltip label="Coming later">
            <View className="px-5 py-2.5 rounded-xl border border-surface-border opacity-40 flex-row items-center gap-2">
              <FontAwesome name="long-arrow-right" size={12} color={colors.textMuted} />
              <Text className="text-typography-muted text-xs font-black uppercase tracking-widest">Timeline</Text>
            </View>
          </Tooltip>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} className="flex-1">
          <ProjectsTable refreshKey={tableRefreshKey} onOpenProject={setDashboardProjectId} />
          <View className="h-20" />
        </ScrollView>
      </View>

      <ProjectFolderModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onSuccess={() => { fetchProjects(); bumpTable(); }}
        project={selectedProject}
      />

      <ProjectDashboard
        visible={!!dashboardProjectId}
        projectId={dashboardProjectId}
        onClose={() => setDashboardProjectId(null)}
        onEdit={() => {
          const p = projects.find(pr => pr.id === dashboardProjectId);
          setDashboardProjectId(null);
          if (p) handleEdit(p);
        }}
      />

      <BulkCreateProjectsSheet
        visible={bulkCreateVisible}
        onClose={() => setBulkCreateVisible(false)}
        onCreated={(res) => {
          showAlert('Bulk Create Complete', `Created ${res.projects_created} projects and ${res.tasks_created} tasks.`);
          fetchProjects();
          bumpTable();
        }}
      />
    </View>
  );
}

import { useThemeColors } from '@/hooks/useThemeColors';
