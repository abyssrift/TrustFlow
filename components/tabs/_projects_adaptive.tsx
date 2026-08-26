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
import SpreadsheetImportSheet from '@/components/projects/SpreadsheetImportSheet';
import ProjectsTable from '@/components/projects/ProjectsTable';
import ProjectBoard from '@/components/projects/ProjectBoard';
import ProjectsTimeline from '@/components/projects/ProjectsTimeline';
import PortfolioScopeHeader from '@/components/portfolios/PortfolioScopeHeader';
import ManageProjectFieldsPopup from '@/components/projects/ManageProjectFieldsPopup';
import Popup from '@/components/common/Popup';
import { useAuth } from '@/contexts/AuthContext';
import { useAlert } from '@/contexts/AlertContext';
import { TAB_BAR_HEIGHT } from '@/lib/layout';
import { useNavBarPosition } from '@/hooks/useNavBarPosition';
import { useThemeColors } from '@/hooks/useThemeColors';
import { usePersistedState } from '@/hooks/usePersistedState';
import { isProjectsView, type ProjectsView } from '@/lib/projectPresentation';
import Tooltip from '@/components/common/Tooltip';
import { EntityGlyph, EntityTag, SegmentedControl } from '@/components/entities/EntityUI';

// Phase 8 (#187) — the narrow/native sibling of _projects_desktop.tsx. Same
// reduction: one primary action, one "add many" door, one segmented view
// control, and an entity tag + glyph so the screen says what a project is
// (plan §17). The two files stay separate because the header layout genuinely
// diverges (icon-only actions and a tab-bar inset here), but every piece of
// the vocabulary comes from components/entities/EntityUI.tsx, so a project
// card at 390px and one at 1400px are the same object.

