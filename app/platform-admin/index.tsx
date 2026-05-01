import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  SafeAreaView, RefreshControl, Platform, StatusBar, Modal,
} from 'react-native';
import { Stack } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

const PLATFORM_OWNERS = [
  'adamsamir2005@gmail.com',
  'adam.samir@trustedgellc.com',
  'adamsamir@hotmail.com'
];
type Section = 'command' | 'tenants' | 'signals' | 'live';

// ── Types ──────────────────────────────────────────────────────────────────

type CompanyOverview = {
  id: string;
  name: string;
  created_at: string;
  user_count: number;
  task_count: number;
  session_minutes_week: number;
  active_sessions_now: number;
  last_active_at: string | null;
};

type TimelineEntry = {
  day: string;
  tasks_created: number;
  session_minutes: number;
  active_users: number;
};

type LiveSession = {
  session_id: string;
  user_name: string;
  user_email: string;
  company_name: string;
  task_title: string;
  started_at: string;
  last_heartbeat_at: string;
  duration_minutes: number;
};

type CompanyDetail = {
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

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtMins(mins: number): string {
  if (!mins || mins <= 0) return '0m';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function timeAgo(dateStr: string | null | undefined): string {
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

function fmtDay(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function workspaceAge(dateStr: string): string {
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return '1 day';
  if (days < 30) return `${days} days`;
  const months = Math.floor(days / 30);
  return `${months} month${months > 1 ? 's' : ''}`;
}

function healthLabel(minsPerUser: number): { label: string; color: string; dimColor: string } {
  if (minsPerUser >= 120) return { label: 'Healthy',   color: 'text-state-success', dimColor: 'bg-state-success-dim' };
  if (minsPerUser >= 60)  return { label: 'Moderate',  color: 'text-state-warning', dimColor: 'bg-state-warning-dim' };
  if (minsPerUser >= 10)  return { label: 'Low',       color: 'text-state-warning', dimColor: 'bg-state-warning-dim' };
  if (minsPerUser > 0)    return { label: 'Dormant',   color: 'text-state-danger',  dimColor: 'bg-state-danger-dim' };
  return                         { label: 'Inactive',  color: 'text-typography-dim', dimColor: 'bg-surface-border' };
}

// ── Reusable UI ────────────────────────────────────────────────────────────

const Divider = () => <View className="h-px bg-surface-border mx-4" />;

const StatTile = ({
  label, value, sub, icon, accent = false,
}: {
  label: string; value: string | number; sub?: string; icon: string; accent?: boolean;
}) => (
  <View className={`flex-1 rounded-2xl p-4 border ${accent ? 'bg-brand-primary-dim border-brand-primary/20' : 'bg-surface-card border-surface-border'}`}>
    <View className="flex-row items-center justify-between mb-3">
      <Text className={`text-[10px] font-black uppercase tracking-widest ${accent ? 'text-brand-primary' : 'text-typography-muted'}`}>{label}</Text>
      <FontAwesome name={icon as any} size={12} color={accent ? 'rgb(var(--brand-primary))' : 'rgb(var(--text-muted))'} />
    </View>
    <Text className={`text-2xl font-black tracking-tight ${accent ? 'text-brand-primary' : 'text-typography-main'}`}>{value}</Text>
    {sub && <Text className="text-typography-dim text-[10px] mt-1">{sub}</Text>}
  </View>
);

const HBar = ({ value, max, tint = 'primary' }: { value: number; max: number; tint?: 'primary' | 'success' | 'warning' }) => {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 2;
  const colorClass = tint === 'success' ? 'bg-state-success' : tint === 'warning' ? 'bg-state-warning' : 'bg-brand-primary';
  return (
    <View className="flex-1 h-1.5 bg-surface-border rounded-full overflow-hidden">
      <View className={`h-full rounded-full ${colorClass}`} style={{ width: `${pct}%` }} />
    </View>
  );
};

const SectionPill = ({
  label, active, onPress, dot,
}: { label: string; active: boolean; onPress: () => void; dot?: boolean }) => (
  <TouchableOpacity
    onPress={onPress}
    className={`px-4 py-2 rounded-xl mr-2 flex-row items-center ${active ? 'bg-brand-primary' : 'bg-surface-card border border-surface-border'}`}
  >
    {dot && (
      <View className={`w-1.5 h-1.5 rounded-full mr-1.5 ${active ? 'bg-white' : 'bg-state-success'}`} />
    )}
    <Text className={`text-xs font-black uppercase tracking-widest ${active ? 'text-white' : 'text-typography-muted'}`}>{label}</Text>
  </TouchableOpacity>
);

// ── Company Detail Modal ───────────────────────────────────────────────────

const CompanyDetailModal = ({
  companyId, onClose,
}: { companyId: string | null; onClose: () => void }) => {
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

  if (!companyId) return null;

  const maxMins = detail?.members
    ? Math.max(1, ...detail.members.map(m => m.session_minutes_week))
    : 1;

  return (
    <Modal visible={!!companyId} animationType="slide" transparent>
      <View className="flex-1 justify-end bg-black/50">
        <View className="bg-surface-background rounded-t-3xl" style={{ maxHeight: '85%' }}>
          {/* Handle */}
          <View className="items-center pt-3 pb-2">
            <View className="w-10 h-1 bg-surface-border rounded-full" />
          </View>

          {loading || !detail ? (
            <View className="items-center justify-center py-20">
              <ActivityIndicator size="large" color="rgb(var(--brand-primary))" />
              <Text className="text-typography-muted mt-4 text-sm font-bold">Loading...</Text>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Header */}
              <View className="px-6 pb-4 flex-row items-start justify-between">
                <View className="flex-1 mr-4">
                  <Text className="text-typography-main font-black text-xl">{detail.company.name}</Text>
                  <Text className="text-typography-muted text-xs mt-1">
                    Workspace · {workspaceAge(detail.company.created_at)} old
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={onClose}
                  className="bg-surface-card border border-surface-border rounded-full w-9 h-9 items-center justify-center"
                >
                  <FontAwesome name="times" size={14} color="rgb(var(--text-muted))" />
                </TouchableOpacity>
              </View>

              <Divider />

              {/* Stats row */}
              <View className="flex-row gap-3 px-6 py-4">
                <View className="flex-1 bg-surface-card rounded-2xl p-3 border border-surface-border items-center">
                  <Text className="text-typography-main font-black text-lg">{detail.stats.total_tasks}</Text>
                  <Text className="text-typography-muted text-[10px] mt-0.5 uppercase tracking-wide">Tasks</Text>
                </View>
                <View className="flex-1 bg-surface-card rounded-2xl p-3 border border-surface-border items-center">
                  <Text className="text-typography-main font-black text-lg">{fmtMins(detail.stats.total_session_minutes)}</Text>
                  <Text className="text-typography-muted text-[10px] mt-0.5 uppercase tracking-wide">All Time</Text>
                </View>
                <View className={`flex-1 rounded-2xl p-3 border items-center ${detail.stats.active_sessions > 0 ? 'bg-state-success-dim border-state-success/20' : 'bg-surface-card border-surface-border'}`}>
                  <Text className={`font-black text-lg ${detail.stats.active_sessions > 0 ? 'text-state-success' : 'text-typography-main'}`}>{detail.stats.active_sessions}</Text>
                  <Text className={`text-[10px] mt-0.5 uppercase tracking-wide ${detail.stats.active_sessions > 0 ? 'text-state-success' : 'text-typography-muted'}`}>Live</Text>
                </View>
              </View>

              <Divider />

              {/* Join code */}
              <View className="flex-row items-center px-6 py-4 gap-3">
                <FontAwesome name="key" size={12} color="rgb(var(--text-muted))" />
                <Text className="text-typography-muted text-xs">Join code</Text>
                <Text className="text-typography-main font-black text-xs tracking-widest ml-1">{detail.company.join_code}</Text>
              </View>

              <Divider />

              {/* Members */}
              <View className="px-6 pt-4 pb-2">
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-3">
                  Members · {detail.members?.length ?? 0}
                </Text>
                {detail.members?.length === 0 && (
                  <Text className="text-typography-dim text-sm text-center py-4">No members yet</Text>
                )}
                {detail.members?.map(m => (
                  <View key={m.id} className="mb-4">
                    <View className="flex-row items-center justify-between mb-1.5">
                      <View className="flex-row items-center gap-2 flex-1 mr-3">
                        {m.is_active && (
                          <View className="w-1.5 h-1.5 rounded-full bg-state-success" />
                        )}
                        <Text className="text-typography-main font-bold text-sm" numberOfLines={1}>{m.name}</Text>
                      </View>
                      <Text className="text-typography-muted text-xs">{fmtMins(m.session_minutes_week)}</Text>
                    </View>
                    {m.job_title && (
                      <Text className="text-typography-dim text-[10px] mb-1.5 ml-3.5">{m.job_title}{m.department ? ` · ${m.department}` : ''}</Text>
                    )}
                    <HBar value={m.session_minutes_week} max={maxMins} />
                  </View>
                ))}
              </View>

              <View className="h-8" />
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
};

// ── Section: Command ───────────────────────────────────────────────────────

const CommandSection = ({
  companies, liveCount, loading, onRefresh, refreshing,
}: {
  companies: CompanyOverview[];
  liveCount: number;
  loading: boolean;
  onRefresh: () => void;
  refreshing: boolean;
}) => {
  const totalUsers = companies.reduce((s, c) => s + c.user_count, 0);
  const totalTasks = companies.reduce((s, c) => s + c.task_count, 0);
  const totalMins  = companies.reduce((s, c) => s + c.session_minutes_week, 0);
  const maxMins    = Math.max(1, ...companies.map(c => c.session_minutes_week));
  const top5       = [...companies].slice(0, 5);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color="rgb(var(--brand-primary))" />
        <Text className="text-typography-muted mt-4 font-bold text-sm">Fetching platform data...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Stat tiles */}
      <View className="flex-row gap-3 px-4 pt-4 pb-3">
        <StatTile label="Tenants" value={companies.length} icon="building" sub="companies on platform" />
        <StatTile label="Users" value={totalUsers} icon="users" sub="across all workspaces" />
      </View>
      <View className="flex-row gap-3 px-4 pb-4">
        <StatTile label="Active Now" value={liveCount} icon="circle" accent={liveCount > 0} sub={liveCount > 0 ? 'sessions running' : 'no active sessions'} />
        <StatTile label="Usage / Week" value={fmtMins(totalMins)} icon="clock-o" sub={`${totalTasks} total tasks`} />
      </View>

      <Divider />

      {/* System pulse */}
      <View className="px-4 pt-5 pb-2">
        <View className="flex-row items-center justify-between mb-4">
          <Text className="text-typography-main font-black text-base">System Pulse</Text>
          <Text className="text-typography-muted text-[10px] uppercase tracking-widest">7-day usage</Text>
        </View>

        {companies.length === 0 && (
          <Text className="text-typography-dim text-sm text-center py-8">No tenants yet</Text>
        )}

        {top5.map((co, i) => {
          const health = healthLabel(co.user_count > 0 ? co.session_minutes_week / co.user_count : 0);
          return (
            <View key={co.id} className="mb-4">
              <View className="flex-row items-center justify-between mb-1.5">
                <View className="flex-row items-center gap-2 flex-1 mr-2">
                  <Text className="text-typography-dim text-[10px] w-4">{i + 1}</Text>
                  <Text className="text-typography-main font-bold text-sm flex-1" numberOfLines={1}>{co.name}</Text>
                  {co.active_sessions_now > 0 && (
                    <View className="flex-row items-center bg-state-success-dim px-1.5 py-0.5 rounded-full">
                      <View className="w-1 h-1 bg-state-success rounded-full mr-1" />
                      <Text className="text-state-success text-[9px] font-black">LIVE</Text>
                    </View>
                  )}
                </View>
                <Text className="text-typography-muted text-xs font-bold">{fmtMins(co.session_minutes_week)}</Text>
              </View>
              <View className="flex-row items-center gap-2">
                <Text className="text-typography-dim text-[10px] w-4" />
                <HBar value={co.session_minutes_week} max={maxMins} />
              </View>
            </View>
          );
        })}

        {companies.length > 5 && (
          <Text className="text-typography-dim text-xs text-center mt-2">
            +{companies.length - 5} more tenants — view in Tenants tab
          </Text>
        )}
      </View>

      <Divider />

      {/* Quick stats grid */}
      <View className="px-4 pt-5 pb-6">
        <Text className="text-typography-main font-black text-base mb-4">Platform Snapshot</Text>
        <View className="bg-surface-card rounded-2xl border border-surface-border overflow-hidden">
          {[
            { label: 'Most active tenant', value: companies[0]?.name ?? '—', icon: 'trophy' },
            { label: 'Avg users / workspace', value: companies.length > 0 ? Math.round(totalUsers / companies.length).toString() : '—', icon: 'users' },
            { label: 'Avg usage / workspace', value: companies.length > 0 ? fmtMins(Math.round(totalMins / companies.length)) : '—', icon: 'clock-o' },
            { label: 'Total platform usage', value: fmtMins(totalMins), icon: 'bar-chart' },
          ].map((row, idx, arr) => (
            <View key={row.label}>
              <View className="flex-row items-center justify-between px-4 py-3.5">
                <View className="flex-row items-center gap-3">
                  <FontAwesome name={row.icon as any} size={12} color="rgb(var(--text-muted))" />
                  <Text className="text-typography-muted text-sm">{row.label}</Text>
                </View>
                <Text className="text-typography-main font-black text-sm">{row.value}</Text>
              </View>
              {idx < arr.length - 1 && <Divider />}
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
};

// ── Section: Tenants ───────────────────────────────────────────────────────

type SortKey = 'usage' | 'users' | 'tasks' | 'age';

const TenantsSection = ({
  companies, loading, onRefresh, refreshing,
}: {
  companies: CompanyOverview[];
  loading: boolean;
  onRefresh: () => void;
  refreshing: boolean;
}) => {
  const [sort, setSort] = useState<SortKey>('usage');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const sorted = [...companies].sort((a, b) => {
    if (sort === 'usage')  return b.session_minutes_week - a.session_minutes_week;
    if (sort === 'users')  return b.user_count - a.user_count;
    if (sort === 'tasks')  return b.task_count - a.task_count;
    if (sort === 'age')    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    return 0;
  });

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color="rgb(var(--brand-primary))" />
      </View>
    );
  }

  return (
    <>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Sort bar */}
        <View className="px-4 pt-4 pb-3">
          <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-3">Sort by</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {(['usage', 'users', 'tasks', 'age'] as SortKey[]).map(k => (
              <TouchableOpacity
                key={k}
                onPress={() => setSort(k)}
                className={`px-3 py-1.5 rounded-lg mr-2 border ${sort === k ? 'bg-brand-primary border-brand-primary' : 'bg-surface-card border-surface-border'}`}
              >
                <Text className={`text-xs font-bold capitalize ${sort === k ? 'text-white' : 'text-typography-muted'}`}>{k}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {companies.length === 0 && (
          <View className="items-center py-20">
            <FontAwesome name="building-o" size={40} color="rgb(var(--text-dim))" />
            <Text className="text-typography-dim mt-4 text-sm">No tenants registered yet</Text>
          </View>
        )}

        <View className="px-4 pb-6">
          {sorted.map(co => {
            const minsPerUser = co.user_count > 0 ? co.session_minutes_week / co.user_count : 0;
            const health = healthLabel(minsPerUser);
            return (
              <TouchableOpacity
                key={co.id}
                onPress={() => setSelectedId(co.id)}
                className="bg-surface-card rounded-2xl p-4 mb-3 border border-surface-border active:opacity-80"
              >
                {/* Name row */}
                <View className="flex-row items-center justify-between mb-3">
                  <Text className="text-typography-main font-black text-base flex-1 mr-3" numberOfLines={1}>{co.name}</Text>
                  <View className="flex-row items-center gap-2">
                    {co.active_sessions_now > 0 && (
                      <View className="flex-row items-center bg-state-success-dim px-2 py-0.5 rounded-full">
                        <View className="w-1.5 h-1.5 bg-state-success rounded-full mr-1" />
                        <Text className="text-state-success text-[9px] font-black">{co.active_sessions_now} LIVE</Text>
                      </View>
                    )}
                    <View className={`px-2 py-0.5 rounded-full ${health.dimColor}`}>
                      <Text className={`text-[9px] font-black uppercase ${health.color}`}>{health.label}</Text>
                    </View>
                  </View>
                </View>

                {/* Metrics row */}
                <View className="flex-row gap-4 mb-3">
                  {[
                    { icon: 'users', value: co.user_count, label: 'users' },
                    { icon: 'tasks', value: co.task_count, label: 'tasks' },
                    { icon: 'clock-o', value: fmtMins(co.session_minutes_week), label: 'this week' },
                  ].map(m => (
                    <View key={m.label} className="flex-row items-center gap-1.5">
                      <FontAwesome name={m.icon as any} size={10} color="rgb(var(--text-muted))" />
                      <Text className="text-typography-main font-black text-xs">{m.value}</Text>
                      <Text className="text-typography-dim text-[10px]">{m.label}</Text>
                    </View>
                  ))}
                </View>

                {/* Footer row */}
                <View className="flex-row items-center justify-between">
                  <Text className="text-typography-dim text-[10px]">
                    Last active {timeAgo(co.last_active_at)}
                  </Text>
                  <View className="flex-row items-center gap-1">
                    <Text className="text-typography-dim text-[10px]">{workspaceAge(co.created_at)} old</Text>
                    <FontAwesome name="chevron-right" size={8} color="rgb(var(--text-dim))" />
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      <CompanyDetailModal companyId={selectedId} onClose={() => setSelectedId(null)} />
    </>
  );
};

// ── Section: Signals ───────────────────────────────────────────────────────

type SignalMetric = 'tasks' | 'sessions' | 'users';

const SignalsSection = ({
  loading, onRefresh, refreshing,
}: { loading: boolean; onRefresh: () => void; refreshing: boolean }) => {
  const [days, setDays] = useState(30);
  const [metric, setMetric] = useState<SignalMetric>('sessions');
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [fetching, setFetching] = useState(false);

  const load = useCallback(async (d: number) => {
    setFetching(true);
    const { data, error } = await supabase.rpc('rpc_platform_activity_timeline', { p_days: d });
    if (!error && data) setTimeline(data as TimelineEntry[]);
    setFetching(false);
  }, []);

  useEffect(() => { load(days); }, [days]);

  const getValue = (e: TimelineEntry) => {
    if (metric === 'tasks')    return e.tasks_created;
    if (metric === 'sessions') return e.session_minutes;
    return e.active_users;
  };

  const maxVal   = Math.max(1, ...timeline.map(getValue));
  const totalVal = timeline.reduce((s, e) => s + getValue(e), 0);

  const metricLabel = metric === 'tasks' ? 'Tasks Created' : metric === 'sessions' ? 'Session Minutes' : 'Active Users';

  if (loading && timeline.length === 0) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color="rgb(var(--brand-primary))" />
      </View>
    );
  }

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { onRefresh(); load(days); }} />}
    >
      {/* Controls */}
      <View className="px-4 pt-4 pb-3 gap-3">
        {/* Days picker */}
        <View className="flex-row items-center gap-2">
          <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mr-1">Range</Text>
          {[7, 14, 30].map(d => (
            <TouchableOpacity
              key={d}
              onPress={() => setDays(d)}
              className={`px-3 py-1.5 rounded-lg border ${days === d ? 'bg-brand-primary border-brand-primary' : 'bg-surface-card border-surface-border'}`}
            >
              <Text className={`text-xs font-bold ${days === d ? 'text-white' : 'text-typography-muted'}`}>{d}d</Text>
            </TouchableOpacity>
          ))}
        </View>
        {/* Metric picker */}
        <View className="flex-row items-center gap-2">
          <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mr-1">Show</Text>
          {(['sessions', 'tasks', 'users'] as SignalMetric[]).map(m => (
            <TouchableOpacity
              key={m}
              onPress={() => setMetric(m)}
              className={`px-3 py-1.5 rounded-lg border ${metric === m ? 'bg-brand-primary border-brand-primary' : 'bg-surface-card border-surface-border'}`}
            >
              <Text className={`text-xs font-bold capitalize ${metric === m ? 'text-white' : 'text-typography-muted'}`}>
                {m === 'sessions' ? 'Usage' : m === 'tasks' ? 'Tasks' : 'Users'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <Divider />

      {/* Summary */}
      <View className="flex-row items-center justify-between px-4 py-4">
        <View>
          <Text className="text-typography-main font-black text-xl">
            {metric === 'sessions' ? fmtMins(totalVal) : totalVal.toLocaleString()}
          </Text>
          <Text className="text-typography-muted text-xs mt-0.5">{metricLabel} · last {days} days</Text>
        </View>
        {fetching && <ActivityIndicator size="small" color="rgb(var(--brand-primary))" />}
      </View>

      <Divider />

      {/* Chart */}
      <View className="px-4 pt-4 pb-8">
        {timeline.length === 0 ? (
          <Text className="text-typography-dim text-sm text-center py-8">No data for this range</Text>
        ) : (
          timeline.slice().reverse().map(entry => {
            const val = getValue(entry);
            const displayVal = metric === 'sessions' ? fmtMins(val) : val.toString();
            return (
              <View key={entry.day} className="flex-row items-center gap-3 mb-2">
                <Text className="text-typography-dim text-[10px] w-14 shrink-0">{fmtDay(entry.day)}</Text>
                <HBar value={val} max={maxVal} />
                <Text className="text-typography-muted text-[10px] w-10 text-right shrink-0">{displayVal}</Text>
              </View>
            );
          })
        )}
      </View>
    </ScrollView>
  );
};

// ── Section: Live ──────────────────────────────────────────────────────────

const LiveSection = ({ companies }: { companies: CompanyOverview[] }) => {
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState(new Date());
  const [secsAgo, setSecsAgo] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSessions = useCallback(async () => {
    const { data, error } = await supabase.rpc('rpc_platform_live_sessions');
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
      setSecsAgo(Math.floor((Date.now() - lastRefreshed.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(tick);
  }, [lastRefreshed]);

  const companiesLive = [...new Set(sessions.map(s => s.company_name))].length;

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color="rgb(var(--brand-primary))" />
        <Text className="text-typography-muted mt-4 font-bold text-sm">Connecting...</Text>
      </View>
    );
  }

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      {/* Status bar */}
      <View className="flex-row items-center justify-between px-4 pt-4 pb-3">
        <View className="flex-row items-center gap-2">
          <View className={`w-2 h-2 rounded-full ${sessions.length > 0 ? 'bg-state-success' : 'bg-typography-dim'}`} />
          <Text className="text-typography-main font-black text-sm">
            {sessions.length > 0 ? `${sessions.length} active · ${companiesLive} workspace${companiesLive !== 1 ? 's' : ''}` : 'No active sessions'}
          </Text>
        </View>
        <TouchableOpacity onPress={fetchSessions} className="flex-row items-center gap-1.5">
          <FontAwesome name="refresh" size={10} color="rgb(var(--text-muted))" />
          <Text className="text-typography-dim text-[10px]">{secsAgo}s ago</Text>
        </TouchableOpacity>
      </View>

      <Divider />

      {sessions.length === 0 ? (
        <View className="items-center py-20">
          <View className="w-16 h-16 bg-surface-card rounded-full border border-surface-border items-center justify-center mb-4">
            <FontAwesome name="moon-o" size={24} color="rgb(var(--text-dim))" />
          </View>
          <Text className="text-typography-main font-black text-base">All quiet</Text>
          <Text className="text-typography-muted text-sm mt-1">No one is working right now</Text>
          <Text className="text-typography-dim text-xs mt-4">Auto-refreshes every 30s</Text>
        </View>
      ) : (
        <View className="px-4 pt-4 pb-6">
          {sessions.map(s => (
            <View key={s.session_id} className="bg-surface-card rounded-2xl p-4 mb-3 border border-surface-border">
              <View className="flex-row items-center justify-between mb-2">
                <View className="flex-row items-center gap-2 flex-1 mr-3">
                  <View className="w-1.5 h-1.5 bg-state-success rounded-full" />
                  <Text className="text-typography-main font-black text-sm" numberOfLines={1}>{s.user_name}</Text>
                </View>
                <View className="bg-state-success-dim px-2 py-0.5 rounded-full">
                  <Text className="text-state-success text-[10px] font-black">{s.duration_minutes}m</Text>
                </View>
              </View>
              <Text className="text-brand-primary text-xs font-bold mb-1" numberOfLines={1}>
                {s.task_title ?? 'Unknown task'}
              </Text>
              <View className="flex-row items-center justify-between mt-1">
                <View className="flex-row items-center gap-1.5">
                  <FontAwesome name="building-o" size={9} color="rgb(var(--text-dim))" />
                  <Text className="text-typography-dim text-[10px]">{s.company_name ?? 'Unknown workspace'}</Text>
                </View>
                <Text className="text-typography-dim text-[10px]">Started {timeAgo(s.started_at)}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
};

// ── Root screen ────────────────────────────────────────────────────────────

export default function PlatformAdminScreen() {
  const { user, initialized } = useAuth();
  const [section, setSection] = useState<Section>('command');
  const [companies, setCompanies] = useState<CompanyOverview[]>([]);
  const [liveCount, setLiveCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchCompanies = useCallback(async () => {
    const { data, error } = await supabase.rpc('rpc_platform_companies_overview');
    if (!error && data) {
      const list = data as CompanyOverview[];
      setCompanies(list);
      setLiveCount(list.reduce((s, c) => s + c.active_sessions_now, 0));
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    if (initialized && PLATFORM_OWNERS.includes(user?.email || '')) {
      fetchCompanies();
    }
  }, [initialized, user?.email]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchCompanies();
  };

  // ── Guards ──────────────────────────────────────────────────────────────
  if (!initialized) {
    return (
      <View className="flex-1 bg-surface-background items-center justify-center">
        <ActivityIndicator size="large" color="rgb(var(--brand-primary))" />
      </View>
    );
  }

  if (!PLATFORM_OWNERS.includes(user?.email || '')) {
    return (
      <View className="flex-1 bg-surface-background items-center justify-center">
        <Text className="text-typography-dim text-sm">404</Text>
      </View>
    );
  }

  return (
    <SafeAreaView
      className="flex-1 bg-surface-background"
      style={{ paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 }}
    >
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View className="bg-surface-card border-b border-surface-border px-4 pt-4 pb-3">
        <View className="flex-row items-center justify-between mb-4">
          <View>
            <View className="flex-row items-center gap-2 mb-0.5">
              <FontAwesome name="shield" size={11} color="rgb(var(--brand-primary))" />
              <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest">TrustFlow</Text>
            </View>
            <Text className="text-typography-main font-black text-xl tracking-tight">Control Plane</Text>
          </View>
          <View className="items-end">
            <View className="flex-row items-center gap-1.5 bg-surface-background border border-surface-border rounded-xl px-3 py-1.5">
              <View className={`w-1.5 h-1.5 rounded-full ${liveCount > 0 ? 'bg-state-success' : 'bg-typography-dim'}`} />
              <Text className="text-typography-muted text-[10px] font-bold">
                {liveCount > 0 ? `${liveCount} live` : 'All quiet'}
              </Text>
            </View>
          </View>
        </View>

        {/* Section tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <SectionPill label="Command"  active={section === 'command'}  onPress={() => setSection('command')} />
          <SectionPill label="Tenants"  active={section === 'tenants'}  onPress={() => setSection('tenants')} />
          <SectionPill label="Signals"  active={section === 'signals'}  onPress={() => setSection('signals')} />
          <SectionPill label="Live"     active={section === 'live'}     onPress={() => setSection('live')} dot={liveCount > 0} />
        </ScrollView>
      </View>

      {/* Section content */}
      <View className="flex-1">
        {section === 'command' && (
          <CommandSection
            companies={companies}
            liveCount={liveCount}
            loading={loading}
            onRefresh={onRefresh}
            refreshing={refreshing}
          />
        )}
        {section === 'tenants' && (
          <TenantsSection
            companies={companies}
            loading={loading}
            onRefresh={onRefresh}
            refreshing={refreshing}
          />
        )}
        {section === 'signals' && (
          <SignalsSection loading={loading} onRefresh={onRefresh} refreshing={refreshing} />
        )}
        {section === 'live' && (
          <LiveSection companies={companies} />
        )}
      </View>
    </SafeAreaView>
  );
}
