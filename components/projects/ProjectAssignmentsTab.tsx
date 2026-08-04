import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';

import ProjectionChart from '@/components/charts/ProjectionChart';
import DraggableSheet from '@/components/common/DraggableSheet';
import SidebarLayout from '@/components/common/SidebarLayout';
import Tooltip from '@/components/common/Tooltip';
import {
  EntityEmptyState,
  EntityGlyph,
  FilterChip,
  StageChip,
} from '@/components/entities/EntityUI';
import TimeByCategoryPie from '@/components/kanban/TimeByCategoryPie';
import CategoryMappingRow, { type CategoryValue } from '@/components/projects/CategoryMappingRow';
import { SkeletonList } from '@/components/Skeleton';
import { useAlert } from '@/contexts/AlertContext';
import { useProjectDetail } from '@/contexts/ProjectDetailContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { useProjectAssignments, type AssignmentTask, type Assignee } from '@/hooks/useProjectAssignments';
import { dueColor, fmtDue, initials } from '@/lib/projectPresentation';
import { supabase } from '@/lib/supabase';

/**
 * The project Assignments screen (issue #198).
 *
 * NAMED "ASSIGNMENTS", NOT "WORK". "Work" named the container, not the job,
 * and it collided with the timer's notion of work sessions and with the
 * "where time went" reading of the same word. The screen answers one question
 * — who is on what — so it is named for that. Plan §17's diagnosis is that
 * the vocabulary is the product problem, not a labelling detail.
 *
 * WHO USES IT: a manager, constantly, on a project they already know. So the
 * screen is built for re-reading rather than first-reading — the answer line
 * is one sentence, the filters are counted so they can be aimed at without
 * reading the list, and the primary action (assign several tasks to someone)
 * is two clicks from any state: select rows, click a person.
 *
 * THE ONE THING IT IS ORGANISED AROUND is "what has nobody picked up?" — the
 * question the issue says managers actually ask. That is the headline, the
 * default-visible filter, and the empty state's subject.
 *
 * Everything here reads through existing pieces: EntityUI's glyphs/chips/empty
 * states (Phase 8), TimeByCategoryPie for the breakdown, CategoryMappingRow
 * for the board/team picker, and the app's ONE assignment writer via
 * useProjectAssignments. No new visual vocabulary, no second writer.
 */

type Segment = 'unassigned' | 'open' | 'all' | 'done';

const SEGMENTS: { value: Segment; label: string; icon: string }[] = [
  { value: 'unassigned', label: 'Nobody on it', icon: 'user-times' },
  { value: 'open', label: 'Open', icon: 'circle-o' },
  { value: 'all', label: 'Everything', icon: 'list' },
  { value: 'done', label: 'Done', icon: 'check' },
];

// ── One task, as a card that carries its own identity ──────────────────────
//
// Plan §14.1: "nothing renders as bare text", and the owner's version of the
// same note — tasks are not slim strips. Every row carries a glyph, its stage,
// who is on it (as marks, not a name string), its due state and its category.

