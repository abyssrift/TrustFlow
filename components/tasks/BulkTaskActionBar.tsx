import ConfirmModal from '@/components/common/ConfirmModal';
import Popup from '@/components/common/Popup';
import SearchableMultiSelect, { type SearchableMultiSelectItem } from '@/components/common/SearchableMultiSelect';
import Tooltip from '@/components/common/Tooltip';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import {
  bulkArchiveTasks,
  bulkAssignTasks,
  bulkMoveTasksToPipeline,
  bulkMoveTasksToProject,
  bulkMoveTasksToStage,
  bulkPingTasks,
  bulkRevertTasks,
  bulkSetTaskPriority,
  summarizeBulkOutcome,
  type BulkOutcome,
} from '@/lib/bulkTaskActions';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';

// Issue #216 — sticky bulk-action bar for the Tasks board's batch/multi-select
// mode. Every action here reuses an existing single-task RPC or the same
// column-update path EditTaskModal already relies on (see lib/bulkTaskActions.ts);
// this component is only the picker UI + wiring.

const PRIORITY_OPTIONS: { value: string; label: string; className: string }[] = [
  { value: 'urgent', label: 'Urgent', className: 'text-state-danger' },
  { value: 'high', label: 'High', className: 'text-state-warning' },
  { value: 'medium', label: 'Normal', className: 'text-typography-muted' },
  { value: 'low', label: 'Low', className: 'text-state-success' },
];

type BoardOption = { id: string; name: string };

type Props = {
  taskIds: string[];
  /** Stages of the currently-viewed pipeline — for "Move → Stage". */
  stages: BoardOption[];
  /** Boards the user can switch a task into — for "Move → Board". */
  availablePipelines: BoardOption[];
  /** Exits select mode (clears the selection). */
  onClose: () => void;
  /** Refresh the board after an action lands. */
  onDone: () => void;
};

type Menu = 'priority' | 'assign' | 'moveStage' | 'moveBoard' | 'moveProject' | null;

