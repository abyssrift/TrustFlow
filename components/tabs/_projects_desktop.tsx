import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useAlert } from '@/contexts/AlertContext';
import { useAuth } from '@/contexts/AuthContext';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import ProjectFolderModal from '@/components/projects/ProjectFolderModal';
import Tooltip from '@/components/common/Tooltip';
import Popup from '@/components/common/Popup';
import BulkCreateProjectsSheet from '@/components/projects/BulkCreateProjectsSheet';
import SpreadsheetImportSheet from '@/components/projects/SpreadsheetImportSheet';
import ManageProjectFieldsPopup from '@/components/projects/ManageProjectFieldsPopup';
import ProjectsTable from '@/components/projects/ProjectsTable';
import ProjectBoard from '@/components/projects/ProjectBoard';
import ProjectsTimeline from '@/components/projects/ProjectsTimeline';
import PortfolioScopeHeader from '@/components/portfolios/PortfolioScopeHeader';
import { EntityGlyph, EntityTag, SegmentedControl } from '@/components/entities/EntityUI';
import { useThemeColors } from '@/hooks/useThemeColors';
import { usePersistedState } from '@/hooks/usePersistedState';
import { isProjectsView, type ProjectsView } from '@/lib/projectPresentation';

// Phase 8 (#187, plan §14/§17). What changed and why:
//
// The complaint was "so many things happening at once". This screen opened
// with a 5xl display title, three full-size buttons of equal weight, and
// three separately-outlined view toggles — nine competing objects before a
// single project appeared. Now there is ONE primary action (Create project),
// one "More ways to add" popup holding the two bulk paths, and one segmented
// control for the view. The loud thing on the screen is the data.
//
// The title carries the entity tag and the project glyph, because §17's
// diagnosis is that users cannot tell a project from a portfolio from a board
// from a task — so every projects surface now says which one it is, in the
// same vocabulary (components/entities/EntityUI.tsx).

