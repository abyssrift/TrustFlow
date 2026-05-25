import { useTaskDetail } from '@/contexts/TaskDetailContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React from 'react';
import { Text, View } from 'react-native';

function formatDuration(seconds: number) {
  if (seconds <= 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  return parts.join(' ');
}

export default function TimerPanel() {
  const { data } = useTaskDetail();
  const colors = useThemeColors();
  if (!data) return null;

  const totalSpent = data.stats.total_time_spent_seconds || 0;
  const recentSessions = data.work_sessions
    .filter(ws => ws.status === 'completed')
    .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
    .slice(0, 5);

  return (
    <View className="bg-surface-card rounded-2xl border border-surface-border p-5">
      {/* Aggregate Header */}
      <View className="flex-row items-center justify-between mb-5">
        <View>
          <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-1">Total Effort</Text>
          <Text className="text-typography-main text-xl font-black">{formatDuration(totalSpent)}</Text>
        </View>
        <View className="w-10 h-10 rounded-full bg-brand-primary/10 items-center justify-center">
          <FontAwesome name="history" size={16} color={colors.primary} />
        </View>
      </View>

      {/* Sessions List */}
      <View className="gap-1">
        <Text className="text-typography-muted text-[8px] font-black uppercase tracking-widest mb-2">Recent Sessions</Text>
        {recentSessions.length === 0 ? (
          <Text className="text-typography-dim text-[10px] italic">No completed sessions yet.</Text>
        ) : (
          recentSessions.map((s) => (
            <View key={s.id} className="flex-row items-center justify-between py-2 border-t border-surface-border/10">
              <View className="flex-row items-center">
                <View className="w-1 h-1 rounded-full bg-typography-dim mr-2 opacity-50" />
                <View>
                  <Text className="text-typography-main text-[10px] font-bold">
                    {new Date(s.started_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </Text>
                </View>
              </View>
              <Text className="text-typography-muted font-mono text-[10px]">{formatDuration(s.total_seconds_spent)}</Text>
            </View>
          ))
        )}
      </View>
    </View>
  );
}