function TaskRow({
  task,
  selected,
  onToggle,
  onOpen,
  nameById,
}: {
  task: AssignmentTask;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  nameById: Map<string, string>;
}) {
  const c = useThemeColors();
  const holders = [...task.user_ids, ...task.team_ids];
  const unassigned = holders.length === 0 && !task.is_complete;

  return (
    <View
      className="bg-surface-card border rounded-2xl px-3 py-3 flex-row items-start gap-3"
      style={{
        borderColor: selected ? c.primary : unassigned ? c.warning + '66' : c.border,
        borderWidth: selected ? 1.5 : 1,
      }}
    >
      {/* Checkbox is its own control, so tapping the card body can stay a
          plain "select" without stealing the row's other affordances. */}
      <TouchableOpacity
        onPress={onToggle}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected }}
        accessibilityLabel={`Select ${task.title}`}
        className="items-center justify-center rounded-md border"
        style={{
          width: 20, height: 20, marginTop: 2,
          borderColor: selected ? c.primary : c.border,
          backgroundColor: selected ? c.primary : 'transparent',
        }}
      >
        {selected && <FontAwesome name="check" size={11} color="#fff" />}
      </TouchableOpacity>

      <TouchableOpacity onPress={onToggle} className="flex-1 min-w-0" accessibilityLabel={task.title}>
        <View className="flex-row items-start gap-2.5">
          <EntityGlyph kind="task" size={26} color={task.is_complete ? c.success : null} />
          <View className="flex-1 min-w-0">
            <Text
              numberOfLines={2}
              className={`text-sm font-semibold leading-5 ${task.is_complete ? 'text-typography-muted' : 'text-typography-main'}`}
            >
              {task.title}
            </Text>

            <View className="flex-row items-center flex-wrap gap-1.5 mt-2">
              <StageChip name={task.stage_name} color={task.stage_color} size="sm" />

              {!!task.category && (
                <View className="rounded-full border border-surface-border px-2 py-0.5">
                  <Text className="text-typography-muted text-[10px] font-semibold">{task.category}</Text>
                </View>
              )}

              <Text className="text-[11px] font-semibold" style={{ color: dueColor(null, c) }}>
                {task.due_date ? fmtDue(null, task.due_date) : 'No due date'}
              </Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>

      <View className="items-end" style={{ gap: 6 }}>
        {/* Who is on it — marks, never a name string (§14.1). */}
        {holders.length > 0 ? (
          <View className="flex-row items-center" style={{ gap: -6 }}>
            {holders.slice(0, 3).map(id => (
              <Tooltip key={id} label={nameById.get(id) ?? 'Unknown'}>
                <View style={{ marginLeft: -6 }}>
                  <EntityGlyph
                    kind={task.team_ids.includes(id) ? 'portfolio' : 'client'}
                    size={22}
                    name={nameById.get(id) ?? '?'}
                  />
                </View>
              </Tooltip>
            ))}
            {holders.length > 3 && (
              <Text className="text-typography-muted text-[10px] font-bold ml-1">+{holders.length - 3}</Text>
            )}
          </View>
        ) : task.is_complete ? null : (
          <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: c.warning + '1A' }}>
            <Text className="text-[9px] font-black uppercase tracking-wider" style={{ color: c.warning }}>
              Nobody
            </Text>
          </View>
        )}

        {/* Requirement 6: a route through to the task on the main board for
            anything this compact view can't do. */}
        <Tooltip label="Open on the board">
          <TouchableOpacity
            onPress={onOpen}
            accessibilityRole="button"
            accessibilityLabel={`Open ${task.title} on the board`}
            className="rounded-lg border border-surface-border items-center justify-center hover:bg-surface-overlay transition-colors"
            style={{ width: 30, height: 30 }}
          >
            <FontAwesome name="arrow-right" size={11} color={c.textMuted} />
          </TouchableOpacity>
        </Tooltip>
      </View>
    </View>
  );
}

// ── The assignee rail ──────────────────────────────────────────────────────
//
// Who CAN take this work, and what they are already carrying on THIS project.
// Clicking one while rows are selected is the whole assign interaction — the
// screen's primary action is one click from a selection, not a modal away.

