import {
  deleteCompany,
  deleteUser,
  deriveAlerts,
  extendRetention,
  fmtBytes,
  fmtDay,
  fmtHHMM,
  fmtMins,
  fmtNumber,
  healthLabel,
  moveUser,
  timeAgo,
  updateUser,
  useCompanyDetail,
  useCompanyRetention,
  useControlPlaneData,
  useInfraData,
  useLiveSessions,
  useTimeline,
  useUsersData,
  useWaitlistList,
  useWaitlistOverview,
  useWaitlistTimeline,
  workspaceAge,
  type AlertSeverity,
  type CompanyOverview,
  type PlatformAlert,
  type PlatformUser,
  type RetentionData,
  type Section,
  type SignalMetric,
  type SortKey
} from '@/components/platform-admin/useControlPlaneData';
import Calendar from '@/components/common/Calendar';
import AppTooltip from '@/components/common/Tooltip';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator, Modal, Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { cssInterop } from 'react-native-css-interop';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis, YAxis,
} from 'recharts';

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
  const barColor = tint === 'success' ? colors.success : tint === 'warning' ? colors.warning : colors.primary;
  return (
    <View className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: colors.border }}>
      <View className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: barColor }} />
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
  const { data: retention, loading: retLoading, reload: reloadRetention } = useCompanyRetention(companyId);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [showPostpone, setShowPostpone] = React.useState(false);
  const [extending, setExtending] = React.useState(false);

  React.useEffect(() => {
    if (!companyId) { setConfirmDelete(false); setShowPostpone(false); }
  }, [companyId]);

  const handleDelete = async () => {
    if (!companyId) return;
    setDeleting(true);
    const { error } = await deleteCompany(companyId);
    setDeleting(false);
    if (!error) onDeleted();
  };

  const handleExtend = async (addDays: number) => {
    if (!companyId || !retention) return;
    setExtending(true);
    await extendRetention(companyId, retention.inactivity_days + addDays);
    setExtending(false);
    setShowPostpone(false);
    reloadRetention(companyId);
  };

  const handleCancelPurge = async () => {
    if (!companyId) return;
    setExtending(true);
    await extendRetention(companyId, 3650);
    setExtending(false);
    reloadRetention(companyId);
  };

  if (!companyId) return null;

  const maxMins = detail?.members ? Math.max(1, ...detail.members.map(m => m.session_minutes_week)) : 1;

  return (
    <Modal visible={!!companyId} transparent animationType="fade">
      <Pressable className="flex-1 bg-black/60" onPress={onClose}>
        <Pressable
          className="absolute right-0 top-0 bottom-0"
          style={{ width: 440, backgroundColor: colors.background, borderLeftWidth: 1, borderColor: colors.border }}
          onPress={e => e.stopPropagation()}
        >
          {/* Header */}
          <View className="px-8 pt-8 pb-5 flex-row items-start justify-between" style={{ borderBottomWidth: 1, borderColor: colors.border }}>
            <View className="flex-1 mr-4">
              {loading || !detail ? (
                <View className="h-7 w-48 rounded-lg" style={{ backgroundColor: colors.border + '40' }} />
              ) : (
                <>
                  <Text className="font-black text-2xl tracking-tight" style={{ color: colors.textMain }}>{detail.company.name}</Text>
                  <Text className="text-xs mt-1" style={{ color: colors.textMuted }}>Workspace · {workspaceAge(detail.company.created_at)} old</Text>
                </>
              )}
            </View>
            <AppTooltip label="Close">
              <TouchableOpacity onPress={onClose} className="w-9 h-9 rounded-full items-center justify-center" style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
                <FontAwesome name="times" size={13} color={colors.textMuted} />
              </TouchableOpacity>
            </AppTooltip>
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
                  <View
                    key={s.label}
                    className="flex-1 rounded-2xl p-3 border items-center"
                    style={{ backgroundColor: s.accent ? colors.success + '1A' : colors.card, borderColor: s.accent ? colors.success + '33' : colors.border }}
                  >
                    <Text className="font-black text-lg" style={{ color: s.accent ? colors.success : colors.textMain }}>{s.value}</Text>
                    <Text className="text-[10px] mt-0.5 uppercase tracking-wide" style={{ color: s.accent ? colors.success : colors.textMuted }}>{s.label}</Text>
                  </View>
                ))}
              </View>

              <View className="h-px mx-8" style={{ backgroundColor: colors.border }} />

              {/* Join code */}
              <View className="flex-row items-center px-8 py-4 gap-3">
                <FontAwesome name="key" size={11} color={colors.textMuted} />
                <Text className="text-xs" style={{ color: colors.textMuted }}>Join code</Text>
                <Text className="font-black text-xs tracking-widest ml-1 px-2 py-0.5 rounded-lg" style={{ color: colors.textMain, backgroundColor: colors.border + '40' }}>{detail.company.join_code}</Text>
              </View>

              <View className="h-px mx-8" style={{ backgroundColor: colors.border }} />

              {/* Members */}
              <View className="px-8 pt-5">
                <View className="flex-row items-center justify-between mb-4">
                  <Text className="text-[10px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>Members · {detail.members?.length ?? 0}</Text>
                  <Text className="text-[10px]" style={{ color: colors.textDim }}>this week</Text>
                </View>
                {detail.members?.length === 0 && (
                  <Text className="text-sm text-center py-6" style={{ color: colors.textDim }}>No members yet</Text>
                )}
                {detail.members?.map(m => (
                  <View key={m.id} className="mb-5">
                    <View className="flex-row items-center justify-between mb-1.5">
                      <View className="flex-row items-center gap-2 flex-1 mr-3">
                        {m.is_active && <View className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: colors.success }} />}
                        <Text className="font-bold text-sm flex-1" style={{ color: colors.textMain }} numberOfLines={1}>{m.name}</Text>
                      </View>
                      <Text className="text-xs" style={{ color: colors.textMuted }}>{fmtMins(m.session_minutes_week)}</Text>
                    </View>
                    {m.job_title && (
                      <Text className="text-[10px] mb-1.5 ml-3.5" style={{ color: colors.textDim }}>{m.job_title}{m.department ? ` · ${m.department}` : ''}</Text>
                    )}
                    <HBar value={m.session_minutes_week} max={maxMins} />
                  </View>
                ))}
              </View>

              {/* Retention */}
              <View className="h-px mx-8 mt-2" style={{ backgroundColor: colors.border }} />
              <View className="px-8 py-5">
                <View className="flex-row items-center justify-between mb-4">
                  <Text className="text-[10px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>Retention Policy</Text>
                  {retLoading && <ActivityIndicator size="small" color={colors.primary} />}
                </View>

                {retention ? (() => {
                  const statusColor =
                    retention.status === 'overdue' ? colors.danger :
                    retention.status === 'warning' ? colors.warning :
                    colors.success;
                  const statusLabel =
                    retention.status === 'overdue' ? 'Overdue' :
                    retention.status === 'warning' ? 'Warning' : 'Active';
                  const fmtDate = (iso: string | null) => {
                    if (!iso) return 'Never';
                    const d = new Date(iso);
                    return isNaN(d.getTime()) ? 'Never' : d.toLocaleDateString();
                  };

                  return (
                    <View>
                      {/* Status + countdown */}
                      <View className="rounded-2xl p-4 mb-3" style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
                        <View className="flex-row items-center justify-between mb-3">
                          <View style={{ backgroundColor: `${statusColor}1A`, borderColor: `${statusColor}55` }} className="px-2.5 py-1 rounded-full border">
                            <Text style={{ color: statusColor }} className="text-[10px] font-black uppercase tracking-widest">{statusLabel}</Text>
                          </View>
                          <Text className="text-[10px]" style={{ color: colors.textDim }}>Threshold: {retention.inactivity_days}d</Text>
                        </View>
                        <View className="flex-row gap-4">
                          <View className="flex-1">
                            <Text className="text-[10px] font-bold uppercase tracking-widest" style={{ color: colors.textMuted }}>Days inactive</Text>
                            <Text style={{ color: statusColor }} className="text-2xl font-black mt-0.5">{retention.days_inactive}</Text>
                          </View>
                          <View className="flex-1">
                            <Text className="text-[10px] font-bold uppercase tracking-widest" style={{ color: colors.textMuted }}>Days until purge</Text>
                            <Text className="text-2xl font-black mt-0.5" style={{ color: colors.textMain }}>{retention.days_until_purge}</Text>
                          </View>
                        </View>
                        <Text className="text-[10px] mt-3" style={{ color: colors.textDim }}>Last active: {fmtDate(retention.last_active_at)}</Text>
                        <View className="h-px mt-3 mb-3" style={{ backgroundColor: colors.border }} />
                        <View className="flex-row gap-4">
                          <View className="flex-1">
                            <Text className="text-[10px] font-bold uppercase tracking-widest" style={{ color: colors.textMuted }}>File storage</Text>
                            <Text className="font-black text-sm mt-0.5" style={{ color: colors.textMain }}>{fmtBytes(retention.file_size_bytes)}</Text>
                          </View>
                          <View className="flex-1">
                            <Text className="text-[10px] font-bold uppercase tracking-widest" style={{ color: colors.textMuted }}>DB (est.)</Text>
                            <Text className="font-black text-sm mt-0.5" style={{ color: colors.textMain }}>{fmtBytes(retention.db_size_bytes)}</Text>
                          </View>
                        </View>
                      </View>

                      {/* Data at risk */}
                      <View className="rounded-2xl p-4 mb-3" style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
                        <Text className="text-[10px] font-black uppercase tracking-widest mb-3" style={{ color: colors.textMuted }}>Data at risk if deleted</Text>
                        <View className="flex-row flex-wrap">
                          {[
                            { icon: 'tasks',    label: 'Tasks',   value: fmtNumber(detail!.stats.total_tasks) },
                            { icon: 'users',    label: 'Members', value: fmtNumber(detail!.members?.length ?? 0) },
                            { icon: 'file-o',  label: 'Files',   value: fmtNumber(retention.file_count) },
                            { icon: 'clock-o', label: 'Logged',  value: fmtMins(retention.session_minutes) },
                          ].map(r => (
                            <View key={r.label} style={{ width: '50%' }} className="flex-row items-center gap-2 py-1.5">
                              <FontAwesome name={r.icon as any} size={11} color={colors.textMuted} style={{ width: 14 }} />
                              <Text className="font-black text-sm" style={{ color: colors.textMain }}>{r.value}</Text>
                              <Text className="text-[10px]" style={{ color: colors.textDim }}>{r.label}</Text>
                            </View>
                          ))}
                        </View>
                      </View>

                      {/* Actions */}
                      {extending ? (
                        <View className="flex-row items-center gap-2 py-2">
                          <ActivityIndicator size="small" color={colors.primary} />
                          <Text className="text-xs" style={{ color: colors.textMuted }}>Updating policy…</Text>
                        </View>
                      ) : showPostpone ? (
                        <View>
                          <Text className="text-[10px] font-black uppercase tracking-widest mb-2" style={{ color: colors.textMuted }}>Extend threshold by</Text>
                          <View className="flex-row gap-2 flex-wrap">
                            {[30, 60, 90, 180].map(d => (
                              <TouchableOpacity
                                key={d}
                                onPress={() => handleExtend(d)}
                                className="px-4 py-2 rounded-xl hover:bg-brand-primary/20 transition-colors"
                                style={{ borderWidth: 1, borderColor: colors.primary + '66', backgroundColor: colors.primary + '1A' }}
                              >
                                <Text className="text-xs font-black" style={{ color: colors.primary }}>+{d}d</Text>
                              </TouchableOpacity>
                            ))}
                            <TouchableOpacity
                              onPress={() => setShowPostpone(false)}
                              className="px-4 py-2 rounded-xl hover:bg-surface-overlay transition-colors"
                              style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}
                            >
                              <Text className="text-xs font-bold" style={{ color: colors.textMuted }}>Cancel</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      ) : (
                        <View className="flex-row gap-2">
                          <TouchableOpacity
                            onPress={() => setShowPostpone(true)}
                            className="flex-row items-center gap-2 px-4 py-2 rounded-xl hover:bg-brand-primary/10 transition-colors"
                            style={{ borderWidth: 1, borderColor: colors.primary + '4D', backgroundColor: colors.primary + '0D' }}
                          >
                            <FontAwesome name="clock-o" size={11} color={colors.primary} />
                            <Text className="text-xs font-bold" style={{ color: colors.primary }}>Postpone</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={handleCancelPurge}
                            className="flex-row items-center gap-2 px-4 py-2 rounded-xl hover:bg-surface-overlay transition-colors"
                            style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}
                          >
                            <FontAwesome name="ban" size={11} color={colors.textMuted} />
                            <Text className="text-xs font-bold" style={{ color: colors.textMuted }}>Cancel Purge</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  );
                })() : !retLoading ? (
                  <Text className="text-xs" style={{ color: colors.textDim }}>No retention data available.</Text>
                ) : null}
              </View>

              {/* Danger Zone */}
              <View className="h-px mx-8 mt-2" style={{ backgroundColor: colors.border }} />
              <View className="px-8 py-6">
                {!confirmDelete ? (
                  <TouchableOpacity
                    onPress={() => setConfirmDelete(true)}
                    className="flex-row items-center gap-2 self-start px-4 py-2 rounded-xl hover:bg-state-danger/10 transition-colors"
                    style={{ borderWidth: 1, borderColor: colors.danger + '4D', backgroundColor: colors.danger + '0D' }}
                  >
                    <FontAwesome name="trash" size={11} color={colors.danger} />
                    <Text className="text-xs font-bold" style={{ color: colors.danger }}>Delete Workspace</Text>
                  </TouchableOpacity>
                ) : (
                  <View className="rounded-2xl p-4 gap-3" style={{ borderWidth: 1, borderColor: colors.danger + '4D', backgroundColor: colors.danger + '0D' }}>
                    <View className="flex-row items-center gap-2">
                      <FontAwesome name="exclamation-triangle" size={12} color={colors.danger} />
                      <Text className="text-xs font-black" style={{ color: colors.danger }}>This cannot be undone</Text>
                    </View>
                    <Text className="text-xs leading-5" style={{ color: colors.textMuted }}>
                      Deleting <Text className="font-bold" style={{ color: colors.textMain }}>{detail.company.name}</Text> will permanently remove all members, tasks, pipelines, sessions, and data. There is no recovery.
                    </Text>
                    <View className="flex-row gap-2 mt-1">
                      <TouchableOpacity
                        onPress={() => setConfirmDelete(false)}
                        disabled={deleting}
                        className="flex-1 items-center py-2 rounded-xl hover:bg-surface-overlay transition-colors"
                        style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}
                      >
                        <Text className="text-xs font-bold" style={{ color: colors.textMuted }}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={handleDelete}
                        disabled={deleting}
                        className="flex-1 items-center py-2 rounded-xl hover:opacity-80 transition-opacity"
                        style={{ backgroundColor: colors.danger }}
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
  const colors = useThemeColors();

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
        <AppTooltip label="Refresh live sessions">
          <TouchableOpacity
            onPress={fetchSessions}
            className="flex-row items-center gap-2 bg-surface-card border border-surface-border px-4 py-2 rounded-xl hover:bg-surface-overlay transition-colors"
          >
            <FontAwesome name="refresh" size={11} className="text-typography-muted" />
            <Text className="text-typography-dim text-xs">{secsAgo}s ago</Text>
          </TouchableOpacity>
        </AppTooltip>
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
      <Text className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: colors.textMuted }}>{label}</Text>
      <View className="rounded-xl px-3 py-2" style={{ backgroundColor: colors.border + '40', borderWidth: 1, borderColor: colors.border }}>
        {/* @ts-ignore — web-only input */}
        <input
          value={value}
          onChange={(e: any) => onChange(e.target.value)}
          style={{ background: 'transparent', border: 'none', color: colors.textMain, fontSize: 13, fontWeight: '600', width: '100%' } as any}
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
  const colors = useThemeColors();

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
          className="absolute right-0 top-0 bottom-0"
          style={{ width: 480, backgroundColor: colors.background, borderLeftWidth: 1, borderColor: colors.border }}
          onPress={e => e.stopPropagation()}
        >
          {/* Header */}
          <View className="px-8 pt-8 pb-5 flex-row items-center gap-4" style={{ borderBottomWidth: 1, borderColor: colors.border }}>
            <UserAvatar user={user} size={48} />
            <View className="flex-1">
              <Text className="font-black text-xl tracking-tight" style={{ color: colors.textMain }} numberOfLines={1}>
                {user.display_name || user.full_name || 'Unnamed User'}
              </Text>
              <Text className="text-xs mt-0.5" style={{ color: colors.textMuted }} numberOfLines={1}>{user.email}</Text>
            </View>
            <View className="flex-row items-center gap-2">
              {!editing ? (
                <TouchableOpacity
                  onPress={() => setEditing(true)}
                  className="flex-row items-center gap-2 px-3 py-2 rounded-xl hover:bg-surface-overlay transition-colors"
                  style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}
                >
                  <FontAwesome name="pencil" size={11} color={colors.textMuted} />
                  <Text className="text-xs font-bold" style={{ color: colors.textMuted }}>Edit</Text>
                </TouchableOpacity>
              ) : (
                <View className="flex-row gap-2">
                  <TouchableOpacity
                    onPress={() => setEditing(false)}
                    disabled={saving}
                    className="px-3 py-2 rounded-xl hover:bg-surface-overlay transition-colors"
                    style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}
                  >
                    <Text className="text-xs font-bold" style={{ color: colors.textMuted }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleSave}
                    disabled={saving}
                    className="flex-row items-center gap-2 px-3 py-2 rounded-xl hover:opacity-80 transition-opacity"
                    style={{ backgroundColor: colors.primary }}
                  >
                    {saving
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Text className="text-white text-xs font-black">Save</Text>
                    }
                  </TouchableOpacity>
                </View>
              )}
              <AppTooltip label="Close">
                <TouchableOpacity
                  onPress={onClose}
                  className="w-9 h-9 rounded-full items-center justify-center"
                  style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}
                >
                  <FontAwesome name="times" size={13} color={colors.textMuted} />
                </TouchableOpacity>
              </AppTooltip>
            </View>
          </View>

          <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
            {/* Status badges */}
            <View className="flex-row items-center gap-2 px-8 pt-5 pb-3">
              <View className="px-2.5 py-1 rounded-full" style={{ backgroundColor: user.is_active ? colors.success + '1A' : colors.danger + '1A' }}>
                <Text className="text-[10px] font-black uppercase tracking-wide" style={{ color: user.is_active ? colors.success : colors.danger }}>
                  {user.is_active ? 'Active' : 'Inactive'}
                </Text>
              </View>
              {user.is_owner && (
                <View className="px-2.5 py-1 rounded-full border" style={{ backgroundColor: colors.primary + '1A', borderColor: colors.primary + '33' }}>
                  <Text className="text-[10px] font-black uppercase tracking-wide" style={{ color: colors.primary }}>Owner</Text>
                </View>
              )}
              {user.work_status && !editing && (
                <View className="px-2.5 py-1 rounded-full" style={{ backgroundColor: colors.border + '40' }}>
                  <Text className="text-[10px] font-bold capitalize" style={{ color: colors.textMuted }}>{user.work_status.replace(/_/g, ' ')}</Text>
                </View>
              )}
            </View>

            <View className="h-px mx-8" style={{ backgroundColor: colors.border }} />

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
                    <Text className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: colors.textMuted }}>Work Status</Text>
                    <View className="flex-row flex-wrap gap-2">
                      {WORK_STATUSES.map(s => (
                        <TouchableOpacity
                          key={s}
                          onPress={() => setForm(f => ({ ...f, work_status: s }))}
                          className={`px-3 py-1.5 rounded-xl border transition-colors ${form.work_status === s ? '' : 'hover:bg-surface-overlay'}`}
                          style={{ backgroundColor: form.work_status === s ? colors.primary : colors.card, borderColor: form.work_status === s ? colors.primary : colors.border }}
                        >
                          <Text className="text-[11px] font-bold capitalize" style={{ color: form.work_status === s ? '#fff' : colors.textMuted }}>
                            {s.replace(/_/g, ' ')}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  <View className="mb-4">
                    <Text className="text-[10px] font-black uppercase tracking-widest mb-2" style={{ color: colors.textMuted }}>Account Status</Text>
                    <TouchableOpacity
                      onPress={() => setForm(f => ({ ...f, is_active: !f.is_active }))}
                      className="flex-row items-center gap-3 px-4 py-3 rounded-xl border transition-colors"
                      style={{
                        backgroundColor: form.is_active ? colors.success + '1A' : colors.danger + '1A',
                        borderColor: form.is_active ? colors.success + '33' : colors.danger + '33',
                      }}
                    >
                      <View className="w-4 h-4 rounded-full border-2 items-center justify-center" style={{ borderColor: form.is_active ? colors.success : colors.danger, backgroundColor: form.is_active ? colors.success : colors.danger }}>
                        {form.is_active && <FontAwesome name="check" size={8} color="#fff" />}
                      </View>
                      <Text className="text-xs font-bold" style={{ color: form.is_active ? colors.success : colors.danger }}>
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
                        <FontAwesome name={row.icon as any} size={11} color={colors.accent} style={{ width: 14, opacity: 0.4 }} />
                        <Text className="text-sm w-24" style={{ color: colors.textMuted }}>{row.label}</Text>
                        <Text className="font-bold text-sm flex-1" style={{ color: colors.textMain }} numberOfLines={1}>{row.value}</Text>
                      </View>
                      {idx < arr.length - 1 && <View className="h-px" style={{ backgroundColor: colors.border }} />}
                    </View>
                  ))}
                </>
              )}
            </View>

            {!editing && (
              <>
                <View className="h-px mx-8 mt-2" style={{ backgroundColor: colors.border }} />

                {/* Move to workspace */}
                <View className="px-8 py-5">
                  <Text className="text-[10px] font-black uppercase tracking-widest mb-3" style={{ color: colors.textMuted }}>Move to Workspace</Text>
                  {moving ? (
                    <View className="flex-row items-center gap-2 py-2">
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text className="text-xs" style={{ color: colors.textMuted }}>Moving user...</Text>
                    </View>
                  ) : showMoveDropdown ? (
                    <View className="rounded-2xl overflow-hidden" style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
                      <View className="px-4 py-3 flex-row items-center justify-between" style={{ borderBottomWidth: 1, borderColor: colors.border }}>
                        <Text className="font-bold text-xs" style={{ color: colors.textMain }}>Select destination workspace</Text>
                        <TouchableOpacity onPress={() => setShowMoveDropdown(false)}>
                          <FontAwesome name="times" size={11} color={colors.textMuted} />
                        </TouchableOpacity>
                      </View>
                      <ScrollView style={{ maxHeight: 200 }}>
                        {otherCompanies.length === 0 && (
                          <Text className="text-xs text-center py-4" style={{ color: colors.textDim }}>No other workspaces available</Text>
                        )}
                        {otherCompanies.map(c => (
                          <TouchableOpacity
                            key={c.id}
                            onPress={() => handleMove(c.id)}
                            className="flex-row items-center justify-between px-4 py-3 hover:bg-surface-overlay transition-colors"
                            style={{ borderBottomWidth: 1, borderColor: colors.border }}
                          >
                            <View>
                              <Text className="font-bold text-sm" style={{ color: colors.textMain }}>{c.name}</Text>
                              <Text className="text-[10px]" style={{ color: colors.textDim }}>{c.user_count} members</Text>
                            </View>
                            <FontAwesome name="chevron-right" size={9} color={colors.textDim} />
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  ) : (
                    <TouchableOpacity
                      onPress={() => setShowMoveDropdown(true)}
                      className="flex-row items-center gap-2 self-start px-4 py-2 rounded-xl hover:bg-surface-overlay transition-colors"
                      style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}
                    >
                      <FontAwesome name="exchange" size={11} color={colors.textMuted} />
                      <Text className="text-xs font-bold" style={{ color: colors.textMuted }}>Change Workspace</Text>
                    </TouchableOpacity>
                  )}
                </View>

                <View className="h-px mx-8" style={{ backgroundColor: colors.border }} />

                {/* Danger zone */}
                <View className="px-8 py-6">
                  {!confirmDelete ? (
                    <TouchableOpacity
                      onPress={() => setConfirmDelete(true)}
                      className="flex-row items-center gap-2 self-start px-4 py-2 rounded-xl hover:bg-state-danger/10 transition-colors"
                      style={{ borderWidth: 1, borderColor: colors.danger + '4D', backgroundColor: colors.danger + '0D' }}
                    >
                      <FontAwesome name="trash" size={11} color={colors.danger} />
                      <Text className="text-xs font-bold" style={{ color: colors.danger }}>Delete User</Text>
                    </TouchableOpacity>
                  ) : (
                    <View className="rounded-2xl p-4 gap-3" style={{ borderWidth: 1, borderColor: colors.danger + '4D', backgroundColor: colors.danger + '0D' }}>
                      <View className="flex-row items-center gap-2">
                        <FontAwesome name="exclamation-triangle" size={12} color={colors.danger} />
                        <Text className="text-xs font-black" style={{ color: colors.danger }}>This cannot be undone</Text>
                      </View>
                      <Text className="text-xs leading-5" style={{ color: colors.textMuted }}>
                        Deleting <Text className="font-bold" style={{ color: colors.textMain }}>{user.display_name || user.full_name || user.email}</Text> will permanently remove their account, all tasks, sessions, and data.
                      </Text>
                      <View className="flex-row gap-2 mt-1">
                        <TouchableOpacity
                          onPress={() => setConfirmDelete(false)}
                          disabled={deleting}
                          className="flex-1 items-center py-2 rounded-xl hover:bg-surface-overlay transition-colors"
                          style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}
                        >
                          <Text className="text-xs font-bold" style={{ color: colors.textMuted }}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={handleDelete}
                          disabled={deleting}
                          className="flex-1 items-center py-2 rounded-xl hover:opacity-80 transition-opacity"
                          style={{ backgroundColor: colors.danger }}
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
              style={{ background: 'transparent', border: 'none', color: 'inherit', fontSize: 13, flex: 1, fontWeight: '500' } as any}
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

// ── Alerts Section ─────────────────────────────────────────────────────────

const ALERT_CONFIG: Record<AlertSeverity, { icon: string; color: string; bgClass: string; borderClass: string; tagClass: string }> = {
  critical: { icon: 'exclamation-triangle', color: 'text-state-danger', bgClass: 'bg-state-danger/5', borderClass: 'border-state-danger/30', tagClass: 'bg-state-danger/10 text-state-danger' },
  warning:  { icon: 'exclamation',         color: 'text-state-warning', bgClass: 'bg-state-warning/5', borderClass: 'border-state-warning/30', tagClass: 'bg-state-warning/10 text-state-warning' },
  info:     { icon: 'info-circle',          color: 'text-brand-primary', bgClass: 'bg-brand-primary-dim', borderClass: 'border-brand-primary/20', tagClass: 'bg-brand-primary/10 text-brand-primary' },
};

function AlertCard({ alert, onViewCompany }: { alert: PlatformAlert; onViewCompany: (id: string) => void }) {
  const cfg = ALERT_CONFIG[alert.severity];
  return (
    <View className={`rounded-2xl border p-5 mb-3 ${cfg.bgClass} ${cfg.borderClass}`}>
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-row items-start gap-3 flex-1">
          <FontAwesome name={cfg.icon as any} size={13} className={cfg.color} style={{ marginTop: 1 }} />
          <View className="flex-1">
            <Text className={`text-sm font-black mb-1 ${cfg.color}`}>{alert.title}</Text>
            <Text className="text-typography-muted text-xs leading-5">{alert.body}</Text>
          </View>
        </View>
        <View className="flex-row items-center gap-2 shrink-0">
          {alert.tag && (
            <View className={`px-2.5 py-1 rounded-full ${cfg.tagClass}`}>
              <Text className="text-[10px] font-black">{alert.tag}</Text>
            </View>
          )}
          {alert.companyId && (
            <TouchableOpacity
              onPress={() => onViewCompany(alert.companyId!)}
              className="flex-row items-center gap-1.5 px-3 py-1.5 bg-surface-card border border-surface-border rounded-xl hover:bg-surface-overlay transition-colors"
            >
              <Text className="text-typography-muted text-[11px] font-bold">View</Text>
              <FontAwesome name="chevron-right" size={8} className="text-typography-dim" />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

function AlertsSection({
  companies, totalMins, onCompanyDeleted,
}: {
  companies: CompanyOverview[];
  totalMins: number;
  onCompanyDeleted: () => void;
}) {
  const colors = useThemeColors();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const alerts = useMemo(() => deriveAlerts(companies), [companies]);
  const criticalCount = alerts.filter(a => a.severity === 'critical').length;
  const warningCount  = alerts.filter(a => a.severity === 'warning').length;

  const sortedByUsage = useMemo(
    () => [...companies].sort((a, b) => b.session_minutes_week - a.session_minutes_week),
    [companies]
  );
  const maxMins   = Math.max(1, ...sortedByUsage.map(c => c.session_minutes_week));
  const maxTasks  = Math.max(1, ...sortedByUsage.map(c => c.task_count));
  const maxUsers  = Math.max(1, ...sortedByUsage.map(c => c.user_count));

  return (
    <>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 32, paddingBottom: 48 }}>

        {/* Summary pills */}
        <View className="flex-row items-center gap-3 mb-6">
          <View className="flex-row items-center gap-2 bg-state-danger/10 border border-state-danger/20 rounded-2xl px-5 py-3">
            <FontAwesome name="exclamation-triangle" size={12} className="text-state-danger" />
            <Text className="text-state-danger font-black text-sm">{criticalCount}</Text>
            <Text className="text-state-danger/70 text-xs font-bold">critical</Text>
          </View>
          <View className="flex-row items-center gap-2 bg-state-warning/10 border border-state-warning/20 rounded-2xl px-5 py-3">
            <FontAwesome name="exclamation" size={12} className="text-state-warning" />
            <Text className="text-state-warning font-black text-sm">{warningCount}</Text>
            <Text className="text-state-warning/70 text-xs font-bold">warnings</Text>
          </View>
          <View className="flex-row items-center gap-2 bg-surface-card border border-surface-border rounded-2xl px-5 py-3">
            <FontAwesome name="info-circle" size={12} className="text-brand-primary/60" />
            <Text className="text-typography-main font-black text-sm">{alerts.length - criticalCount - warningCount}</Text>
            <Text className="text-typography-muted text-xs font-bold">info</Text>
          </View>
          {alerts.length === 0 && (
            <View className="flex-row items-center gap-2 bg-state-success/10 border border-state-success/20 rounded-2xl px-5 py-3">
              <FontAwesome name="check-circle" size={12} className="text-state-success" />
              <Text className="text-state-success text-xs font-bold">All clear — no alerts</Text>
            </View>
          )}
        </View>

        {/* Alerts list */}
        {alerts.length > 0 && (
          <View className="mb-8">
            <Text className="text-typography-main font-black text-base mb-4">Active Alerts</Text>
            {alerts.map(a => (
              <AlertCard key={a.id} alert={a} onViewCompany={setSelectedId} />
            ))}
          </View>
        )}

        {/* Resource leaderboard */}
        <View className="bg-surface-card rounded-2xl border border-surface-border overflow-hidden">
          <View className="px-6 py-5 border-b border-surface-border">
            <Text className="text-typography-main font-black text-base">Resource Leaderboard</Text>
            <Text className="text-typography-muted text-xs mt-0.5">All workspaces · this week · % of max per metric</Text>
          </View>

          {sortedByUsage.length === 0 ? (
            <View className="items-center py-12">
              <Text className="text-typography-dim text-sm">No tenants yet</Text>
            </View>
          ) : (
            <View style={{ height: 260, paddingTop: 16, paddingBottom: 8, paddingRight: 16 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={sortedByUsage.map(co => ({
                    name: co.name.length > 14 ? co.name.slice(0, 13) + '…' : co.name,
                    usage: maxMins > 0 ? Math.round((co.session_minutes_week / maxMins) * 100) : 0,
                    tasks: maxTasks > 0 ? Math.round((co.task_count / maxTasks) * 100) : 0,
                    users: maxUsers > 0 ? Math.round((co.user_count / maxUsers) * 100) : 0,
                    _id: co.id,
                    _mins: co.session_minutes_week,
                    _tasks: co.task_count,
                    _users: co.user_count,
                  }))}
                  barCategoryGap="30%"
                  barGap={2}
                  onClick={(d: any) => d?.activePayload?.[0]?.payload?._id && setSelectedId(d.activePayload[0].payload._id)}
                  style={{ cursor: 'pointer' }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}%`} width={34} />
                  <Tooltip
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                    content={({ active, payload }: any) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      return (
                        <View className="bg-surface-overlay border border-surface-border rounded-xl px-3 py-2 gap-1">
                          <Text className="text-typography-main font-black text-xs mb-1">{d.name}</Text>
                          <Text className="text-typography-dim text-[10px]">Usage: <Text className="text-brand-primary font-bold">{fmtMins(d._mins)}</Text></Text>
                          <Text className="text-typography-dim text-[10px]">Tasks: <Text style={{ color: 'rgb(251,191,36)' }} className="font-bold">{fmtNumber(d._tasks)}</Text></Text>
                          <Text className="text-typography-dim text-[10px]">Users: <Text className="text-state-success font-bold">{fmtNumber(d._users)}</Text></Text>
                        </View>
                      );
                    }}
                  />
                  <Bar dataKey="usage" name="Usage" fill="rgb(99,102,241)" radius={[3, 3, 0, 0]} maxBarSize={20} />
                  <Bar dataKey="tasks" name="Tasks" fill="rgb(251,191,36)" radius={[3, 3, 0, 0]} maxBarSize={20} />
                  <Bar dataKey="users" name="Users" fill="rgb(34,197,94)" radius={[3, 3, 0, 0]} maxBarSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </View>
          )}
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

// ── Trial Codes Section ────────────────────────────────────────────────────

const TRIAL_PLANS = ['free', 'pro', 'business', 'enterprise'];

// Each preset is { label, hours }
const TRIAL_DURATION_PRESETS = [
  { label: '1h',   hours: 1   },
  { label: '6h',   hours: 6   },
  { label: '1d',   hours: 24  },
  { label: '3d',   hours: 72  },
  { label: '1wk',  hours: 168 },
  { label: '1mo',  hours: 720 },
  { label: '3mo',  hours: 2160 },
  { label: '6mo',  hours: 4320 },
  { label: '12mo', hours: 8760 },
];

function fmtDurationHours(h: number): string {
  if (h < 24)   return `${h}h`;
  if (h < 168)  return `${Math.round(h / 24)}d`;
  if (h < 720)  return `${Math.round(h / 168)}wk`;
  const mo = Math.round(h / 720);
  return `${mo}mo`;
}

function TrialCodesSection() {
  const colors = useThemeColors();
  const [codes, setCodes] = React.useState<any[]>([]);
  const [loadingCodes, setLoadingCodes] = React.useState(true);
  const [generating, setGenerating] = React.useState(false);
  const [revoking, setRevoking] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState<string | null>(null);
  const [generated, setGenerated] = React.useState<string | null>(null);
  const [showExpiryCalendar, setShowExpiryCalendar] = React.useState(false);
  const [form, setForm] = React.useState({
    plan_code: 'pro', duration_hours: 720, max_redemptions: 1, expires_at: '', notes: '',
  });

  const load = React.useCallback(async () => {
    setLoadingCodes(true);
    const { data } = await supabase.rpc('rpc_list_trial_codes');
    setCodes((data as any[]) ?? []);
    setLoadingCodes(false);
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const handleGenerate = async () => {
    setGenerating(true);
    setGenerated(null);
    try {
      const { data, error } = await supabase.rpc('rpc_generate_trial_code', {
        p_plan_code: form.plan_code,
        p_duration_hours: form.duration_hours,
        p_max_redemptions: form.max_redemptions,
        p_expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
        p_notes: form.notes || null,
      });
      if (error) throw error;
      setGenerated((data as any)?.code ?? null);
      await load();
    } catch (e: any) {
      alert(e?.message || 'Failed to generate code.');
    } finally {
      setGenerating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setRevoking(id);
    await supabase.rpc('rpc_revoke_trial_code', { p_id: id });
    setRevoking(null);
    await load();
  };

  const handleCopy = (code: string) => {
    (navigator as any).clipboard?.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 32, paddingBottom: 48 }}>
      {/* Generate form */}
      <View className="bg-surface-card rounded-2xl border border-surface-border p-6 mb-6">
        <Text className="text-typography-main font-black text-base mb-1">Generate Trial Code</Text>
        <Text className="text-typography-muted text-xs mb-5">Creates a unique code that unlocks a timed plan trial for any workspace.</Text>

        <View className="flex-row gap-6 mb-4 flex-wrap">
          {/* Plan picker */}
          <View>
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Plan</Text>
            <View className="flex-row gap-2">
              {TRIAL_PLANS.map(p => (
                <TouchableOpacity
                  key={p}
                  onPress={() => setForm(f => ({ ...f, plan_code: p }))}
                  className={`px-3 py-1.5 rounded-xl border transition-colors ${form.plan_code === p ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border hover:bg-surface-overlay'}`}
                >
                  <Text className={`text-xs font-bold capitalize ${form.plan_code === p ? 'text-white' : 'text-typography-muted'}`}>{p}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Duration picker */}
          <View>
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Duration</Text>
            <View className="flex-row flex-wrap gap-2">
              {TRIAL_DURATION_PRESETS.map(p => (
                <TouchableOpacity
                  key={p.hours}
                  onPress={() => setForm(f => ({ ...f, duration_hours: p.hours }))}
                  className={`px-3 py-1.5 rounded-xl border transition-colors ${form.duration_hours === p.hours ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border hover:bg-surface-overlay'}`}
                >
                  <Text className={`text-xs font-bold ${form.duration_hours === p.hours ? 'text-white' : 'text-typography-muted'}`}>{p.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        <View className="flex-row gap-4 mb-5">
          {/* Max uses */}
          <View style={{ width: 120 }}>
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Max Uses</Text>
            <View className="bg-surface-background border border-surface-border rounded-xl px-3 py-2">
              {/* @ts-ignore */}
              <input
                type="number"
                value={form.max_redemptions}
                min={1}
                onChange={(e: any) => setForm(f => ({ ...f, max_redemptions: Math.max(1, parseInt(e.target.value) || 1) }))}
                style={{ background: 'transparent', border: 'none', color: 'inherit', fontSize: 13, fontWeight: '600', width: '100%' } as any}
              />
            </View>
          </View>

          {/* Expiry — premium calendar */}
          <View style={{ width: 220 }}>
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Code Expires</Text>
            <View style={{ position: 'relative' as any }}>
              <TouchableOpacity
                onPress={() => setShowExpiryCalendar(v => !v)}
                className={`flex-row items-center gap-2 bg-surface-background border rounded-xl px-3 py-2.5 transition-colors ${showExpiryCalendar ? 'border-brand-primary' : 'border-surface-border hover:border-brand-primary/50'}`}
              >
                <FontAwesome name="calendar" size={11} className={form.expires_at ? 'text-brand-primary' : 'text-typography-muted'} />
                <Text className={`text-sm flex-1 ${form.expires_at ? 'text-typography-main font-bold' : 'text-typography-dim'}`}>
                  {form.expires_at
                    ? new Date(form.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    : 'No expiry'}
                </Text>
                {form.expires_at ? (
                  <TouchableOpacity onPress={(e: any) => { e.stopPropagation(); setForm(f => ({ ...f, expires_at: '' })); setShowExpiryCalendar(false); }}>
                    <FontAwesome name="times-circle" size={11} className="text-typography-dim" />
                  </TouchableOpacity>
                ) : (
                  <FontAwesome name="chevron-down" size={9} className="text-typography-dim" />
                )}
              </TouchableOpacity>
              {showExpiryCalendar && (
                <Calendar
                  scale="compact"
                  selectedDate={form.expires_at || null}
                  onSelect={date => {
                    setForm(f => ({ ...f, expires_at: date }));
                    setShowExpiryCalendar(false);
                  }}
                  floatingStyle={{ position: 'absolute' as any, top: '110%', left: 0, zIndex: 200, width: 320 }}
                />
              )}
            </View>
          </View>

          {/* Notes */}
          <View className="flex-1">
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Notes (optional)</Text>
            <View className="bg-surface-background border border-surface-border rounded-xl px-3 py-2">
              {/* @ts-ignore */}
              <input
                value={form.notes}
                onChange={(e: any) => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="e.g. for Acme Inc demo"
                style={{ background: 'transparent', border: 'none', color: 'inherit', fontSize: 13, fontWeight: '500', width: '100%' } as any}
              />
            </View>
          </View>
        </View>

        <View className="flex-row items-center gap-4 flex-wrap">
          <TouchableOpacity
            onPress={handleGenerate}
            disabled={generating}
            className="flex-row items-center gap-2 bg-brand-primary px-5 py-3 rounded-xl hover:opacity-80 transition-opacity"
          >
            {generating
              ? <ActivityIndicator size="small" color="#fff" />
              : <FontAwesome name="ticket" size={12} className="text-white" />
            }
            <Text className="text-white font-black text-xs uppercase tracking-widest">
              {generating ? 'Generating…' : 'Generate Code'}
            </Text>
          </TouchableOpacity>

          {generated && (
            <View className="flex-row items-center gap-3 bg-state-success/10 border border-state-success/30 rounded-xl px-4 py-2.5">
              <FontAwesome name="check" size={11} className="text-state-success" />
              <Text className="text-state-success font-black text-sm tracking-widest">{generated}</Text>
              <TouchableOpacity onPress={() => handleCopy(generated)}>
                <FontAwesome
                  name={copied === generated ? 'check-circle' : 'copy'}
                  size={12}
                  className={copied === generated ? 'text-state-success' : 'text-typography-muted'}
                />
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>

      {/* Codes table */}
      <View className="bg-surface-card rounded-2xl border border-surface-border overflow-hidden">
        <View className="px-6 py-4 border-b border-surface-border flex-row items-center justify-between">
          <Text className="text-typography-main font-black text-base">All Codes · {codes.length}</Text>
          <TouchableOpacity
            onPress={load}
            className="flex-row items-center gap-2 px-3 py-1.5 rounded-xl border border-surface-border bg-surface-background hover:bg-surface-overlay transition-colors"
          >
            <FontAwesome name="refresh" size={10} className="text-typography-muted" />
            <Text className="text-typography-muted text-[11px] font-bold">Refresh</Text>
          </TouchableOpacity>
        </View>

        {loadingCodes ? (
          <View className="items-center py-12">
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : codes.length === 0 ? (
          <View className="items-center py-12 gap-2">
            <FontAwesome name="ticket" size={28} className="text-typography-dim" />
            <Text className="text-typography-dim text-sm mt-1">No codes yet — generate one above</Text>
          </View>
        ) : (
          <>
            {/* Header */}
            <View className="flex-row items-center px-6 py-2 border-b border-surface-border bg-surface-background">
              {(['Code', 'Plan', 'Duration', 'Redeemed', 'Expires', 'Notes', ''] as const).map((h, i) => (
                <Text
                  key={i}
                  className="text-typography-muted text-[9px] font-black uppercase tracking-widest"
                  style={{ flex: [3, 1.5, 1, 1.5, 2, 2, 1.5][i] }}
                >
                  {h}
                </Text>
              ))}
            </View>

            {codes.map((c, idx) => {
              const isRevoked = c.expires_at && new Date(c.expires_at) <= new Date();
              return (
                <View
                  key={c.id}
                  className={`flex-row items-center px-6 py-4 ${idx < codes.length - 1 ? 'border-b border-surface-border' : ''}`}
                  style={{ opacity: isRevoked ? 0.45 : 1 }}
                >
                  {/* Code + copy */}
                  <View className="flex-row items-center gap-2" style={{ flex: 3 }}>
                    <Text className="text-typography-main font-black text-xs tracking-widest">{c.code}</Text>
                    <TouchableOpacity onPress={() => handleCopy(c.code)}>
                      <FontAwesome
                        name={copied === c.code ? 'check-circle' : 'copy'}
                        size={10}
                        className={copied === c.code ? 'text-state-success' : 'text-typography-dim'}
                      />
                    </TouchableOpacity>
                  </View>
                  {/* Plan */}
                  <Text className="text-typography-muted text-xs capitalize font-bold" style={{ flex: 1.5 }}>{c.plan_code}</Text>
                  {/* Duration */}
                  <Text className="text-typography-muted text-xs" style={{ flex: 1 }}>{fmtDurationHours(c.duration_hours)}</Text>
                  {/* Redemptions */}
                  <Text className="text-typography-muted text-xs" style={{ flex: 1.5 }}>
                    {c.redeemed_count}{c.max_redemptions != null ? ` / ${c.max_redemptions}` : ' / ∞'}
                  </Text>
                  {/* Expires */}
                  <Text
                    className={`text-xs ${isRevoked ? 'text-state-danger' : 'text-typography-muted'}`}
                    style={{ flex: 2 }}
                  >
                    {c.expires_at ? new Date(c.expires_at).toLocaleDateString() : '—'}
                  </Text>
                  {/* Notes */}
                  <Text className="text-typography-dim text-xs" style={{ flex: 2 }} numberOfLines={1}>
                    {c.notes || '—'}
                  </Text>
                  {/* Actions */}
                  <View style={{ flex: 1.5 }}>
                    {isRevoked ? (
                      <View className="self-start px-2.5 py-1 rounded-lg bg-surface-border">
                        <Text className="text-typography-dim text-[10px]">Revoked</Text>
                      </View>
                    ) : (
                      <TouchableOpacity
                        onPress={() => handleRevoke(c.id)}
                        disabled={revoking === c.id}
                        className="self-start px-2.5 py-1.5 rounded-lg border border-state-danger/30 bg-state-danger/5 hover:bg-state-danger/10 transition-colors"
                      >
                        {revoking === c.id
                          ? <ActivityIndicator size="small" color={colors.primary} />
                          : <Text className="text-state-danger text-[10px] font-bold">Revoke</Text>
                        }
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}
          </>
        )}
      </View>
    </ScrollView>
  );
}

// ── Plan Control Section (#58) ──────────────────────────────────────────────
// Admin-editable plan definitions. billing_plans already backs member/pipeline/
// file-size enforcement server-side (see rpc_check_plan_limit); this is just
// the first UI to edit that table instead of hand-writing SQL migrations.
// No payment gateway wired up — price is a display number only.

type PlanLimits = {
  max_members: number | null;
  max_pipelines: number | null;
  max_file_bytes: number | null;
  max_storage_bytes: number | null;
  analytics_max_days: number | null;
  analytics_throughput: boolean;
  analytics_funnel: boolean;
  analytics_personnel: boolean;
  analytics_personnel_export: boolean;
  analytics_reports: boolean;
  features: string[];
};

type PlanRow = {
  code: string;
  name: string;
  description: string;
  price_cents: number;
  currency: string;
  interval: string;
  per_seat: boolean;
  sort_order: number;
  is_active: boolean;
  features: string[];
  limits: PlanLimits;
};

// number field that shows "" for null (= unlimited); parses back to null on save
function useNumField(initial: number | null) {
  const [text, setText] = React.useState(initial == null ? '' : String(initial));
  const value = () => (text.trim() === '' ? null : Number(text));
  return { text, setText, value };
}

function PlanNumField({ label, text, onChangeText, placeholder = 'Unlimited' }: {
  label: string; text: string; onChangeText: (v: string) => void; placeholder?: string;
}) {
  return (
    <View className="flex-1 min-w-[130px]">
      <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-1.5">{label}</Text>
      <TextInput
        value={text}
        onChangeText={v => onChangeText(v.replace(/[^0-9]/g, ''))}
        placeholder={placeholder}
        placeholderTextColor="rgb(148,163,184)"
        keyboardType="number-pad"
        className="bg-surface-background border border-surface-border rounded-xl px-3 py-2.5 text-typography-main text-sm font-bold"
      />
    </View>
  );
}

function PlanToggleField({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <TouchableOpacity
      onPress={() => onChange(!value)}
      className={`px-3 py-2 rounded-xl border flex-row items-center gap-2 ${value ? 'bg-brand-primary/10 border-brand-primary' : 'bg-surface-background border-surface-border'}`}
    >
      <View className={`w-3.5 h-3.5 rounded-full items-center justify-center ${value ? 'bg-brand-primary' : 'bg-surface-border'}`}>
        {value && <FontAwesome name="check" size={8} color="white" />}
      </View>
      <Text className={`text-[10px] font-bold ${value ? 'text-brand-primary' : 'text-typography-muted'}`}>{label}</Text>
    </TouchableOpacity>
  );
}

function PlanCard({ plan, onSaved }: { plan: PlanRow; onSaved: () => void }) {
  const colors = useThemeColors();
  const [name, setName] = React.useState(plan.name);
  const [description, setDescription] = React.useState(plan.description ?? '');
  const [priceText, setPriceText] = React.useState((plan.price_cents / 100).toFixed(2));
  const [perSeat, setPerSeat] = React.useState(plan.per_seat);
  const [sortOrderText, setSortOrderText] = React.useState(String(plan.sort_order));
  const [isActive, setIsActive] = React.useState(plan.is_active);
  const [featuresText, setFeaturesText] = React.useState(plan.features.join('\n'));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  const maxMembers   = useNumField(plan.limits.max_members);
  const maxPipelines = useNumField(plan.limits.max_pipelines);
  const maxFileMB    = useNumField(plan.limits.max_file_bytes == null ? null : Math.round(plan.limits.max_file_bytes / 1048576));
  const maxStorageGB = useNumField(plan.limits.max_storage_bytes == null ? null : Math.round(plan.limits.max_storage_bytes / 1073741824));
  const maxDays      = useNumField(plan.limits.analytics_max_days);

  const [throughput, setThroughput]           = React.useState(plan.limits.analytics_throughput);
  const [funnel, setFunnel]                   = React.useState(plan.limits.analytics_funnel);
  const [personnel, setPersonnel]             = React.useState(plan.limits.analytics_personnel);
  const [personnelExport, setPersonnelExport] = React.useState(plan.limits.analytics_personnel_export);
  const [reports, setReports]                 = React.useState(plan.limits.analytics_reports);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const priceCents = Math.round(parseFloat(priceText || '0') * 100);
      if (isNaN(priceCents) || priceCents < 0) throw new Error('Invalid price.');

      const { error: rpcError } = await supabase.rpc('rpc_platform_upsert_billing_plan', {
        p_code: plan.code,
        p_name: name.trim(),
        p_description: description.trim(),
        p_price_cents: priceCents,
        p_currency: plan.currency,
        p_interval: plan.interval,
        p_per_seat: perSeat,
        p_sort_order: parseInt(sortOrderText || '0', 10) || 0,
        p_is_active: isActive,
        p_features: featuresText.split('\n').map(f => f.trim()).filter(Boolean),
        p_limits: {
          features: plan.limits.features ?? [],
          max_members: maxMembers.value(),
          max_pipelines: maxPipelines.value(),
          max_file_bytes: maxFileMB.value() == null ? null : maxFileMB.value()! * 1048576,
          max_storage_bytes: maxStorageGB.value() == null ? null : maxStorageGB.value()! * 1073741824,
          analytics_max_days: maxDays.value(),
          analytics_throughput: throughput,
          analytics_funnel: funnel,
          analytics_personnel: personnel,
          analytics_personnel_export: personnelExport,
          analytics_reports: reports,
        },
      });
      if (rpcError) throw rpcError;
      setSaved(true);
      onSaved();
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      setError(e?.message || 'Failed to save plan.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View className="bg-surface-card rounded-2xl border border-surface-border p-6 mb-5" style={{ opacity: isActive ? 1 : 0.6 }}>
      {/* Header row */}
      <View className="flex-row items-center justify-between mb-4">
        <View className="flex-row items-center gap-3">
          <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest">{plan.code}</Text>
          {!isActive && (
            <View className="px-2 py-0.5 rounded-md bg-state-danger/10 border border-state-danger/30">
              <Text className="text-state-danger text-[9px] font-black uppercase">Inactive</Text>
            </View>
          )}
        </View>
        <PlanToggleField label={isActive ? 'Active' : 'Retired'} value={isActive} onChange={setIsActive} />
      </View>

      {/* Name / description */}
      <View className="flex-row gap-4 mb-4 flex-wrap">
        <View className="flex-1 min-w-[160px]">
          <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-1.5">Name</Text>
          <TextInput value={name} onChangeText={setName} className="bg-surface-background border border-surface-border rounded-xl px-3 py-2.5 text-typography-main text-sm font-bold" />
        </View>
        <View style={{ flex: 2 }} className="min-w-[220px]">
          <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-1.5">Description</Text>
          <TextInput value={description} onChangeText={setDescription} className="bg-surface-background border border-surface-border rounded-xl px-3 py-2.5 text-typography-main text-sm" />
        </View>
      </View>

      {/* Price / per-seat / sort order */}
      <View className="flex-row gap-4 mb-4 flex-wrap items-end">
        <View className="min-w-[130px]">
          <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-1.5">Price / {plan.interval} ({plan.currency.toUpperCase()})</Text>
          <TextInput
            value={priceText}
            onChangeText={v => setPriceText(v.replace(/[^0-9.]/g, ''))}
            keyboardType="decimal-pad"
            className="bg-surface-background border border-surface-border rounded-xl px-3 py-2.5 text-typography-main text-sm font-bold"
          />
        </View>
        <PlanToggleField label="Per seat" value={perSeat} onChange={setPerSeat} />
        <View className="w-24">
          <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-1.5">Sort</Text>
          <TextInput
            value={sortOrderText}
            onChangeText={v => setSortOrderText(v.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            className="bg-surface-background border border-surface-border rounded-xl px-3 py-2.5 text-typography-main text-sm font-bold text-center"
          />
        </View>
      </View>

      {/* Resource limits */}
      <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-2">Resource Limits</Text>
      <View className="flex-row gap-4 mb-4 flex-wrap">
        <PlanNumField label="Max Members"        text={maxMembers.text}   onChangeText={maxMembers.setText} />
        <PlanNumField label="Max Pipelines"       text={maxPipelines.text} onChangeText={maxPipelines.setText} />
        <PlanNumField label="Max File Size (MB)"  text={maxFileMB.text}    onChangeText={maxFileMB.setText} />
        <PlanNumField label="Max Storage (GB)"    text={maxStorageGB.text} onChangeText={maxStorageGB.setText} />
      </View>

      {/* Analytics gating */}
      <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-2">Analytics Features</Text>
      <View className="flex-row gap-4 mb-2 flex-wrap items-end">
        <PlanNumField label="History (days)" text={maxDays.text} onChangeText={maxDays.setText} />
      </View>
      <View className="flex-row gap-2 mb-4 flex-wrap">
        <PlanToggleField label="Throughput"       value={throughput}      onChange={setThroughput} />
        <PlanToggleField label="Funnel"           value={funnel}          onChange={setFunnel} />
        <PlanToggleField label="Personnel"        value={personnel}       onChange={setPersonnel} />
        <PlanToggleField label="Personnel Export" value={personnelExport} onChange={setPersonnelExport} />
        <PlanToggleField label="Reports"          value={reports}         onChange={setReports} />
      </View>

      {/* Display features (marketing copy shown in BillingPanel) */}
      <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-1.5">Display Features (one per line)</Text>
      <TextInput
        value={featuresText}
        onChangeText={setFeaturesText}
        multiline
        numberOfLines={4}
        textAlignVertical="top"
        className="bg-surface-background border border-surface-border rounded-xl px-3 py-2.5 text-typography-main text-xs mb-4"
        style={{ minHeight: 90 }}
      />

      {error && (
        <View className="bg-state-danger/10 border border-state-danger/30 rounded-xl px-3 py-2 mb-3">
          <Text className="text-state-danger text-xs font-bold">{error}</Text>
        </View>
      )}

      <TouchableOpacity
        onPress={handleSave}
        disabled={saving}
        className={`self-start px-5 py-2.5 rounded-xl flex-row items-center gap-2 ${saved ? 'bg-state-success' : 'bg-brand-primary'}`}
      >
        {saving ? (
          <ActivityIndicator size="small" color="white" />
        ) : (
          <>
            <FontAwesome name={saved ? 'check' : 'floppy-o'} size={12} color="white" />
            <Text className="text-white text-xs font-black uppercase tracking-widest">{saved ? 'Saved' : 'Save Plan'}</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

function PlanControlSection() {
  const colors = useThemeColors();
  const [plans, setPlans] = React.useState<PlanRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase.rpc('rpc_platform_list_billing_plans');
    if (error) setLoadError(error.message);
    else setPlans((data as PlanRow[]) ?? []);
    setLoading(false);
  }, []);

  React.useEffect(() => { load(); }, [load]);

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 32, paddingBottom: 48 }}>
      <Text className="text-typography-main font-black text-lg mb-1">Plan Control</Text>
      <Text className="text-typography-muted text-xs mb-6">
        Edit pricing, resource limits, and analytics feature gating per plan. No payment gateway is connected —
        price is a display number only, same as the company billing panel.
      </Text>

      {loading ? (
        <View className="py-16 items-center"><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : loadError ? (
        <View className="bg-state-danger/10 border border-state-danger/30 rounded-xl px-4 py-3">
          <Text className="text-state-danger text-sm font-bold">{loadError}</Text>
        </View>
      ) : (
        plans.map(p => <PlanCard key={p.code} plan={p} onSaved={load} />)
      )}
    </ScrollView>
  );
}

// ── Waitlist Section ───────────────────────────────────────────────────────

function WaitlistSection() {
  const colors = useThemeColors();
  const { overview, loading: overviewLoading } = useWaitlistOverview();
  const { days, setDays, timeline, fetching } = useWaitlistTimeline(30);
  const { query, setQuery, signups, loading: listLoading } = useWaitlistList();

  const chartData = useMemo(
    () => [...timeline].reverse().map(e => ({ day: fmtDay(e.day), signups: e.signups })),
    [timeline]
  );
  const spark = useMemo(() => [...timeline].reverse().map(e => e.signups), [timeline]);

  if (overviewLoading || !overview) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color={colors.primary} />
        <Text className="text-typography-muted mt-4 font-bold text-sm">Fetching waitlist data...</Text>
      </View>
    );
  }

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 32, paddingBottom: 48 }}>
      {/* Stat cards */}
      <View className="flex-row gap-4 mb-6">
        <StatCard label="Total Signups" value={fmtNumber(overview.total)} icon="user-plus" sub="all time" sparkData={spark} accent />
        <StatCard label="Today" value={fmtNumber(overview.today)} icon="calendar" sub="new signups" />
        <StatCard label="This Week" value={fmtNumber(overview.this_week)} icon="line-chart" sub="new signups" sparkData={spark} />
        <StatCard label="Via Referral" value={fmtNumber(overview.referred)} icon="share-alt" sub={overview.total > 0 ? `${Math.round((overview.referred / overview.total) * 100)}% of total` : 'no signups yet'} />
      </View>

      {/* Timeline chart */}
      <View className="bg-surface-card rounded-2xl border border-surface-border p-6 mb-6">
        <View className="flex-row items-center justify-between mb-5">
          <View>
            <Text className="text-typography-main font-black text-lg tracking-tight">Signups Over Time</Text>
            <Text className="text-typography-muted text-xs mt-0.5">last {days} days</Text>
          </View>
          <View className="flex-row items-center gap-2">
            {[7, 14, 30].map(d => (
              <TouchableOpacity
                key={d}
                onPress={() => setDays(d)}
                className={`px-3 py-1.5 rounded-xl border transition-colors ${days === d ? 'bg-brand-primary border-brand-primary' : 'bg-surface-overlay border-surface-border hover:bg-surface-overlay'}`}
              >
                <Text className={`text-xs font-bold ${days === d ? 'text-white' : 'text-typography-muted'}`}>{d}d</Text>
              </TouchableOpacity>
            ))}
            {fetching && <ActivityIndicator size="small" color={colors.primary} />}
          </View>
        </View>
        {chartData.length === 0 ? (
          <View className="items-center py-12">
            <Text className="text-typography-dim text-sm">No data yet</Text>
          </View>
        ) : (
          <View style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="waitlistGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(99,102,241)" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="rgb(99,102,241)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(51,65,85,0.5)" vertical={false} />
                <XAxis dataKey="day" tick={{ fill: 'rgb(100,116,139)', fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fill: 'rgb(100,116,139)', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTooltip metricLabel="Signups" />} />
                <Area type="monotone" dataKey="signups" stroke="rgb(99,102,241)" fill="url(#waitlistGrad)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </View>
        )}
      </View>

      <View className="flex-row gap-4 mb-6">
        {/* Top referrers */}
        <View className="flex-1 bg-surface-card rounded-2xl border border-surface-border p-6">
          <Text className="text-typography-main font-black text-base mb-5">Top Referrers</Text>
          {overview.top_referrers.length === 0 ? (
            <Text className="text-typography-dim text-sm text-center py-8">No referrals yet</Text>
          ) : (
            overview.top_referrers.map((r, i) => (
              <View key={r.referral_code} className="flex-row items-center justify-between py-2.5">
                <View className="flex-row items-center gap-2 flex-1 mr-2">
                  <Text className="text-typography-dim text-[10px] w-4">{i + 1}</Text>
                  <Text className="text-typography-main font-bold text-sm flex-1" numberOfLines={1}>{r.company_name}</Text>
                </View>
                <Text className="text-typography-muted text-xs font-bold">{r.referred_count} referred</Text>
              </View>
            ))
          )}
        </View>

        {/* Snapshot */}
        <View className="flex-1 bg-surface-card rounded-2xl border border-surface-border p-6">
          <Text className="text-typography-main font-black text-base mb-5">Snapshot</Text>
          {[
            { label: 'Total signups', value: fmtNumber(overview.total), icon: 'user-plus' },
            { label: 'Signed up today', value: fmtNumber(overview.today), icon: 'calendar' },
            { label: 'Signed up this week', value: fmtNumber(overview.this_week), icon: 'line-chart' },
            { label: 'Came via referral', value: fmtNumber(overview.referred), icon: 'share-alt' },
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

      {/* Signup list */}
      <View className="bg-surface-card rounded-2xl border border-surface-border p-6">
        <View className="flex-row items-center justify-between mb-5">
          <Text className="text-typography-main font-black text-base">All Signups · {fmtNumber(overview.total)}</Text>
          {/* @ts-ignore — web-only input */}
          <input
            value={query}
            onChange={(e: any) => setQuery(e.target.value)}
            placeholder="Search email or company..."
            style={{
              background: colors.card, border: `1px solid ${colors.border}`, borderRadius: 10,
              padding: '8px 12px', fontSize: 13, color: colors.textMain, width: 240,
            } as any}
          />
        </View>

        {listLoading ? (
          <View className="items-center py-10"><ActivityIndicator size="small" color={colors.primary} /></View>
        ) : signups.length === 0 ? (
          <Text className="text-typography-dim text-sm text-center py-10">No signups found</Text>
        ) : (
          <View>
            <View className="flex-row items-center px-1 pb-3">
              <Text className="flex-1 text-typography-muted text-[10px] font-black uppercase tracking-widest">Company</Text>
              <Text className="flex-1 text-typography-muted text-[10px] font-black uppercase tracking-widest">Email</Text>
              <Text className="flex-1 text-typography-muted text-[10px] font-black uppercase tracking-widest">Referred by</Text>
              <Text className="w-32 text-typography-muted text-[10px] font-black uppercase tracking-widest text-right">Joined</Text>
            </View>
            {signups.map((s, idx) => (
              <View key={s.id}>
                <View className="flex-row items-center px-1 py-3">
                  <Text className="flex-1 text-typography-main font-bold text-sm" numberOfLines={1}>{s.company_name}</Text>
                  <Text className="flex-1 text-typography-muted text-sm" numberOfLines={1}>{s.email}</Text>
                  <Text className="flex-1 text-typography-dim text-sm" numberOfLines={1}>{s.referred_by_company ?? '—'}</Text>
                  <Text className="w-32 text-typography-dim text-xs text-right">{timeAgo(s.created_at)}</Text>
                </View>
                {idx < signups.length - 1 && <View className="h-px bg-surface-border" />}
              </View>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

// ── Sidebar ────────────────────────────────────────────────────────────────

const NAV_ITEMS: { id: Section; label: string; icon: string }[] = [
  { id: 'command',     label: 'Command',        icon: 'tachometer' },
  { id: 'tenants',     label: 'Tenants',        icon: 'building' },
  { id: 'users',       label: 'Users',          icon: 'users' },
  { id: 'signals',     label: 'Signals',        icon: 'line-chart' },
  { id: 'waitlist',    label: 'Waitlist',       icon: 'user-plus' },
  { id: 'live',        label: 'Live',           icon: 'circle' },
  { id: 'alerts',      label: 'Alerts',         icon: 'bell' },
  { id: 'infra',       label: 'Infrastructure', icon: 'server' },
  { id: 'trial_codes', label: 'Trial Codes',    icon: 'ticket' },
  { id: 'plans',       label: 'Plans',          icon: 'credit-card' },
];

function Sidebar({ section, setSection, liveCount, alertCount }: {
  section: Section; setSection: (s: Section) => void; liveCount: number; alertCount: number;
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
          const showLiveDot = item.id === 'live' && liveCount > 0;
          const showAlertBadge = item.id === 'alerts' && alertCount > 0;
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
              {showLiveDot && (
                <View className={`w-2 h-2 rounded-full ${isActive ? 'bg-brand-primary' : 'bg-state-success'}`} />
              )}
              {showAlertBadge && (
                <View className="bg-state-danger rounded-full min-w-[18px] h-[18px] items-center justify-center px-1">
                  <Text className="text-white text-[9px] font-black">{alertCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Live indicator */}
      {liveCount > 0 && (
        <TouchableOpacity
          onPress={() => setSection('live')}
          className="mx-3 mt-4 bg-state-success/10 rounded-xl px-4 py-3 flex-row items-center gap-2 hover:bg-state-success/20 transition-colors"
        >
          <View className="w-2 h-2 bg-state-success rounded-full" />
          <Text className="text-state-success text-xs font-black">{liveCount} live now</Text>
        </TouchableOpacity>
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

  const alerts = useMemo(() => deriveAlerts(companies), [companies]);
  const alertCount = alerts.filter(a => a.severity === 'critical' || a.severity === 'warning').length;

  if (!initialized || isOwner === null) {
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

      <Sidebar section={section} setSection={setSection} liveCount={liveCount} alertCount={alertCount} />

      <View className="flex-1">
        {/* Top bar */}
        <View className="bg-surface-card border-b border-surface-border px-8 py-4 flex-row items-center justify-between">
          <Text className="text-typography-main font-black text-lg tracking-tight">
            {NAV_ITEMS.find(n => n.id === section)?.label ?? section}
          </Text>
          <View className="flex-row items-center gap-3">
            {alertCount > 0 && section !== 'alerts' && (
              <TouchableOpacity
                onPress={() => setSection('alerts')}
                className="flex-row items-center gap-2 bg-state-danger/10 border border-state-danger/20 rounded-xl px-3 py-1.5 hover:bg-state-danger/20 transition-colors"
              >
                <FontAwesome name="bell" size={10} className="text-state-danger" />
                <Text className="text-state-danger text-[10px] font-black">{alertCount} alert{alertCount !== 1 ? 's' : ''}</Text>
              </TouchableOpacity>
            )}
            <View className="flex-row items-center gap-2 bg-surface-overlay border border-surface-border rounded-xl px-3 py-1.5">
              <View className={`w-1.5 h-1.5 rounded-full ${liveCount > 0 ? 'bg-state-success' : 'bg-surface-border'}`} />
              <Text className="text-typography-muted text-[10px] font-bold">
                {liveCount > 0 ? `${liveCount} live` : 'All quiet'}
              </Text>
            </View>
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
          {section === 'waitlist' && <WaitlistSection />}
          {section === 'live'    && <LiveSection />}
          {section === 'alerts'  && (
            <AlertsSection companies={companies} totalMins={totalMins} onCompanyDeleted={fetchCompanies} />
          )}
          {section === 'infra'        && <InfraSection />}
          {section === 'trial_codes'  && <TrialCodesSection />}
          {section === 'plans'       && <PlanControlSection />}
        </View>
      </View>
    </View>
  );
}
