import { supabase } from '@/lib/supabase';

// Issue #216 — bulk actions for multi-selected tasks on the Tasks board.
// Every backing RPC here already existed for the single-task flows
// (TaskCardActions, EditTaskModal, TaskDetailContext) — this module is just
// the N-task wiring, per .agents/rules/global-utilities-index.md rule 1
// (reuse the existing writer, don't fork a bulk-only duplicate).

export type BulkOutcome = {
  succeededIds: string[];
  failed: { id: string; message: string }[];
};

/**
 * Runs `fn` once per id, in order, isolating failures so one bad task
 * (permission denied, stale timer, already-terminal stage, ...) can't abort
 * the rest of the batch. Sequential rather than Promise.all — several of
 * these RPCs fire notifications/history rows per call, and firing N of them
 * in parallel would race those side effects for no benefit (there is no
 * atomic bulk equivalent for archive/revert/ping/stage-place/pipeline-move,
 * unlike rpc_bulk_update_task_assignments below).
 */
export async function runSequential(
  ids: string[],
  fn: (id: string) => Promise<void>,
): Promise<BulkOutcome> {
  const succeededIds: string[] = [];
  const failed: { id: string; message: string }[] = [];
  for (const id of ids) {
    try {
      await fn(id);
      succeededIds.push(id);
    } catch (err: any) {
      failed.push({ id, message: err?.message || 'Unknown error' });
    }
  }
  return { succeededIds, failed };
}

/**
 * Human summary of a BulkOutcome for a toast, e.g. "Archived 4 of 5 tasks —
 * 1 failed." `verb` is the past-tense form ("Archived", "Pinged", "Moved").
 */
export function summarizeBulkOutcome(outcome: BulkOutcome, verb: string): string {
  const total = outcome.succeededIds.length + outcome.failed.length;
  const noun = total === 1 ? 'task' : 'tasks';
  if (outcome.failed.length === 0) {
    return `${verb} ${outcome.succeededIds.length} ${noun}.`;
  }
  if (outcome.succeededIds.length === 0) {
    return `No tasks were ${verb.toLowerCase()} (${total} selected).`;
  }
  return `${verb} ${outcome.succeededIds.length} of ${total} ${noun} — ${outcome.failed.length} failed.`;
}

export function bulkArchiveTasks(ids: string[]): Promise<BulkOutcome> {
  return runSequential(ids, async (id) => {
    const { error } = await supabase.rpc('rpc_archive_task', { p_task_id: id });
    if (error) throw error;
  });
}

export function bulkRevertTasks(ids: string[]): Promise<BulkOutcome> {
  return runSequential(ids, async (id) => {
    const { error } = await supabase.rpc('rpc_revert_stage', { p_task_id: id });
    if (error) throw error;
  });
}

export function bulkPingTasks(ids: string[]): Promise<BulkOutcome> {
  return runSequential(ids, async (id) => {
    const { error } = await supabase.rpc('rpc_ping_task', { p_task_id: id });
    if (error) throw error;
  });
}

/** Places each task directly into `stageId` within its own pipeline (a manager override, not a workflow transition). */
export function bulkMoveTasksToStage(ids: string[], stageId: string): Promise<BulkOutcome> {
  return runSequential(ids, async (id) => {
    const { error } = await supabase.rpc('rpc_import_place_task_stage', { p_task_id: id, p_stage_id: stageId });
    if (error) throw error;
  });
}

/** Moves each task to a different pipeline (lands in that pipeline's initial stage). */
export function bulkMoveTasksToPipeline(ids: string[], pipelineId: string): Promise<BulkOutcome> {
  return runSequential(ids, async (id) => {
    const { error } = await supabase.rpc('rpc_move_task_pipeline', { p_task_id: id, p_pipeline_id: pipelineId });
    if (error) throw error;
  });
}

/**
 * Priority/project moves are plain column updates gated by the
 * `tasks_update_editable` RLS policy (the same policy EditTaskModal's save
 * relies on) — no RPC needed. One batched UPDATE .in(ids) instead of N round
 * trips; `RETURNING id` reports which rows RLS actually let through, so a
 * partial success (a task this user can't edit) surfaces instead of being
 * silently claimed as done.
 */
async function bulkUpdateTaskColumn(ids: string[], patch: Record<string, unknown>): Promise<BulkOutcome> {
  if (ids.length === 0) return { succeededIds: [], failed: [] };
  const { data, error } = await supabase.from('tasks').update(patch).in('id', ids).select('id');
  if (error) {
    return { succeededIds: [], failed: ids.map(id => ({ id, message: error.message })) };
  }
  const succeededIds = (data || []).map((row: any) => row.id as string);
  const succeededSet = new Set(succeededIds);
  const failed = ids
    .filter(id => !succeededSet.has(id))
    .map(id => ({ id, message: 'Not permitted, or the task no longer exists.' }));
  return { succeededIds, failed };
}

export function bulkSetTaskPriority(ids: string[], priority: string): Promise<BulkOutcome> {
  return bulkUpdateTaskColumn(ids, { priority });
}

export function bulkMoveTasksToProject(ids: string[], projectId: string | null): Promise<BulkOutcome> {
  return bulkUpdateTaskColumn(ids, { project_id: projectId });
}

/**
 * Reassignment is one atomic call to `rpc_bulk_update_task_assignments`
 * (issue #198), which wraps `rpc_update_task_assignments` per task inside a
 * single transaction — it commits every task or none. That means it CANNOT
 * be isolated per task the way the loops above are: a permission failure on
 * one selected task aborts the whole batch, by design (a half-reassigned
 * engagement is worse than a refused one — see the migration's own comment).
 */
export async function bulkAssignTasks(ids: string[], userIds: string[], teamIds: string[]): Promise<void> {
  const { error } = await supabase.rpc('rpc_bulk_update_task_assignments', {
    p_task_ids: ids,
    p_user_ids: userIds,
    p_team_ids: teamIds,
  });
  if (error) throw error;
}