function AssigneeList({
  assignees,
  selectedCount,
  onAssign,
  onClear,
  busy,
}: {
  assignees: Assignee[];
  selectedCount: number;
  onAssign: (a: Assignee) => void;
  onClear: () => void;
  busy: boolean;
}) {
  const c = useThemeColors();
  const teams = assignees.filter(a => a.kind === 'team');
  const people = assignees.filter(a => a.kind === 'user');

  const row = (a: Assignee) => (
    <TouchableOpacity
      key={`${a.kind}-${a.id}`}
      onPress={() => onAssign(a)}
      disabled={selectedCount === 0 || busy}
      accessibilityRole="button"
      accessibilityLabel={
        selectedCount === 0
          ? `${a.name}, carrying ${a.load} open ${a.load === 1 ? 'task' : 'tasks'} here`
          : `Assign ${selectedCount} selected to ${a.name}`
      }
      className="flex-row items-center gap-2.5 rounded-xl px-2 hover:bg-surface-overlay transition-colors"
      style={{ minHeight: 44, opacity: selectedCount === 0 ? 0.55 : 1 }}
    >
      <EntityGlyph kind={a.kind === 'team' ? 'portfolio' : 'client'} size={26} name={a.name} color={a.color} />
      <Text numberOfLines={1} className="flex-1 text-typography-main text-xs font-semibold">
        {a.name}
      </Text>
      {/* The load number is the point of this rail — never hide it behind a
          hover. Amber past 5 open items on one project is a nudge, not a
          rule, so it is a colour and not a block. */}
      <Tooltip label={`${a.load} open ${a.load === 1 ? 'task' : 'tasks'} on this project`}>
        <View
          className="rounded-full px-2 py-0.5"
          style={{ backgroundColor: a.load === 0 ? 'transparent' : (a.load > 5 ? c.warning : c.primary) + '1A' }}
        >
          <Text
            className="text-[10px] font-black"
            style={{ color: a.load === 0 ? c.textDim : a.load > 5 ? c.warning : c.primary }}
          >
            {a.load}
          </Text>
        </View>
      </Tooltip>
    </TouchableOpacity>
  );

  return (
    <View style={{ gap: 10 }}>
      <View>
        <Text className="text-typography-main text-sm font-bold">Who can take it</Text>
        <Text className="text-typography-muted text-[11px] mt-0.5 leading-4">
          {selectedCount === 0
            ? 'Select tasks on the left, then pick someone here.'
            : `Assigning ${selectedCount} ${selectedCount === 1 ? 'task' : 'tasks'}. Pick someone.`}
        </Text>
      </View>

      {selectedCount > 0 && (
        <TouchableOpacity
          onPress={onClear}
          disabled={busy}
          accessibilityRole="button"
          className="flex-row items-center justify-center gap-2 rounded-xl border border-surface-border hover:bg-surface-overlay transition-colors"
          style={{ minHeight: 40 }}
        >
          <FontAwesome name="user-times" size={11} color={c.danger} />
          <Text className="text-[11px] font-bold" style={{ color: c.danger }}>
            Take everyone off
          </Text>
        </TouchableOpacity>
      )}

      {teams.length > 0 && (
        <View>
          <Text className="text-typography-dim text-[9px] font-black uppercase tracking-[0.15em] mb-1">Teams</Text>
          {teams.map(row)}
        </View>
      )}

      <View>
        <Text className="text-typography-dim text-[9px] font-black uppercase tracking-[0.15em] mb-1">People</Text>
        {people.length === 0 ? (
          <Text className="text-typography-dim text-[11px] italic px-2">Nobody in this workspace yet.</Text>
        ) : (
          people.map(row)
        )}
      </View>
    </View>
  );
}

// ── Category → board / team, revisited after creation ──────────────────────
//
// The second mount plan §13.11 predicted. #182 answers "which board, which
// team" once at creation; this answers it again later, which is exactly what
// the stub this file replaces promised ("change which board each category of
// work sits on, and which team owns it, without recreating the project").
// Same component, so the two moments cannot drift.

