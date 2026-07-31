import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/contexts/ToastContext';

// #172 P2 -- reads/writes the fields the Phase 2 backend added to `projects`
// (current_stage_id, blocked, blocked_reason) that rpc_project_dashboard does
// not carry. Shared by ProjectDashboard.tsx and ProjectDashboardSheet.tsx so
// the fetch/mutate logic (and the RPC error-message mapping) exists once.

export type ProjectLifecycle = {
  pipelineId: string | null;
  currentStageId: string | null;
  stageName: string | null;
  stageColor: string | null;
  blocked: boolean;
  blockedReason: string | null;
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
      .select('pipeline_id, current_stage_id, blocked, blocked_reason, stage:pipeline_stages!projects_current_stage_id_fkey(name, color)')
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

  // ponytail: plain UPDATE, not an RPC — blocked/blocked_reason are a bare
  // flag with no transition rules or permission logic beyond the projects_update
  // RLS policy (owner or project.edit) that already gates every other project
  // edit. Nothing here would justify a stored procedure.
  const setBlocked = useCallback(async (blocked: boolean, reason: string | null): Promise<boolean> => {
    if (!projectId) return false;
    const blocked_reason = blocked ? (reason?.trim() || null) : null;
    const { error } = await supabase.from('projects').update({ blocked, blocked_reason }).eq('id', projectId);
    if (error) {
      errorToast(error.message, 'Could not update blocked status');
      return false;
    }
    setData(prev => prev ? { ...prev, blocked, blockedReason: blocked_reason } : prev);
    return true;
  }, [projectId, errorToast]);

  return { data, loading, refresh, advanceStage, setBlocked };
}
