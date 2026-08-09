import { useCallback, useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';
import type { ProjectionConfidence } from '@/components/charts/projection';

/**
 * The portfolio screen's data (Phase 10, #191).
 *
 * Every number here comes from rpc_portfolios_table, which rolls up ONLY the
 * projects the caller can access (fn_project_accessible) — see that migration
 * for why counting straight off `projects` would hand every member a census of
 * work they cannot open. Nothing in this file recomputes a rollup, and nothing
 * derives a projected date: `projectedEnd` and `confidence` come from the same
 * server-side definition every other Phase 10 surface reads, so two screens
 * cannot show different finish dates for the same batch (§16.1).
 *
 * Extracted from the grid component per ui-style-guide.md §4 — shared business
 * logic lives outside the UI so the presentation can change (or diverge per
 * platform) without the fetching following it around.
 */
export type PortfolioRow = {
  id: string;
  name: string;
  source: string | null;
  received_at: string | null;
  target_date: string | null;
  created_at: string;
  template_id: string | null;
  template_name: string | null;
  projects_total: number;
  projects_done: number;
  projects_blocked: number;
  tasks_total: number;
  tasks_done: number;
  next_due: string | null;
  projected_end: string | null;
  confidence: ProjectionConfidence;
};

export function usePortfolios(search: string = '') {
  const [rows, setRows] = useState<PortfolioRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase.rpc('rpc_portfolios_table', {
      p_search: search.trim() || null,
      p_limit: 100,
      p_offset: 0,
    });
    if (e) {
      // An empty list, a denied read and a broken connection are three
      // different things and must not look the same — "no portfolios yet"
      // invites you to make one, which is bad advice if the truth is that you
      // are not allowed to see the ones that exist. rpc_portfolios_table
      // raises "Insufficient permissions to view portfolios." for that case;
      // everything else is a failure the user can retry.
      const isDenied = /insufficient permissions/i.test(e.message || '');
      setDenied(isDenied);
      setError(
        isDenied
          ? 'You don’t have access to portfolios. Ask an admin if you should.'
          : 'Could not load portfolios. Check your connection and try again.',
      );
      setRows([]);
    } else {
      setDenied(false);
      setRows((data ?? []) as PortfolioRow[]);
    }
    setLoading(false);
  }, [search]);

  useEffect(() => {
    // Debounced so typing in the search box does not fire a query per keystroke.
    const t = setTimeout(fetchAll, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [fetchAll, search]);

  return { rows, loading, error, denied, refresh: fetchAll };
}
