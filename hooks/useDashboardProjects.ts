// The dashboard's ONE read of the projects table (Phase 10, #191).
//
// This exists purely so the two project-shaped panels on the dashboard —
// `BlockedExceptionsPanel` and `ProjectionStrip` — share a single round trip
// instead of each firing their own 500-row `rpc_projects_table` call on every
// load. It is a fetch, not a definition: no filtering, no derivation, no
// predicate of its own. `needs_attention`, `projected_end` and
// `projection_confidence` all arrive already decided by the server, and each
// panel reads the columns it cares about (§16.1 — one definition, many
// readers).
//
// `p_blocked` is deliberately left unset, exactly as BlockedExceptionsPanel
// called it before this hook existed. Passing it would work identically today
// (it calls the same `fn_project_needs_attention`) but would make the count and
// the list depend on two calls agreeing.

import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { useCallback, useEffect, useState } from 'react';

export type DashboardProjectsState = {
  rows: any[];
  state: 'loading' | 'ready' | 'error';
  reload: () => void;
  /** False when the viewer cannot see projects at all — panels render nothing. */
  canView: boolean;
};

export function useDashboardProjects(refreshKey = 0): DashboardProjectsState {
  const { hasPermission } = useAuth();
  const canView = hasPermission('project.view');

  const [rows, setRows] = useState<any[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(async () => {
    if (!canView) return;
    setState('loading');
    try {
      const { data, error } = await supabase.rpc('rpc_projects_table', { p_limit: 500 });
      if (error) throw error;
      setRows(data || []);
      setState('ready');
    } catch (err) {
      console.error('[useDashboardProjects] load error', err);
      setState('error');
    }
  }, [canView]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  return { rows, state, reload: load, canView };
}
