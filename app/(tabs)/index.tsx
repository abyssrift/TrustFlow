import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import DevTool from '../../components/DevTool';

type TaskStats = {
  total: number;
  open: number;
  inProgress: number;
  completed: number;
};

export default function DashboardScreen() {
  const [stats, setStats] = useState<TaskStats>({ total: 0, open: 0, inProgress: 0, completed: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // ... rest of state logic
  const fetchStats = async () => {
    try {
      const { data: tasks, error } = await supabase
        .from('tasks')
        .select('current_stage_id');

      if (error) throw error;

      // Temporary simple layout until pipeline context is fully mapped to stats
      const newStats = { total: tasks?.length || 0, open: 0, inProgress: 0, completed: 0 };
      setStats(newStats);
    } catch (err) {
      console.error('Error fetching stats:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchStats();
  };

  return (
    <ScrollView
      className="flex-1 bg-surface-background p-5"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="rgb(var(--brand-primary))" />}
    >
      <View className="mb-4 mt-4">
        <Text className="text-brand-secondary font-bold uppercase tracking-widest text-[10px] mb-1">Company Overview</Text>
        <Text className="text-typography-main text-4xl font-extrabold tracking-tight">TrustFlow</Text>
      </View>

      <DevTool />

      {loading ? (
        <View className="mt-10 items-center justify-center">
          <ActivityIndicator size="large" color="rgb(var(--brand-primary))" />
        </View>
      ) : (
        <View>
          <View className="flex-row flex-wrap justify-between">
            <View className="w-[48%] bg-surface-card p-5 rounded-3xl border border-surface-border mb-4 premium-shadow">
              <View className="w-10 h-10 rounded-2xl bg-brand-primary/20 items-center justify-center mb-4">
                <FontAwesome name="tasks" size={16} color="rgb(var(--brand-primary))" />
              </View>
              <Text className="text-typography-muted text-xs font-bold uppercase tracking-tighter mb-1">Total Pipeline</Text>
              <Text className="text-typography-main text-3xl font-black">{stats.total}</Text>
            </View>

            <View className="w-[48%] bg-surface-card p-5 rounded-3xl border border-surface-border mb-4 premium-shadow">
              <View className="w-10 h-10 rounded-2xl bg-brand-accent/20 items-center justify-center mb-4">
                <FontAwesome name="hourglass-half" size={14} color="rgb(var(--state-warning))" />
              </View>
              <Text className="text-typography-muted text-xs font-bold uppercase tracking-tighter mb-1">Active Now</Text>
              <Text className="text-typography-main text-3xl font-black">{stats.open + stats.inProgress}</Text>
            </View>
          </View>

          {/* New Full Width Stats Bar */}
          <View className="bg-surface-card p-6 rounded-3xl border border-surface-border mb-8 overflow-hidden">
            <View className="flex-row items-center justify-between mb-4">
              <Text className="text-typography-main font-bold text-lg">Completion Rate</Text>
              <Text className="text-brand-secondary font-black text-lg">
                {stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0}%
              </Text>
            </View>
            <View className="w-full h-3 bg-surface-background rounded-full overflow-hidden">
              <View
                className="h-full bg-brand-secondary"
                style={{ width: `${stats.total > 0 ? (stats.completed / stats.total) * 100 : 0}%` }}
              />
            </View>
          </View>
        </View>
      )}

      {/* Recent Activity Section - Redesigned */}
      <View className="mt-4 mb-12">
        <View className="flex-row items-center justify-between mb-4">
          <Text className="text-typography-main text-2xl font-bold">Activity Feed</Text>
          <TouchableOpacity>
            <Text className="text-brand-primary font-bold">See All</Text>
          </TouchableOpacity>
        </View>

        <View className="glass-card p-8 rounded-[40px] items-center justify-center border-dashed border-2">
          <View className="w-16 h-16 rounded-full bg-surface-overlay flex-center mb-4">
            <FontAwesome name="bolt" size={24} color="rgb(var(--brand-primary))" />
          </View>
          <Text className="text-typography-muted text-center font-medium leading-5">
            Real-time activity logs and event streams will populate here from the database audit trail.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}
