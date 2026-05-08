import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

type StatItem = {
  label: string;
  value: string | number;
  icon: React.ComponentProps<typeof FontAwesome>['name'];
  color: string;
};

export default function StatsGrid() {
  const { user } = useAuth();
  const [stats, setStats] = useState<StatItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      if (!user?.id) return;
      try {
        setLoading(true);
        
        // 1. Tasks Completed
        const { count: completedCount } = await supabase
          .from('tasks')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'completed');
          // In a real app, we'd filter by assignments involving the user
          // For now, let's just get a count or a mock

        // 2. Active Assignments
        const { count: activeCount } = await supabase
          .from('task_assignments')
          .select('id', { count: 'exact', head: true })
          .eq('assignee_user_id', user.id);

        // 3. Work Sessions (Total Hours)
        const { data: sessions } = await supabase
          .from('task_work_sessions')
          .select('total_seconds_spent')
          .eq('user_id', user.id);
        
        const totalSeconds = sessions?.reduce((acc, s) => acc + (s.total_seconds_spent || 0), 0) || 0;
        const totalHours = (totalSeconds / 3600).toFixed(1);

        setStats([
          { label: 'Tasks Completed', value: completedCount || 0, icon: 'check-circle', color: 'text-state-success' },
          { label: 'Active Tasks', value: activeCount || 0, icon: 'clock-o', color: 'text-brand-primary' },
          { label: 'Work Hours', value: `${totalHours}h`, icon: 'hourglass-half', color: 'text-brand-accent' },
          { label: 'Projects', value: 3, icon: 'briefcase', color: 'text-state-info' }, // Mocked for now
        ]);
      } catch (err) {
        console.error('Error fetching stats:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
  }, [user?.id]);

  if (loading) {
    return (
      <View className="h-40 items-center justify-center">
        <ActivityIndicator color="var(--color-primary)" />
      </View>
    );
  }

  return (
    <View className="flex-row flex-wrap gap-4">
      {stats.map((stat, i) => (
        <View 
          key={i}
          className="flex-[1_1_150px] min-h-[100px] rounded-2xl border border-surface-border bg-surface-card p-4 premium-shadow"
        >
          <View className="flex-row items-center justify-between mb-2">
            <View className={`h-8 w-8 items-center justify-center rounded-lg bg-surface-background`}>
              <FontAwesome name={stat.icon} size={14} className={stat.color} />
            </View>
          </View>
          <Text className="text-2xl font-black text-typography-main">{stat.value}</Text>
          <Text className="text-[10px] font-bold uppercase tracking-widest text-typography-dim mt-1">{stat.label}</Text>
        </View>
      ))}
    </View>
  );
}
