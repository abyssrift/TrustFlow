import Popup from '@/components/common/Popup';
import SearchableMultiSelect from '@/components/common/SearchableMultiSelect';
import { useAlert } from '@/contexts/AlertContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { runBulk, summarizeBulk } from '@/lib/bulkTaskActions';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';

type StageLite = { id: string; name: string; color?: string };
type PipelineLite = { id: string; name: string };

const PRIORITIES = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
] as const;

type Picker = null | 'priority' | 'assign' | 'move';

export default function BulkTaskActionBar({
  taskIds,
  stages,
  pipelines,
  boardPipelineId,
  onExit,
  onApplied,
  onOptimisticArchive,
  bottomOffset = 24,
}: {
  taskIds: string[];
  stages: StageLite[];
  pipelines: PipelineLite[];
  boardPipelineId: string;
  bottomOffset?: number;
  /** Leave select mode (also clears the selection). */
  onExit: () => void;
  /** Re-fetch the board after a successful bulk write. */
  onApplied: () => void;
  onOptimisticArchive?: (ids: string[]) => void;
}) {
  const colors = useThemeColors();
  const { hasPermission, profile } = useAuth();
  const companyId = profile?.company_id;
  const { successToast, errorToast } = useToast();
  const { showConfirm } = useAlert();

  const [picker, setPicker] = useState<Picker>(null);
  const [busy, setBusy] = useState(false);
  const count = taskIds.length;

  const canAssign = hasPermission('task.assign');
  const canEdit = hasPermission('task.edit') || hasPermission('task.create') || !!profile?.is_owner;
  const canArchive = hasPermission('archive:create') || hasPermission('pipeline.edit') || !!profile?.is_owner;
  const canPing = hasPermission('task.ping') || hasPermission('system.manage') || !!profile?.is_owner;
  const canRevert = hasPermission('pipeline.reverse') || !!profile?.is_owner;

  // Finish any bulk write: toast the tally, refresh, and drop out of select mode
  // (a stale selection over a re-paged board is meaningless).
  const finish = (verb: string, outcome: Awaited<ReturnType<typeof runBulk>>) => {
    const msg = summarizeBulk(outcome, verb);
    outcome.failed.length && outcome.ok.length === 0 ? errorToast(msg) : successToast(msg);
    setPicker(null);
    setBusy(false);
    onApplied();
    onExit();
  };

  // A plain UPDATE ... IN (...) is one round trip, but RLS (tasks_update_editable)
  // silently drops rows the caller can't edit — so report the rows that actually
  // changed, not the count we asked for.
  const bulkColumnUpdate = async (patch: Record<string, unknown>, verb: string, failMsg: string) => {
    setBusy(true);
    try {
      const { data, error } = await supabase.from('tasks').update(patch).in('id', taskIds).select('id');
      if (error) throw error;
      const ok = (data as { id: string }[] | null)?.map((r) => r.id) ?? [];
      const failed = taskIds.filter((id) => !ok.includes(id)).map((id) => ({ id, error: 'no edit access' }));
      finish(verb, { ok, failed });
    } catch (e: any) {
      setBusy(false);
      errorToast(e?.message || failMsg);
    }
  };

  const setPriority = (value: string) => bulkColumnUpdate({ priority: value }, 'Reprioritised', 'Could not change priority.');

  const moveToProject = (projectId: string | null) => bulkColumnUpdate({ project_id: projectId }, 'Moved', 'Could not move tasks.');

  const moveToStage = async (stageId: string) => {
    setBusy(true);
    finish('Moved', await runBulk(taskIds, async (id) => {
      const { error } = await supabase.rpc('rpc_import_place_task_stage', { p_task_id: id, p_stage_id: stageId });
      if (error) throw error;
    }));
  };

  const moveToPipeline = async (pipelineId: string) => {
    setBusy(true);
    finish('Moved', await runBulk(taskIds, async (id) => {
      const { error } = await supabase.rpc('rpc_move_task_pipeline', { p_task_id: id, p_pipeline_id: pipelineId });
      if (error) throw error;
    }));
  };

  const reassign = async (userIds: string[], teamIds: string[]) => {
    setBusy(true);
    try {
      const { error } = await supabase.rpc('rpc_bulk_update_task_assignments', {
        p_task_ids: taskIds,
        p_user_ids: userIds,
        p_team_ids: teamIds,
      });
      if (error) throw error;
      finish('Reassigned', { ok: taskIds, failed: [] });
    } catch (e: any) {
      setBusy(false);
      errorToast(e?.message || 'Could not reassign tasks.');
    }
  };

  const ping = () => {
    showConfirm(
      `Ping ${count} task${count === 1 ? '' : 's'}?`,
      'Each task\'s assignees get a notification.',
      async () => {
        setBusy(true);
        finish('Pinged', await runBulk(taskIds, async (id) => {
          const { error } = await supabase.rpc('rpc_ping_task', { p_task_id: id });
          if (error) throw error;
        }));
      },
      undefined,
      'Ping',
      'Cancel',
    );
  };

  const revert = () => {
    showConfirm(
      `Revert ${count} task${count === 1 ? '' : 's'}?`,
      'Each moves back to the stage it was in before its current one. Tasks already at the first stage are skipped.',
      async () => {
        setBusy(true);
        finish('Reverted', await runBulk(taskIds, async (id) => {
          const { error } = await supabase.rpc('rpc_revert_stage', { p_task_id: id });
          if (error) throw error;
        }));
      },
      undefined,
      'Revert',
      'Cancel',
    );
  };

  const archive = () => {
    showConfirm(
      `Archive ${count} task${count === 1 ? '' : 's'}?`,
      'They leave the active board and move to Intelligence › Archives. A task with a running timer is skipped.',
      async () => {
        setBusy(true);
        onOptimisticArchive?.(taskIds);
        finish('Archived', await runBulk(taskIds, async (id) => {
          const { error } = await supabase.rpc('rpc_archive_task', { p_task_id: id });
          if (error) throw error;
        }));
      },
      undefined,
      'Archive',
      'Cancel',
      'destructive',
    );
  };

  const Action = ({ icon, label, onPress, disabled }: { icon: string; label: string; onPress: () => void; disabled?: boolean }) => (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || busy}
      className="flex-row items-center gap-2 px-3.5 py-2.5 rounded-xl border border-surface-border bg-surface-background active:opacity-70"
      style={{ opacity: disabled ? 0.4 : 1 }}
    >
      <FontAwesome name={icon as any} size={12} className="text-typography-muted" />
      <Text className="text-typography-main text-[11px] font-black uppercase tracking-widest">{label}</Text>
    </TouchableOpacity>
  );

  return (
    <>
      <View
        pointerEvents="box-none"
        style={{ position: 'absolute', left: 0, right: 0, bottom: bottomOffset, alignItems: 'center', zIndex: 90 }}
      >
        <View
          className="flex-row items-center gap-2 px-4 py-3 rounded-2xl border border-surface-border premium-shadow"
          style={{ backgroundColor: colors.card, maxWidth: '96%', flexWrap: 'wrap' }}
        >
          <View className="flex-row items-center gap-2 pr-1">
            <View className="min-w-[26px] h-[26px] px-1.5 items-center justify-center rounded-full bg-brand-primary">
              <Text className="text-white text-[12px] font-black">{count}</Text>
            </View>
            <Text className="text-typography-muted text-[11px] font-black uppercase tracking-widest">selected</Text>
          </View>

          {busy ? (
            <ActivityIndicator size="small" color={colors.primary} style={{ marginHorizontal: 16 }} />
          ) : (
            <>
              {canEdit && <Action icon="flag" label="Priority" onPress={() => setPicker('priority')} />}
              {canAssign && <Action icon="user-plus" label="Assign" onPress={() => setPicker('assign')} />}
              {canEdit && <Action icon="arrows" label="Move" onPress={() => setPicker('move')} />}
              {canRevert && <Action icon="undo" label="Revert" onPress={revert} />}
              {canPing && <Action icon="bell" label="Ping" onPress={ping} />}
              {canArchive && <Action icon="archive" label="Archive" onPress={archive} />}
            </>
          )}

          <TouchableOpacity
            onPress={onExit}
            disabled={busy}
            className="w-8 h-8 items-center justify-center rounded-full border border-surface-border active:opacity-70"
          >
            <FontAwesome name="times" size={13} className="text-typography-muted" />
          </TouchableOpacity>
        </View>
      </View>

      <Popup visible={picker === 'priority'} onClose={() => setPicker(null)} presentation="auto" maxWidth={420} title="Set priority">
        <View className="gap-2 p-1">
          {PRIORITIES.map((p) => (
            <TouchableOpacity
              key={p.value}
              onPress={() => setPriority(p.value)}
              className="px-4 py-3.5 rounded-xl border border-surface-border bg-surface-background active:opacity-70"
            >
              <Text className="text-typography-main text-sm font-black uppercase tracking-widest">{p.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Popup>

      <Popup visible={picker === 'move'} onClose={() => setPicker(null)} presentation="auto" maxWidth={480} title={`Move ${count} task${count === 1 ? '' : 's'}`}>
        <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ gap: 16, padding: 4 }}>
          <View className="gap-1.5">
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Stage (this board)</Text>
            {stages.map((s) => (
              <TouchableOpacity
                key={s.id}
                onPress={() => moveToStage(s.id)}
                className="flex-row items-center gap-2.5 px-4 py-3 rounded-xl border border-surface-border bg-surface-background active:opacity-70"
              >
                {!!s.color && <View style={{ backgroundColor: s.color, width: 10, height: 10, borderRadius: 5 }} />}
                <Text className="text-typography-main text-sm font-bold">{s.name}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {pipelines.filter((p) => p.id !== boardPipelineId).length > 0 && (
            <View className="gap-1.5">
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Another board</Text>
              <Text className="text-typography-dim text-[10px] font-bold">Lands in that board's first stage.</Text>
              {pipelines.filter((p) => p.id !== boardPipelineId).map((p) => (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => moveToPipeline(p.id)}
                  className="px-4 py-3 rounded-xl border border-surface-border bg-surface-background active:opacity-70"
                >
                  <Text className="text-typography-main text-sm font-bold">{p.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <ProjectMoveSection onPick={moveToProject} />
        </ScrollView>
      </Popup>

      {picker === 'assign' && (
        <BulkAssignPopup
          count={count}
          companyId={companyId}
          onClose={() => setPicker(null)}
          onApply={reassign}
        />
      )}
    </>
  );
}

// Projects are company-scoped by RLS; a bulk board rarely has more than a
// handful, so a plain list (not SearchableMultiSelect) is enough.
function ProjectMoveSection({ onPick }: { onPick: (id: string | null) => void }) {
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    supabase.from('projects').select('id, name').is('deleted_at', null).order('name').then(({ data }) => {
      setProjects((data as any[]) || []);
    });
  }, []);
  return (
    <View className="gap-1.5">
      <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Project</Text>
      <TouchableOpacity
        onPress={() => onPick(null)}
        className="px-4 py-3 rounded-xl border border-surface-border bg-surface-background active:opacity-70"
      >
        <Text className="text-typography-muted text-sm font-bold">No project</Text>
      </TouchableOpacity>
      {projects.map((p) => (
        <TouchableOpacity
          key={p.id}
          onPress={() => onPick(p.id)}
          className="px-4 py-3 rounded-xl border border-surface-border bg-surface-background active:opacity-70"
        >
          <Text className="text-typography-main text-sm font-bold">{p.name}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// rpc_bulk_update_task_assignments REPLACES each task's assignees with the given
// sets (delete-then-insert), so this is "set assignees on all N", not "add".
function BulkAssignPopup({
  count,
  companyId,
  onClose,
  onApply,
}: {
  count: number;
  companyId?: string;
  onClose: () => void;
  onApply: (userIds: string[], teamIds: string[]) => void;
}) {
  const [people, setPeople] = useState<{ id: string; full_name: string; avatar_url: string | null }[]>([]);
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [selected, setSelected] = useState<string[]>([]); // prefixed: "u:<id>" / "t:<id>"

  useEffect(() => {
    if (!companyId) return;
    Promise.all([
      supabase.from('users').select('id, full_name, avatar_url').is('deleted_at', null).eq('company_id', companyId).order('full_name'),
      supabase.from('teams').select('id, name').is('deleted_at', null).eq('company_id', companyId).order('name'),
    ]).then(([u, t]) => {
      setPeople((u.data as any[]) || []);
      setTeams((t.data as any[]) || []);
    });
  }, [companyId]);

  const items = [
    ...teams.map((t) => ({ id: `t:${t.id}`, label: t.name, category: 'Teams', icon: 'users' })),
    ...people.map((p) => ({ id: `u:${p.id}`, label: p.full_name || 'User', category: 'People', avatarUrl: p.avatar_url })),
  ];

  const apply = () => {
    onApply(
      selected.filter((s) => s.startsWith('u:')).map((s) => s.slice(2)),
      selected.filter((s) => s.startsWith('t:')).map((s) => s.slice(2)),
    );
  };

  return (
    <Popup
      visible
      onClose={onClose}
      presentation="auto"
      maxWidth={460}
      title={`Assignees for ${count} task${count === 1 ? '' : 's'}`}
      footer="single-action"
    >
      <ScrollView style={{ maxHeight: 420 }}>
        <Text className="text-typography-dim text-[11px] font-bold mb-3 px-1">
          Replaces the current assignees on every selected task.
        </Text>
        <SearchableMultiSelect
          title="Assign to"
          items={items}
          selectedIds={selected}
          onToggle={(id) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))}
          searchPlaceholder="Search people & teams…"
        />
      </ScrollView>
      <TouchableOpacity
        onPress={apply}
        className="mt-3 bg-brand-primary py-3.5 rounded-xl items-center active:opacity-80"
      >
        <Text className="text-white text-xs font-black uppercase tracking-widest">
          {selected.length === 0 ? 'Clear all assignees' : `Set ${selected.length} assignee${selected.length === 1 ? '' : 's'}`}
        </Text>
      </TouchableOpacity>
    </Popup>
  );
}
