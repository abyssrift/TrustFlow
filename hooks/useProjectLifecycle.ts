import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/contexts/ToastContext';

// #172 P2 -- reads/writes the fields the Phase 2 backend added to `projects`
// (current_stage_id, blocked, blocked_reason) that rpc_project_dashboard does
// not carry. Originally shared by ProjectDashboard.tsx and
// ProjectDashboardSheet.tsx; both were retired by #184 in favor of the
// /projects/[id] route, which is now this hook's caller (via ProjectHeader.tsx)
// so the fetch/mutate logic (and the RPC error-message mapping) still exists
// once.
//
// #184 also added `flags`/`flag_note` (plan §13.12's fixed, composable set --
// blocked / awaiting_client / at_risk) for the route's shared header, and
// retired the standalone `setBlocked` mutator (ProjectBlockedToggle.tsx,
// its only caller, went with the two Popups #184 replaced). `blocked`/
// `blocked_reason` are NOT dropped -- rpc_projects_table's list badge,
// sort and "blocked only" filter (ProjectsTable.tsx) still read them, and
// that RPC's contract is fixed (see .agents/rules/global-utilities-
// index.md). So setFlags below is now the ONLY write path for "is this
// project blocked", and it keeps both representations in sync in the same
// UPDATE -- one flag toggle in the new header, not two independently
// editable states that can drift apart.

export type ProjectFlag = 'blocked' | 'awaiting_client' | 'at_risk';
export const PROJECT_FLAGS: { key: ProjectFlag; label: string }[] = [
  { key: 'blocked', label: 'Blocked' },
  { key: 'awaiting_client', label: 'Awaiting Client' },
  { key: 'at_risk', label: 'At Risk' },
];

export type ProjectLifecycle = {
  pipelineId: string | null;
  currentStageId: string | null;
  stageName: string | null;
  stageColor: string | null;
  blocked: boolean;
  blockedReason: string | null;
  flags: ProjectFlag[];
  flagNote: string | null;
};

// rpc_advance_project_stage's RAISE EXCEPTION messages, verbatim -> readable copy.
const STAGE_ERROR_MESSAGES: Record<string, string> = {
  'Invalid stage transition path': "That stage isn't reachable directly from the current one — check the pipeline's transition rules, or ask an owner to move it.",
  'Target stage does not belong to a project pipeline': 'That stage belongs to a task pipeline, not a project pipeline.',
  'Project not found': 'This project could not be found — it may have been deleted.',
  'Unauthorized': "You don't have permission to move this project.",
};

export function friendlyStageError(message: string | undefined | null): string {
  if (!message) return 'Could not move the project to that stage.';
  return STAGE_ERROR_MESSAGES[message] ?? message;
}

export function useProjectLifecycle(projectId: string | null, active: boolean) {
  const { successToast, errorToast } = useToast();
  const [data, setData] = useState<ProjectLifecycle | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const { data: row, error } = await supabase
      .from('projects')
      .select('pipeline_id, current_stage_id, blocked, blocked_reason, flags, flag_note, stage:pipeline_stages!projects_current_stage_id_fkey(name, color)')
      .eq('id', projectId)
      .single();
    if (!error && row) {
      const stage = row.stage as unknown as { name: string; color: string | null } | null;
      setData({
        pipelineId: row.pipeline_id,
        currentStageId: row.current_stage_id,
        stageName: stage?.name ?? null,
        stageColor: stage?.color ?? null,
        blocked: row.blocked,
        blockedReason: row.blocked_reason,
        flags: (row.flags ?? []) as ProjectFlag[],
        flagNote: row.flag_note ?? null,
      });
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    if (active && projectId) refresh();
    else if (!active) setData(null);
  }, [active, projectId, refresh]);

  const advanceStage = useCallback(async (stageId: string): Promise<boolean> => {
    if (!projectId) return false;
    const { error } = await supabase.rpc('rpc_advance_project_stage', { p_project_id: projectId, p_to_stage_id: stageId });
    if (error) {
      errorToast(friendlyStageError(error.message), 'Could not move stage');
      return false;
    }
    successToast('Project stage updated.', 'Stage moved');
    await refresh();
    return true;
  }, [projectId, refresh, errorToast, successToast]);

  // ponytail: plain UPDATE, not an RPC -- flags are a bare set with no
  // transition rules or permission logic beyond the projects_update RLS
  // policy (owner or project.edit) that already gates every other project
  // edit. Nothing here would justify a stored procedure.
  //
  // blocked/blocked_reason are derived from flags in the same UPDATE (see
  // file header) so rpc_projects_table's badge/sort/filter -- which this
  // issue deliberately does not touch -- stay correct without a second
  // write path.
  const setFlags = useCallback(async (flags: ProjectFlag[], note: string | null): Promise<boolean> => {
    if (!projectId) return false;
    const flag_note = flags.length > 0 ? (note?.trim() || null) : null;
    const blocked = flags.includes('blocked');
    const blocked_reason = blocked ? flag_note : null;
    const { error } = await supabase.from('projects').update({ flags, flag_note, blocked, blocked_reason }).eq('id', projectId);
    if (error) {
      errorToast(error.message, 'Could not update flags');
      return false;
    }
    setData(prev => prev ? { ...prev, flags, flagNote: flag_note, blocked, blockedReason: blocked_reason } : prev);
    return true;
  }, [projectId, errorToast]);

  return { data, loading, refresh, advanceStage, setFlags };
}
