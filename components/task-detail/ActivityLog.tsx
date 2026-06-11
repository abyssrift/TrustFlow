import React from 'react';
import { View, Text } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useTaskDetail } from '@/contexts/TaskDetailContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import CollapsibleCard from './CollapsibleCard';

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
  const colors = useThemeColors();
  const { data } = useTaskDetail();

  const getEventStyle = (type: string) => {
    switch (type) {
      case 'task.created': return { icon: 'plus-circle', color: colors.primary };
      case 'task.stage_advanced': return { icon: 'arrow-right', color: colors.success };
      case 'task.work_submitted': return { icon: 'upload', color: colors.info };
      case 'task.submission_reviewed': return { icon: 'gavel', color: colors.warning };
      case 'task.comment_added': return { icon: 'comment', color: colors.primary };
      case 'task.comment_deleted': return { icon: 'trash', color: colors.danger };
      case 'task.assigned': return { icon: 'user-plus', color: colors.info };
      default: return { icon: 'circle-o', color: colors.textMuted };
    }
  };

  if (!data || data.activity.length === 0) return null;

  return (
    <CollapsibleCard title="Activity" defaultCollapsed>
      {data.activity.slice(0, 20).map(a => {
        const ev = getEventStyle(a.event_type);
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
    </CollapsibleCard>
  );
}
