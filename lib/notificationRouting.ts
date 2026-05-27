import { AppNotification } from '@/contexts/NotificationsContext';

export function getNotificationRoute(item: AppNotification): string | null {
  const taskId = item.data?.task_id;
  if (taskId) return `/task/${taskId}`;

  switch (item.type) {
    case 'filehub.file_received':
      return '/filehub?tab=inbox';
    case 'filehub.broadcast_posted':
      return '/filehub?tab=broadcast';
    case 'filehub.group_file_shared':
      return '/filehub?tab=groups';
    default:
      return null;
  }
}
