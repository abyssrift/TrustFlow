import { useCallback, useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

/**
 * One portfolio's projects (issue #260) — the list behind the open-portfolio
 * Multi-View Modal.
 *
 * Mirrors the rpc_projects_table contract (issue #173, Phase 3) scoped with
 * `p_portfolio_id`, the SAME reader /projects uses (ProjectsTable, the board,
 * the timeline) — so the modal can never disagree with the projects screen
 * about what belongs to a batch. The RPC already gates every row through
 * fn_project_accessible, and `p_search` is passed through (debounced by the
 * caller) rather than filtering a fetched page client-side, which would
 * silently shrink the result set.
 *
 * Extracted from PortfolioViewModal per ui-style-guide.md §4 — shared data
 * fetching lives outside the UI so the presentation can change without the
 * fetching following it around.
 */
export type PortfolioProjectRow = {
  id: string;
  name: string;
  color: string | null;
  client_id: string | null;
  client_name: string | null;
  portfolio_id: string | null;
  portfolio_name: string | null;
  current_stage_id: string | null;
  stage_name: string | null;
  stage_color: string | null;
  days_in_current_stage: number | null;
  due_date: string | null;
  days_remaining: number | null;
  tasks_total: number;
  tasks_done: number;
  weighted_progress: number;
  owner_id: string | null;
  owner_name: string | null;
  owner_avatar_url: string | null;
  blocked: boolean;
  blocked_reason: string | null;
  tracked_seconds: number;
  estimated_hours: number | null;
  updated_at: string;
};

export function usePortfolioProjects(portfolioId: string | null, search: string = '') {
  const [rows, setRows] = useState<PortfolioProjectRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rpcMissing, setRpcMissing] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!portfolioId) {
      setRows([]);
      setError(null);
      setRpcMissing(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase.rpc('rpc_projects_table', {
      p_search: search.trim() || null,
      p_limit: 500,
      p_offset: 0,
      p_portfolio_id: portfolioId,
    });
    if (e) {
      // Same two-way failure split as ProjectsTable — "backend not deployed"
      // (PGRST202 / function missing) is a distinct, explainable condition
      // from a plain failure, so the modal's status banner can say which.
      setRpcMissing(e.code === 'PGRST202' || /could not find the function|does not exist/i.test(e.message || ''));
      setError(e.message);
      setRows([]);
    } else {
      setRpcMissing(false);
      setRows((data ?? []) as PortfolioProjectRow[]);
    }
    setLoading(false);
  }, [portfolioId, search]);

  useEffect(() => {
    // Debounced so typing in the modal's search box does not fire a query per keystroke.
    const t = setTimeout(fetchAll, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [fetchAll, search]);

  return { rows, loading, error, rpcMissing, refresh: fetchAll };
}
