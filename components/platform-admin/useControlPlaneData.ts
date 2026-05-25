import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

// ── Constants ──────────────────────────────────────────────────────────────

export const PLATFORM_OWNERS = [
  'adamsamir2005@gmail.com',
  'adam.samir@trustedgellc.com',
  'adamsamir@hotmail.com',
];

// ── Types ──────────────────────────────────────────────────────────────────

export type Section = 'command' | 'tenants' | 'signals' | 'live' | 'users';

export type CompanyOverview = {
  id: string;
  name: string;
  created_at: string;
  user_count: number;
  task_count: number;
  session_minutes_week: number;
  active_sessions_now: number;
  last_active_at: string | null;
};

export type TimelineEntry = {
  day: string;
  tasks_created: number;
  session_minutes: number;
  active_users: number;
};

export type LiveSession = {
  session_id: string;
  user_name: string;
  user_email: string;
  company_name: string;
  task_title: string;
  started_at: string;
  last_heartbeat_at: string;
  duration_minutes: number;
};

export type CompanyDetail = {
  company: { id: string; name: string; created_at: string; join_code: string };
  members: Array<{
    id: string;
    name: string;
    email: string;
    job_title: string | null;
    department: string | null;
    session_minutes_week: number;
    is_active: boolean;
  }>;
  stats: {
    total_tasks: number;
    total_session_minutes: number;
    active_sessions: number;
  };
};

export type SortKey = 'usage' | 'users' | 'tasks' | 'age';
export type SignalMetric = 'tasks' | 'sessions' | 'users';

export type PlatformUser = {
  id: string;
  email: string;
  full_name: string | null;
  display_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  job_title: string | null;
  department: string | null;
  is_active: boolean;
  is_owner: boolean;
  work_status: string | null;
  company_id: string | null;
  company_name: string | null;
  created_at: string;
  last_seen_at: string | null;
};

// ── Helpers ────────────────────────────────────────────────────────────────

export function fmtMins(mins: number): string {
  if (!mins || mins <= 0) return '0m';
  if (mins < 60) return `${Math.round(mins)}m`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function fmtNumber(n: number): string {
  if (n === null || n === undefined || isNaN(n)) return '0';
  return n.toLocaleString();
}

export function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function fmtDay(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export function workspaceAge(dateStr: string): string {
  const days = Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / 86400000
  );
  if (days === 0) return 'Today';
  if (days === 1) return '1 day';
  if (days < 30) return `${days} days`;
  const months = Math.floor(days / 30);
  return `${months} month${months > 1 ? 's' : ''}`;
}

export function healthLabel(minsPerUser: number): {
  label: string;
  color: string;
  dimColor: string;
} {
  if (minsPerUser >= 120)
    return {
      label: 'Healthy',
      color: 'text-state-success',
      dimColor: 'bg-state-success/10',
    };
  if (minsPerUser >= 60)
    return {
      label: 'Moderate',
      color: 'text-state-warning',
      dimColor: 'bg-state-warning/10',
    };
  if (minsPerUser >= 10)
    return {
      label: 'Low',
      color: 'text-state-warning',
      dimColor: 'bg-state-warning/10',
    };
  if (minsPerUser > 0)
    return {
      label: 'Dormant',
      color: 'text-state-danger',
      dimColor: 'bg-state-danger/10',
    };
  return {
    label: 'Inactive',
    color: 'text-typography-dim',
    dimColor: 'bg-surface-border/30',
  };
}

// ── Hooks ──────────────────────────────────────────────────────────────────

export function useControlPlaneData() {
  const { user, initialized } = useAuth();
  const [section, setSection] = useState<Section>('command');
  const [companies, setCompanies] = useState<CompanyOverview[]>([]);
  const [liveCount, setLiveCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const isOwner =
    initialized && PLATFORM_OWNERS.includes(user?.email || '');

  const fetchCompanies = useCallback(async () => {
    const { data, error } = await supabase.rpc(
      'rpc_platform_companies_overview',
      { _dummy: null }
    );
    if (!error && data) {
      const list = data as CompanyOverview[];
      setCompanies(list);
      setLiveCount(list.reduce((s, c) => s + c.active_sessions_now, 0));
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    if (isOwner) {
      fetchCompanies();
    }
  }, [isOwner]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchCompanies();
  }, [fetchCompanies]);

  const totalUsers = companies.reduce((s, c) => s + c.user_count, 0);
  const totalTasks = companies.reduce((s, c) => s + c.task_count, 0);
  const totalMins = companies.reduce(
    (s, c) => s + c.session_minutes_week,
    0
  );

  return {
    // Auth state
    user,
    initialized,
    isOwner,
    // Section nav
    section,
    setSection,
    // Company data
    companies,
    liveCount,
    loading,
    refreshing,
    onRefresh,
    fetchCompanies,
    // Derived totals
    totalUsers,
    totalTasks,
    totalMins,
  };
}

export function useTimeline(initialDays = 30) {
  const [days, setDays] = useState(initialDays);
  const [metric, setMetric] = useState<SignalMetric>('sessions');
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [fetching, setFetching] = useState(false);

  const load = useCallback(async (d: number) => {
    setFetching(true);
    const { data, error } = await supabase.rpc(
      'rpc_platform_activity_timeline',
      { p_days: d }
    );
    if (!error && data) setTimeline(data as TimelineEntry[]);
    setFetching(false);
  }, []);

  useEffect(() => {
    load(days);
  }, [days]);

  const getValue = useCallback(
    (e: TimelineEntry) => {
      if (metric === 'tasks') return e.tasks_created;
      if (metric === 'sessions') return e.session_minutes;
      return e.active_users;
    },
    [metric]
  );

  const maxVal = Math.max(1, ...timeline.map(getValue));
  const totalVal = timeline.reduce((s, e) => s + getValue(e), 0);

  const metricLabel =
    metric === 'tasks'
      ? 'Tasks Created'
      : metric === 'sessions'
        ? 'Session Minutes'
        : 'Active Users';

  return {
    days,
    setDays,
    metric,
    setMetric,
    timeline,
    fetching,
    load,
    getValue,
    maxVal,
    totalVal,
    metricLabel,
  };
}

export function useLiveSessions() {
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState(new Date());
  const [secsAgo, setSecsAgo] = useState(0);

  const fetchSessions = useCallback(async () => {
    const { data, error } = await supabase.rpc(
      'rpc_platform_live_sessions',
      { _dummy: null }
    );
    if (!error && data) setSessions(data as LiveSession[]);
    setLastRefreshed(new Date());
    setSecsAgo(0);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchSessions();
    const poll = setInterval(fetchSessions, 30000);
    return () => clearInterval(poll);
  }, [fetchSessions]);

  useEffect(() => {
    const tick = setInterval(() => {
      setSecsAgo(
        Math.floor((Date.now() - lastRefreshed.getTime()) / 1000)
      );
    }, 1000);
    return () => clearInterval(tick);
  }, [lastRefreshed]);

  const companiesLive = [
    ...new Set(sessions.map((s) => s.company_name)),
  ].length;

  return {
    sessions,
    loading,
    lastRefreshed,
    secsAgo,
    companiesLive,
    fetchSessions,
  };
}

export async function deleteCompany(companyId: string) {
  return supabase.rpc('rpc_platform_delete_company', { p_company_id: companyId });
}

export function useCompanyDetail(companyId: string | null) {
  const [detail, setDetail] = useState<CompanyDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    setDetail(null);
    setLoading(true);
    supabase
      .rpc('rpc_platform_company_detail', { p_company_id: companyId })
      .then(({ data, error }) => {
        if (!error && data) setDetail(data as CompanyDetail);
        setLoading(false);
      });
  }, [companyId]);

  return { detail, loading };
}

