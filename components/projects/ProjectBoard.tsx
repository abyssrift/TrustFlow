import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, useWindowDimensions } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/hooks/useThemeColors';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useDragSource, useDropTarget } from '@/hooks/useWebDnd';
import { friendlyStageError } from '@/hooks/useProjectLifecycle';
import ProjectStagePicker from './ProjectStagePicker';
import { SkeletonList } from '@/components/Skeleton';
// #176 Projects P6 -- import the table's exported ageing/date helpers instead
// of re-deriving the >=7d amber / >=14d red thresholds a second time (see
// that file's header comment -- this is exactly the second surface it warns
// about). ProjectsTable.tsx itself is NOT edited, only imported from.
import { ageColor, dueColor, fmtDue } from './ProjectsTable';

/**
 * Projects P6 (#176) -- purpose-built project board.
 *
 * WHAT THIS DELIBERATELY DOES NOT SHARE WITH THE TASK BOARD
 * (`_tasks_desktop.tsx`, 1,740 lines): taskBoardCache, the personalizer,
 * StageTransitionFX/actor-chip FLIP animation, submission/claiming/timer
 * machinery, board-switcher favourites+recents. A project card needs none of
 * it (no timers, no submissions, no claiming, no stage actions) -- per the
 * issue, duplicating the visual shell (column header treatment, card
 * shadow/radius, rounded stage-body chrome) is cheaper than generalizing that
 * file, and is the one place the "extend the existing pattern" rule is
 * explicitly overridden. Nothing is imported from _tasks_desktop.tsx.
 *
 * WHAT IS SHARED (on purpose, per the issue's "reuse rather than re-derive"):
 * - `rpc_projects_table` (issue #173) for card data -- already paginated,
 *   already gated by `fn_project_accessible` (#186), already the single
 *   definition of "days in stage" / "weighted progress" so a card can't
 *   drift from the table row for the same project. Called once per stage
 *   column with `p_stage_id` + `p_limit`/`p_offset` -- no new RPC.
 * - `rpc_advance_project_stage` (#172) for every move -- drag-drop AND the
 *   tap-to-move affordance both funnel through it, never a raw UPDATE.
 * - `ageColor`/`dueColor`/`fmtDue` from ProjectsTable.tsx.
 * - `ProjectStagePicker` for the tap-to-move affordance (desktop fallback +
 *   the ONLY move path on mobile, since drag-drop is web/desktop-only) --
 *   already built for #184, doesn't toast itself so this file's toasting
 *   doesn't double up.
 * - `hooks/useWebDnd.ts`'s `useDragSource`/`useDropTarget` -- draggable/
 *   onDrag* props are silently dropped by react-native-web; this hook
 *   attaches real DOM drag events via ref, same pattern FileHub's desktop
 *   view already uses for file/folder drag.
 *
 * PAGINATION (issue's second hazard: the task board fetches an entire
 * pipeline with no limit/range/virtualization -- ties to #45):
 * each column is its own bounded page. PAGE_SIZE=30 per stage per fetch,
 * loaded in parallel (one rpc_projects_table call per stage, not per
 * project), with a manual "Load N more" per column. A pipeline with 2,500
 * projects in one stage still only ever fetches 30 rows for that column
 * until asked for more -- the initial payload is bounded by
 * (stage count x PAGE_SIZE), never by total project count.
 *
 * MOBILE (<768px): not a horizontally-scrolling desktop board (CLAUDE.md
 * names that the #1 way this pattern gets violated). One stage visible at a
 * time, picked via the same horizontal stage-chip affordance
 * ProjectsTable.tsx already uses for its mobile stage filter -- cards stack
 * vertically underneath. Moving a card is the tap-to-move button (opens
 * ProjectStagePicker), not a drag gesture -- there is no drag surface on
 * touch in this app (useWebDnd is web-pointer-event only).
 */

const PAGE_SIZE = 30;
const DESKTOP_BREAKPOINT = 768;

type BoardRow = {
  id: string;
  name: string;
  current_stage_id: string | null;
  stage_name: string | null;
  stage_color: string | null;
  days_in_current_stage: number | null;
  due_date: string | null;
  days_remaining: number | null;
  tasks_total: number;
  tasks_done: number;
  weighted_progress: number;
  blocked: boolean;
};

