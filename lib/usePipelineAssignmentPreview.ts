import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type AssignmentPreview = {
  mode: 'manual' | 'round_robin' | 'smart';
  pool_type?: 'users' | 'teams';
  pool_size?: number;
  assignee_user_id?: string | null;
  assignee_team_id?: string | null;
  assignee_name?: string | null;
};

// Previews a pipeline's auto-assignment: the mode and who is next in line.
// Backed by rpc_preview_task_assignee, which shares fn_pick_assignee with the
// real assign engine, so the previewed name matches what creation will pick.
export function usePipelineAssignmentPreview(pipelineId: string | null | undefined) {
  const [preview, setPreview] = useState<AssignmentPreview | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!pipelineId) { setPreview(null); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase.rpc('rpc_preview_task_assignee', { p_pipeline_id: pipelineId });
      if (cancelled) return;
      if (error) { console.error('Assignment preview error:', error); setPreview(null); }
      else setPreview(data as AssignmentPreview);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [pipelineId]);

  return { preview, loading };
}