// Phase 10 (#191): same optional portfolio scope as _projects_desktop.tsx, so
// mobile web and native land on the same screen, not a desktop-only fix.
export default function ProjectsScreen({ portfolioId }: { portfolioId?: string } = {}) {
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
  const [spreadsheetImportVisible, setSpreadsheetImportVisible] = useState(false);
  const [addMenuVisible, setAddMenuVisible] = useState(false);
  const [manageFieldsVisible, setManageFieldsVisible] = useState(false);
  const [tableRefreshKey, setTableRefreshKey] = useState(0);
  const bumpTable = () => setTableRefreshKey(k => k + 1);
  // #176 Projects P6 -- Table/Board toggle; Timeline landed in Phase 10 (#191).
  // Persisted: switching to Board and coming back to a List you did not choose
  // is the kind of small betrayal that makes an app feel like it is not
  // listening. Still validated on read, and the guard is shared with
  // _projects_desktop.tsx (lib/projectPresentation.ts) so the two screens
  // reading the same storage key cannot disagree about what is valid.
  const [view, setView] = usePersistedState<ProjectsView>(
    'projects_view',
    'table',
    isProjectsView,
  );

  const { hasPermission } = useAuth();
  const isWeb = Platform.OS === 'web';
  const isLargeScreen = width > 768;
  const { position: navPosition } = useNavBarPosition();

  const canViewProjects = hasPermission('project.view');
  const canCreate = hasPermission('project.create');
  const canManageFields = hasPermission('project.edit');

  // Permission check: user must have project.view permission. Placed after
  // every hook call above (never before) so the same hooks run on every
  // render regardless of when the permission itself resolves — an early
  // return before a hook call here previously caused "Rendered more hooks
  // than during the previous render" whenever permissions loaded async
  // and flipped false -> true between renders (issue #96).
  if (!canViewProjects) {
    return (
      <View className="flex-1 bg-surface-background items-center justify-center p-10">
        <FontAwesome name="lock" size={40} color={colors.textMuted} />
        <Text className="text-typography-main text-xl font-bold mt-4">You can’t see projects</Text>
        <Text className="text-typography-muted text-sm text-center mt-2 leading-5">
          Projects are hidden for your role. An owner can grant the “view projects” permission from Settings → Roles.
        </Text>
      </View>
    );
  }

  // See _projects_desktop.tsx — create actions all take portfolioId now, so
  // a scoped screen gets the same three doors as the unscoped header.
  const scoped = !!portfolioId;

  const headerInset = isWeb
    ? (!isLargeScreen && navPosition === 'top' ? { paddingTop: TAB_BAR_HEIGHT.web } : undefined)
    : { paddingTop: TAB_BAR_HEIGHT.native };

  return (
    <View className="flex-1 bg-surface-background">
      {scoped ? (
        <View className="px-4 pt-3 pb-1" style={headerInset}>
          <PortfolioScopeHeader
            portfolioId={portfolioId!}
            onAllProjects={() => router.push('/(tabs)/projects' as any)}
            actions={
              <>
                <Tooltip label="Templates">
                  <TouchableOpacity
                    onPress={() => router.push('/projects/templates' as any)}
                    accessibilityRole="button"
                    accessibilityLabel="Templates"
                    className="bg-surface-card border border-surface-border rounded-xl items-center justify-center"
                    style={{ width: 40, height: 40 }}
                  >
                    <FontAwesome name="list-alt" size={14} color={colors.textMuted} />
                  </TouchableOpacity>
                </Tooltip>

                {(canCreate || canManageFields) && (
                  <Tooltip label="Add several, or manage custom fields">
                    <TouchableOpacity
                      onPress={() => setAddMenuVisible(true)}
                      accessibilityRole="button"
                      accessibilityLabel="More project tools"
                      className="bg-surface-card border border-surface-border rounded-xl items-center justify-center"
                      style={{ width: 40, height: 40 }}
                    >
                      <FontAwesome name="th-list" size={14} color={colors.textMuted} />
                    </TouchableOpacity>
                  </Tooltip>
                )}

                <Tooltip label={canCreate ? 'Create a project in this portfolio' : 'You need the “create projects” permission'}>
                  <TouchableOpacity
                    onPress={() => canCreate ? setModalVisible(true) : showAlert('Not allowed', 'You need the “create projects” permission. An owner can grant it from Settings → Roles.')}
                    accessibilityRole="button"
                    accessibilityLabel="New project"
                    className="bg-brand-primary rounded-xl items-center justify-center"
                    style={{ width: 40, height: 40, opacity: canCreate ? 1 : 0.45 }}
                  >
                    <FontAwesome name="plus" size={14} color="white" />
                  </TouchableOpacity>
                </Tooltip>
              </>
            }
          />
        </View>
      ) : (
      /* Header */
      <View
        className={`flex-row items-center justify-between px-4 gap-3 ${isWeb ? 'py-5 border-b border-surface-border' : 'pb-3'}`}
        style={headerInset}
      >
        <View className="flex-row items-center gap-2.5 flex-1 min-w-0">
          <EntityGlyph kind="project" size={34} />
          <View className="flex-1 min-w-0">
            <EntityTag kind="project" />
            <Text className={`${isLargeScreen ? 'text-2xl' : 'text-xl'} text-typography-main font-black tracking-tight`}>Projects</Text>
          </View>
        </View>

        <View className="flex-row items-center gap-2 flex-shrink-0">
          {/* Icon-only here (the header is 3 controls at 390px), but present —
              a template you cannot reopen on mobile is a template you cannot
              reopen. */}
          <Tooltip label="Templates">
            <TouchableOpacity
              onPress={() => router.push('/projects/templates' as any)}
              accessibilityRole="button"
              accessibilityLabel="Templates"
              className="bg-surface-card border border-surface-border rounded-xl items-center justify-center"
              style={{ width: 44, height: 44 }}
            >
              <FontAwesome name="list-alt" size={15} color={colors.textMuted} />
            </TouchableOpacity>
          </Tooltip>

          {(canCreate || canManageFields) && (
            <Tooltip label="Add several, or manage custom fields">
              <TouchableOpacity
                onPress={() => setAddMenuVisible(true)}
                accessibilityRole="button"
                accessibilityLabel="More project tools"
                className="bg-surface-card border border-surface-border rounded-xl items-center justify-center"
                style={{ width: 44, height: 44 }}
              >
                <FontAwesome name="th-list" size={15} color={colors.textMuted} />
              </TouchableOpacity>
            </Tooltip>
          )}

          <Tooltip label={canCreate ? 'Create a project' : 'You need the “create projects” permission'}>
            <TouchableOpacity
              onPress={() => canCreate ? setModalVisible(true) : showAlert('Not allowed', 'You need the “create projects” permission. An owner can grant it from Settings → Roles.')}
              accessibilityRole="button"
              accessibilityLabel="New project"
              className="bg-brand-primary rounded-xl items-center justify-center"
              style={{ width: 44, height: 44, opacity: canCreate ? 1 : 0.45 }}
            >
              <FontAwesome name="plus" size={15} color="white" />
            </TouchableOpacity>
          </Tooltip>
        </View>
      </View>
      )}

      {/* View toggle — Board shipped #176 (Phase 6), Timeline #191 (Phase 10). */}
      <View className="px-4 pt-3">
        <SegmentedControl<ProjectsView>
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: 'table', label: 'List', icon: 'table' },
            { value: 'board', label: 'Board', icon: 'columns' },
            { value: 'timeline', label: 'Timeline', icon: 'long-arrow-right' },
          ]}
        />
      </View>

      {view === 'table' ? (
        <ScrollView
          className="flex-1 pt-3"
          contentContainerStyle={{ paddingBottom: isWeb ? 32 : TAB_BAR_HEIGHT.native + 16 }}
        >
          <ProjectsTable
            refreshKey={tableRefreshKey}
            portfolioId={portfolioId ?? null}
            onOpenProject={(id) => router.push(`/projects/${id}` as any)}
            onBrowseStarters={canCreate ? () => setBulkCreateVisible(true) : undefined}
            onCreateProject={canCreate ? () => setModalVisible(true) : undefined}
          />
        </ScrollView>
      ) : view === 'timeline' ? (
        <ScrollView
          className="flex-1 pt-3"
          contentContainerStyle={{ paddingBottom: isWeb ? 32 : TAB_BAR_HEIGHT.native + 16, paddingHorizontal: 16 }}
        >
          <ProjectsTimeline
            refreshKey={tableRefreshKey}
            portfolioId={portfolioId ?? null}
            onOpenProject={(id) => router.push(`/projects/${id}` as any)}
            onBrowseStarters={canCreate ? () => setBulkCreateVisible(true) : undefined}
            onCreateProject={canCreate ? () => setModalVisible(true) : undefined}
          />
        </ScrollView>
      ) : (
        <View className="flex-1 pt-3">
          <ProjectBoard
            refreshKey={tableRefreshKey}
            portfolioId={portfolioId ?? null}
            onOpenProject={(id) => router.push(`/projects/${id}` as any)}
          />
        </View>
      )}

      <Popup
        visible={addMenuVisible}
        onClose={() => setAddMenuVisible(false)}
        presentation="auto"
        maxWidth={460}
        title="More project tools"
        scrollable={false}
      >
        <View className="px-5 py-4 gap-3">
          <View className="gap-2">
            <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider px-1">Add several</Text>
            <TouchableOpacity
              onPress={() => { setAddMenuVisible(false); setSpreadsheetImportVisible(true); }}
              accessibilityRole="button"
              className="flex-row items-start gap-3 rounded-xl border border-surface-border p-3.5"
              style={{ minHeight: 44 }}
            >
              <FontAwesome name="file-excel-o" size={16} color={colors.primary} style={{ marginTop: 2 }} />
              <View className="flex-1">
                <Text className="text-typography-main text-sm font-bold">Import a spreadsheet</Text>
                <Text className="text-typography-muted text-xs mt-0.5 leading-4">
                  Drop in a client list or engagement schedule. It reads the columns for you, then you confirm.
                </Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { setAddMenuVisible(false); setBulkCreateVisible(true); }}
              accessibilityRole="button"
              className="flex-row items-start gap-3 rounded-xl border border-surface-border p-3.5"
              style={{ minHeight: 44 }}
            >
              <FontAwesome name="magic" size={16} color={colors.primary} style={{ marginTop: 2 }} />
              <View className="flex-1">
                <Text className="text-typography-main text-sm font-bold">Create from a template</Text>
                <Text className="text-typography-muted text-xs mt-0.5 leading-4">
                  Paste a list of names and pick a template. Every project starts with the same task list and schedule.
                </Text>
              </View>
            </TouchableOpacity>
          </View>

          {canManageFields && (
            <View className="gap-2 pt-1 border-t border-surface-border">
              <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider px-1 mt-2">Manage</Text>
              <TouchableOpacity
                onPress={() => { setAddMenuVisible(false); setManageFieldsVisible(true); }}
                accessibilityRole="button"
                className="flex-row items-start gap-3 rounded-xl border border-surface-border p-3.5"
                style={{ minHeight: 44 }}
              >
                <FontAwesome name="table" size={16} color={colors.primary} style={{ marginTop: 2 }} />
                <View className="flex-1">
                  <Text className="text-typography-main text-sm font-bold">Custom fields</Text>
                  <Text className="text-typography-muted text-xs mt-0.5 leading-4">
                    Rename, retype, reorder or remove the columns your spreadsheet imports created.
                  </Text>
                </View>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </Popup>

      <ProjectFolderModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onSuccess={bumpTable}
        portfolioId={portfolioId}
      />

      <BulkCreateProjectsSheet
        visible={bulkCreateVisible}
        onClose={() => setBulkCreateVisible(false)}
        onCreated={(res) => {
          showAlert('Projects created', `${res.projects_created} projects and ${res.tasks_created} tasks are ready.`);
          bumpTable();
        }}
        portfolioId={portfolioId}
      />

      <SpreadsheetImportSheet
        visible={spreadsheetImportVisible}
        onClose={() => setSpreadsheetImportVisible(false)}
        onCreated={(res) => {
          showAlert('Import finished', `${res.projects_created} projects and ${res.tasks_created} tasks are ready.`);
          bumpTable();
        }}
        portfolioId={portfolioId}
      />

      <ManageProjectFieldsPopup
        visible={manageFieldsVisible}
        onClose={() => setManageFieldsVisible(false)}
      />
    </View>
  );
}
