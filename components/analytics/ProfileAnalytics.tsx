import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ActivityIndicator, ScrollView, TouchableOpacity } from 'react-native';
import { useAnalytics, PerformancePeriod, CompanyHistoryEntry } from '@/contexts/AnalyticsContext';
import { useAuth } from '@/contexts/AuthContext';
import { PerformanceChart } from './PerformanceChart';
import { TimerDeliverabilityChart } from './TimerDeliverabilityChart';
import { PeriodToggle } from './PeriodToggle';
import { useThemeColors } from '@/hooks/useThemeColors';

interface ProfileAnalyticsProps {
  userId: string;
}

function buildConclusion(
  current: PerformancePeriod | undefined,
  onTimeRate: number | null,
  timerEfficiency: number | null,
): { text: string; type: 'success' | 'warning' | 'neutral' } {
  if (!current || (current.completed_tasks === 0 && current.failed_tasks === 0)) {
    return {
      text: 'No activity recorded this period. Complete a task to see performance insights.',
      type: 'neutral',
    };
  }

  const parts: string[] = [];
  const c = current.completed_tasks;
  parts.push(`${c} task${c !== 1 ? 's' : ''} completed`);

  if (onTimeRate !== null) parts.push(`${onTimeRate}% on-time delivery`);

  if (timerEfficiency !== null) {
    if (timerEfficiency < 80) parts.push(`running ${timerEfficiency}% of estimated hours — ahead of schedule`);
    else if (timerEfficiency > 120) parts.push(`at ${timerEfficiency}% of estimated hours — over budget`);
  }

  if (current.revision_count > 0) parts.push(`${current.revision_count} revision${current.revision_count !== 1 ? 's' : ''}`);

  const isBad = current.failed_tasks > 0 || (onTimeRate !== null && onTimeRate < 50);
  const isGood = !isBad && (onTimeRate === null || onTimeRate >= 75) && (current.failed_tasks === 0);

  return {
    text: `${current.weight_points} weight points · ${parts.join(' · ')}.`,
    type: isGood ? 'success' : isBad ? 'warning' : 'neutral',
  };
}