// Phase 10 (#191): this screen now takes an optional portfolio scope.
//
// "i was hoping the portfolio would just be ABOVE projects, but not a whole
// different directory / category... portfolios are composed of projects after
// all". So /portfolios/[id] renders THIS component with portfolioId set — the
// portfolio's rollup sits above, the screen below is the one the user already
// likes, with search, filters, sorting, paging and all three views intact.
// There is no second projects screen.
export default function ProjectsScreenWeb({ portfolioId }: { portfolioId?: string } = {}) {
  const colors = useThemeColors();
  const { showAlert } = useAlert();
  const { hasPermission } = useAuth();

  // #184: project edit now happens inside the /projects/[id] route's
  // ProjectHeader.tsx (which has the project row from its own context), so
  // this screen's ProjectFolderModal is create-only -- it no longer needs a
  // local `projects` fetch just to hand an existing row to the modal.
  const router = useRouter();
  const [modalVisible, setModalVisible] = useState(false);
  const [bulkCreateVisible, setBulkCreateVisible] = useState(false);
  const [spreadsheetImportVisible, setSpreadsheetImportVisible] = useState(false);
  const [addMenuVisible, setAddMenuVisible] = useState(false);
  const [manageFieldsVisible, setManageFieldsVisible] = useState(false);
  const [tableRefreshKey, setTableRefreshKey] = useState(0);
  // #176 Projects P6 -- Table/Board toggle; Timeline landed in Phase 10 (#191).
  // Persisted: switching to Board and coming back to a List you did not choose
  // is the kind of small betrayal that makes an app feel like it is not
  // listening. Still validated on read — what comes back from storage is a
  // string written by an older build, and an unknown one must fall back to the
  // list rather than strand the screen on a view this build cannot render.
  const [view, setView] = usePersistedState<ProjectsView>(
    'projects_view',
    'table',
    isProjectsView,
  );

  const canViewProjects = hasPermission('project.view');
  const canCreate = hasPermission('project.create');
  const canManageFields = hasPermission('project.edit');

  // Permission check: user must have project.view permission. Placed after
  // every hook call above (never before) so the same hooks run on every
  // render regardless of when the permission itself resolves — an early
  // return before a hook call here previously caused "Rendered more hooks
  // than during the previous render" whenever permissions loaded async and
  // flipped false -> true between renders (issue #96).
  if (!canViewProjects) {
    return (
      <View className="flex-1 bg-surface-background items-center justify-center p-10">
        <FontAwesome name="lock" size={40} color={colors.textMuted} />
        <Text className="text-typography-main text-xl font-bold mt-4">You can’t see projects</Text>
        <Text className="text-typography-muted text-sm text-center mt-2 max-w-sm leading-5">
          Projects are hidden for your role. An owner can grant the “view projects” permission from Settings → Roles.
        </Text>
      </View>
    );
  }

  const bumpTable = () => setTableRefreshKey(k => k + 1);

  // Scoped to one batch: the identity on screen is the PORTFOLIO's. Create
  // actions all take portfolioId now (20260818_append_projects_to_existing_
  // portfolio.sql gave rpc_create_project/rpc_instantiate_template an
  // optional target-portfolio param) so New project / Add many / Templates
  // attach into THIS portfolio instead of creating an unbatched project or a
  // second portfolio — the header's action row (PortfolioScopeHeader's
  // `actions` slot) is the same three doors as the unscoped header, just
  // scoped.
  const scoped = !!portfolioId;

  return (
    <View className="flex-1 bg-surface-background px-8 py-4">
      <View className="max-w-[1600px] mx-auto w-full flex-1">
        {scoped ? (
          <View className="mb-3">
            <PortfolioScopeHeader
              portfolioId={portfolioId!}
              onAllProjects={() => router.push('/(tabs)/projects' as any)}
              actions={
                <>
                  <Tooltip label="Open, edit and reuse your saved templates">
                    <TouchableOpacity
                      onPress={() => router.push('/projects/templates' as any)}
                      accessibilityRole="button"
                      accessibilityLabel="Templates"
                      className="h-11 w-11 items-center justify-center bg-surface-card border border-surface-border rounded-xl hover:bg-surface-overlay"
                    >
                      <FontAwesome name="list-alt" size={13} color={colors.textMuted} />
                    </TouchableOpacity>
                  </Tooltip>

                  {(canCreate || canManageFields) && (
                    <Tooltip label="Bulk create, import a spreadsheet, or manage custom fields">
                      <TouchableOpacity
                        onPress={() => setAddMenuVisible(true)}
                        accessibilityRole="button"
                        accessibilityLabel="More project tools"
                        className="h-11 w-11 items-center justify-center bg-surface-card border border-surface-border rounded-xl hover:bg-surface-overlay"
                      >
                        <FontAwesome name="th-list" size={13} color={colors.textMuted} />
                      </TouchableOpacity>
                    </Tooltip>
                  )}

                  <Tooltip label={canCreate ? 'Create a single project in this portfolio' : 'You need the “create projects” permission'}>
                    <TouchableOpacity
                      onPress={() => canCreate && setModalVisible(true)}
                      disabled={!canCreate}
                      accessibilityRole="button"
                      className="bg-brand-primary hover:bg-brand-primary-hover px-4 rounded-xl flex-row items-center gap-2 justify-center"
                      style={{ minHeight: 44, opacity: canCreate ? 1 : 0.45 }}
                    >
                      <FontAwesome name="plus" size={13} color="white" />
                      <Text className="text-white text-sm font-bold">New project</Text>
                    </TouchableOpacity>
                  </Tooltip>
                </>
              }
            />
          </View>
        ) : (
        /* Header — one identity, one primary action, one overflow. */
        <View className="flex-row items-center justify-between gap-4 mb-5">
          <View className="flex-row items-center gap-3">
            <EntityGlyph kind="project" size={44} />
            <View>
              <EntityTag kind="project" />
              <Text className="text-typography-main text-3xl font-black tracking-tight">Projects</Text>
              <Text className="text-typography-muted text-sm mt-0.5">
                One project is one piece of work for one client — its tasks, its deadline, its stage.
              </Text>
            </View>
          </View>

          <View className="flex-row items-center gap-2 flex-shrink-0">
            {/* The templates library. The editor has existed since #177 but was
                reachable only from "Save as template" and from the starter
                picker inside Bulk Create — both one-way creation doors, so a
                saved template could never be opened again. This is the door
                back in. */}
            <Tooltip label="Open, edit and reuse your saved templates">
              <TouchableOpacity
                onPress={() => router.push('/projects/templates' as any)}
                accessibilityRole="button"
                accessibilityLabel="Templates"
                className="bg-surface-card border border-surface-border px-4 rounded-xl hover:bg-surface-overlay flex-row items-center gap-2 justify-center"
                style={{ minHeight: 44 }}
              >
                <FontAwesome name="list-alt" size={13} color={colors.textMuted} />
                <Text className="text-typography-main text-sm font-semibold">Templates</Text>
              </TouchableOpacity>
            </Tooltip>

            {(canCreate || canManageFields) && (
              <Tooltip label="Bulk create, import a spreadsheet, or manage custom fields">
                <TouchableOpacity
                  onPress={() => setAddMenuVisible(true)}
                  accessibilityRole="button"
                  accessibilityLabel="More project tools"
                  className="bg-surface-card border border-surface-border px-4 rounded-xl hover:bg-surface-overlay flex-row items-center gap-2 justify-center"
                  style={{ minHeight: 44 }}
                >
                  <FontAwesome name="th-list" size={13} color={colors.textMuted} />
                  <Text className="text-typography-main text-sm font-semibold">Add many</Text>
                </TouchableOpacity>
              </Tooltip>
            )}

            <Tooltip label={canCreate ? 'Create a single project' : 'You need the “create projects” permission'}>
              <TouchableOpacity
                onPress={() => canCreate && setModalVisible(true)}
                disabled={!canCreate}
                accessibilityRole="button"
                className="bg-brand-primary hover:bg-brand-primary-hover px-5 rounded-xl flex-row items-center gap-2 justify-center"
                style={{ minHeight: 44, opacity: canCreate ? 1 : 0.45 }}
              >
                <FontAwesome name="plus" size={13} color="white" />
                <Text className="text-white text-sm font-bold">New project</Text>
              </TouchableOpacity>
            </Tooltip>
          </View>
        </View>
        )}

        {/* View toggle — Board shipped #176 (Phase 6), Timeline #191 (Phase 10). */}
        <View className="mb-2">
          <SegmentedControl<ProjectsView>
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
          <ScrollView showsVerticalScrollIndicator={false} className="flex-1">
            <ProjectsTable
              refreshKey={tableRefreshKey}
              portfolioId={portfolioId ?? null}
              onOpenProject={(id) => router.push(`/projects/${id}` as any)}
              onBrowseStarters={canCreate ? () => setBulkCreateVisible(true) : undefined}
              onCreateProject={canCreate ? () => setModalVisible(true) : undefined}
            />
            <View className="h-16" />
          </ScrollView>
        ) : view === 'timeline' ? (
          <ScrollView showsVerticalScrollIndicator={false} className="flex-1">
            <ProjectsTimeline
              refreshKey={tableRefreshKey}
              portfolioId={portfolioId ?? null}
              onOpenProject={(id) => router.push(`/projects/${id}` as any)}
              onBrowseStarters={canCreate ? () => setBulkCreateVisible(true) : undefined}
              onCreateProject={canCreate ? () => setModalVisible(true) : undefined}
            />
            <View className="h-16" />
          </ScrollView>
        ) : (
          <ProjectBoard
            refreshKey={tableRefreshKey}
            portfolioId={portfolioId ?? null}
            onOpenProject={(id) => router.push(`/projects/${id}` as any)}
          />
        )}
      </View>

      {/* The two bulk paths, off the main bar. Both create many projects at
          once, so they belong together and behind one door rather than beside
          the single-project action. Issue #197 item 4 (manage custom fields)
          joined this door too, rather than earning its own toolbar icon —
          mobile's header is already at its 3-icon budget (see
          _projects_adaptive.tsx), so a fourth action goes here on both
          platforms for one consistent entry point instead of two. */}
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
            <AddOption
              icon="file-excel-o"
              title="Import a spreadsheet"
              body="Drop in a client list or engagement schedule. It reads the columns for you, then you confirm."
              onPress={() => { setAddMenuVisible(false); setSpreadsheetImportVisible(true); }}
            />
            <AddOption
              icon="magic"
              title="Create from a template"
              body="Paste a list of names and pick a template. Every project starts with the same task list and schedule."
              onPress={() => { setAddMenuVisible(false); setBulkCreateVisible(true); }}
            />
          </View>

          {canManageFields && (
            <View className="gap-2 pt-1 border-t border-surface-border">
              <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider px-1 mt-2">Manage</Text>
              <AddOption
                icon="table"
                title="Custom fields"
                body="Rename, retype, reorder or remove the columns your spreadsheet imports created."
                onPress={() => { setAddMenuVisible(false); setManageFieldsVisible(true); }}
              />
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

function AddOption({ icon, title, body, onPress }: { icon: string; title: string; body: string; onPress: () => void }) {
  const c = useThemeColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      className="flex-row items-start gap-3 rounded-xl border border-surface-border p-3.5 hover:bg-surface-overlay"
      style={{ minHeight: 44 }}
    >
      <FontAwesome name={icon as any} size={16} color={c.primary} style={{ marginTop: 2 }} />
      <View className="flex-1">
        <Text className="text-typography-main text-sm font-bold">{title}</Text>
        <Text className="text-typography-muted text-xs mt-0.5 leading-4">{body}</Text>
      </View>
      <FontAwesome name="chevron-right" size={11} color={c.textDim} style={{ marginTop: 4 }} />
    </TouchableOpacity>
  );
}
