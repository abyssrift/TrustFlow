import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, RefreshControl, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { useAnalytics, PerformancePeriod } from '@/contexts/AnalyticsContext';
import { useAuth } from '@/contexts/AuthContext';
import { PeriodToggle } from '@/components/analytics/PeriodToggle';
import { StatsCard } from '@/components/analytics/StatsCard';
import { EfficiencyIndicator } from '@/components/analytics/EfficiencyIndicator';
import { PerformanceChart } from '@/components/analytics/PerformanceChart';
import { TimerDeliverabilityChart } from '@/components/analytics/TimerDeliverabilityChart';
import { FontAwesome } from '@expo/vector-icons';

export default function PersonalAnalyticsScreen() {
  const { user } = useAuth();
  const { getPersonalPulse, getUserPerformanceSeries, invalidate } = useAnalytics();

  const [period, setPeriod] = useState('month');
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pulse, setPulse]   = useState<any>(null);
  const [series, setSeries] = useState<PerformancePeriod[]>([]);
  const [error, setError]   = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!user?.id) return;
    try {
      setError(null);
      const [p, s] = await Promise.all([
        getPersonalPulse(),
        getUserPerformanceSeries(user.id, period, 12),
      ]);
      setPulse(p);
      setSeries(s ?? []);
    } catch (err: any) {
      console.error('Analytics load failed', err);
      setError('Failed to load analytics. Pull down to retry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id, period]);

  useEffect(() => {
    setLoading(true);
    loadData();
  }, [loadData]);

  const onRefresh = () => {
    setRefreshing(true);
    invalidate(`series:${user?.id}:${period}`);
    invalidate('pulse');
    loadData();
  };

  const handlePeriodChange = (p: string) => {
    setPeriod(p);
    invalidate(`series:${user?.id}:${p}`);
  };

  // Current period = first row (RPC returns newest → oldest)
  const current: PerformancePeriod | undefined =
    series.find(r => r.is_current_period) ?? series[0];

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

  if (error && !loading && !refreshing) {
    return (
      <View className="flex-1 bg-surface-background items-center justify-center p-10">
        <FontAwesome name="exclamation-triangle" size={40} className="text-state-danger mb-4" />
        <Text className="text-typography-main font-black text-center text-xl mb-2">Sync Interrupted</Text>
        <Text className="text-typography-muted text-center mb-8">{error}</Text>
        <TouchableOpacity
          onPress={() => { setLoading(true); loadData(); }}
          className="bg-brand-primary px-8 py-4 rounded-2xl"
        >
          <Text className="text-white font-black uppercase tracking-widest text-xs">Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-surface-background"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View className="p-6" style={{ paddingTop: Platform.OS !== 'web' ? 54 : 24 }}>

        {/* Header */}
        <View className="mb-8">
          <Text className="text-brand-primary font-black uppercase tracking-[0.3em] text-[10px] mb-2">
            Personal Performance
          </Text>
          <Text className="text-typography-main text-3xl font-black tracking-tighter">Your Pulse</Text>
          <Text className="text-typography-muted text-sm mt-1">
            {pulse?.is_working ? '● Working now' : 'Real-time efficiency and output tracking.'}
          </Text>
        </View>

        {/* Period toggle */}
        <View className="mb-8">
          <PeriodToggle value={period} onChange={handlePeriodChange} />
        </View>

        {loading ? (
          <View className="items-center py-16">
            <ActivityIndicator color="var(--color-primary)" />
          </View>
        ) : (
          <>
            {/* Top stats row */}
            <View className="flex-row gap-4 mb-4">
              <StatsCard
                label="Weight Points"
                value={current?.weight_points ?? 0}
                icon="bolt"
                accent
              />
              <StatsCard
                label="Active Time"
                value={`${activeHours}h ${activeMinutes}m`}
                icon="clock-o"
              />
            </View>

            <View className="flex-row gap-4 mb-6">
              <StatsCard
                label="Completed"
                value={current?.completed_tasks ?? 0}
                icon="check-circle"
              />
              <StatsCard
                label="On-Time Rate"
                value={onTimeRate !== null ? `${onTimeRate}%` : '—'}
                icon="flag-checkered"
              />
            </View>

            {/* Timer efficiency */}
            {timerEfficiency !== null && (
              <View className="mb-6">
                <EfficiencyIndicator
                  percentage={timerEfficiency}
                  label="Timer Efficiency"
                  subLabel="Actual time vs estimated — lower is faster"
                />
              </View>
            )}

            {/* Weight points chart */}
            {series.length > 0 && (
              <View className="mb-6">
                <PerformanceChart
                  data={series}
                  metricKey="weight_points"
                  label="Weight Points per Period"
                />
              </View>
            )}

            {/* Timer deliverability chart */}
            {series.length > 0 && (
              <View className="mb-6">
                <TimerDeliverabilityChart data={series} />
              </View>
            )}

            {/* Period breakdown */}
            <View className="bg-surface-card border border-[var(--color-surface-border)] rounded-2xl p-6 mb-10">
              <Text className="text-typography-main font-black text-lg mb-4">Period Breakdown</Text>
              {[
                { label: 'Tasks Completed',  value: current?.completed_tasks ?? 0,  color: 'text-typography-main' },
                { label: 'Tasks Failed',      value: current?.failed_tasks ?? 0,     color: 'text-[var(--color-danger)]' },
                { label: 'Revisions',         value: current?.revision_count ?? 0,   color: 'text-[var(--color-warning)]' },
                { label: 'On-Time Tasks',     value: current?.on_time_tasks ?? 0,    color: 'text-[var(--color-success)]' },
              ].map((row, i, arr) => (
                <View
                  key={row.label}
                  className={`flex-row justify-between items-center py-3 ${i < arr.length - 1 ? 'border-b border-surface-border/50' : ''}`}
                >
                  <Text className="text-typography-muted text-sm font-medium">{row.label}</Text>
                  <Text className={`font-bold ${row.color}`}>{row.value}</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </View>
    </ScrollView>
  );
}
