import { supabase } from '@/lib/supabase';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

// #184 -- data provider for the /projects/[id] route, mirroring
// TaskDetailContext.tsx's shape (provider-per-detail-route, taskId ->
// projectId, ACCESS_DENIED sentinel) so the two detail routes stay
// consistent rather than inventing a second convention.
//
// One real difference from TaskDetailContext: #186 settled that project
// denial and non-existence must be indistinguishable (a distinguishable
// "denied" discloses the engagement exists -- see plan §13.14). So this
// context exposes a single `notFound` boolean, not an error string a screen
// could render verbatim. rpc_project_dashboard already folds both cases into
// the same `RAISE EXCEPTION 'Project not found.'` -- any RPC error here is
// treated as not-found, never surfaced as a distinct "access denied" message.

// ── Types mirror rpc_project_dashboard (see ProjectDashboard.tsx history) ──
export type ProjectTotals = {
  total: number; completed: number; overdue: number; active: number;
  completion_rate: number; total_weight: number; completed_weight: number;
  est_hours: number; tracked_seconds: number;
};
export type ProjectStageRow = { stage_id: string; name: string; color: string | null; position: number; is_terminal: boolean; terminal_type: string | null; count: number };
export type ProjectPriorityRow = { priority: string; count: number };
export type ProjectCategoryRow = { category: string; count: number };
export type ProjectContributorRow = { user_id: string; full_name: string | null; avatar_url: string | null; tracked_seconds: number; tasks: number };
export type ProjectRecentRow = { id: string; title: string; priority: string; stage_name: string | null; stage_color: string | null; due_date: string | null; created_at: string; is_complete: boolean };
export type ProjectDueRow = { id: string; title: string; due_date: string; stage_name: string | null; overdue: boolean };

export type ProjectDashboardData = {
  project: { id: string; name: string; description: string | null; status: string; expiry_date: string | null; is_featured: boolean; created_at: string };
  totals: ProjectTotals;
  by_priority: ProjectPriorityRow[];
  by_stage: ProjectStageRow[];
  by_category: ProjectCategoryRow[];
  contributors: ProjectContributorRow[];
  recent_tasks: ProjectRecentRow[];
  due_soon: ProjectDueRow[];
};

type ProjectDetailContextType = {
  projectId: string;
  data: ProjectDashboardData | null;
  loading: boolean;
  notFound: boolean;
  refresh: () => Promise<void>;
};

const ProjectDetailContext = createContext<ProjectDetailContextType | null>(null);

export const useProjectDetail = () => {
  const context = useContext(ProjectDetailContext);
  if (!context) throw new Error('useProjectDetail must be used within a ProjectDetailProvider');
  return context;
};

export const ProjectDetailProvider = ({ projectId, children }: { projectId: string; children: React.ReactNode }) => {
  const [data, setData] = useState<ProjectDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const fetchDetails = useCallback(async () => {
    setLoading(true);
    const { data: res, error } = await supabase.rpc('rpc_project_dashboard', { p_project_id: projectId });
    if (error || !res) {
      // Denied and non-existent both land here, on purpose -- see file header.
      setNotFound(true);
      setData(null);
    } else {
      setNotFound(false);
      setData(res as ProjectDashboardData);
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

  return (
    <ProjectDetailContext.Provider value={{ projectId, data, loading, notFound, refresh: fetchDetails }}>
      {children}
    </ProjectDetailContext.Provider>
  );
};
