import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Platform,
  useWindowDimensions
} from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import ProjectFolderModal from '@/components/projects/ProjectFolderModal';
import BulkCreateProjectsSheet from '@/components/projects/BulkCreateProjectsSheet';
import ProjectsTable from '@/components/projects/ProjectsTable';
import { useAuth } from '@/contexts/AuthContext';
import { useAlert } from '@/contexts/AlertContext';
import { TAB_BAR_HEIGHT } from '@/lib/layout';
import { useNavBarPosition } from '@/hooks/useNavBarPosition';
import { useThemeColors } from '@/hooks/useThemeColors';
import Tooltip from '@/components/common/Tooltip';

export default function ProjectsScreen() {
  const colors = useThemeColors();
  const { showAlert } = useAlert();
  const { width } = useWindowDimensions();
  const router = useRouter();
  // #184: project edit now happens inside the /projects/[id] route's
  // ProjectHeader.tsx (which has the project row from its own context), so
  // this screen's ProjectFolderModal is create-only -- it no longer needs a
  // local `projects` fetch just to hand an existing row to the modal.
  const [modalVisible, setModalVisible] = useState(false);
  const [bulkCreateVisible, setBulkCreateVisible] = useState(false);
  const [tableRefreshKey, setTableRefreshKey] = useState(0);
  const bumpTable = () => setTableRefreshKey(k => k + 1);

  const { hasPermission } = useAuth();
  const isWeb = Platform.OS === 'web';
  const isLargeScreen = width > 768;
  const { position: navPosition } = useNavBarPosition();

  const canViewProjects = hasPermission('project.view');

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

  const handleCreateNew = () => {
    if (!hasPermission('project.create')) {
      showAlert('Permission Denied', 'You do not have permission to create projects.');
      return;
    }
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
          onOpenProject={(id) => router.push(`/projects/${id}` as any)}
          onBrowseStarters={hasPermission('project.create') ? () => setBulkCreateVisible(true) : undefined}
        />
      </ScrollView>

      <ProjectFolderModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onSuccess={bumpTable}
      />

      <BulkCreateProjectsSheet
        visible={bulkCreateVisible}
        onClose={() => setBulkCreateVisible(false)}
        onCreated={(res) => {
          showAlert('Bulk Create Complete', `Created ${res.projects_created} projects and ${res.tasks_created} tasks.`);
          bumpTable();
        }}
      />
    </View>
  );
}