export function useUsersData() {
  const [query, setQueryState] = useState('');
  const [companyFilter, setCompanyFilterState] = useState<string | null>(null);
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryRef = useRef('');
  const filterRef = useRef<string | null>(null);

  const fetchUsers = useCallback(async (q: string, cid: string | null) => {
    setLoading(true);
    const { data, error } = await supabase.rpc('rpc_platform_search_users', {
      p_query: q,
      p_company_id: cid,
      p_limit: 100,
    });
    if (!error && data) setUsers(data as PlatformUser[]);
    setLoading(false);
  }, []);

  const setQuery = useCallback((q: string) => {
    queryRef.current = q;
    setQueryState(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchUsers(q, filterRef.current), 350);
  }, [fetchUsers]);

  const setCompanyFilter = useCallback((cid: string | null) => {
    filterRef.current = cid;
    setCompanyFilterState(cid);
    fetchUsers(queryRef.current, cid);
  }, [fetchUsers]);

  const refetch = useCallback(() => {
    fetchUsers(queryRef.current, filterRef.current);
  }, [fetchUsers]);

  useEffect(() => {
    fetchUsers('', null);
  }, [fetchUsers]);

  return { query, setQuery, companyFilter, setCompanyFilter, users, loading, refetch };
}

export async function updateUser(userId: string, fields: {
  full_name: string;
  display_name: string;
  phone: string;
  job_title: string;
  department: string;
  work_status: string;
  is_active: boolean;
}) {
  return supabase.rpc('rpc_platform_update_user', {
    p_user_id: userId,
    p_full_name: fields.full_name,
    p_display_name: fields.display_name,
    p_phone: fields.phone,
    p_job_title: fields.job_title,
    p_department: fields.department,
    p_work_status: fields.work_status,
    p_is_active: fields.is_active,
  });
}

export async function moveUser(userId: string, companyId: string) {
  return supabase.rpc('rpc_platform_move_user', {
    p_user_id: userId,
    p_company_id: companyId,
  });
}

export async function deleteUser(userId: string) {
  return supabase.rpc('rpc_platform_delete_user', { p_user_id: userId });
}
