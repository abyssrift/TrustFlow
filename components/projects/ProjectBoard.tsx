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
import { InlineRename, ProjectActionsButton, useProjectActions } from './ProjectActionsMenu';
import { SkeletonList } from '@/components/Skeleton';
import Tooltip from '@/components/common/Tooltip';
// Phase 8 (#187): the card, the chips and the empty states are the shared
// vocabulary in components/entities/EntityUI.tsx, and the column chrome is
// components/board/BoardChrome.tsx -- see both files' headers. The ageing
// thresholds this board used to import from ProjectsTable.tsx now live in
// lib/projectPresentation.ts with a self-check on them.
import {
  EntityEmptyState,
  FilterChip,
  ProjectCard,
  type ProjectCardRow,
} from '@/components/entities/EntityUI';
import { BoardColumn, BoardColumnEmpty } from '@/components/board/BoardChrome';

/**
 * Projects P6 (#176) -- purpose-built project board.
 *
 * WHAT THIS DELIBERATELY DOES NOT SHARE WITH THE TASK BOARD
 * (`_tasks_desktop.tsx`, 1,740 lines): taskBoardCache, the personalizer,
 * StageTransitionFX/actor-chip FLIP animation, submission/claiming/timer
 * machinery, board-switcher favourites+recents. A project card needs none of
 * it (no timers, no submissions, no claiming, no stage actions), so
 * generalizing that file was and remains the wrong trade. Nothing is imported
 * from _tasks_desktop.tsx.
 *
 * WHAT PHASE 8 (#187) CHANGED ABOUT THAT: the visual shell used to be
 * *copied* here, which left two definitions of "what a board column looks
 * like", free to drift. The chrome now lives once in
 * `components/board/BoardChrome.tsx` (values taken from _tasks_desktop.tsx so
 * adopting it there is visually a no-op -- that adoption is a separate change,
 * the task board being out of this phase's scope). Data paths stay separate,
 * as above; only the pixels are shared.
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

// rpc_projects_table's row, narrowed to what a card needs. `ProjectCardRow`
// is the structural contract EntityUI's card accepts, so this stays a subset
// of the table's row rather than a second, drifting shape.
type BoardRow = ProjectCardRow & {
  current_stage_id: string | null;
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
function BoardProjectCard({
  row, stageId, canEdit, dragEnabled, isMoving, justMoved, renaming, onOpen, onTapMove, onOpenMenu, onCommitRename, onCancelRename,
}: {
  row: BoardRow;
  stageId: string;
  canEdit: boolean;
  dragEnabled: boolean;
  isMoving: boolean;
  justMoved: boolean;
  renaming: boolean;
  onOpen: (id: string) => void;
  onTapMove: (row: BoardRow) => void;
  onOpenMenu: (row: BoardRow) => void;
  onCommitRename: (row: BoardRow, next: string) => void;
  onCancelRename: () => void;
}) {
  const c = useThemeColors();
  const dragRef = useDragSource<DragPayload>({ projectId: row.id, fromStageId: stageId }, dragEnabled);
  return (
    <View className="mb-2.5">
      <ProjectCard
        row={row}
        innerRef={dragRef}
        onPress={() => onOpen(row.id)}
        dimmed={isMoving}
        highlighted={justMoved}
        actions={
          <View className="flex-row items-center gap-1.5">
            <Tooltip label={canEdit ? 'Move to another stage' : 'You need the “edit projects” permission to move a project'}>
              <TouchableOpacity
                onPress={(e) => { e.stopPropagation(); if (canEdit) onTapMove(row); }}
                disabled={!canEdit}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Move ${row.name} to another stage`}
                style={{ width: 28, height: 28, opacity: canEdit ? 1 : 0.4 }}
                className="items-center justify-center rounded-lg border border-surface-border hover:bg-surface-overlay"
              >
                <FontAwesome name="exchange" size={11} color={c.textMuted} />
              </TouchableOpacity>
            </Tooltip>
            <ProjectActionsButton onPress={() => onOpenMenu(row)} label={`Actions for ${row.name}`} />
          </View>
        }
        footer={
          renaming ? (
            <View className="mt-2.5">
              <InlineRename
                initialValue={row.name}
                onCommit={(next) => onCommitRename(row, next)}
                onCancel={onCancelRename}
              />
            </View>
          ) : undefined
        }
      />
    </View>
  );
}

// ─── Column (desktop) ────────────────────────────────────────────────────
// Same reasoning as ProjectCard: useDropTarget is a hook, so the column body
// needs to be its own component rather than a function called from
// stages.map() inside the parent's render.
function ProjectColumn({
  stage, col, canEdit, movePendingId, justMovedId, renamingId, onOpen, onTapMove, onDrop, onLoadMore, onOpenMenu, onCommitRename, onCancelRename,
}: {
  stage: Stage;
  col: ColumnState;
  canEdit: boolean;
  movePendingId: string | null;
  justMovedId: string | null;
  renamingId: string | null;
  onOpen: (id: string) => void;
  onTapMove: (row: BoardRow) => void;
  onDrop: (payload: DragPayload, stage: Stage) => void;
  onLoadMore: (stageId: string, nextOffset: number) => void;
  onOpenMenu: (row: BoardRow) => void;
  onCommitRename: (row: BoardRow, next: string) => void;
  onCancelRename: () => void;
}) {
  const { ref: dropRef, isOver } = useDropTarget<DragPayload>(
    (payload) => onDrop(payload, stage),
    (payload) => payload.fromStageId !== stage.id,
  );

  return (
    <BoardColumn
      name={stage.name}
      color={stage.color}
      count={col.rows.length}
      hasMore={col.hasMore}
      isOver={isOver}
      dropRef={dropRef}
    >
      {col.loading && col.rows.length === 0 ? (
        <SkeletonList count={3} itemHeight={150} />
      ) : col.rows.length === 0 ? (
        <BoardColumnEmpty label={canEdit ? `Nothing is in ${stage.name}. Drag a project here to move it.` : `Nothing is in ${stage.name}.`} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          {col.rows.map(row => (
            <BoardProjectCard
              key={row.id}
              row={row}
              stageId={stage.id}
              canEdit={canEdit}
              dragEnabled={canEdit}
              isMoving={movePendingId === row.id}
              justMoved={justMovedId === row.id}
              renaming={renamingId === row.id}
              onOpen={onOpen}
              onTapMove={onTapMove}
              onOpenMenu={onOpenMenu}
              onCommitRename={onCommitRename}
              onCancelRename={onCancelRename}
            />
          ))}
          {col.hasMore && (
            <TouchableOpacity
              onPress={() => onLoadMore(stage.id, col.offset + PAGE_SIZE)}
              disabled={col.loading}
              className="items-center justify-center py-2.5 rounded-xl border border-surface-border mb-3 hover:bg-surface-overlay"
              style={{ minHeight: 40 }}
            >
              <Text className="text-typography-muted text-[11px] font-semibold">
                {col.loading ? 'Loading…' : `Show ${PAGE_SIZE} more`}
              </Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      )}
    </BoardColumn>
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

  // Phase 8 (#187) -- rename / roll-forward / save-as-template / archive from
  // the card itself, not only from the detail route (plan §17).
  const reloadBoardRef = React.useRef<() => void>(() => {});
  const actions = useProjectActions({
    onChanged: () => reloadBoardRef.current(),
    onOpenProject,
  });

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
  reloadBoardRef.current = reloadBoard;

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
    // flexGrow:0 -- react-native-web's ScrollView defaults to flexGrow:1
    // regardless of the `horizontal` prop, so nested inside a `flex-1`
    // column (both the desktop and mobile branches below) this chip row
    // would otherwise swallow all remaining vertical space and, combined
    // with alignItems:'stretch', stretch every rounded-full chip into a
    // giant pill filling the column -- caught by driving the mobile board
    // in a real browser at 390px, not visible at the single-pipeline count
    // this repo happens to seed locally.
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} className="mb-4" contentContainerStyle={{ gap: 8, alignItems: 'center' }}>
      <Text className="text-typography-dim text-[10px] font-black uppercase tracking-[0.15em] mr-1">Board</Text>
      {pipelines.map(p => (
        <FilterChip
          key={p.id}
          label={p.name}
          icon="columns"
          active={pipelineId === p.id}
          onPress={() => setPipelineId(p.id)}
          touchTarget
        />
      ))}
    </ScrollView>
  );

  if (shellLoading && stages.length === 0 && pipelines.length === 0) {
    return <View className="p-6"><SkeletonList count={4} itemHeight={120} /></View>;
  }

  if (!shellLoading && pipelines.length === 0) {
    // §17: explain the entity. Users confuse a board with a project — this is
    // the screen where saying what a board IS pays for itself.
    return (
      <EntityEmptyState
        kind="board"
        title="No project board yet"
        body="A board is the run of stages a project moves through — Planning, In progress, Review, Done. Open the pipeline editor and mark a pipeline as “Projects” to see one here."
      />
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
              renamingId={actions.renamingId}
              onOpen={onOpenProject}
              onTapMove={openPicker}
              onDrop={handleDrop}
              onLoadMore={loadStage}
              onOpenMenu={actions.openMenu}
              onCommitRename={actions.commitRename}
              onCancelRename={actions.cancelRename}
            />
          ))}
        </ScrollView>
        <ProjectStagePicker
          visible={!!pickerProject}
          currentStageId={pickerProject?.stageId ?? null}
          onClose={() => setPickerProject(null)}
          onSelectStage={handlePickerSelect}
        />
        {actions.overlay}
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
      {/* flexGrow:0 -- see the identical note on pipelineChips above; without
          it this horizontal chip row stretches to fill the flex-1 column
          and its rounded-full chips balloon into full-height pills. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} className="mb-4" contentContainerStyle={{ gap: 8, alignItems: 'center' }}>
        <Text className="text-typography-dim text-[10px] font-black uppercase tracking-[0.15em] mr-1">Stage</Text>
        {stages.map(s => (
          <FilterChip
            key={s.id}
            label={s.name}
            dotColor={s.color ?? c.primary}
            count={columns[s.id]?.rows.length}
            active={mobileStageId === s.id}
            onPress={() => setMobileStageId(s.id)}
            touchTarget
          />
        ))}
      </ScrollView>

      {/* The stage-chip row above is a fixed header; only the card list
          scrolls. Without this ScrollView the outer flex-1 View has no
          scroll affordance at all, so a stage with more cards than fit one
          screen (easy once "Load 30 more" is tapped a couple of times) was
          simply unreachable below the fold -- caught the same way as the
          chip-stretch bug, by actually driving this at 390px. */}
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
        {activeCol.loading && activeCol.rows.length === 0 ? (
          <SkeletonList count={3} itemHeight={170} />
        ) : activeCol.rows.length === 0 ? (
          <EntityEmptyState
            kind="project"
            compact
            title={activeStage ? `Nothing is in ${activeStage.name}` : 'Nothing here'}
            body={
              canEdit
                ? 'Projects land in a stage when someone moves them. Open a project and use its stage chip, or tap the move button on a card in another stage.'
                : 'Projects appear in a stage once someone moves them here.'
            }
          />
        ) : (
          <>
            {activeStage && activeCol.rows.map(row => (
              <BoardProjectCard
                key={row.id}
                row={row}
                stageId={activeStage.id}
                canEdit={canEdit}
                dragEnabled={false}
                isMoving={movePendingId === row.id}
                justMoved={justMovedId === row.id}
                renaming={actions.renamingId === row.id}
                onOpen={onOpenProject}
                onTapMove={openPicker}
                onOpenMenu={actions.openMenu}
                onCommitRename={actions.commitRename}
                onCancelRename={actions.cancelRename}
              />
            ))}
            {activeCol.hasMore && activeStage && (
              <TouchableOpacity
                onPress={() => loadStage(activeStage.id, activeCol.offset + PAGE_SIZE)}
                disabled={activeCol.loading}
                className="items-center justify-center py-3 rounded-xl border border-surface-border mb-6"
                style={{ minHeight: 44 }}
              >
                <Text className="text-typography-muted text-[11px] font-semibold">
                  {activeCol.loading ? 'Loading…' : `Show ${PAGE_SIZE} more`}
                </Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </ScrollView>

      <ProjectStagePicker
        visible={!!pickerProject}
        currentStageId={pickerProject?.stageId ?? null}
        onClose={() => setPickerProject(null)}
        onSelectStage={handlePickerSelect}
      />
      {actions.overlay}
    </View>
  );
}