type Stage = { id: string; name: string; color: string | null; position: number };
type Pipeline = { id: string; name: string };
type ColumnState = { rows: BoardRow[]; offset: number; hasMore: boolean; loading: boolean };
type DragPayload = { projectId: string; fromStageId: string };

function emptyColumn(): ColumnState {
  return { rows: [], offset: 0, hasMore: false, loading: true };
}

// ─── Card ──────────────────────────────────────────────────────────────────
// Its own component (not a helper fn called from inside a .map) so
// useDragSource -- a hook -- is called a fixed number of times per render:
// once, from this component's own render, however many card instances React
// mounts. Calling a hook from inside a loop body in the parent would violate
// the rules of hooks the moment the row count changes between renders.
function ProjectCard({
  row, stageId, canEdit, dragEnabled, isMoving, justMoved, onOpen, onTapMove,
}: {
  row: BoardRow;
  stageId: string;
  canEdit: boolean;
  dragEnabled: boolean;
  isMoving: boolean;
  justMoved: boolean;
  onOpen: (id: string) => void;
  onTapMove: (row: BoardRow) => void;
}) {
  const c = useThemeColors();
  const dragRef = useDragSource<DragPayload>({ projectId: row.id, fromStageId: stageId }, dragEnabled);
  return (
    <TouchableOpacity
      ref={dragRef}
      onPress={() => onOpen(row.id)}
      disabled={isMoving}
      className="bg-surface-card p-4 rounded-2xl mb-3 premium-shadow"
      style={{
        borderWidth: justMoved ? 1.5 : 1,
        borderColor: justMoved ? c.primary : 'rgba(128,128,128,0.15)',
        opacity: isMoving ? 0.5 : 1,
      }}
    >
      <View className="flex-row items-start justify-between gap-2 mb-2">
        <Text className="text-typography-main font-black text-sm flex-1" numberOfLines={2}>{row.name}</Text>
        {canEdit && (
          <TouchableOpacity
            onPress={(e) => { e.stopPropagation(); onTapMove(row); }}
            hitSlop={8}
            style={{ width: 26, height: 26 }}
            className="items-center justify-center rounded-lg bg-surface-background border border-surface-border"
          >
            <FontAwesome name="exchange" size={10} color={c.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      <Text style={{ color: ageColor(row.days_in_current_stage, c) }} className="text-xs font-black mb-2">
        {row.days_in_current_stage == null ? 'Never staged' : `${row.days_in_current_stage}d in stage`}
      </Text>

      <View className="mb-2">
        <View className="flex-row justify-between mb-1">
          <Text className="text-typography-muted text-[10px] font-bold">{row.tasks_done}/{row.tasks_total}</Text>
          <Text className="text-typography-main text-[10px] font-black">{Math.round(row.weighted_progress)}%</Text>
        </View>
        <View className="h-1.5 w-full bg-surface-background rounded-full overflow-hidden">
          <View style={{ width: `${Math.min(100, Math.max(0, row.weighted_progress))}%`, backgroundColor: row.blocked ? c.danger : c.primary }} className="h-full rounded-full" />
        </View>
      </View>

      {row.due_date && (
        <Text style={{ color: dueColor(row.days_remaining, c) }} className="text-[11px] font-bold">
          {fmtDue(row.days_remaining, row.due_date)}
        </Text>
      )}
    </TouchableOpacity>
  );
}

// ─── Column (desktop) ────────────────────────────────────────────────────
// Same reasoning as ProjectCard: useDropTarget is a hook, so the column body
// needs to be its own component rather than a function called from
// stages.map() inside the parent's render.
function ProjectColumn({
  stage, col, canEdit, movePendingId, justMovedId, onOpen, onTapMove, onDrop, onLoadMore,
}: {
  stage: Stage;
  col: ColumnState;
  canEdit: boolean;
  movePendingId: string | null;
  justMovedId: string | null;
  onOpen: (id: string) => void;
  onTapMove: (row: BoardRow) => void;
  onDrop: (payload: DragPayload, stage: Stage) => void;
  onLoadMore: (stageId: string, nextOffset: number) => void;
}) {
  const c = useThemeColors();
  const { ref: dropRef, isOver } = useDropTarget<DragPayload>(
    (payload) => onDrop(payload, stage),
    (payload) => payload.fromStageId !== stage.id,
  );

  return (
    <View className="h-full" style={{ width: 320, marginRight: 24 }}>
      <View className="flex-row items-center mb-4 px-1">
        <View style={{ backgroundColor: stage.color ?? c.primary }} className="w-3 h-3 rounded-full mr-3" />
        <Text className="text-typography-main font-black text-sm uppercase tracking-[0.2em]" numberOfLines={1}>{stage.name}</Text>
        <View className="ml-2 bg-surface-card border border-surface-border px-2 py-0.5 rounded-lg">
          <Text className="text-typography-muted text-[10px] font-black">{col.rows.length}{col.hasMore ? '+' : ''}</Text>
        </View>
      </View>

      <View
        ref={dropRef as any}
        className="flex-1 rounded-[2.5rem] p-4 border"
        style={{
          backgroundColor: isOver ? `${c.primary}14` : 'rgba(128,128,128,0.03)',
          borderColor: isOver ? c.primary : 'rgba(128,128,128,0.15)',
        }}
      >
        {col.loading && col.rows.length === 0 ? (
          <SkeletonList count={3} itemHeight={90} />
        ) : col.rows.length === 0 ? (
          <View className="items-center py-10 px-2">
            <FontAwesome name="inbox" size={20} color={c.textDim} />
            <Text className="text-typography-dim text-xs mt-2">No projects here</Text>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false}>
            {col.rows.map(row => (
              <ProjectCard
                key={row.id}
                row={row}
                stageId={stage.id}
                canEdit={canEdit}
                dragEnabled={canEdit}
                isMoving={movePendingId === row.id}
                justMoved={justMovedId === row.id}
                onOpen={onOpen}
                onTapMove={onTapMove}
              />
            ))}
            {col.hasMore && (
              <TouchableOpacity
                onPress={() => onLoadMore(stage.id, col.offset + PAGE_SIZE)}
                disabled={col.loading}
                className="items-center py-3 rounded-xl border border-surface-border mb-4"
              >
                <Text className="text-typography-muted text-[10px] font-black uppercase">
                  {col.loading ? 'Loading…' : `Load ${PAGE_SIZE} more`}
                </Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

export default function ProjectBoard({
  onOpenProject,
  refreshKey = 0,
}: {
  onOpenProject: (id: string) => void;
  refreshKey?: number;
}) {
  const c = useThemeColors();
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;
  const { hasPermission } = useAuth();
  const { successToast, errorToast } = useToast();
  const canEdit = hasPermission('project.edit');

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [shellLoading, setShellLoading] = useState(true);
  const [columns, setColumns] = useState<Record<string, ColumnState>>({});
  const [mobileStageId, setMobileStageId] = useState<string | null>(null);
  const [movePendingId, setMovePendingId] = useState<string | null>(null);
  const [justMovedId, setJustMovedId] = useState<string | null>(null);
  const [pickerProject, setPickerProject] = useState<{ id: string; stageId: string | null } | null>(null);

  // Pipelines (subject_kind='project') -- same query ProjectStagePicker.tsx
  // already runs, kept here as a second call rather than importing that
  // component's internals: it's a 6-line RLS-scoped select, not worth
  // coupling two components over.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setShellLoading(true);
      const { data } = await supabase
        .from('pipelines')
        .select('id, name')
        .eq('subject_kind', 'project')
        .is('deleted_at', null)
        .order('name');
      if (cancelled) return;
      const list = data || [];
      setPipelines(list);
      setPipelineId(prev => (prev && list.some(p => p.id === prev)) ? prev : (list[0]?.id ?? null));
      if (list.length === 0) setShellLoading(false);
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  // Stages for the selected pipeline.
  useEffect(() => {
    if (!pipelineId) { setStages([]); return; }
    let cancelled = false;
    (async () => {
      setShellLoading(true);
      const { data } = await supabase
        .from('pipeline_stages')
        .select('id, name, color, position')
        .eq('pipeline_id', pipelineId)
        .order('position');
      if (cancelled) return;
      const list = data || [];
      setStages(list);
      setMobileStageId(prev => (prev && list.some(s => s.id === prev)) ? prev : (list[0]?.id ?? null));
      setShellLoading(false);
    })();
    return () => { cancelled = true; };
  }, [pipelineId]);

  const loadStage = useCallback(async (stageId: string, offset: number) => {
    setColumns(prev => ({ ...prev, [stageId]: { ...(prev[stageId] ?? emptyColumn()), loading: true } }));
    const { data, error } = await supabase.rpc('rpc_projects_table', {
      p_stage_id: stageId,
      p_limit: PAGE_SIZE,
      p_offset: offset,
    });
    const rows = (error ? [] : (data as BoardRow[])) || [];
    setColumns(prev => {
      const existing = offset === 0 ? [] : (prev[stageId]?.rows ?? []);
      return {
        ...prev,
        [stageId]: { rows: [...existing, ...rows], offset, hasMore: rows.length === PAGE_SIZE, loading: false },
      };
    });
  }, []);

  // Initial + refresh load: every stage's first page, in parallel -- one
  // request per column, not one per project.
  useEffect(() => {
    if (stages.length === 0) return;
    stages.forEach(s => loadStage(s.id, 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stages, refreshKey]);

  const reloadBoard = useCallback(() => {
    stages.forEach(s => loadStage(s.id, 0));
  }, [stages, loadStage]);

  const advanceProject = useCallback(async (projectId: string, toStageId: string): Promise<boolean> => {
    const { error } = await supabase.rpc('rpc_advance_project_stage', { p_project_id: projectId, p_to_stage_id: toStageId });
    if (error) {
      errorToast(friendlyStageError(error.message), 'Could not move project');
      return false;
    }
    successToast('Project moved.', 'Stage updated');
    return true;
  }, [errorToast, successToast]);

  // Drag-and-drop path: source and target are both columns of the currently
  // rendered pipeline, so an optimistic patch (days_in_current_stage resets
  // to 0, which is what the server will compute a moment later) is safe and
  // avoids a round trip before the card visibly moves. On failure, the two
  // affected columns are re-fetched from scratch rather than hand-unwound --
  // simpler and always correct, at the cost of losing "load more" position
  // on just those two columns (acceptable: failure is the rare path).
  const handleDrop = useCallback(async (payload: DragPayload, toStage: Stage) => {
    if (payload.fromStageId === toStage.id || movePendingId) return;
    let row: BoardRow | undefined;
    setColumns(prev => {
      row = prev[payload.fromStageId]?.rows.find(r => r.id === payload.projectId);
      if (!row) return prev;
      const next = { ...prev };
      next[payload.fromStageId] = {
        ...(next[payload.fromStageId] ?? emptyColumn()),
        rows: (next[payload.fromStageId]?.rows ?? []).filter(r => r.id !== row!.id),
      };
      const patched: BoardRow = { ...row, current_stage_id: toStage.id, stage_name: toStage.name, stage_color: toStage.color, days_in_current_stage: 0 };
      next[toStage.id] = {
        ...(next[toStage.id] ?? emptyColumn()),
        rows: [patched, ...(next[toStage.id]?.rows ?? [])],
      };
      return next;
    });
    if (!row) return;

    setMovePendingId(payload.projectId);
    const ok = await advanceProject(row.id, toStage.id);
    setMovePendingId(null);
    if (!ok) {
      await Promise.all([loadStage(payload.fromStageId, 0), loadStage(toStage.id, 0)]);
    } else {
      const movedId = row.id;
      setJustMovedId(movedId);
      setTimeout(() => setJustMovedId(prev => (prev === movedId ? null : prev)), 1500);
    }
  }, [movePendingId, advanceProject, loadStage]);

  // Tap-to-move path (mobile's only move path; also the desktop fallback for
  // anyone not dragging). ProjectStagePicker spans every project pipeline,
  // not just the one currently on screen, so a move through it can relocate
  // a project out of view entirely -- a full board reload (not an optimistic
  // patch) is the only correct response.
  const handlePickerSelect = useCallback(async (stageId: string): Promise<boolean> => {
    if (!pickerProject) return false;
    const ok = await advanceProject(pickerProject.id, stageId);
    if (ok) reloadBoard();
    return ok;
  }, [pickerProject, advanceProject, reloadBoard]);

  const openPicker = useCallback((row: BoardRow) => setPickerProject({ id: row.id, stageId: row.current_stage_id }), []);

  const pipelineChips = pipelines.length > 1 && (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-4" contentContainerStyle={{ gap: 8 }}>
      {pipelines.map(p => (
        <TouchableOpacity
          key={p.id}
          onPress={() => setPipelineId(p.id)}
          className={`px-4 min-h-[44px] justify-center rounded-full border ${pipelineId === p.id ? 'bg-brand-primary/10 border-brand-primary' : 'border-surface-border'}`}
        >
          <Text className={`text-[11px] font-black uppercase ${pipelineId === p.id ? 'text-brand-primary' : 'text-typography-muted'}`}>{p.name}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  if (shellLoading && stages.length === 0 && pipelines.length === 0) {
    return <View className="p-6"><SkeletonList count={4} itemHeight={120} /></View>;
  }

  if (!shellLoading && pipelines.length === 0) {
    return (
      <View className="items-center justify-center py-16 px-6">
        <FontAwesome name="columns" size={28} color={c.textMuted} />
        <Text className="text-typography-main text-lg font-black mt-4">No project pipelines yet</Text>
        <Text className="text-typography-muted text-sm text-center mt-2 max-w-sm">
          Mark a pipeline as "Projects" in the pipeline editor to see a board here.
        </Text>
      </View>
    );
  }

  if (isDesktop) {
    return (
      <View className="flex-1">
        {pipelineChips}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-1" contentContainerStyle={{ paddingBottom: 24 }}>
          {stages.map(stage => (
            <ProjectColumn
              key={stage.id}
              stage={stage}
              col={columns[stage.id] ?? emptyColumn()}
              canEdit={canEdit}
              movePendingId={movePendingId}
              justMovedId={justMovedId}
              onOpen={onOpenProject}
              onTapMove={openPicker}
              onDrop={handleDrop}
              onLoadMore={loadStage}
            />
          ))}
        </ScrollView>
        <ProjectStagePicker
          visible={!!pickerProject}
          currentStageId={pickerProject?.stageId ?? null}
          onClose={() => setPickerProject(null)}
          onSelectStage={handlePickerSelect}
        />
      </View>
    );
  }

  // Mobile / narrow web: one stage at a time via chips, cards stacked
  // vertically underneath -- never a horizontally-scrolling board.
  const activeStage = stages.find(s => s.id === mobileStageId) ?? stages[0];
  const activeCol = activeStage ? (columns[activeStage.id] ?? emptyColumn()) : emptyColumn();

  return (
    <View className="flex-1 px-4">
      {pipelineChips}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-4" contentContainerStyle={{ gap: 8 }}>
        {stages.map(s => (
          <TouchableOpacity
            key={s.id}
            onPress={() => setMobileStageId(s.id)}
            className={`flex-row items-center gap-1.5 px-4 min-h-[44px] rounded-full border ${mobileStageId === s.id ? 'bg-brand-primary/10 border-brand-primary' : 'border-surface-border'}`}
          >
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: s.color ?? c.primary }} />
            <Text className={`text-[11px] font-black uppercase ${mobileStageId === s.id ? 'text-brand-primary' : 'text-typography-muted'}`} numberOfLines={1}>{s.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {activeCol.loading && activeCol.rows.length === 0 ? (
        <SkeletonList count={3} itemHeight={110} />
      ) : activeCol.rows.length === 0 ? (
        <View className="items-center py-16 px-2">
          <FontAwesome name="inbox" size={24} color={c.textDim} />
          <Text className="text-typography-dim text-sm mt-3">No projects in this stage</Text>
        </View>
      ) : (
        <>
          {activeStage && activeCol.rows.map(row => (
            <ProjectCard
              key={row.id}
              row={row}
              stageId={activeStage.id}
              canEdit={canEdit}
              dragEnabled={false}
              isMoving={movePendingId === row.id}
              justMoved={justMovedId === row.id}
              onOpen={onOpenProject}
              onTapMove={openPicker}
            />
          ))}
          {activeCol.hasMore && activeStage && (
            <TouchableOpacity
              onPress={() => loadStage(activeStage.id, activeCol.offset + PAGE_SIZE)}
              disabled={activeCol.loading}
              className="items-center py-3 rounded-xl border border-surface-border mb-6"
              style={{ minHeight: 44 }}
            >
              <Text className="text-typography-muted text-[10px] font-black uppercase">
                {activeCol.loading ? 'Loading…' : `Load ${PAGE_SIZE} more`}
              </Text>
            </TouchableOpacity>
          )}
        </>
      )}

      <ProjectStagePicker
        visible={!!pickerProject}
        currentStageId={pickerProject?.stageId ?? null}
        onClose={() => setPickerProject(null)}
        onSelectStage={handlePickerSelect}
      />
    </View>
  );
}
