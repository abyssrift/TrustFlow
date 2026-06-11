import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { useSubmission } from '../../contexts/SubmissionContext';
import { useAnalytics, ActivityEntry } from '../../contexts/AnalyticsContext';
import { Ionicons } from '@expo/vector-icons';

const formatDistanceToNow = (date: Date) => {
  const diff = Date.now() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
};

export const RecentActivitySidebar = () => {
  const { activeJobs } = useSubmission();
  const { getRecentActivity } = useAnalytics();
  const [history, setHistory] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadHistory = async () => {
      try {
        const data = await getRecentActivity(10);
        setHistory(data);
      } catch (err) {
        console.error('Failed to load activity history:', err);
      } finally {
        setLoading(false);
      }
    };

    loadHistory();
    // Refresh history every 30 seconds
    const interval = setInterval(loadHistory, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <View className="w-[380px] h-full border-l border-surface-border bg-surface-background/50">
      <View className="p-6 border-b border-surface-border">
        <Text className="text-xl font-bold text-typography-main mb-1">Intelligence Feed</Text>
        <Text className="text-sm text-typography-muted">Real-time task monitoring</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 24, gap: 32 }}>
        {/* Live Submissions Section */}
        {Object.values(activeJobs).length > 0 && (
          <View>
            <View className="flex-row items-center justify-between mb-4">
              <View className="flex-row items-center gap-2">
                <Ionicons name="cloud-upload" size={18} color="#3b82f6" />
                <Text className="text-sm font-semibold text-typography-main uppercase tracking-wider">Live Submissions</Text>
              </View>
              <View className="bg-brand-primary/10 px-2 py-0.5 rounded-full">
                <Text className="text-[10px] font-bold text-brand-primary">{Object.values(activeJobs).length}</Text>
              </View>
            </View>
            <View className="gap-3">
              {Object.values(activeJobs).map((job) => (
                <View key={job.taskId} className="bg-surface-card border border-surface-border rounded-2xl p-4 premium-shadow">
                  <View className="flex-row items-center justify-between mb-2">
                    <Text className="text-sm font-medium text-typography-main flex-1 mr-2" numberOfLines={1}>
                      {job.taskTitle}
                    </Text>
                    <Text className="text-[10px] text-typography-muted font-mono">{Math.round(job.progress * 100)}%</Text>
                  </View>
                  <View className="h-1.5 bg-surface-background rounded-full overflow-hidden">
                    <View 
                      className="h-full bg-brand-primary rounded-full" 
                      style={{ width: `${job.progress * 100}%` }} 
                    />
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Recent History Section */}
        <View>
          <View className="flex-row items-center gap-2 mb-4">
            <Ionicons name="time" size={18} color="#64748b" />
            <Text className="text-sm font-semibold text-typography-main uppercase tracking-wider">Recent Activity</Text>
          </View>

          {loading ? (
            <ActivityIndicator size="small" color="#64748b" />
          ) : history.length === 0 ? (
            <View className="bg-surface-card/50 border border-dashed border-surface-border rounded-2xl p-8 items-center">
              <Text className="text-xs text-typography-muted">No recent activity detected</Text>
            </View>
          ) : (
            <View className="gap-4">
              {history.map((item) => (
                <View key={item.id} className="flex-row gap-3">
                  <View className="items-center">
                    <View className={`w-8 h-8 rounded-full items-center justify-center ${item.is_completion ? 'bg-state-success/10' : 'bg-surface-card border border-surface-border'}`}>
                      <Ionicons 
                        name={item.is_completion ? 'checkmark-circle' : 'arrow-forward'} 
                        size={14} 
                        color={item.is_completion ? '#22c55e' : '#64748b'} 
                      />
                    </View>
                    <View className="w-px flex-1 bg-surface-border my-1" />
                  </View>
                  
                  <View className="flex-1 pt-1">
                    <Text className="text-xs font-bold text-typography-main mb-0.5" numberOfLines={1}>
                      {item.task_title}
                    </Text>
                    <Text className="text-[10px] text-typography-muted mb-2">
                      {item.from_stage_name} → <Text className={item.is_completion ? 'text-state-success font-semibold' : 'text-typography-main'}>{item.to_stage_name}</Text>
                    </Text>
                    <View className="flex-row items-center justify-between">
                      <View className="flex-row items-center gap-1">
                        <Ionicons name="person" size={10} color="#94a3b8" />
                        <Text className="text-[10px] text-typography-muted">{item.moved_by}</Text>
                      </View>
                      <Text className="text-[9px] text-typography-muted font-medium">
                        {formatDistanceToNow(new Date(item.transitioned_at))}
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
};
