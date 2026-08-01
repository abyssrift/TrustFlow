import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  InteractionManager,
  Platform,
  useWindowDimensions
} from 'react-native';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import ProjectFolderModal from '@/components/projects/ProjectFolderModal';
import ProjectDashboardSheet from '@/components/projects/ProjectDashboardSheet';
import BulkCreateProjectsSheet from '@/components/projects/BulkCreateProjectsSheet';
import SpreadsheetImportSheet from '@/components/projects/SpreadsheetImportSheet';
import ProjectsTable from '@/components/projects/ProjectsTable';
import { useAuth } from '@/contexts/AuthContext';
import { useAlert } from '@/contexts/AlertContext';
import { TAB_BAR_HEIGHT } from '@/lib/layout';
import { useNavBarPosition } from '@/hooks/useNavBarPosition';
import { useThemeColors } from '@/hooks/useThemeColors';
import Tooltip from '@/components/common/Tooltip';

type Project = {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'closed' | 'archived';
  expiry_date: string | null;
};

export default function ProjectsScreen() {
  const colors = useThemeColors();
  const { showAlert } = useAlert();
  const { width } = useWindowDimensions();
  // Raw project rows are still fetched for the edit modal (ProjectFolderModal
  // needs name/description/status/expiry_date, which the table RPC doesn't
  // carry) — the dense listing itself is fetched independently inside
  // ProjectsTable via rpc_projects_table.
  const [projects, setProjects] = useState<Project[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | undefined>();
  const [dashboardProjectId, setDashboardProjectId] = useState<string | null>(null);
  const [bulkCreateVisible, setBulkCreateVisible] = useState(false);
  const [spreadsheetImportVisible, setSpreadsheetImportVisible] = useState(false);
  const [tableRefreshKey, setTableRefreshKey] = useState(0);
  const bumpTable = () => setTableRefreshKey(k => k + 1);

  const { hasPermission } = useAuth();
  const isWeb = Platform.OS === 'web';
  const isLargeScreen = width > 768;
  const { position: navPosition } = useNavBarPosition();

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
    // flip true once auth resolves — this effect's deps include canViewProjects
    // so the fetch fires once it does, instead of only ever firing (or not)
    // based on whatever the permission happened to be at mount time.
    if (!canViewProjects) return;
    // On web, InteractionManager.runAfterInteractions can hang indefinitely
    // (its handle never clears with ongoing subscriptions/animations), so the
    // callback never fires and loading stays true forever. Run directly on web.
    if (Platform.OS === 'web') {
      fetchProjects();
      return;
    }
    const task = InteractionManager.runAfterInteractions(() => {
      fetchProjects();
    });
    return () => task.cancel();
  }, [canViewProjects]);

  // Permission check: user must have project.view permission. Placed after
  // every hook call above (never before) so the same hooks run on every
  // render regardless of when the permission itself resolves — an early
  // return before a hook call here previously caused "Rendered more hooks
  // than during the previous render" whenever permissions loaded async
  // and flipped false -> true between renders (issue #96).
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
      showAlert('Permission Denied', 'You do not have permission to edit projects.');
      return;
    }
    setSelectedProject(project);
    setModalVisible(true);
  };

  const handleCreateNew = () => {
    if (!hasPermission('project.create')) {
      showAlert('Permission Denied', 'You do not have permission to create projects.');
      return;
    }
    setSelectedProject(undefined);
    setModalVisible(true);
  };

  return (
    <View className="flex-1 bg-surface-background">
      {/* Header */}
      <View className={`flex-row items-center justify-between px-6 ${isWeb ? 'py-8 border-b border-surface-border' : 'pb-3'}`} style={isWeb ? (!isLargeScreen && navPosition === 'top' ? { paddingTop: TAB_BAR_HEIGHT.web } : undefined) : { paddingTop: TAB_BAR_HEIGHT.native }}>
        <View className="flex-1 mr-3">
          <Text className={`${isWeb ? (isLargeScreen ? 'text-5xl' : 'text-3xl') : 'text-2xl'} text-typography-main font-black tracking-tighter`}>Projects</Text>
          {isWeb && (
            <Text className="text-typography-muted text-sm font-medium">Manage your projects and team initiatives</Text>
          )}
        </View>

        <View className="flex-row items-center gap-3 flex-shrink-0">
          {hasPermission('project.create') && (
            <Tooltip label="Import from spreadsheet">
              <TouchableOpacity
                onPress={() => setSpreadsheetImportVisible(true)}
                className="bg-surface-card border border-surface-border p-3 rounded-xl"
              >
                <FontAwesome name="file-excel-o" size={16} color={colors.primary} />
              </TouchableOpacity>
            </Tooltip>
          )}

          {hasPermission('project.create') && (
            <Tooltip label="Bulk create from template">
              <TouchableOpacity
                onPress={() => setBulkCreateVisible(true)}
                className="bg-surface-card border border-surface-border p-3 rounded-xl"
              >
                <FontAwesome name="magic" size={16} color={colors.primary} />
              </TouchableOpacity>
            </Tooltip>
          )}

          <Tooltip label="Create project">
            <TouchableOpacity
              onPress={handleCreateNew}
              className="bg-brand-primary p-3 rounded-xl"
            >
              <FontAwesome name="plus" size={16} color="white" />
            </TouchableOpacity>
          </Tooltip>
        </View>
      </View>

      {/* View toggle — Board (#173 Phase 6) and Timeline are future phases, shown disabled rather than stubbed */}
      <View className="flex-row items-center gap-2 px-6 pt-4">
        <View className="px-4 py-2 rounded-xl bg-brand-primary/10 border border-brand-primary flex-row items-center gap-1.5">
          <FontAwesome name="table" size={11} color={colors.primary} />
          <Text className="text-brand-primary text-[11px] font-black uppercase tracking-widest">Table</Text>
        </View>
        <View className="px-4 py-2 rounded-xl border border-surface-border opacity-40 flex-row items-center gap-1.5">
          <FontAwesome name="columns" size={11} color={colors.textMuted} />
          <Text className="text-typography-muted text-[11px] font-black uppercase tracking-widest">Board</Text>
        </View>
        <View className="px-4 py-2 rounded-xl border border-surface-border opacity-40 flex-row items-center gap-1.5">
          <FontAwesome name="long-arrow-right" size={11} color={colors.textMuted} />
          <Text className="text-typography-muted text-[11px] font-black uppercase tracking-widest">Timeline</Text>
        </View>
      </View>

      <ScrollView
        className="flex-1 px-6 pt-4"
        contentContainerStyle={{ paddingBottom: isWeb ? 32 : TAB_BAR_HEIGHT.native + 16 }}
      >
        <ProjectsTable
          refreshKey={tableRefreshKey}
          onOpenProject={setDashboardProjectId}
          onBrowseStarters={hasPermission('project.create') ? () => setBulkCreateVisible(true) : undefined}
        />
      </ScrollView>

      <ProjectFolderModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onSuccess={() => { fetchProjects(); bumpTable(); }}
        project={selectedProject}
      />

      <ProjectDashboardSheet
        visible={!!dashboardProjectId}
        projectId={dashboardProjectId}
        onClose={() => setDashboardProjectId(null)}
        onEdit={hasPermission('project.edit') ? () => {
          const p = projects.find(pr => pr.id === dashboardProjectId);
          setDashboardProjectId(null);
          if (p) handleEdit(p);
        } : undefined}
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

      <SpreadsheetImportSheet
        visible={spreadsheetImportVisible}
        onClose={() => setSpreadsheetImportVisible(false)}
        onCreated={(res) => {
          showAlert('Import Complete', `Created ${res.projects_created} projects and ${res.tasks_created} tasks.`);
          fetchProjects();
          bumpTable();
        }}
      />
    </View>
  );
}
