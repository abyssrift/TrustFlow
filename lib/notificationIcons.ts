import type { useThemeColors } from '@/hooks/useThemeColors';
import type FontAwesome from '@expo/vector-icons/FontAwesome';
import type React from 'react';

type ThemeColors = ReturnType<typeof useThemeColors>;

export type NotificationIconSpec = {
  name: React.ComponentProps<typeof FontAwesome>['name'];
  color: string;
  /** NativeWind tint for the icon chip. Raw-DOM surfaces use `color + '22'` instead. */
  bgClass: string;
};

/** Single source of truth for notification type → icon. Used by the native screen,
 *  the web screen, and the topbar dropdown — add new types here, not in a copy. */
export function getNotificationIcon(type: string, colors: ThemeColors): NotificationIconSpec {
  switch (type) {
    case 'task.assigned':       return { name: 'user-plus', color: colors.primary, bgClass: 'bg-brand-primary/10' };
    case 'task.mentioned':      return { name: 'at', color: colors.warning, bgClass: 'bg-state-warning/10' };
    case 'task.commented':      return { name: 'comment-o', color: colors.textMuted, bgClass: 'bg-surface-overlay' };
    case 'task.created':        return { name: 'plus-square', color: colors.success, bgClass: 'bg-state-success/10' };
    case 'task.completed':      return { name: 'check-circle', color: colors.success, bgClass: 'bg-state-success/10' };
    case 'task.stage_transition': return { name: 'exchange', color: colors.primary, bgClass: 'bg-brand-primary/10' };
    case 'task.status_changed': return { name: 'refresh', color: colors.primary, bgClass: 'bg-brand-primary/10' };
    case 'task.due_soon':       return { name: 'clock-o', color: colors.warning, bgClass: 'bg-state-warning/10' };
    case 'task.overdue':        return { name: 'exclamation-circle', color: colors.danger, bgClass: 'bg-state-danger/10' };
    case 'task.pinged':         return { name: 'bullhorn', color: colors.warning, bgClass: 'bg-state-warning/10' };
    case 'task.manual_time_flagged':  return { name: 'flag', color: colors.warning, bgClass: 'bg-state-warning/10' };
    case 'task.manual_time_approved': return { name: 'thumbs-up', color: colors.success, bgClass: 'bg-state-success/10' };
    case 'task.manual_time_rejected': return { name: 'thumbs-down', color: colors.danger, bgClass: 'bg-state-danger/10' };
    case 'task.submission_deleted': return { name: 'trash-o', color: colors.danger, bgClass: 'bg-state-danger/10' };
    case 'pipeline.member_added': return { name: 'users', color: colors.primary, bgClass: 'bg-brand-primary/10' };
    case 'pipeline.archived':   return { name: 'archive', color: colors.textMuted, bgClass: 'bg-surface-overlay' };
    case 'filehub.file_received':    return { name: 'file-text-o', color: colors.primary, bgClass: 'bg-brand-primary/10' };
    case 'filehub.broadcast_posted': return { name: 'rss', color: colors.warning, bgClass: 'bg-state-warning/10' };
    case 'filehub.group_file_shared': return { name: 'share-alt', color: colors.primary, bgClass: 'bg-brand-primary/10' };
    case 'timer.auto_stopped':  return { name: 'hourglass-end', color: colors.danger, bgClass: 'bg-state-danger/10' };
    default:                    return { name: 'bell-o', color: colors.primary, bgClass: 'bg-brand-primary/10' };
  }
}