function CategoryMappingSection({
  categories,
  tasksByCategory,
  pipelines,
  teams,
  onApply,
  busy,
}: {
  categories: string[];
  tasksByCategory: Map<string, AssignmentTask[]>;
  pipelines: { id: string; name: string; hasStages: boolean }[];
  teams: { id: string; name: string; color: string | null }[];
  onApply: (category: string, value: CategoryValue) => void;
  busy: boolean;
}) {
  const [pending, setPending] = useState<Record<string, CategoryValue>>({});

  if (categories.length === 0) return null;

  return (
    <View className="bg-surface-card border border-surface-border rounded-2xl p-4" style={{ gap: 10 }}>
      <View>
        <Text className="text-typography-main text-sm font-bold">Board and team by category</Text>
        <Text className="text-typography-muted text-[11px] mt-0.5 leading-4">
          Answer once per category and every task in it follows. Moving a category to another board moves its
          tasks there.
        </Text>
      </View>
      {categories.map(cat => {
        const value = pending[cat] ?? { pipeline_id: null, assignee_team_id: null };
        const count = tasksByCategory.get(cat)?.length ?? 0;
        const dirty = !!value.pipeline_id || !!value.assignee_team_id;
        return (
          <View key={cat} style={{ gap: 6 }}>
            <CategoryMappingRow
              category={cat}
              value={value}
              pipelines={pipelines}
              teams={teams}
              onChange={next => setPending(p => ({ ...p, [cat]: next }))}
            />
            {dirty && (
              <TouchableOpacity
                onPress={() => { onApply(cat, value); setPending(p => ({ ...p, [cat]: { pipeline_id: null, assignee_team_id: null } })); }}
                disabled={busy}
                accessibilityRole="button"
                className="self-start rounded-xl bg-brand-primary hover:bg-brand-primary-hover px-4 justify-center"
                style={{ minHeight: 40, opacity: busy ? 0.6 : 1 }}
              >
                <Text className="text-white text-[11px] font-bold">
                  Apply to {count} {count === 1 ? 'task' : 'tasks'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })}
    </View>
  );
}

// ── The screen ─────────────────────────────────────────────────────────────

export default function ProjectAssignmentsTab() {
  const c = useThemeColors();
  const router = useRouter();
  const { showConfirm } = useAlert();
  const { projectId, data, lifecycle } = useProjectDetail();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;
  const isMobile = width < 768;

  const { tasks, assignees, nameById, loading, error, refresh, assign, buildProjection } =
    useProjectAssignments(projectId);

  const [segment, setSegment] = useState<Segment>('unassigned');
  const [category, setCategory] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pipelines, setPipelines] = useState<{ id: string; name: string; hasStages: boolean }[]>([]);
  const [teamRows, setTeamRows] = useState<{ id: string; name: string; color: string | null }[]>([]);

  // Boards + teams for the category mapping section. Loaded once, lazily —
  // the mapping section is the secondary job on this screen and most visits
  // never touch it.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const [pRes, tRes] = await Promise.all([
        supabase.from('pipelines').select('id, name, stages:pipeline_stages(id)').is('deleted_at', null).order('name'),
        supabase.from('teams').select('id, name, color').is('deleted_at', null).order('name'),
      ]);
      if (cancelled) return;
      setPipelines((pRes.data ?? []).map((p: any) => ({ id: p.id, name: p.name, hasStages: (p.stages ?? []).length > 0 })));
      setTeamRows((tRes.data ?? []).map((t: any) => ({ id: t.id, name: t.name, color: t.color })));
    })();
    return () => { cancelled = true; };
  }, []);

  const unassignedCount = useMemo(
    () => tasks.filter(t => !t.is_complete && t.user_ids.length === 0 && t.team_ids.length === 0).length,
    [tasks]
  );
  const openCount = useMemo(() => tasks.filter(t => !t.is_complete).length, [tasks]);
  const doneCount = tasks.length - openCount;

  const visible = useMemo(() => {
    let rows = tasks;
    if (segment === 'unassigned') rows = rows.filter(t => !t.is_complete && t.user_ids.length === 0 && t.team_ids.length === 0);
    else if (segment === 'open') rows = rows.filter(t => !t.is_complete);
    else if (segment === 'done') rows = rows.filter(t => t.is_complete);
    if (category) {
      rows = rows.filter(t => ((t.category || 'Uncategorized').trim() || 'Uncategorized') === category);
    }
    return rows;
  }, [tasks, segment, category]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach(t => set.add((t.category || 'Uncategorized').trim() || 'Uncategorized'));
    return [...set].sort();
  }, [tasks]);

  const tasksByCategory = useMemo(() => {
    const m = new Map<string, AssignmentTask[]>();
    tasks.forEach(t => {
      const k = (t.category || 'Uncategorized').trim() || 'Uncategorized';
      m.set(k, [...(m.get(k) ?? []), t]);
    });
    return m;
  }, [tasks]);

  const projection = useMemo(
    () => buildProjection(tasks, lifecycle?.dueDate ?? null),
    [tasks, lifecycle?.dueDate, buildProjection]
  );

  const selectedTasks = useMemo(() => tasks.filter(t => selected.has(t.id)), [tasks, selected]);

  const toggle = (id: string) =>
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const allVisibleSelected = visible.length > 0 && visible.every(t => selected.has(t.id));
  const toggleAllVisible = () =>
    setSelected(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) visible.forEach(t => next.delete(t.id));
      else visible.forEach(t => next.add(t.id));
      return next;
    });

  const runAssign = async (taskIds: string[], userIds: string[], teamIds: string[]) => {
    setBusy(true);
    try {
      await assign(taskIds, userIds, teamIds);
      setSelected(new Set());
      setSheetOpen(false);
    } catch (e: any) {
      // Assignment is refused by the DB when the caller isn't the task's
      // manager. Say which rule stopped it rather than echoing the raw
      // exception (plan §14.2: errors name the thing and offer the fix).
      showConfirm(
        'Could not reassign',
        e?.message?.includes('task manager')
          ? 'Only a task’s manager, or the workspace owner, can change who it is assigned to. Ask the manager of these tasks to make the change.'
          : e?.message || 'Something went wrong assigning these tasks.',
        () => {},
      );
    } finally {
      setBusy(false);
    }
  };

  const handleAssign = (a: Assignee) => {
    const ids = selectedTasks.map(t => t.id);
    if (ids.length === 0) return;
    const alreadyHeld = selectedTasks.filter(t => t.user_ids.length > 0 || t.team_ids.length > 0).length;

    const commit = () =>
      runAssign(ids, a.kind === 'user' ? [a.id] : [], a.kind === 'team' ? [a.id] : []);

    // Assigning REPLACES whoever is currently on the task (the underlying
    // writer deletes then inserts). Silently dropping people off a task is
    // the destructive part, so it is confirmed — and only when it would
    // actually happen.
    if (alreadyHeld > 0) {
      showConfirm(
        `Reassign ${ids.length} ${ids.length === 1 ? 'task' : 'tasks'}?`,
        `${alreadyHeld} of them already ${alreadyHeld === 1 ? 'has someone' : 'have someone'} on ${alreadyHeld === 1 ? 'it' : 'them'}. Assigning to ${a.name} replaces who is on ${ids.length === 1 ? 'it' : 'them'}.`,
        commit,
        undefined,
        `Assign to ${a.name}`,
      );
    } else {
      commit();
    }
  };

  const handleClearAssignees = () => {
    const ids = selectedTasks.map(t => t.id);
    if (ids.length === 0) return;
    showConfirm(
      `Take everyone off ${ids.length} ${ids.length === 1 ? 'task' : 'tasks'}?`,
      'They go back to nobody being on them, and will show under "Nobody on it".',
      () => runAssign(ids, [], []),
      undefined,
      'Take them off',
      'Cancel',
      'destructive',
    );
  };

  const applyCategoryMapping = (cat: string, value: CategoryValue) => {
    const rows = tasksByCategory.get(cat) ?? [];
    if (rows.length === 0) return;
    const boardName = pipelines.find(p => p.id === value.pipeline_id)?.name;
    const teamName = teamRows.find(t => t.id === value.assignee_team_id)?.name;
    const parts = [
      boardName ? `move them to ${boardName}` : null,
      teamName ? `hand them to ${teamName}` : null,
    ].filter(Boolean).join(' and ');

    showConfirm(
      `Apply to ${rows.length} ${rows.length === 1 ? 'task' : 'tasks'}?`,
      `Every ${cat} task on this project will ${parts}.${teamName ? ' Anyone currently on them is replaced.' : ''}`,
      async () => {
        setBusy(true);
        try {
          if (value.pipeline_id) {
            // One call per task: rpc_move_task_pipeline is the existing mover
            // and it takes a single task. Not batched into a new RPC — moving
            // boards re-stages a task, and that logic is not something to
            // duplicate for a convenience wrapper.
            for (const t of rows) {
              const { error: e } = await supabase.rpc('rpc_move_task_pipeline', {
                p_task_id: t.id,
                p_pipeline_id: value.pipeline_id,
              });
              if (e) throw e;
            }
          }
          if (value.assignee_team_id) {
            await assign(rows.map(t => t.id), [], [value.assignee_team_id]);
          } else {
            await refresh();
          }
        } catch (e: any) {
          showConfirm('Could not apply', e?.message || 'Something went wrong.', () => {});
        } finally {
          setBusy(false);
        }
      },
      undefined,
      'Apply',
    );
  };

  if (loading) {
    return <View className="p-4 md:p-8"><SkeletonList count={5} itemHeight={72} /></View>;
  }

  if (error) {
    return (
      <View className="p-4 md:p-8">
        <View className="bg-surface-card border border-surface-border rounded-2xl p-5 items-center">
          <FontAwesome name="exclamation-triangle" size={20} color={c.warning} />
          <Text className="text-typography-main text-sm font-bold mt-3 text-center">{error}</Text>
          <TouchableOpacity
            onPress={refresh}
            className="mt-4 px-5 rounded-xl bg-brand-primary hover:bg-brand-primary-hover justify-center"
            style={{ minHeight: 44 }}
          >
            <Text className="text-white text-xs font-bold">Try again</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const totalTasks = tasks.length;

  // ── The answer line ──────────────────────────────────────────────────────
  // One sentence, the manager's actual question, before any chart. A repeated
  // visitor should be able to leave after reading this line.
  const answer =
    totalTasks === 0
      ? null
      : unassignedCount > 0
        ? `${unassignedCount} of ${totalTasks} ${unassignedCount === 1 ? 'task has' : 'tasks have'} nobody on ${unassignedCount === 1 ? 'it' : 'them'}.`
        : `Everything has someone on it. ${openCount} still open, ${doneCount} done.`;

  const charts = (
    <View className={isDesktop ? 'flex-row gap-4' : ''} style={isDesktop ? undefined : { gap: 4 }}>
      <View className={isDesktop ? 'flex-1' : ''}>
        <TimeByCategoryPie
          tasks={tasks}
          mode="count"
          title="Work by category"
          selected={category}
          onSelect={setCategory}
          size={isMobile ? 120 : 148}
        />
      </View>
      <View className={isDesktop ? 'flex-1' : ''}>
        <ProjectionChart
          series={projection}
          title="Progress and finish"
          subtitle="Completed tasks over time."
          height={isMobile ? 170 : 200}
        />
      </View>
    </View>
  );

  const filters = (
    <View style={{ gap: 8 }}>
      <View className="flex-row items-center flex-wrap gap-2">
        {SEGMENTS.map(s => (
          <FilterChip
            key={s.value}
            label={s.label}
            icon={s.icon}
            active={segment === s.value}
            touchTarget={isMobile}
            count={
              s.value === 'unassigned' ? unassignedCount
                : s.value === 'open' ? openCount
                : s.value === 'done' ? doneCount
                : totalTasks
            }
            onPress={() => setSegment(s.value)}
          />
        ))}
        {!!category && (
          <FilterChip label={`${category} ✕`} active touchTarget={isMobile} onPress={() => setCategory(null)} />
        )}
      </View>

      {visible.length > 0 && (
        <View className="flex-row items-center justify-between gap-3 flex-wrap">
          <TouchableOpacity
            onPress={toggleAllVisible}
            accessibilityRole="button"
            className="flex-row items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-overlay transition-colors"
          >
            <View
              className="items-center justify-center rounded-md border"
              style={{
                width: 16, height: 16,
                borderColor: allVisibleSelected ? c.primary : c.border,
                backgroundColor: allVisibleSelected ? c.primary : 'transparent',
              }}
            >
              {allVisibleSelected && <FontAwesome name="check" size={9} color="#fff" />}
            </View>
            <Text className="text-typography-muted text-[11px] font-semibold">
              {allVisibleSelected ? 'Clear these' : `Select these ${visible.length}`}
            </Text>
          </TouchableOpacity>

          {selected.size > 0 && (
            <View className="flex-row items-center gap-2">
              <Text className="text-brand-primary text-[11px] font-bold">{selected.size} selected</Text>
              {/* Below the two-pane breakpoint the rail is a sheet, so the
                  selection needs a way to reach it. */}
              {!isDesktop && (
                <TouchableOpacity
                  onPress={() => setSheetOpen(true)}
                  accessibilityRole="button"
                  className="rounded-xl bg-brand-primary hover:bg-brand-primary-hover px-4 justify-center"
                  style={{ minHeight: 40 }}
                >
                  <Text className="text-white text-[11px] font-bold">Assign…</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={() => setSelected(new Set())}
                accessibilityRole="button"
                className="rounded-xl border border-surface-border px-3 justify-center"
                style={{ minHeight: 40 }}
              >
                <Text className="text-typography-muted text-[11px] font-bold">Clear</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </View>
  );

  const list =
    visible.length === 0 ? (
      <EntityEmptyState
        kind="task"
        compact
        title={
          totalTasks === 0
            ? 'No tasks on this project yet'
            : segment === 'unassigned'
              ? 'Everything here has someone on it'
              : 'Nothing matches those filters'
        }
        body={
          totalTasks === 0
            ? 'A task is one unit of work inside a project — assigned to a person, tracked with a timer. Tasks arrive when a project is created from a template, or when someone adds one on a board.'
            : segment === 'unassigned'
              ? 'Every open task on this project has a person or a team on it. Switch to Open to see what is still in flight.'
              : 'Try a different filter, or clear the category.'
        }
        secondaryLabel={totalTasks === 0 ? undefined : 'Show everything'}
        onSecondary={totalTasks === 0 ? undefined : () => { setSegment('all'); setCategory(null); }}
      />
    ) : (
      <View style={{ gap: 8 }}>
        {visible.map(t => (
          <TaskRow
            key={t.id}
            task={t}
            selected={selected.has(t.id)}
            onToggle={() => toggle(t.id)}
            onOpen={() => router.push(`/task/${t.id}`)}
            nameById={nameById}
          />
        ))}
      </View>
    );

  return (
    <View className="p-4 md:p-8" style={{ gap: 16 }}>
      {!!answer && (
        <View className="flex-row items-center gap-3 flex-wrap">
          <View
            className="rounded-full items-center justify-center"
            style={{ width: 34, height: 34, backgroundColor: (unassignedCount > 0 ? c.warning : c.success) + '1A' }}
          >
            <FontAwesome
              name={unassignedCount > 0 ? 'user-times' : 'check'}
              size={14}
              color={unassignedCount > 0 ? c.warning : c.success}
            />
          </View>
          <Text className="text-typography-main text-base md:text-lg font-bold flex-1 min-w-0">{answer}</Text>
          {unassignedCount > 0 && segment !== 'unassigned' && (
            <TouchableOpacity
              onPress={() => setSegment('unassigned')}
              accessibilityRole="button"
              className="rounded-xl border border-surface-border px-4 justify-center hover:bg-surface-overlay transition-colors"
              style={{ minHeight: 40 }}
            >
              <Text className="text-typography-main text-[11px] font-bold">Show them</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {charts}

      {/* Desktop: two panes, each with its own scroll (ux-consistency's
          desktop-density rule — a dense screen must not be one narrow
          column). Below 1024 the rail collapses into a sheet reached from
          the selection bar, per the same rule's mobile mapping. */}
      <View className={isDesktop ? 'flex-row gap-6 items-start' : ''} style={{ gap: 12 }}>
        <View className={isDesktop ? 'flex-1 min-w-0' : ''} style={{ gap: 12 }}>
          {filters}
          {list}
          <CategoryMappingSection
            categories={categories}
            tasksByCategory={tasksByCategory}
            pipelines={pipelines}
            teams={teamRows}
            onApply={applyCategoryMapping}
            busy={busy}
          />
        </View>

        {isDesktop && (
          <SidebarLayout
            width={300}
            style={{
              borderLeftWidth: 1,
              borderLeftColor: c.border,
              borderRadius: 16,
              maxHeight: 620,
              flex: undefined,
            }}
          >
            <AssigneeList
              assignees={assignees}
              selectedCount={selected.size}
              onAssign={handleAssign}
              onClear={handleClearAssignees}
              busy={busy}
            />
          </SidebarLayout>
        )}
      </View>

      {/* Mobile/tablet: the same rail as a sheet. DraggableSheet directly,
          not Popup — this is always a drawer here, never a centered card. */}
      {!isDesktop && (
        <DraggableSheet
          visible={sheetOpen}
          onClose={() => setSheetOpen(false)}
          dimBackdrop
          maxHeight="85%"
          title="Assign to"
          containerStyle={{ backgroundColor: c.card }}
        >
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16 }}>
            <AssigneeList
              assignees={assignees}
              selectedCount={selected.size}
              onAssign={handleAssign}
              onClear={handleClearAssignees}
              busy={busy}
            />
          </ScrollView>
        </DraggableSheet>
      )}
    </View>
  );
}