export function ProfileAnalytics({ userId }: ProfileAnalyticsProps) {
  const colors = useThemeColors();
  const { getUserPerformanceSeries, getUserCompanyHistory, invalidate } = useAnalytics();
  const { profile } = useAuth();
  const [period, setPeriod] = useState('month');
  const [companies, setCompanies] = useState<CompanyHistoryEntry[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(profile?.company_id ?? null);
  const [series, setSeries] = useState<PerformancePeriod[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    getUserCompanyHistory(userId).then(data => {
      setCompanies(data ?? []);
    });
  }, [userId]);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const data = await getUserPerformanceSeries(userId, period, 6, selectedCompanyId);
      setSeries(data ?? []);
    } finally {
      setLoading(false);
    }
  }, [userId, period, selectedCompanyId]);

  useEffect(() => { load(); }, [load]);

  const handlePeriodChange = (p: string) => {
    setPeriod(p);
    invalidate(`series:${userId}:${p}`);
  };

  const handleCompanyChange = (id: string | null) => {
    setSelectedCompanyId(id);
    invalidate(`series:${userId}`);
  };

  const current = series.find(r => r.is_current_period) ?? series[0];

  const activeHours   = Math.floor((current?.active_seconds ?? 0) / 3600);
  const activeMinutes = Math.floor(((current?.active_seconds ?? 0) % 3600) / 60);

  const timerEfficiency =
    (current?.estimated_seconds ?? 0) > 0
      ? Math.round((current!.active_seconds / current!.estimated_seconds) * 100)
      : null;

  const totalTasks = (current?.completed_tasks ?? 0) + (current?.failed_tasks ?? 0);
  const onTimeRate = totalTasks > 0
    ? Math.round(((current?.on_time_tasks ?? 0) / totalTasks) * 100)
    : null;

  const chartData = series.map(r => ({
    ...r,
    active_hours: parseFloat((r.active_seconds / 3600).toFixed(1)),
  }));

  if (loading) {
    return (
      <View className="py-12 items-center">
        <ActivityIndicator color={colors.primary} />
        <Text className="text-typography-muted text-xs mt-3">Loading performance data…</Text>
      </View>
    );
  }

  const isAllZero = series.every(
    r => r.weight_points === 0 && r.active_seconds === 0 && r.completed_tasks === 0,
  );
  const conclusion = buildConclusion(current, onTimeRate, timerEfficiency);

  return (
    <View className="gap-6">
      {companies.length > 1 && (
        <View className="gap-2">
          <Text className="text-[9px] font-black uppercase tracking-widest text-typography-dim ml-1">Workspace</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="flex-row gap-2">
            <TouchableOpacity
              onPress={() => handleCompanyChange(null)}
              className={`px-4 py-2 rounded-xl border ${selectedCompanyId === null ? 'bg-brand-primary border-brand-primary' : 'bg-surface-card border-surface-border'}`}
            >
              <Text className={`text-xs font-black uppercase tracking-widest ${selectedCompanyId === null ? 'text-white' : 'text-typography-muted'}`}>
                All
              </Text>
            </TouchableOpacity>
            {companies.map(c => (
              <TouchableOpacity
                key={c.company_id}
                onPress={() => handleCompanyChange(c.company_id)}
                className={`px-4 py-2 rounded-xl border ${selectedCompanyId === c.company_id ? 'bg-brand-primary border-brand-primary' : 'bg-surface-card border-surface-border'}`}
              >
                <Text className={`text-xs font-black uppercase tracking-widest ${selectedCompanyId === c.company_id ? 'text-white' : 'text-typography-muted'}`}>
                  {c.company_name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
      <PeriodToggle value={period} onChange={handlePeriodChange} />

      {isAllZero ? (
        <View className="bg-surface-card border border-surface-border rounded-2xl p-10 items-center gap-3">
          <Text className="text-typography-main font-black text-lg">No Activity Yet</Text>
          <Text className="text-typography-muted text-sm text-center">
            Complete your first task to start seeing performance analytics.
          </Text>
        </View>
      ) : (
        <>
          {chartData.length > 0 && (
            <>
              <PerformanceChart
                data={chartData}
                metricKey="weight_points"
                label="Weight Points per Period"
              />
              <PerformanceChart
                data={chartData}
                metricKey="active_hours"
                label="Active Hours per Period"
              />
              <TimerDeliverabilityChart data={chartData} />
            </>
          )}

          {/* Conclusion card */}
          <View className={`rounded-2xl p-5 border ${
            conclusion.type === 'success' ? 'bg-state-success/5 border-state-success/20' :
            conclusion.type === 'warning'  ? 'bg-state-warning/5 border-state-warning/20' :
            'bg-surface-card border-surface-border'
          }`}>
            <Text className="text-[10px] font-black uppercase tracking-[0.3em] text-typography-dim mb-2">
              Performance Snapshot
            </Text>
            <Text className={`font-bold text-sm leading-relaxed ${
              conclusion.type === 'success' ? 'text-state-success' :
              conclusion.type === 'warning'  ? 'text-state-warning' :
              'text-typography-main'
            }`}>
              {conclusion.text}
            </Text>

            <View className="flex-row gap-3 mt-4 flex-wrap">
              <View className="flex-1 min-w-[80px] bg-surface-overlay rounded-xl p-3">
                <Text className="text-typography-dim text-[9px] font-black uppercase tracking-widest">Active Time</Text>
                <Text className="text-typography-main font-black text-base mt-0.5">{activeHours}h {activeMinutes}m</Text>
              </View>
              <View className="flex-1 min-w-[80px] bg-surface-overlay rounded-xl p-3">
                <Text className="text-typography-dim text-[9px] font-black uppercase tracking-widest">On-Time Rate</Text>
                <Text className="text-typography-main font-black text-base mt-0.5">
                  {onTimeRate !== null ? `${onTimeRate}%` : '—'}
                </Text>
              </View>
              {timerEfficiency !== null && (
                <View className="flex-1 min-w-[80px] bg-surface-overlay rounded-xl p-3">
                  <Text className="text-typography-dim text-[9px] font-black uppercase tracking-widest">Timer Eff.</Text>
                  <Text className="text-typography-main font-black text-base mt-0.5">{timerEfficiency}%</Text>
                </View>
              )}
              <View className="flex-1 min-w-[80px] bg-surface-overlay rounded-xl p-3">
                <Text className="text-typography-dim text-[9px] font-black uppercase tracking-widest">Revisions</Text>
                <Text className="text-typography-main font-black text-base mt-0.5">{current?.revision_count ?? 0}</Text>
              </View>
            </View>
          </View>
        </>
      )}
    </View>
  );
}
