import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, ActivityIndicator, TouchableOpacity } from 'react-native';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';

type TaskStats = {
  total: number;
  open: number;
  inProgress: number;
  completed: number;
};

export default function DashboardScreenWeb() {
  const [stats, setStats] = useState<TaskStats>({ total: 0, open: 0, inProgress: 0, completed: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStats = async () => {
    try {
      const { data: tasks, error } = await supabase
        .from('tasks')
        .select('current_stage_id');

      if (error) throw error;

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
      className="flex-1 bg-surface-background p-10"
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="rgb(var(--brand-primary))" />}
    >
      <View className="max-w-[1400px] mx-auto w-full">
        {/* Header Section */}
        <View className="mb-12 flex-row items-center justify-between">
          <View>
            <View className="flex-row items-center mb-2">
              <View className="w-8 h-8 rounded-lg bg-brand-primary/10 items-center justify-center border border-brand-primary/20 mr-4">
                <FontAwesome name="dashboard" size={14} color="rgb(var(--brand-primary))" />
              </View>
              <Text className="text-brand-primary font-black uppercase tracking-[0.3em] text-[10px]">Overview</Text>
            </View>
            <Text className="text-typography-main text-5xl font-black tracking-tighter">Dashboard</Text>
            <Text className="text-typography-muted text-lg mt-2 font-medium">Global intelligence and team coordination overview.</Text>
          </View>
          
          <TouchableOpacity 
            onPress={onRefresh}
            className="flex-row items-center bg-surface-card border border-surface-border px-6 py-4 rounded-2xl premium-shadow active:scale-95 transition-transform"
          >
            <FontAwesome name="refresh" size={14} className="text-brand-primary" />
            <Text className="ml-3 font-black uppercase tracking-widest text-xs text-typography-main">Refresh</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View className="h-96 items-center justify-center bg-surface-card rounded-[2.5rem] border border-surface-border">
            <ActivityIndicator size="large" color="rgb(var(--brand-primary))" />
            <Text className="text-typography-muted mt-4 font-bold uppercase tracking-widest text-[10px]">Loading data...</Text>
          </View>
        ) : (
          <View>
            {/* Stats Grid */}
            <View className="flex-row flex-wrap gap-6 mb-10">
              <View className="flex-1 min-w-[280px] bg-surface-card p-8 rounded-[2rem] border border-surface-border premium-shadow group">
                <View className="w-14 h-14 rounded-2xl bg-brand-primary/10 items-center justify-center mb-6 border border-brand-primary/10 group-hover:bg-brand-primary transition-all">
                  <FontAwesome name="tasks" size={24} color="rgb(var(--brand-primary))" className="group-hover:text-white" />
                </View>
                <Text className="text-typography-muted text-xs font-black uppercase tracking-widest mb-2">Total Tasks</Text>
                <Text className="text-typography-main text-5xl font-black tracking-tighter">{stats.total}</Text>
                <View className="mt-4 flex-row items-center">
                  <FontAwesome name="caret-up" size={12} color="#10b981" />
                  <Text className="text-emerald-500 text-[10px] font-black ml-1 uppercase tracking-widest">+12% vs LY</Text>
                </View>
              </View>

              <View className="flex-1 min-w-[280px] bg-surface-card p-8 rounded-[2rem] border border-surface-border premium-shadow group">
                <View className="w-14 h-14 rounded-2xl bg-amber-500/10 items-center justify-center mb-6 border border-amber-500/10">
                  <FontAwesome name="hourglass-half" size={20} color="#f59e0b" />
                </View>
                <Text className="text-typography-muted text-xs font-black uppercase tracking-widest mb-2">In Progress</Text>
                <Text className="text-typography-main text-5xl font-black tracking-tighter">{stats.open + stats.inProgress}</Text>
                <View className="mt-4 flex-row items-center">
                  <Text className="text-amber-500 text-[10px] font-black uppercase tracking-widest">High Intensity</Text>
                </View>
              </View>

              <View className="flex-1 min-w-[280px] bg-surface-card p-8 rounded-[2rem] border border-surface-border premium-shadow group">
                <View className="w-14 h-14 rounded-2xl bg-emerald-500/10 items-center justify-center mb-6 border border-emerald-500/10">
                  <FontAwesome name="check-circle" size={24} color="#10b981" />
                </View>
                <Text className="text-typography-muted text-xs font-black uppercase tracking-widest mb-2">Completed</Text>
                <Text className="text-typography-main text-5xl font-black tracking-tighter">{stats.completed}</Text>
                <View className="mt-4 flex-row items-center">
                   <Text className="text-emerald-500 text-[10px] font-black uppercase tracking-widest">Target Reached</Text>
                </View>
              </View>
            </View>

            {/* Main Content Sections */}
            <View className="flex-row gap-8 mb-20">
              {/* Progress Panel */}
              <View className="flex-[2] bg-surface-card p-10 rounded-[3rem] border border-surface-border premium-shadow">
                <View className="flex-row items-center justify-between mb-10">
                  <View>
                    <Text className="text-typography-main text-2xl font-black tracking-tight">Task Progress</Text>
                    <Text className="text-typography-muted text-xs mt-1 font-medium">Real-time completion metrics per sector.</Text>
                  </View>
                  <View className="bg-brand-primary/10 px-4 py-2 rounded-full">
                    <Text className="text-brand-primary font-black text-lg">
                      {stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0}%
                    </Text>
                  </View>
                </View>

                <View className="w-full h-4 bg-surface-background rounded-full overflow-hidden mb-12 border border-surface-border">
                  <View
                    className="h-full bg-brand-primary"
                    style={{ width: `${stats.total > 0 ? (stats.completed / stats.total) * 100 : 0}%` }}
                  />
                </View>

                <View className="gap-6">
                  {[
                    { label: 'Planning', progress: 85, color: '#6366f1' },
                    { label: 'Execution', progress: 45, color: '#f59e0b' },
                    { label: 'Resource Management', progress: 62, color: '#10b981' },
                  ].map((item, idx) => (
                    <View key={idx}>
                      <View className="flex-row justify-between mb-2 px-1">
                        <Text className="text-typography-main font-bold text-sm">{item.label}</Text>
                        <Text className="text-typography-muted font-bold text-[10px] uppercase tracking-widest">{item.progress}%</Text>
                      </View>
                      <View className="w-full h-1.5 bg-surface-background rounded-full overflow-hidden">
                        <View className="h-full" style={{ width: `${item.progress}%`, backgroundColor: item.color }} />
                      </View>
                    </View>
                  ))}
                </View>
              </View>

              {/* Activity Feed Panel */}
              <View className="flex-1 bg-surface-card p-10 rounded-[3rem] border border-surface-border premium-shadow">
                 <View className="flex-row items-center justify-between mb-8">
                  <Text className="text-typography-main text-2xl font-black tracking-tight">Activity</Text>
                  <TouchableOpacity>
                    <FontAwesome name="arrow-right" size={12} color="rgb(var(--brand-primary))" />
                  </TouchableOpacity>
                </View>

                <View className="flex-1 items-center justify-center p-8 rounded-[2rem] bg-surface-background/50 border border-dashed border-surface-border">
                  <View className="w-16 h-16 rounded-full bg-brand-primary/5 flex-center mb-6">
                    <FontAwesome name="bolt" size={24} color="rgb(var(--brand-primary))" />
                  </View>
                  <Text className="text-typography-main font-bold text-center mb-2">Updating feed...</Text>
                  <Text className="text-typography-muted text-center text-xs font-medium leading-relaxed">
                    Event sequences from the task registry will synchronize here in real-time.
                  </Text>
                </View>
              </View>
            </View>
          </View>
        )}
      </View>
    </ScrollView>
  );
}
