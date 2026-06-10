import {
    fmtDay,
    fmtMins,
    fmtNumber,
    fmtBytes,
    fmtHHMM,
    healthLabel,
    timeAgo,
    deleteCompany,
    deleteUser,
    moveUser,
    updateUser,
    useCompanyDetail,
    useControlPlaneData,
    useInfraData,
    useLiveSessions,
    useTimeline,
    useUsersData,
    workspaceAge,
    type CompanyOverview,
    type PlatformUser,
    type Section,
    type SignalMetric,
    type SortKey,
} from '@/components/platform-admin/useControlPlaneData';
import { FontAwesome } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
    ActivityIndicator, Modal, Pressable,
    ScrollView,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { cssInterop } from 'react-native-css-interop';
import {
    Area,
    AreaChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis, YAxis,
    ReferenceLine,
} from 'recharts';
import { useThemeColors } from '@/hooks/useThemeColors';

cssInterop(FontAwesome, {
  className: { target: 'style', nativeStyleToProp: { color: true, size: true } },
} as any);

// ── Sparkline ──────────────────────────────────────────────────────────────

function Sparkline({ data, color = 'rgb(99,102,241)' }: { data: number[]; color?: string }) {
  const colors = useThemeColors();
  const chartData = data.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width="100%" height={40}>
      <AreaChart data={chartData} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
        <defs>
          <linearGradient id={`spark-${color.replace(/[^a-z]/gi, '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="v"
          stroke={color}
          fill={`url(#spark-${color.replace(/[^a-z]/gi, '')})`}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Stat Card with sparkline ───────────────────────────────────────────────

function StatCard({
  label, value, sub, icon, accent, sparkData,
}: {
  label: string; value: string | number; sub?: string; icon: string;
  accent?: boolean; sparkData?: number[];
}) {
  const color = accent ? 'rgb(99,102,241)' : 'rgb(99,102,241)';
  return (
    <View className={`flex-1 rounded-2xl p-5 border ${accent ? 'bg-brand-primary-dim border-brand-primary/20' : 'bg-surface-card border-surface-border'}`}>
      <View className="flex-row items-center justify-between mb-1">
        <Text className={`text-[10px] font-black uppercase tracking-widest ${accent ? 'text-brand-primary' : 'text-typography-muted'}`}>{label}</Text>
        <FontAwesome name={icon as any} size={11} className={accent ? 'text-brand-primary' : 'text-brand-accent/40'} />
      </View>
      <Text className={`text-3xl font-black tracking-tight mt-1 ${accent ? 'text-brand-primary' : 'text-typography-main'}`}>{value}</Text>
      {sub && <Text className="text-typography-dim text-[10px] mt-0.5">{sub}</Text>}
      {sparkData && sparkData.length > 1 && (
        <View style={{ marginTop: 8 }}>
          <Sparkline data={sparkData} color={accent ? 'rgb(99,102,241)' : 'rgb(99,102,241)'} />
        </View>
      )}
    </View>
  );
}

// ── HBar ──────────────────────────────────────────────────────────────────

function HBar({ value, max, tint = 'primary' }: { value: number; max: number; tint?: 'primary' | 'success' | 'warning' }) {
  const colors = useThemeColors();
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 2;
  const colorClass = tint === 'success' ? 'bg-state-success' : tint === 'warning' ? 'bg-state-warning' : 'bg-brand-primary';
  return (
    <View className="flex-1 h-1.5 bg-surface-border rounded-full overflow-hidden">
      <View className={`h-full rounded-full ${colorClass}`} style={{ width: `${pct}%` }} />
    </View>
  );
}

// ── Custom tooltip for recharts ────────────────────────────────────────────

const ChartTooltip = ({ active, payload, label, metricLabel }: any) => {
  const colors = useThemeColors();
  if (!active || !payload?.length) return null;
  return (
    <View className="bg-surface-overlay border border-surface-border rounded-xl px-3 py-2">
      <Text className="text-typography-dim text-[10px] mb-0.5">{label}</Text>
      <Text className="text-typography-main font-black text-sm">{fmtNumber(payload[0]?.value ?? 0)}</Text>
      <Text className="text-typography-muted text-[10px]">{metricLabel}</Text>
    </View>
  );
};

// ── Company Detail Panel ───────────────────────────────────────────────────

function CompanyDetailPanel({ companyId, onClose, onDeleted }: { companyId: string | null; onClose: () => void; onDeleted: () => void }) {
  const colors = useThemeColors();
  const { detail, loading } = useCompanyDetail(companyId);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  React.useEffect(() => {
    if (!companyId) setConfirmDelete(false);
  }, [companyId]);

  const handleDelete = async () => {
    if (!companyId) return;
    setDeleting(true);
    const { error } = await deleteCompany(companyId);
    setDeleting(false);
    if (!error) onDeleted();
  };

  if (!companyId) return null;

  const maxMins = detail?.members ? Math.max(1, ...detail.members.map(m => m.session_minutes_week)) : 1;

  return (
    <Modal visible={!!companyId} transparent animationType="fade">
      <Pressable className="flex-1 bg-black/60" onPress={onClose}>
        <Pressable
          className="absolute right-0 top-0 bottom-0 bg-surface-background border-l border-surface-border"
          style={{ width: 440 }}
          onPress={e => e.stopPropagation()}
        >
          {/* Header */}
          <View className="px-8 pt-8 pb-5 border-b border-surface-border flex-row items-start justify-between">
            <View className="flex-1 mr-4">
              {loading || !detail ? (
                <View className="h-7 w-48 bg-surface-overlay rounded-lg" />
              ) : (
                <>
                  <Text className="text-typography-main font-black text-2xl tracking-tight">{detail.company.name}</Text>
                  <Text className="text-typography-muted text-xs mt-1">Workspace · {workspaceAge(detail.company.created_at)} old</Text>
                </>
              )}
            </View>
            <TouchableOpacity onPress={onClose} className="w-9 h-9 bg-surface-card border border-surface-border rounded-full items-center justify-center">
              <FontAwesome name="times" size={13} className="text-typography-muted" />
            </TouchableOpacity>
          </View>

          {loading || !detail ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : (
            <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
              {/* Stats */}
              <View className="flex-row gap-3 px-8 py-5">
                {[
                  { label: 'Tasks', value: fmtNumber(detail.stats.total_tasks) },
                  { label: 'All Time', value: fmtMins(detail.stats.total_session_minutes) },
                  { label: 'Live', value: String(detail.stats.active_sessions), accent: detail.stats.active_sessions > 0 },
                ].map(s => (
                  <View key={s.label} className={`flex-1 rounded-2xl p-3 border items-center ${s.accent ? 'bg-state-success/10 border-state-success/20' : 'bg-surface-card border-surface-border'}`}>
                    <Text className={`font-black text-lg ${s.accent ? 'text-state-success' : 'text-typography-main'}`}>{s.value}</Text>
                    <Text className={`text-[10px] mt-0.5 uppercase tracking-wide ${s.accent ? 'text-state-success' : 'text-typography-muted'}`}>{s.label}</Text>
                  </View>
                ))}
              </View>

              <View className="h-px bg-surface-border mx-8" />

              {/* Join code */}
              <View className="flex-row items-center px-8 py-4 gap-3">
                <FontAwesome name="key" size={11} className="text-typography-muted" />
                <Text className="text-typography-muted text-xs">Join code</Text>
                <Text className="text-typography-main font-black text-xs tracking-widest ml-1 bg-surface-overlay px-2 py-0.5 rounded-lg">{detail.company.join_code}</Text>
              </View>

              <View className="h-px bg-surface-border mx-8" />

              {/* Members */}
              <View className="px-8 pt-5">
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-4">Members · {detail.members?.length ?? 0}</Text>
                {detail.members?.length === 0 && (
                  <Text className="text-typography-dim text-sm text-center py-6">No members yet</Text>
                )}
                {detail.members?.map(m => (
                  <View key={m.id} className="mb-5">
                    <View className="flex-row items-center justify-between mb-1.5">
                      <View className="flex-row items-center gap-2 flex-1 mr-3">
                        {m.is_active && <View className="w-1.5 h-1.5 rounded-full bg-state-success" />}
                        <Text className="text-typography-main font-bold text-sm flex-1" numberOfLines={1}>{m.name}</Text>
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

              {/* Danger Zone */}
              <View className="h-px bg-surface-border mx-8 mt-2" />
              <View className="px-8 py-6">
                {!confirmDelete ? (
                  <TouchableOpacity
                    onPress={() => setConfirmDelete(true)}
                    className="flex-row items-center gap-2 self-start px-4 py-2 rounded-xl border border-state-danger/30 bg-state-danger/5 hover:bg-state-danger/10 transition-colors"
                  >
                    <FontAwesome name="trash" size={11} className="text-state-danger" />
                    <Text className="text-state-danger text-xs font-bold">Delete Workspace</Text>
                  </TouchableOpacity>
                ) : (
                  <View className="rounded-2xl border border-state-danger/30 bg-state-danger/5 p-4 gap-3">
                    <View className="flex-row items-center gap-2">
                      <FontAwesome name="exclamation-triangle" size={12} className="text-state-danger" />
                      <Text className="text-state-danger text-xs font-black">This cannot be undone</Text>
                    </View>
                    <Text className="text-typography-muted text-xs leading-5">
                      Deleting <Text className="text-typography-main font-bold">{detail.company.name}</Text> will permanently remove all members, tasks, pipelines, sessions, and data. There is no recovery.
                    </Text>
                    <View className="flex-row gap-2 mt-1">
                      <TouchableOpacity
                        onPress={() => setConfirmDelete(false)}
                        disabled={deleting}
                        className="flex-1 items-center py-2 rounded-xl border border-surface-border bg-surface-card hover:bg-surface-overlay transition-colors"
                      >
                        <Text className="text-typography-muted text-xs font-bold">Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={handleDelete}
                        disabled={deleting}
                        className="flex-1 items-center py-2 rounded-xl bg-state-danger hover:opacity-80 transition-opacity"
                      >
                        {deleting
                          ? <ActivityIndicator size="small" color="#fff" />
                          : <Text className="text-white text-xs font-black">Confirm Delete</Text>
                        }
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Command Section ────────────────────────────────────────────────────────

function CommandSection({ companies, liveCount, loading, totalUsers, totalTasks, totalMins }: {
  companies: CompanyOverview[]; liveCount: number; loading: boolean;
  totalUsers: number; totalTasks: number; totalMins: number;
}) {
  const { timeline } = useTimeline(7);
  const maxMins = Math.max(1, ...companies.map(c => c.session_minutes_week));
  const top5 = companies.slice(0, 5);

  const chartData = useMemo(() =>
    [...timeline].reverse().map(e => ({
      day: fmtDay(e.day),
      sessions: e.session_minutes,
      tasks: e.tasks_created,
      users: e.active_users,
    })), [timeline]);

  const usersSpark = useMemo(() => [...timeline].reverse().map(e => e.active_users), [timeline]);
  const sessSpark  = useMemo(() => [...timeline].reverse().map(e => e.session_minutes), [timeline]);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color={colors.primary} />
        <Text className="text-typography-muted mt-4 font-bold text-sm">Fetching platform data...</Text>
      </View>
    );
  }

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 32, paddingBottom: 48 }}>
      {/* Stat cards */}
      <View className="flex-row gap-4 mb-6">
        <StatCard label="Tenants" value={fmtNumber(companies.length)} icon="building" sub="companies on platform" sparkData={usersSpark} />
        <StatCard label="Users" value={fmtNumber(totalUsers)} icon="users" sub="across all workspaces" sparkData={usersSpark} />
        <StatCard label="Active Now" value={fmtNumber(liveCount)} icon="circle" sub={liveCount > 0 ? 'sessions running' : 'no active sessions'} accent={liveCount > 0} sparkData={sessSpark} />
        <StatCard label="Usage / Week" value={fmtMins(totalMins)} icon="clock-o" sub={`${fmtNumber(totalTasks)} total tasks`} sparkData={sessSpark} />
      </View>

      {/* 7-day area chart */}
      <View className="bg-surface-card rounded-2xl border border-surface-border p-6 mb-6">
        <View className="flex-row items-center justify-between mb-5">
          <View>
            <Text className="text-typography-main font-black text-lg tracking-tight">Activity Timeline</Text>
            <Text className="text-typography-muted text-xs mt-0.5">Session minutes · last 7 days</Text>
          </View>
          <View className="flex-row items-center gap-1.5 bg-surface-overlay px-3 py-1.5 rounded-xl">
            <View className="w-2 h-2 rounded-full bg-brand-primary" />
            <Text className="text-typography-muted text-[10px] font-bold">Sessions</Text>
          </View>
        </View>
        {chartData.length === 0 ? (
          <View className="items-center py-12">
            <Text className="text-typography-dim text-sm">No data yet</Text>
          </View>
        ) : (
          <View style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="sessGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(99,102,241)" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="rgb(99,102,241)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(51,65,85,0.5)" vertical={false} />
                <XAxis dataKey="day" tick={{ fill: 'rgb(100,116,139)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'rgb(100,116,139)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip metricLabel="Session Minutes" />} />
                <Area type="monotone" dataKey="sessions" stroke="rgb(99,102,241)" fill="url(#sessGrad)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </View>
        )}
      </View>

      <View className="flex-row gap-4">
        {/* System Pulse */}
        <View className="flex-1 bg-surface-card rounded-2xl border border-surface-border p-6">
          <View className="flex-row items-center justify-between mb-5">
            <Text className="text-typography-main font-black text-base">System Pulse</Text>
            <Text className="text-typography-muted text-[10px] uppercase tracking-widest">7-day usage</Text>
          </View>
          {companies.length === 0 && (
            <Text className="text-typography-dim text-sm text-center py-8">No tenants yet</Text>
          )}
          {top5.map((co, i) => (
            <View key={co.id} className="mb-4">
              <View className="flex-row items-center justify-between mb-1.5">
                <View className="flex-row items-center gap-2 flex-1 mr-2">
                  <Text className="text-typography-dim text-[10px] w-4">{i + 1}</Text>
                  <Text className="text-typography-main font-bold text-sm flex-1" numberOfLines={1}>{co.name}</Text>
                  {co.active_sessions_now > 0 && (
                    <View className="flex-row items-center bg-state-success/10 px-1.5 py-0.5 rounded-full">
                      <View className="w-1 h-1 bg-state-success rounded-full mr-1" />
                      <Text className="text-state-success text-[9px] font-black">LIVE</Text>
                    </View>
                  )}
                </View>
                <Text className="text-typography-muted text-xs font-bold">{fmtMins(co.session_minutes_week)}</Text>
              </View>
              <View className="flex-row items-center gap-2">
                <View className="w-4" />
                <HBar value={co.session_minutes_week} max={maxMins} />
              </View>
            </View>
          ))}
          {companies.length > 5 && (
            <Text className="text-typography-dim text-xs text-center mt-2">
              +{companies.length - 5} more — view in Tenants
            </Text>
          )}
        </View>

        {/* Platform Snapshot */}
        <View className="flex-1 bg-surface-card rounded-2xl border border-surface-border p-6">
          <Text className="text-typography-main font-black text-base mb-5">Platform Snapshot</Text>
          {[
            { label: 'Most active tenant', value: companies[0]?.name ?? '—', icon: 'trophy' },
            { label: 'Avg users / workspace', value: companies.length > 0 ? fmtNumber(Math.round(totalUsers / companies.length)) : '—', icon: 'users' },
            { label: 'Avg usage / workspace', value: companies.length > 0 ? fmtMins(Math.round(totalMins / companies.length)) : '—', icon: 'clock-o' },
            { label: 'Total platform usage', value: fmtMins(totalMins), icon: 'bar-chart' },
            { label: 'Total tasks created', value: fmtNumber(totalTasks), icon: 'tasks' },
          ].map((row, idx, arr) => (
            <View key={row.label}>
              <View className="flex-row items-center justify-between py-3">
                <View className="flex-row items-center gap-3">
                  <FontAwesome name={row.icon as any} size={11} className="text-brand-accent/40" />
                  <Text className="text-typography-muted text-sm">{row.label}</Text>
                </View>
                <Text className="text-typography-main font-black text-sm">{row.value}</Text>
              </View>
              {idx < arr.length - 1 && <View className="h-px bg-surface-border" />}
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

// ── Tenants Section ────────────────────────────────────────────────────────

function TenantsSection({ companies, loading, onCompanyDeleted }: { companies: CompanyOverview[]; loading: boolean; onCompanyDeleted: () => void }) {
  const colors = useThemeColors();
  const [sort, setSort] = useState<SortKey>('usage');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const sorted = useMemo(() => [...companies].sort((a, b) => {
    if (sort === 'usage') return b.session_minutes_week - a.session_minutes_week;
    if (sort === 'users') return b.user_count - a.user_count;
    if (sort === 'tasks') return b.task_count - a.task_count;
    if (sort === 'age')   return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    return 0;
  }), [companies, sort]);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 32, paddingBottom: 48 }}>
        {/* Sort bar */}
        <View className="flex-row items-center gap-3 mb-6">
          <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mr-1">Sort</Text>
          {(['usage', 'users', 'tasks', 'age'] as SortKey[]).map(k => (
            <TouchableOpacity
              key={k}
              onPress={() => setSort(k)}
              className={`px-4 py-2 rounded-xl border transition-colors ${sort === k ? 'bg-brand-primary border-brand-primary' : 'bg-surface-card border-surface-border hover:bg-surface-overlay'}`}
            >
              <Text className={`text-xs font-bold capitalize ${sort === k ? 'text-white' : 'text-typography-muted'}`}>{k}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {companies.length === 0 && (
          <View className="items-center py-20">
            <FontAwesome name="building-o" size={36} className="text-typography-dim" />
            <Text className="text-typography-dim mt-4 text-sm">No tenants registered yet</Text>
          </View>
        )}

        {/* 2-col grid */}
        <View className="flex-row flex-wrap gap-4">
          {sorted.map(co => {
            const minsPerUser = co.user_count > 0 ? co.session_minutes_week / co.user_count : 0;
            const health = healthLabel(minsPerUser);
            return (
              <TouchableOpacity
                key={co.id}
                onPress={() => setSelectedId(co.id)}
                className="bg-surface-card rounded-2xl p-5 border border-surface-border hover:border-brand-primary/40 hover:bg-surface-overlay transition-all"
                style={{ width: 'calc(50% - 8px)' } as any}
              >
                <View className="flex-row items-center justify-between mb-3">
                  <Text className="text-typography-main font-black text-base flex-1 mr-3" numberOfLines={1}>{co.name}</Text>
                  <View className="flex-row items-center gap-2">
                    {co.active_sessions_now > 0 && (
                      <View className="flex-row items-center bg-state-success/10 px-2 py-0.5 rounded-full">
                        <View className="w-1.5 h-1.5 bg-state-success rounded-full mr-1" />
                        <Text className="text-state-success text-[9px] font-black">{co.active_sessions_now} LIVE</Text>
                      </View>
                    )}
                    <View className={`px-2 py-0.5 rounded-full ${health.dimColor}`}>
                      <Text className={`text-[9px] font-black uppercase ${health.color}`}>{health.label}</Text>
                    </View>
                  </View>
                </View>

                <View className="flex-row gap-5 mb-3">
                  {[
                    { icon: 'users', value: fmtNumber(co.user_count), label: 'users' },
                    { icon: 'tasks', value: fmtNumber(co.task_count), label: 'tasks' },
                    { icon: 'clock-o', value: fmtMins(co.session_minutes_week), label: 'this week' },
                  ].map(m => (
                    <View key={m.label} className="flex-row items-center gap-1.5">
                      <FontAwesome name={m.icon as any} size={10} className="text-typography-muted" />
                      <Text className="text-typography-main font-black text-xs">{m.value}</Text>
                      <Text className="text-typography-dim text-[10px]">{m.label}</Text>
                    </View>
                  ))}
                </View>

                <View className="flex-row items-center justify-between">
                  <Text className="text-typography-dim text-[10px]">Last active {timeAgo(co.last_active_at)}</Text>
                  <View className="flex-row items-center gap-1">
                    <Text className="text-typography-dim text-[10px]">{workspaceAge(co.created_at)} old</Text>
                    <FontAwesome name="chevron-right" size={8} className="text-typography-dim" />
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      <CompanyDetailPanel
        companyId={selectedId}
        onClose={() => setSelectedId(null)}
        onDeleted={() => { setSelectedId(null); onCompanyDeleted(); }}
      />
    </>
  );
}

// ── Signals Section ────────────────────────────────────────────────────────

function SignalsSection() {
  const colors = useThemeColors();
  const { days, setDays, metric, setMetric, timeline, fetching, getValue, totalVal, metricLabel } = useTimeline(30);

  const chartData = useMemo(() =>
    [...timeline].reverse().map(e => ({
      day: fmtDay(e.day),
      value: getValue(e),
    })), [timeline, getValue]);

  const accentColor = metric === 'tasks' ? 'rgb(251,191,36)' : metric === 'users' ? 'rgb(34,197,94)' : 'rgb(99,102,241)';
  const gradId = `sig-${metric}`;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 32, paddingBottom: 48 }}>
      {/* Controls */}
      <View className="flex-row items-center gap-6 mb-6">
        <View className="flex-row items-center gap-2">
          <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mr-1">Range</Text>
          {[7, 14, 30].map(d => (
            <TouchableOpacity
              key={d}
              onPress={() => setDays(d)}
              className={`px-4 py-2 rounded-xl border transition-colors ${days === d ? 'bg-brand-primary border-brand-primary' : 'bg-surface-card border-surface-border hover:bg-surface-overlay'}`}
            >
              <Text className={`text-xs font-bold ${days === d ? 'text-white' : 'text-typography-muted'}`}>{d}d</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View className="flex-row items-center gap-2">
          <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mr-1">Metric</Text>
          {(['sessions', 'tasks', 'users'] as SignalMetric[]).map(m => (
            <TouchableOpacity
              key={m}
              onPress={() => setMetric(m)}
              className={`px-4 py-2 rounded-xl border transition-colors ${metric === m ? 'bg-brand-primary border-brand-primary' : 'bg-surface-card border-surface-border hover:bg-surface-overlay'}`}
            >
              <Text className={`text-xs font-bold ${metric === m ? 'text-white' : 'text-typography-muted'}`}>
                {m === 'sessions' ? 'Usage' : m === 'tasks' ? 'Tasks' : 'Users'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {fetching && <ActivityIndicator size="small" color={colors.primary} />}
      </View>

      {/* Summary stat */}
      <View className="bg-surface-card rounded-2xl border border-surface-border p-6 mb-6">
        <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-1">{metricLabel} · last {days} days</Text>
        <Text className="text-typography-main font-black text-4xl tracking-tight">
          {metric === 'sessions' ? fmtMins(totalVal) : fmtNumber(totalVal)}
        </Text>
      </View>

      {/* Area chart */}
      <View className="bg-surface-card rounded-2xl border border-surface-border p-6">
        <Text className="text-typography-main font-black text-base mb-5">{metricLabel} over time</Text>
        {chartData.length === 0 ? (
          <View className="items-center py-12">
            <Text className="text-typography-dim text-sm">No data for this range</Text>
          </View>
        ) : (
          <View style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={accentColor} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={accentColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(51,65,85,0.5)" vertical={false} />
                <XAxis dataKey="day" tick={{ fill: 'rgb(100,116,139)', fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fill: 'rgb(100,116,139)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip metricLabel={metricLabel} />} />
                <Area type="monotone" dataKey="value" stroke={accentColor} fill={`url(#${gradId})`} strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

// ── Live Section ───────────────────────────────────────────────────────────

function LiveSection() {
  const colors = useThemeColors();
  const { sessions, loading, secsAgo, companiesLive, fetchSessions } = useLiveSessions();

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color={colors.primary} />
        <Text className="text-typography-muted mt-4 font-bold text-sm">Connecting...</Text>
      </View>
    );
  }

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 32, paddingBottom: 48 }}>
      {/* Status bar */}
      <View className="flex-row items-center justify-between mb-6">
        <View className="flex-row items-center gap-2">
          <View className={`w-2.5 h-2.5 rounded-full ${sessions.length > 0 ? 'bg-state-success' : 'bg-surface-border'}`} />
          <Text className="text-typography-main font-black text-base">
            {sessions.length > 0 ? `${sessions.length} active · ${companiesLive} workspace${companiesLive !== 1 ? 's' : ''}` : 'No active sessions'}
          </Text>
        </View>
        <TouchableOpacity
          onPress={fetchSessions}
          className="flex-row items-center gap-2 bg-surface-card border border-surface-border px-4 py-2 rounded-xl hover:bg-surface-overlay transition-colors"
        >
          <FontAwesome name="refresh" size={11} className="text-typography-muted" />
          <Text className="text-typography-dim text-xs">{secsAgo}s ago</Text>
        </TouchableOpacity>
      </View>

      {sessions.length === 0 ? (
        <View className="items-center py-24">
          <View className="w-20 h-20 bg-surface-card rounded-full border border-surface-border items-center justify-center mb-5">
            <FontAwesome name="moon-o" size={28} className="text-typography-dim" />
          </View>
          <Text className="text-typography-main font-black text-xl">All quiet</Text>
          <Text className="text-typography-muted text-sm mt-2">No one is working right now</Text>
          <Text className="text-typography-dim text-xs mt-4">Auto-refreshes every 30s</Text>
        </View>
      ) : (
        <View className="flex-row flex-wrap gap-4">
          {sessions.map(s => (
            <View
              key={s.session_id}
              className="bg-surface-card rounded-2xl p-5 border border-surface-border"
              style={{ width: 'calc(50% - 8px)' } as any}
            >
              <View className="flex-row items-center justify-between mb-2">
                <View className="flex-row items-center gap-2 flex-1 mr-3">
                  <View className="w-1.5 h-1.5 bg-state-success rounded-full" />
                  <Text className="text-typography-main font-black text-sm" numberOfLines={1}>{s.user_name}</Text>
                </View>
                <View className="bg-state-success/10 px-2 py-0.5 rounded-full">
                  <Text className="text-state-success text-[10px] font-black">{fmtMins(s.duration_minutes)}</Text>
                </View>
              </View>
              <Text className="text-brand-primary text-xs font-bold mb-2" numberOfLines={1}>{s.task_title ?? 'Unknown task'}</Text>
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-1.5">
                  <FontAwesome name="building-o" size={9} className="text-typography-dim" />
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
}

// ── Users Section ─────────────────────────────────────────────────────────

const WORK_STATUSES = ['available', 'busy', 'away', 'do_not_disturb', 'offline'];

function UserAvatar({ user, size = 40 }: { user: PlatformUser; size?: number }) {
  const colors = useThemeColors();
  const initials = (user.display_name || user.full_name || user.email)
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');
  if (user.avatar_url) {
    return (
      <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: 'rgba(99,102,241,0.2)' }}>
        {/* eslint-disable-next-line @typescript-eslint/no-require-imports */}
        <img src={user.avatar_url} style={{ width: size, height: size, objectFit: 'cover' } as any} />
      </View>
    );
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: 'rgba(99,102,241,0.2)', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: 'rgb(99,102,241)', fontWeight: '900', fontSize: size * 0.35 }}>{initials || '?'}</Text>
    </View>
  );
}

function EditField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const colors = useThemeColors();
  return (
    <View className="mb-3">
      <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-1">{label}</Text>
      <View className="bg-surface-overlay border border-surface-border rounded-xl px-3 py-2">
        {/* @ts-ignore — web-only input */}
        <input
          value={value}
          onChange={(e: any) => onChange(e.target.value)}
          style={{ background: 'transparent', border: 'none', outline: 'none', color: 'inherit', fontSize: 13, fontWeight: '600', width: '100%' } as any}
        />
      </View>
    </View>
  );
}

function UserDetailPanel({
  user,
  companies,
  onClose,
  onDeleted,
  onUpdated,
}: {
  user: PlatformUser | null;
  companies: CompanyOverview[];
  onClose: () => void;
  onDeleted: () => void;
  onUpdated: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showMoveDropdown, setShowMoveDropdown] = useState(false);
  const [moving, setMoving] = useState(false);
  const [form, setForm] = useState({ full_name: '', display_name: '', phone: '', job_title: '', department: '', work_status: '', is_active: true });

  React.useEffect(() => {
    if (user) {
      setForm({
        full_name:    user.full_name    ?? '',
        display_name: user.display_name ?? '',
        phone:        user.phone        ?? '',
        job_title:    user.job_title    ?? '',
        department:   user.department   ?? '',
        work_status:  user.work_status  ?? '',
        is_active:    user.is_active,
      });
      setEditing(false);
      setConfirmDelete(false);
      setShowMoveDropdown(false);
    }
  }, [user?.id]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    await updateUser(user.id, form);
    setSaving(false);
    setEditing(false);
    onUpdated();
  };

  const handleDelete = async () => {
    if (!user) return;
    setDeleting(true);
    await deleteUser(user.id);
    setDeleting(false);
    onDeleted();
  };

  const handleMove = async (companyId: string) => {
    if (!user) return;
    setMoving(true);
    setShowMoveDropdown(false);
    await moveUser(user.id, companyId);
    setMoving(false);
    onUpdated();
  };

  if (!user) return null;

  const otherCompanies = companies.filter(c => c.id !== user.company_id);

  return (
    <Modal visible={!!user} transparent animationType="fade">
      <Pressable className="flex-1 bg-black/60" onPress={onClose}>
        <Pressable
          className="absolute right-0 top-0 bottom-0 bg-surface-background border-l border-surface-border"
          style={{ width: 480 }}
          onPress={e => e.stopPropagation()}
        >
          {/* Header */}
          <View className="px-8 pt-8 pb-5 border-b border-surface-border flex-row items-center gap-4">
            <UserAvatar user={user} size={48} />
            <View className="flex-1">
              <Text className="text-typography-main font-black text-xl tracking-tight" numberOfLines={1}>
                {user.display_name || user.full_name || 'Unnamed User'}
              </Text>
              <Text className="text-typography-muted text-xs mt-0.5" numberOfLines={1}>{user.email}</Text>
            </View>
            <View className="flex-row items-center gap-2">
              {!editing ? (
                <TouchableOpacity
                  onPress={() => setEditing(true)}
                  className="flex-row items-center gap-2 px-3 py-2 bg-surface-card border border-surface-border rounded-xl hover:bg-surface-overlay transition-colors"
                >
                  <FontAwesome name="pencil" size={11} className="text-typography-muted" />
                  <Text className="text-typography-muted text-xs font-bold">Edit</Text>
                </TouchableOpacity>
              ) : (
                <View className="flex-row gap-2">
                  <TouchableOpacity
                    onPress={() => setEditing(false)}
                    disabled={saving}
                    className="px-3 py-2 bg-surface-card border border-surface-border rounded-xl hover:bg-surface-overlay transition-colors"
                  >
                    <Text className="text-typography-muted text-xs font-bold">Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleSave}
                    disabled={saving}
                    className="flex-row items-center gap-2 px-3 py-2 bg-brand-primary rounded-xl hover:opacity-80 transition-opacity"
                  >
                    {saving
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Text className="text-white text-xs font-black">Save</Text>
                    }
                  </TouchableOpacity>
                </View>
              )}
              <TouchableOpacity
                onPress={onClose}
                className="w-9 h-9 bg-surface-card border border-surface-border rounded-full items-center justify-center"
              >
                <FontAwesome name="times" size={13} className="text-typography-muted" />
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
            {/* Status badges */}
            <View className="flex-row items-center gap-2 px-8 pt-5 pb-3">
              <View className={`px-2.5 py-1 rounded-full ${user.is_active ? 'bg-state-success/10' : 'bg-state-danger/10'}`}>
                <Text className={`text-[10px] font-black uppercase tracking-wide ${user.is_active ? 'text-state-success' : 'text-state-danger'}`}>
                  {user.is_active ? 'Active' : 'Inactive'}
                </Text>
              </View>
              {user.is_owner && (
                <View className="bg-brand-primary-dim px-2.5 py-1 rounded-full border border-brand-primary/20">
                  <Text className="text-brand-primary text-[10px] font-black uppercase tracking-wide">Owner</Text>
                </View>
              )}
              {user.work_status && !editing && (
                <View className="bg-surface-overlay px-2.5 py-1 rounded-full">
                  <Text className="text-typography-muted text-[10px] font-bold capitalize">{user.work_status.replace(/_/g, ' ')}</Text>
                </View>
              )}
            </View>

            <View className="h-px bg-surface-border mx-8" />

            {/* Fields */}
            <View className="px-8 pt-5">
              {editing ? (
                <>
                  <EditField label="Full Name" value={form.full_name} onChange={v => setForm(f => ({ ...f, full_name: v }))} />
                  <EditField label="Display Name" value={form.display_name} onChange={v => setForm(f => ({ ...f, display_name: v }))} />
                  <EditField label="Phone" value={form.phone} onChange={v => setForm(f => ({ ...f, phone: v }))} />
                  <EditField label="Job Title" value={form.job_title} onChange={v => setForm(f => ({ ...f, job_title: v }))} />
                  <EditField label="Department" value={form.department} onChange={v => setForm(f => ({ ...f, department: v }))} />

                  <View className="mb-3">
                    <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-1">Work Status</Text>
                    <View className="flex-row flex-wrap gap-2">
                      {WORK_STATUSES.map(s => (
                        <TouchableOpacity
                          key={s}
                          onPress={() => setForm(f => ({ ...f, work_status: s }))}
                          className={`px-3 py-1.5 rounded-xl border transition-colors ${form.work_status === s ? 'bg-brand-primary border-brand-primary' : 'bg-surface-card border-surface-border hover:bg-surface-overlay'}`}
                        >
                          <Text className={`text-[11px] font-bold capitalize ${form.work_status === s ? 'text-white' : 'text-typography-muted'}`}>
                            {s.replace(/_/g, ' ')}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  <View className="mb-4">
                    <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Account Status</Text>
                    <TouchableOpacity
                      onPress={() => setForm(f => ({ ...f, is_active: !f.is_active }))}
                      className={`flex-row items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${form.is_active ? 'bg-state-success/10 border-state-success/20' : 'bg-state-danger/10 border-state-danger/20'}`}
                    >
                      <View className={`w-4 h-4 rounded-full border-2 items-center justify-center ${form.is_active ? 'border-state-success bg-state-success' : 'border-state-danger bg-state-danger'}`}>
                        {form.is_active && <FontAwesome name="check" size={8} className="text-white" />}
                      </View>
                      <Text className={`text-xs font-bold ${form.is_active ? 'text-state-success' : 'text-state-danger'}`}>
                        {form.is_active ? 'Account is active' : 'Account is disabled'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <>
                  {[
                    { icon: 'building-o', label: 'Workspace', value: user.company_name ?? 'No workspace' },
                    { icon: 'briefcase', label: 'Job Title', value: user.job_title ?? '—' },
                    { icon: 'sitemap', label: 'Department', value: user.department ?? '—' },
                    { icon: 'phone', label: 'Phone', value: user.phone ?? '—' },
                    { icon: 'calendar', label: 'Joined', value: new Date(user.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) },
                    { icon: 'clock-o', label: 'Last Seen', value: timeAgo(user.last_seen_at) },
                  ].map((row, idx, arr) => (
                    <View key={row.label}>
                      <View className="flex-row items-center py-3 gap-3">
                        <FontAwesome name={row.icon as any} size={11} className="text-brand-accent/40" style={{ width: 14 }} />
                        <Text className="text-typography-muted text-sm w-24">{row.label}</Text>
                        <Text className="text-typography-main font-bold text-sm flex-1" numberOfLines={1}>{row.value}</Text>
                      </View>
                      {idx < arr.length - 1 && <View className="h-px bg-surface-border" />}
                    </View>
                  ))}
                </>
              )}
            </View>

            {!editing && (
              <>
                <View className="h-px bg-surface-border mx-8 mt-2" />

                {/* Move to workspace */}
                <View className="px-8 py-5">
                  <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-3">Move to Workspace</Text>
                  {moving ? (
                    <View className="flex-row items-center gap-2 py-2">
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text className="text-typography-muted text-xs">Moving user...</Text>
                    </View>
                  ) : showMoveDropdown ? (
                    <View className="bg-surface-card rounded-2xl border border-surface-border overflow-hidden">
                      <View className="px-4 py-3 border-b border-surface-border flex-row items-center justify-between">
                        <Text className="text-typography-main font-bold text-xs">Select destination workspace</Text>
                        <TouchableOpacity onPress={() => setShowMoveDropdown(false)}>
                          <FontAwesome name="times" size={11} className="text-typography-muted" />
                        </TouchableOpacity>
                      </View>
                      <ScrollView style={{ maxHeight: 200 }}>
                        {otherCompanies.length === 0 && (
                          <Text className="text-typography-dim text-xs text-center py-4">No other workspaces available</Text>
                        )}
                        {otherCompanies.map(c => (
                          <TouchableOpacity
                            key={c.id}
                            onPress={() => handleMove(c.id)}
                            className="flex-row items-center justify-between px-4 py-3 border-b border-surface-border hover:bg-surface-overlay transition-colors"
                          >
                            <View>
                              <Text className="text-typography-main font-bold text-sm">{c.name}</Text>
                              <Text className="text-typography-dim text-[10px]">{c.user_count} members</Text>
                            </View>
                            <FontAwesome name="chevron-right" size={9} className="text-typography-dim" />
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  ) : (
                    <TouchableOpacity
                      onPress={() => setShowMoveDropdown(true)}
                      className="flex-row items-center gap-2 self-start px-4 py-2 rounded-xl border border-surface-border bg-surface-card hover:bg-surface-overlay transition-colors"
                    >
                      <FontAwesome name="exchange" size={11} className="text-typography-muted" />
                      <Text className="text-typography-muted text-xs font-bold">Change Workspace</Text>
                    </TouchableOpacity>
                  )}
                </View>

                <View className="h-px bg-surface-border mx-8" />

                {/* Danger zone */}
                <View className="px-8 py-6">
                  {!confirmDelete ? (
                    <TouchableOpacity
                      onPress={() => setConfirmDelete(true)}
                      className="flex-row items-center gap-2 self-start px-4 py-2 rounded-xl border border-state-danger/30 bg-state-danger/5 hover:bg-state-danger/10 transition-colors"
                    >
                      <FontAwesome name="trash" size={11} className="text-state-danger" />
                      <Text className="text-state-danger text-xs font-bold">Delete User</Text>
                    </TouchableOpacity>
                  ) : (
                    <View className="rounded-2xl border border-state-danger/30 bg-state-danger/5 p-4 gap-3">
                      <View className="flex-row items-center gap-2">
                        <FontAwesome name="exclamation-triangle" size={12} className="text-state-danger" />
                        <Text className="text-state-danger text-xs font-black">This cannot be undone</Text>
                      </View>
                      <Text className="text-typography-muted text-xs leading-5">
                        Deleting <Text className="text-typography-main font-bold">{user.display_name || user.full_name || user.email}</Text> will permanently remove their account, all tasks, sessions, and data.
                      </Text>
                      <View className="flex-row gap-2 mt-1">
                        <TouchableOpacity
                          onPress={() => setConfirmDelete(false)}
                          disabled={deleting}
                          className="flex-1 items-center py-2 rounded-xl border border-surface-border bg-surface-card hover:bg-surface-overlay transition-colors"
                        >
                          <Text className="text-typography-muted text-xs font-bold">Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={handleDelete}
                          disabled={deleting}
                          className="flex-1 items-center py-2 rounded-xl bg-state-danger hover:opacity-80 transition-opacity"
                        >
                          {deleting
                            ? <ActivityIndicator size="small" color="#fff" />
                            : <Text className="text-white text-xs font-black">Confirm Delete</Text>
                          }
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>
              </>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function UsersSection({ companies, onUserDeleted }: { companies: CompanyOverview[]; onUserDeleted: () => void }) {
  const colors = useThemeColors();
  const { query, setQuery, companyFilter, setCompanyFilter, users, loading, refetch } = useUsersData();
  const [selectedUser, setSelectedUser] = useState<PlatformUser | null>(null);

  const activeCount = users.filter(u => u.is_active).length;

  return (
    <>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 32, paddingBottom: 48 }}>
        {/* Search + filter bar */}
        <View className="flex-row items-center gap-3 mb-6">
          <View className="flex-1 flex-row items-center gap-2 bg-surface-card border border-surface-border rounded-xl px-4 py-2.5">
            <FontAwesome name="search" size={12} className="text-typography-muted" />
            {/* @ts-ignore */}
            <input
              value={query}
              onChange={(e: any) => setQuery(e.target.value)}
              placeholder="Search by name or email…"
              style={{ background: 'transparent', border: 'none', outline: 'none', color: 'inherit', fontSize: 13, flex: 1, fontWeight: '500' } as any}
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery('')}>
                <FontAwesome name="times-circle" size={12} className="text-typography-dim" />
              </TouchableOpacity>
            )}
          </View>

          {/* Company filter */}
          <View className="relative">
            <TouchableOpacity
              onPress={() => setCompanyFilter(null)}
              className={`flex-row items-center gap-2 px-4 py-2.5 rounded-xl border transition-colors ${!companyFilter ? 'bg-brand-primary border-brand-primary' : 'bg-surface-card border-surface-border hover:bg-surface-overlay'}`}
            >
              <Text className={`text-xs font-bold ${!companyFilter ? 'text-white' : 'text-typography-muted'}`}>All Workspaces</Text>
            </TouchableOpacity>
          </View>

          {loading && <ActivityIndicator size="small" color={colors.primary} />}
        </View>

        {/* Workspace filter pills */}
        {companies.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
            <View className="flex-row gap-2">
              {companies.map(c => (
                <TouchableOpacity
                  key={c.id}
                  onPress={() => setCompanyFilter(companyFilter === c.id ? null : c.id)}
                  className={`flex-row items-center gap-1.5 px-3 py-1.5 rounded-xl border transition-colors ${companyFilter === c.id ? 'bg-brand-primary/20 border-brand-primary/40' : 'bg-surface-card border-surface-border hover:bg-surface-overlay'}`}
                >
                  <Text className={`text-[11px] font-bold ${companyFilter === c.id ? 'text-brand-primary' : 'text-typography-muted'}`}>{c.name}</Text>
                  <Text className={`text-[10px] ${companyFilter === c.id ? 'text-brand-primary/70' : 'text-typography-dim'}`}>{c.user_count}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        )}

        {/* Summary */}
        <View className="flex-row gap-4 mb-6">
          <View className="flex-1 bg-surface-card rounded-2xl border border-surface-border px-5 py-4 flex-row items-center gap-3">
            <FontAwesome name="users" size={14} className="text-brand-accent/40" />
            <View>
              <Text className="text-typography-main font-black text-2xl">{fmtNumber(users.length)}</Text>
              <Text className="text-typography-muted text-[10px] uppercase tracking-wide">total users</Text>
            </View>
          </View>
          <View className="flex-1 bg-surface-card rounded-2xl border border-surface-border px-5 py-4 flex-row items-center gap-3">
            <View className="w-3 h-3 rounded-full bg-state-success" />
            <View>
              <Text className="text-typography-main font-black text-2xl">{fmtNumber(activeCount)}</Text>
              <Text className="text-typography-muted text-[10px] uppercase tracking-wide">active</Text>
            </View>
          </View>
          <View className="flex-1 bg-surface-card rounded-2xl border border-surface-border px-5 py-4 flex-row items-center gap-3">
            <View className="w-3 h-3 rounded-full bg-state-danger" />
            <View>
              <Text className="text-typography-main font-black text-2xl">{fmtNumber(users.length - activeCount)}</Text>
              <Text className="text-typography-muted text-[10px] uppercase tracking-wide">inactive</Text>
            </View>
          </View>
        </View>

        {/* User rows */}
        {users.length === 0 && !loading && (
          <View className="items-center py-20">
            <FontAwesome name="user-o" size={36} className="text-typography-dim" />
            <Text className="text-typography-dim mt-4 text-sm">
              {query ? 'No users match your search' : 'No users found'}
            </Text>
          </View>
        )}

        <View className="bg-surface-card rounded-2xl border border-surface-border overflow-hidden">
          {users.map((u, idx) => (
            <TouchableOpacity
              key={u.id}
              onPress={() => setSelectedUser(u)}
              className={`flex-row items-center gap-4 px-5 py-4 hover:bg-surface-overlay transition-colors ${idx < users.length - 1 ? 'border-b border-surface-border' : ''}`}
            >
              <UserAvatar user={u} size={36} />
              <View className="flex-1 min-w-0">
                <View className="flex-row items-center gap-2 mb-0.5">
                  <Text className="text-typography-main font-bold text-sm" numberOfLines={1}>
                    {u.display_name || u.full_name || 'Unnamed'}
                  </Text>
                  {u.is_owner && (
                    <View className="bg-brand-primary-dim px-1.5 py-0.5 rounded-md">
                      <Text className="text-brand-primary text-[9px] font-black uppercase">Owner</Text>
                    </View>
                  )}
                </View>
                <Text className="text-typography-muted text-xs" numberOfLines={1}>{u.email}</Text>
              </View>
              <View className="items-end gap-1">
                <Text className="text-typography-dim text-xs" numberOfLines={1}>{u.company_name ?? '—'}</Text>
                {u.job_title && <Text className="text-typography-dim text-[10px]" numberOfLines={1}>{u.job_title}</Text>}
              </View>
              <View className={`w-2 h-2 rounded-full ml-2 ${u.is_active ? 'bg-state-success' : 'bg-surface-border'}`} />
              <FontAwesome name="chevron-right" size={9} className="text-typography-dim" />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      <UserDetailPanel
        user={selectedUser}
        companies={companies}
        onClose={() => setSelectedUser(null)}
        onDeleted={() => { setSelectedUser(null); refetch(); onUserDeleted(); }}
        onUpdated={() => { refetch(); setSelectedUser(null); }}
      />
    </>
  );
}

// ── Infrastructure Section ─────────────────────────────────────────────────

const SUPABASE_FREE_DB_LIMIT = 500 * 1024 * 1024; // 500 MB

function infraCacheColor(ratio: number): 'success' | 'warning' | 'danger' {
  const colors = useThemeColors();
  if (ratio >= 95) return 'success';
  if (ratio >= 75) return 'warning';
  return 'danger';
}

function infraConnColor(pct: number): 'success' | 'warning' | 'danger' {
  if (pct < 50) return 'success';
  if (pct < 80) return 'warning';
  return 'danger';
}

function infraStorageColor(pct: number): 'success' | 'warning' | 'danger' {
  if (pct < 70) return 'success';
  if (pct < 90) return 'warning';
  return 'danger';
}

function InfraStatCard({
  label, value, sub, icon, pct, pctColor,
}: {
  label: string; value: string; sub: string; icon: string;
  pct?: number; pctColor?: 'success' | 'warning' | 'danger';
}) {
  const barColor =
    pctColor === 'danger'  ? 'bg-state-danger'   :
    pctColor === 'warning' ? 'bg-state-warning'  :
                             'bg-state-success';
  const textColor =
    pctColor === 'danger'  ? 'text-state-danger'  :
    pctColor === 'warning' ? 'text-state-warning' :
                             'text-state-success';
  return (
    <View className="flex-1 bg-surface-card rounded-2xl border border-surface-border p-5">
      <View className="flex-row items-center justify-between mb-1">
        <Text className="text-[10px] font-black uppercase tracking-widest text-typography-muted">{label}</Text>
        <FontAwesome name={icon as any} size={11} className="text-brand-accent/40" />
      </View>
      <Text className="text-3xl font-black tracking-tight mt-1 text-typography-main">{value}</Text>
      <Text className="text-typography-dim text-[10px] mt-0.5">{sub}</Text>
      {pct !== undefined && (
        <View className="mt-3 gap-1">
          <View className="flex-row justify-between">
            <Text className={`text-[9px] font-bold ${textColor}`}>{pct.toFixed(1)}%</Text>
          </View>
          <View className="h-1.5 bg-surface-border rounded-full overflow-hidden">
            <View className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
          </View>
        </View>
      )}
    </View>
  );
}

const InfraChartTooltip = ({ active, payload, label, formatter }: any) => {
  const colors = useThemeColors();
  if (!active || !payload?.length) return null;
  return (
    <View className="bg-surface-overlay border border-surface-border rounded-xl px-3 py-2">
      <Text className="text-typography-dim text-[10px] mb-0.5">{label}</Text>
      <Text className="text-typography-main font-black text-sm">
        {formatter ? formatter(payload[0]?.value ?? 0) : payload[0]?.value ?? 0}
      </Text>
    </View>
  );
};

function InfraSection() {
  const colors = useThemeColors();
  const { metrics, loading, secsAgo, refetch } = useInfraData();

  const storageChartData = useMemo(() =>
    (metrics?.snapshots ?? []).map(s => ({
      time: fmtHHMM(s.captured_at),
      mb:   parseFloat((s.db_size_bytes / (1024 * 1024)).toFixed(2)),
    })), [metrics?.snapshots]);

  const connChartData = useMemo(() =>
    (metrics?.snapshots ?? []).map(s => ({
      time:        fmtHHMM(s.captured_at),
      connections: s.active_connections,
    })), [metrics?.snapshots]);

  const cacheChartData = useMemo(() =>
    (metrics?.snapshots ?? []).map(s => ({
      time:  fmtHHMM(s.captured_at),
      ratio: Number(s.cache_hit_ratio),
    })), [metrics?.snapshots]);

  const peakConn   = useMemo(() => Math.max(0, ...(metrics?.snapshots ?? []).map(s => s.active_connections)), [metrics?.snapshots]);
  const peakMB     = useMemo(() => Math.max(0, ...(metrics?.snapshots ?? []).map(s => s.db_size_bytes / (1024 * 1024))), [metrics?.snapshots]);
  const lowestCache = useMemo(() => {
    const vals = (metrics?.snapshots ?? []).map(s => Number(s.cache_hit_ratio));
    return vals.length ? Math.min(...vals) : null;
  }, [metrics?.snapshots]);

  const maxTableSize = useMemo(() =>
    Math.max(1, ...(metrics?.table_sizes ?? []).map(t => t.size_bytes)), [metrics?.table_sizes]);

  const cur = metrics?.current;
  const storagePct = cur ? (cur.db_size_bytes / SUPABASE_FREE_DB_LIMIT) * 100 : 0;
  const snapCount  = (metrics?.snapshots ?? []).length;
  const hasHistory = snapCount > 1;

  const CHART_HEIGHT = 180;
  const tickStyle  = { fill: 'rgb(100,116,139)', fontSize: 11 };
  const gridStroke = 'rgba(51,65,85,0.5)';

  if (loading) {
    const colors = useThemeColors();
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color={colors.primary} />
        <Text className="text-typography-muted mt-4 font-bold text-sm">Loading infrastructure metrics...</Text>
      </View>
    );
  }

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 32, paddingBottom: 48 }}>

      {/* Info banner + refresh */}
      <View className="flex-row items-center justify-between mb-6">
        <View className="flex-1 flex-row items-center gap-2 bg-surface-card border border-surface-border rounded-2xl px-4 py-3 mr-4">
          <FontAwesome name="info-circle" size={12} className="text-brand-primary/60" />
          <Text className="text-typography-muted text-xs flex-1">
            Database-level metrics via PostgreSQL. Direct CPU/RAM require server-side infrastructure access.
          </Text>
        </View>
        <TouchableOpacity
          onPress={refetch}
          className="flex-row items-center gap-2 bg-surface-card border border-surface-border px-4 py-3 rounded-2xl hover:bg-surface-overlay transition-colors"
        >
          <FontAwesome name="refresh" size={11} className="text-typography-muted" />
          <Text className="text-typography-dim text-xs">{secsAgo}s ago</Text>
        </TouchableOpacity>
      </View>

      {/* Stat cards */}
      <View className="flex-row gap-4 mb-6">
        <InfraStatCard
          label="Storage"
          value={cur?.db_size_pretty ?? '—'}
          sub={`of 500 MB free tier · ${cur?.total_tables ?? 0} tables`}
          icon="database"
          pct={storagePct}
          pctColor={infraStorageColor(storagePct)}
        />
        <InfraStatCard
          label="Cache Hit Rate"
          value={cur ? `${cur.cache_hit_ratio}%` : '—'}
          sub="data served from memory"
          icon="bolt"
          pct={cur?.cache_hit_ratio ?? 0}
          pctColor={infraCacheColor(cur?.cache_hit_ratio ?? 0)}
        />
        <InfraStatCard
          label="Active Connections"
          value={cur ? `${cur.active_connections} / ${cur.max_connections}` : '—'}
          sub={cur ? `${cur.connection_pct}% of pool used` : 'pool capacity'}
          icon="plug"
          pct={cur?.connection_pct ?? 0}
          pctColor={infraConnColor(cur?.connection_pct ?? 0)}
        />
        <InfraStatCard
          label="Query Rate"
          value={cur ? `${cur.tps}` : '—'}
          sub="transactions / sec"
          icon="exchange"
        />
      </View>

      {/* Charts row 1 */}
      <View className="flex-row gap-4 mb-6">

        {/* Storage timeline */}
        <View className="flex-1 bg-surface-card rounded-2xl border border-surface-border p-6">
          <View className="flex-row items-start justify-between mb-5">
            <View>
              <Text className="text-typography-main font-black text-base">Storage Usage</Text>
              <Text className="text-typography-muted text-xs mt-0.5">Database size over time · MB</Text>
            </View>
            {peakMB > 0 && (
              <View className="bg-surface-overlay px-3 py-1.5 rounded-xl">
                <Text className="text-typography-dim text-[10px]">Peak <Text className="text-typography-main font-black">{peakMB.toFixed(1)} MB</Text></Text>
              </View>
            )}
          </View>
          {!hasHistory ? (
            <View className="items-center py-10 gap-1">
              <Text className="text-typography-main font-bold text-sm">
                {snapCount === 0 ? 'Capturing first snapshot…' : 'First snapshot captured'}
              </Text>
              <Text className="text-typography-dim text-xs">
                {snapCount === 0 ? 'Refresh in a moment' : 'Trend charts appear after the next reading — auto-refreshes in ~5 min'}
              </Text>
            </View>
          ) : (
            <View style={{ height: CHART_HEIGHT }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={storageChartData} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="infraStorageGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="rgb(99,102,241)" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="rgb(99,102,241)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                  <XAxis dataKey="time" tick={tickStyle} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={tickStyle} axisLine={false} tickLine={false} tickFormatter={v => `${v}`} unit=" MB" />
                  <Tooltip content={<InfraChartTooltip formatter={(v: number) => `${v.toFixed(2)} MB`} />} />
                  <Area type="monotone" dataKey="mb" stroke="rgb(99,102,241)" fill="url(#infraStorageGrad)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </View>
          )}
        </View>

        {/* Connection load */}
        <View className="flex-1 bg-surface-card rounded-2xl border border-surface-border p-6">
          <View className="flex-row items-start justify-between mb-5">
            <View>
              <Text className="text-typography-main font-black text-base">Connection Load</Text>
              <Text className="text-typography-muted text-xs mt-0.5">Active connections over time</Text>
            </View>
            {peakConn > 0 && (
              <View className="bg-surface-overlay px-3 py-1.5 rounded-xl">
                <Text className="text-typography-dim text-[10px]">Peak <Text className="text-typography-main font-black">{peakConn}</Text></Text>
              </View>
            )}
          </View>
          {!hasHistory ? (
            <View className="items-center py-10 gap-1">
              <Text className="text-typography-main font-bold text-sm">
                {snapCount === 0 ? 'Capturing first snapshot…' : 'First snapshot captured'}
              </Text>
              <Text className="text-typography-dim text-xs">
                {snapCount === 0 ? 'Refresh in a moment' : 'Trend charts appear after the next reading — auto-refreshes in ~5 min'}
              </Text>
            </View>
          ) : (
            <View style={{ height: CHART_HEIGHT }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={connChartData} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="infraConnGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="rgb(251,191,36)" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="rgb(251,191,36)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                  <XAxis dataKey="time" tick={tickStyle} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={tickStyle} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip content={<InfraChartTooltip formatter={(v: number) => `${v} connections`} />} />
                  <ReferenceLine y={cur?.max_connections} stroke="rgba(239,68,68,0.3)" strokeDasharray="4 4" />
                  <Area type="monotone" dataKey="connections" stroke="rgb(251,191,36)" fill="url(#infraConnGrad)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </View>
          )}
        </View>

      </View>

      {/* Charts row 2 */}
      <View className="flex-row gap-4">

        {/* Table sizes */}
        <View className="flex-1 bg-surface-card rounded-2xl border border-surface-border p-6">
          <Text className="text-typography-main font-black text-base mb-1">Table Sizes</Text>
          <Text className="text-typography-muted text-xs mb-5">Top tables by total size (data + indexes)</Text>
          {(metrics?.table_sizes ?? []).length === 0 ? (
            <Text className="text-typography-dim text-sm text-center py-8">No table data</Text>
          ) : (
            (metrics?.table_sizes ?? []).slice(0, 10).map((t, i) => (
              <View key={t.name} className="mb-4">
                <View className="flex-row items-center justify-between mb-1.5">
                  <View className="flex-row items-center gap-2 flex-1 mr-3">
                    <Text className="text-typography-dim text-[10px] w-4">{i + 1}</Text>
                    <Text className="text-typography-main font-bold text-sm flex-1" numberOfLines={1}>{t.name}</Text>
                  </View>
                  <Text className="text-typography-muted text-xs font-bold">{t.size_pretty}</Text>
                </View>
                <View className="flex-row items-center gap-2">
                  <View className="w-4" />
                  <HBar value={t.size_bytes} max={maxTableSize} tint="primary" />
                </View>
              </View>
            ))
          )}
        </View>

        {/* Cache hit rate history */}
        <View className="flex-1 bg-surface-card rounded-2xl border border-surface-border p-6">
          <View className="flex-row items-start justify-between mb-5">
            <View>
              <Text className="text-typography-main font-black text-base">Cache Efficiency</Text>
              <Text className="text-typography-muted text-xs mt-0.5">Buffer cache hit rate — higher is better</Text>
            </View>
            {lowestCache !== null && (
              <View className="bg-surface-overlay px-3 py-1.5 rounded-xl">
                <Text className="text-typography-dim text-[10px]">Low <Text className="text-typography-main font-black">{Number(lowestCache).toFixed(1)}%</Text></Text>
              </View>
            )}
          </View>
          {!hasHistory ? (
            <View className="items-center py-10 gap-1">
              <Text className="text-typography-main font-bold text-sm">
                {snapCount === 0 ? 'Capturing first snapshot…' : 'First snapshot captured'}
              </Text>
              <Text className="text-typography-dim text-xs">
                {snapCount === 0 ? 'Refresh in a moment' : 'Trend charts appear after the next reading — auto-refreshes in ~5 min'}
              </Text>
            </View>
          ) : (
            <View style={{ height: CHART_HEIGHT }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={cacheChartData} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="infraCacheGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="rgb(34,197,94)" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="rgb(34,197,94)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                  <XAxis dataKey="time" tick={tickStyle} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={tickStyle} axisLine={false} tickLine={false} domain={[0, 100]} tickFormatter={v => `${v}%`} />
                  <Tooltip content={<InfraChartTooltip formatter={(v: number) => `${v.toFixed(1)}% cache hit`} />} />
                  <ReferenceLine y={95} stroke="rgba(34,197,94,0.3)" strokeDasharray="4 4" />
                  <Area type="monotone" dataKey="ratio" stroke="rgb(34,197,94)" fill="url(#infraCacheGrad)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </View>
          )}
        </View>

      </View>
    </ScrollView>
  );
}

// ── Sidebar ────────────────────────────────────────────────────────────────

const NAV_ITEMS: { id: Section; label: string; icon: string }[] = [
  { id: 'command', label: 'Command',        icon: 'tachometer' },
  { id: 'tenants', label: 'Tenants',        icon: 'building' },
  { id: 'users',   label: 'Users',          icon: 'users' },
  { id: 'signals', label: 'Signals',        icon: 'line-chart' },
  { id: 'live',    label: 'Live',           icon: 'circle' },
  { id: 'infra',   label: 'Infrastructure', icon: 'server' },
];

function Sidebar({ section, setSection, liveCount }: {
  section: Section; setSection: (s: Section) => void; liveCount: number;
}) {
  return (
    <View className="bg-surface-card border-r border-surface-border" style={{ width: 240 }}>
      {/* Logo */}
      <View className="px-6 pt-8 pb-6 border-b border-surface-border">
        <View className="flex-row items-center gap-2 mb-1">
          <FontAwesome name="shield" size={12} className="text-brand-accent" />
          <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest">TrustFlow</Text>
        </View>
        <Text className="text-typography-main font-black text-xl tracking-tight">Control Plane</Text>
      </View>

      {/* Nav */}
      <View className="px-3 pt-4 gap-1">
        {NAV_ITEMS.map(item => {
          const isActive = section === item.id;
          const showDot = item.id === 'live' && liveCount > 0;
          return (
            <TouchableOpacity
              key={item.id}
              onPress={() => setSection(item.id)}
              className={`flex-row items-center gap-3 px-4 py-3 rounded-xl transition-colors ${
                isActive ? 'bg-brand-primary-dim border border-brand-primary/30' : 'border border-transparent hover:bg-surface-overlay'
              }`}
            >
              <FontAwesome
                name={item.icon as any}
                size={16}
                className={isActive ? 'text-brand-accent' : 'text-brand-accent/40'}
              />
              <Text className={`flex-1 font-bold text-sm ${isActive ? 'text-brand-primary' : 'text-typography-muted'}`}>
                {item.label}
              </Text>
              {showDot && (
                <View className={`w-2 h-2 rounded-full ${isActive ? 'bg-brand-primary' : 'bg-state-success'}`} />
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Live indicator */}
      {liveCount > 0 && (
        <View className="mx-3 mt-4 bg-state-success/10 rounded-xl px-4 py-3 flex-row items-center gap-2">
          <View className="w-2 h-2 bg-state-success rounded-full" />
          <Text className="text-state-success text-xs font-black">{liveCount} live now</Text>
        </View>
      )}
    </View>
  );
}

// ── Root ───────────────────────────────────────────────────────────────────

export default function PlatformAdminWebScreen() {
  const colors = useThemeColors();
  const {
    user, initialized, isOwner,
    section, setSection,
    companies, liveCount, loading, fetchCompanies,
    totalUsers, totalTasks, totalMins,
  } = useControlPlaneData();

  if (!initialized) {
    return (
      <View className="flex-1 bg-surface-background items-center justify-center">
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!isOwner) {
    return (
      <View className="flex-1 bg-surface-background items-center justify-center">
        <Text className="text-typography-dim text-sm">404</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 flex-row bg-surface-background">
      <Stack.Screen options={{ headerShown: false }} />

      <Sidebar section={section} setSection={setSection} liveCount={liveCount} />

      <View className="flex-1">
        {/* Top bar */}
        <View className="bg-surface-card border-b border-surface-border px-8 py-4 flex-row items-center justify-between">
          <Text className="text-typography-main font-black text-lg tracking-tight capitalize">{section}</Text>
          <View className="flex-row items-center gap-2 bg-surface-overlay border border-surface-border rounded-xl px-3 py-1.5">
            <View className={`w-1.5 h-1.5 rounded-full ${liveCount > 0 ? 'bg-state-success' : 'bg-surface-border'}`} />
            <Text className="text-typography-muted text-[10px] font-bold">
              {liveCount > 0 ? `${liveCount} live` : 'All quiet'}
            </Text>
          </View>
        </View>

        {/* Section content */}
        <View className="flex-1">
          {section === 'command' && (
            <CommandSection
              companies={companies}
              liveCount={liveCount}
              loading={loading}
              totalUsers={totalUsers}
              totalTasks={totalTasks}
              totalMins={totalMins}
            />
          )}
          {section === 'tenants' && (
            <TenantsSection companies={companies} loading={loading} onCompanyDeleted={fetchCompanies} />
          )}
          {section === 'users' && (
            <UsersSection companies={companies} onUserDeleted={fetchCompanies} />
          )}
          {section === 'signals' && <SignalsSection />}
          {section === 'live'    && <LiveSection />}
          {section === 'infra'   && <InfraSection />}
        </View>
      </View>
    </View>
  );
}
