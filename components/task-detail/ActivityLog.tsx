import React from 'react';
import { View, Text } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useTaskDetail } from '@/contexts/TaskDetailContext';

const EVENT_ICONS: Record<string, { icon: string; color: string }> = {
  'task.created':             { icon: 'plus-circle',  color: '#6366f1' },
  'task.stage_advanced':      { icon: 'arrow-right',  color: '#22c55e' },
  'task.work_submitted':      { icon: 'upload',       color: '#3b82f6' },
  'task.submission_reviewed': { icon: 'gavel',        color: '#f59e0b' },
  'task.comment_added':       { icon: 'comment',      color: '#8b5cf6' },
  'task.comment_deleted':     { icon: 'trash',        color: '#ef4444' },
  'task.assigned':            { icon: 'user-plus',    color: '#06b6d4' },
};

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function eventLabel(type: string, metadata: any): string {
  switch (type) {
    case 'task.created': return 'Task created';
    case 'task.stage_advanced': return `Stage: ${metadata?.from || '?'} → ${metadata?.to || '?'}`;
    case 'task.work_submitted': return 'Work submitted';
    case 'task.submission_reviewed': return `Submission ${metadata?.decision || 'reviewed'}`;
    case 'task.comment_added': return metadata?.is_reply ? 'Replied to comment' : 'Comment added';
    case 'task.comment_deleted': return 'Comment deleted';
    case 'task.assigned': return 'Task assigned';
    default: return type.replace('task.', '').replace(/_/g, ' ');
  }
}

export default function ActivityLog() {
  const { data } = useTaskDetail();
  if (!data || data.activity.length === 0) return null;

  return (
    <View className="bg-surface-card rounded-2xl border border-surface-border p-4">
      <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.15em] mb-3">Activity</Text>

      {data.activity.slice(0, 20).map(a => {
        const ev = EVENT_ICONS[a.event_type] || { icon: 'circle-o', color: '#64748b' };
        return (
          <View key={a.id} className="flex-row items-start mb-2.5">
            <View className="w-5 items-center mt-0.5">
              <FontAwesome name={ev.icon as any} size={10} color={ev.color} />
            </View>
            <View className="flex-1 ml-2">
              <Text className="text-typography-label text-[11px] font-bold">{eventLabel(a.event_type, a.metadata)}</Text>
              <Text className="text-typography-dim text-[9px]">
                {a.user_name || 'System'} · {timeAgo(a.created_at)}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}