export default function BulkTaskActionBar({ taskIds, stages, availablePipelines, onClose, onDone }: Props) {
  const colors = useThemeColors();
  const { hasPermission, profile } = useAuth();
  const { successToast, warningToast, errorToast } = useToast();

  const [menu, setMenu] = useState<Menu>(null);
  const [busy, setBusy] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [showPingConfirm, setShowPingConfirm] = useState(false);

  const [projects, setProjects] = useState<{ id: string; name: string; color: string | null }[] | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(false);

  const [users, setUsers] = useState<{ id: string; full_name: string }[] | null>(null);
  const [teams, setTeams] = useState<{ id: string; name: string; color: string | null }[] | null>(null);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [assignSelected, setAssignSelected] = useState<{ users: string[]; teams: string[] }>({ users: [], teams: [] });

  const count = taskIds.length;
  if (count === 0) return null;

  const canArchive = profile?.is_owner || hasPermission('archive:create') || hasPermission('pipeline.edit');
  const canAssign = hasPermission('task.assign');
  const canMoveStage = profile?.is_owner || hasPermission('task.create') || hasPermission('system.view_all_data');
  const canMoveBoard = profile?.is_owner || hasPermission('task.edit');
  const canRevert = profile?.is_owner || hasPermission('pipeline.reverse');
  const canPing = profile?.is_owner || hasPermission('task.ping') || hasPermission('system.manage');

  const closeMenu = () => setMenu(null);

  const finishAction = (outcome: BulkOutcome, verb: string) => {
    const message = summarizeBulkOutcome(outcome, verb);
    if (outcome.failed.length === 0) successToast(message);
    else if (outcome.succeededIds.length === 0) errorToast(message);
    else warningToast(message);
    onDone();
    onClose();
  };

  const runAction = async (verb: string, fn: () => Promise<BulkOutcome>) => {
    setBusy(true);
    try {
      const outcome = await fn();
      finishAction(outcome, verb);
    } catch (err: any) {
      errorToast(err?.message || `Could not ${verb.toLowerCase()} the selected tasks.`);
    } finally {
      setBusy(false);
      closeMenu();
    }
  };

  const openProjectPicker = async () => {
    setMenu('moveProject');
    if (projects) return;
    setProjectsLoading(true);
    const { data } = await supabase.from('projects').select('id, name, color').is('deleted_at', null).order('name');
    setProjects(data || []);
    setProjectsLoading(false);
  };

  const openAssignPicker = async () => {
    setMenu('assign');
    setAssignSelected({ users: [], teams: [] });
    if (users && teams) return;
    setPeopleLoading(true);
    const companyId = profile?.company_id;
    const [{ data: u }, { data: t }] = await Promise.all([
      supabase.from('users').select('id, full_name').is('deleted_at', null).eq('company_id', companyId).order('full_name'),
      supabase.from('teams').select('id, name, color').is('deleted_at', null).eq('company_id', companyId).order('name'),
    ]);
    setUsers(u || []);
    setTeams(t || []);
    setPeopleLoading(false);
  };

  const handleAssignSave = async () => {
    setBusy(true);
    try {
      await bulkAssignTasks(taskIds, assignSelected.users, assignSelected.teams);
      successToast(`Reassigned ${count} ${count === 1 ? 'task' : 'tasks'}.`);
      onDone();
      onClose();
    } catch (err: any) {
      errorToast(err?.message || 'Could not reassign the selected tasks.');
    } finally {
      setBusy(false);
      closeMenu();
    }
  };

  const assignItems: SearchableMultiSelectItem[] = [
    ...(teams || []).map(t => ({ id: t.id, label: t.name, color: t.color, category: 'Teams' })),
    ...(users || []).map(u => ({ id: u.id, label: u.full_name, category: 'People' })),
  ];
  const assignSelectedIds = [...assignSelected.teams, ...assignSelected.users];
  const toggleAssign = (id: string) => {
    const isTeam = (teams || []).some(t => t.id === id);
    setAssignSelected(prev => {
      const key = isTeam ? 'teams' : 'users';
      const set = new Set(prev[key]);
      if (set.has(id)) set.delete(id); else set.add(id);
      return { ...prev, [key]: Array.from(set) };
    });
  };

  return (
    <>
      <View
        pointerEvents="box-none"
        style={{ position: 'absolute', left: 0, right: 0, bottom: 24, alignItems: 'center', zIndex: 90 }}
      >
        <View
          className="flex-row items-center gap-2 bg-surface-card border border-surface-border rounded-2xl px-4 py-3 premium-shadow"
          style={{ borderColor: colors.primary + '40' }}
        >
          <View className="bg-brand-primary/10 px-3 py-1.5 rounded-xl mr-1">
            <Text className="text-brand-primary font-black text-xs uppercase tracking-widest">{count} selected</Text>
          </View>

          {busy && <ActivityIndicator size="small" color={colors.primary} style={{ marginHorizontal: 4 }} />}

          <Tooltip label="Change priority">
            <TouchableOpacity
              disabled={busy}
              onPress={() => setMenu('priority')}
              className="w-10 h-10 items-center justify-center rounded-xl bg-surface-background border border-surface-border"
            >
              <FontAwesome name="flag" size={14} className="text-typography-muted" />
            </TouchableOpacity>
          </Tooltip>

          {canAssign && (
            <Tooltip label="Reassign">
              <TouchableOpacity
                disabled={busy}
                onPress={openAssignPicker}
                className="w-10 h-10 items-center justify-center rounded-xl bg-surface-background border border-surface-border"
              >
                <FontAwesome name="user-plus" size={14} className="text-typography-muted" />
              </TouchableOpacity>
            </Tooltip>
          )}

          {canMoveStage && (
            <Tooltip label="Move to stage">
              <TouchableOpacity
                disabled={busy}
                onPress={() => setMenu('moveStage')}
                className="w-10 h-10 items-center justify-center rounded-xl bg-surface-background border border-surface-border"
              >
                <FontAwesome name="arrow-right" size={14} className="text-typography-muted" />
              </TouchableOpacity>
            </Tooltip>
          )}

          {canMoveBoard && availablePipelines.length > 1 && (
            <Tooltip label="Move to board">
              <TouchableOpacity
                disabled={busy}
                onPress={() => setMenu('moveBoard')}
                className="w-10 h-10 items-center justify-center rounded-xl bg-surface-background border border-surface-border"
              >
                <FontAwesome name="sitemap" size={14} className="text-typography-muted" />
              </TouchableOpacity>
            </Tooltip>
          )}

          <Tooltip label="Move to project">
            <TouchableOpacity
              disabled={busy}
              onPress={openProjectPicker}
              className="w-10 h-10 items-center justify-center rounded-xl bg-surface-background border border-surface-border"
            >
              <FontAwesome name="folder-o" size={14} className="text-typography-muted" />
            </TouchableOpacity>
          </Tooltip>

          {canRevert && (
            <Tooltip label="Revert to previous stage">
              <TouchableOpacity
                disabled={busy}
                onPress={() => runAction('Reverted', () => bulkRevertTasks(taskIds))}
                className="w-10 h-10 items-center justify-center rounded-xl bg-surface-background border border-surface-border"
              >
                <FontAwesome name="undo" size={14} className="text-typography-muted" />
              </TouchableOpacity>
            </Tooltip>
          )}

          {canPing && (
            <Tooltip label="Ping assignees">
              <TouchableOpacity
                disabled={busy}
                onPress={() => setShowPingConfirm(true)}
                className="w-10 h-10 items-center justify-center rounded-xl bg-surface-background border border-surface-border"
              >
                <FontAwesome name="bell-o" size={14} className="text-typography-muted" />
              </TouchableOpacity>
            </Tooltip>
          )}

          {canArchive && (
            <Tooltip label="Archive">
              <TouchableOpacity
                disabled={busy}
                onPress={() => setShowArchiveConfirm(true)}
                className="w-10 h-10 items-center justify-center rounded-xl bg-state-danger/10 border border-state-danger/30"
              >
                <FontAwesome name="archive" size={14} className="text-state-danger" />
              </TouchableOpacity>
            </Tooltip>
          )}

          <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: colors.border, marginHorizontal: 2 }} />

          <Tooltip label="Exit selection">
            <TouchableOpacity
              disabled={busy}
              onPress={onClose}
              className="w-10 h-10 items-center justify-center rounded-xl bg-surface-background border border-surface-border"
            >
              <FontAwesome name="times" size={14} className="text-typography-muted" />
            </TouchableOpacity>
          </Tooltip>
        </View>
      </View>

      {/* ─── Priority picker ───────────────────────────────────────────── */}
      <Popup visible={menu === 'priority'} onClose={closeMenu} presentation="auto" maxWidth={360} title={`Set priority (${count})`}>
        <View className="p-6">
          {PRIORITY_OPTIONS.map(opt => (
            <TouchableOpacity
              key={opt.value}
              disabled={busy}
              onPress={() => runAction('Updated priority for', () => bulkSetTaskPriority(taskIds, opt.value))}
              className="py-3.5 px-4 rounded-xl border border-surface-border bg-surface-background mb-2 flex-row items-center justify-between"
            >
              <Text className={`${opt.className} font-black uppercase tracking-widest text-xs`}>{opt.label}</Text>
              <FontAwesome name="chevron-right" size={10} className="text-typography-muted" />
            </TouchableOpacity>
          ))}
        </View>
      </Popup>

      {/* ─── Move → Stage picker ───────────────────────────────────────── */}
      <Popup visible={menu === 'moveStage'} onClose={closeMenu} presentation="auto" maxWidth={420} title={`Move to stage (${count})`}>
        <View className="p-6">
          <Text className="text-typography-muted text-xs mb-4">Places each task directly into the chosen stage of its own board.</Text>
          {stages.map(stage => (
            <TouchableOpacity
              key={stage.id}
              disabled={busy}
              onPress={() => runAction('Moved', () => bulkMoveTasksToStage(taskIds, stage.id))}
              className="py-3.5 px-4 rounded-xl border border-surface-border bg-surface-background mb-2 flex-row items-center justify-between"
            >
              <Text className="text-typography-main font-bold text-sm">{stage.name}</Text>
              <FontAwesome name="chevron-right" size={10} className="text-typography-muted" />
            </TouchableOpacity>
          ))}
        </View>
      </Popup>

      {/* ─── Move → Board picker ───────────────────────────────────────── */}
      <Popup visible={menu === 'moveBoard'} onClose={closeMenu} presentation="auto" maxWidth={420} title={`Move to board (${count})`}>
        <View className="p-6">
          <Text className="text-typography-muted text-xs mb-4">Each task lands in the target board's initial stage.</Text>
          {availablePipelines.map(board => (
            <TouchableOpacity
              key={board.id}
              disabled={busy}
              onPress={() => runAction('Moved', () => bulkMoveTasksToPipeline(taskIds, board.id))}
              className="py-3.5 px-4 rounded-xl border border-surface-border bg-surface-background mb-2 flex-row items-center justify-between"
            >
              <Text className="text-typography-main font-bold text-sm">{board.name}</Text>
              <FontAwesome name="chevron-right" size={10} className="text-typography-muted" />
            </TouchableOpacity>
          ))}
        </View>
      </Popup>

      {/* ─── Move → Project picker ─────────────────────────────────────── */}
      <Popup visible={menu === 'moveProject'} onClose={closeMenu} presentation="auto" maxWidth={420} title={`Move to project (${count})`}>
        <View className="p-6">
          {projectsLoading ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <>
              <TouchableOpacity
                disabled={busy}
                onPress={() => runAction('Updated project for', () => bulkMoveTasksToProject(taskIds, null))}
                className="py-3.5 px-4 rounded-xl border border-surface-border bg-surface-background mb-2 flex-row items-center justify-between"
              >
                <Text className="text-typography-muted font-bold text-sm italic">No project</Text>
                <FontAwesome name="chevron-right" size={10} className="text-typography-muted" />
              </TouchableOpacity>
              {(projects || []).map(project => (
                <TouchableOpacity
                  key={project.id}
                  disabled={busy}
                  onPress={() => runAction('Updated project for', () => bulkMoveTasksToProject(taskIds, project.id))}
                  className="py-3.5 px-4 rounded-xl border border-surface-border bg-surface-background mb-2 flex-row items-center justify-between"
                >
                  <View className="flex-row items-center gap-2">
                    {project.color && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: project.color }} />}
                    <Text className="text-typography-main font-bold text-sm">{project.name}</Text>
                  </View>
                  <FontAwesome name="chevron-right" size={10} className="text-typography-muted" />
                </TouchableOpacity>
              ))}
            </>
          )}
        </View>
      </Popup>

      {/* ─── Assign picker ─────────────────────────────────────────────── */}
      <Popup visible={menu === 'assign'} onClose={closeMenu} presentation="auto" maxWidth={480} title={`Reassign tasks (${count})`}>
        <View className="p-6">
          <Text className="text-typography-muted text-xs mb-4">Replaces each task's current assignment with the selection below.</Text>
          {peopleLoading ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <SearchableMultiSelect
              title="Assignees"
              items={assignItems}
              selectedIds={assignSelectedIds}
              onToggle={toggleAssign}
              searchPlaceholder="Search people or teams..."
            />
          )}
          <TouchableOpacity
            disabled={busy || peopleLoading}
            onPress={handleAssignSave}
            className="mt-5 bg-brand-primary py-4 rounded-2xl items-center"
          >
            <Text className="text-white font-black uppercase tracking-widest text-xs">
              {busy ? 'Saving...' : `Assign to ${assignSelectedIds.length} selected`}
            </Text>
          </TouchableOpacity>
        </View>
      </Popup>

      <ConfirmModal
        visible={showArchiveConfirm}
        title="Archive tasks"
        description={`Archive ${count} ${count === 1 ? 'task' : 'tasks'}? Each will be snapshotted and removed from its active board. This is the only way to remove a task — there is no separate hard-delete.`}
        confirmLabel={busy ? 'Archiving...' : 'Archive'}
        variant="danger"
        loading={busy}
        onConfirm={() => { setShowArchiveConfirm(false); runAction('Archived', () => bulkArchiveTasks(taskIds)); }}
        onCancel={() => setShowArchiveConfirm(false)}
      />

      <ConfirmModal
        visible={showPingConfirm}
        title="Ping assignees"
        description={`Notify every assignee across ${count} ${count === 1 ? 'task' : 'tasks'}?`}
        confirmLabel={busy ? 'Pinging...' : 'Ping'}
        variant="info"
        loading={busy}
        onConfirm={() => { setShowPingConfirm(false); runAction('Pinged', () => bulkPingTasks(taskIds)); }}
        onCancel={() => setShowPingConfirm(false)}
      />
    </>
  );
}
