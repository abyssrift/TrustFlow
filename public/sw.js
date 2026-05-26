'use strict';

// Event types that should stick around until the user acknowledges them.
const HIGH_PRIORITY = new Set([
  'task.overdue',
  'task.due_soon',
  'task.manual_time_flagged',
  'task.manual_time_rejected',
]);

// Event types that fire silently (no sound / vibration) — low-noise updates.
const LOW_PRIORITY = new Set([
  'task.commented',
  'task.status_changed',
  'task.stage_transition',
]);

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: 'TrustFlow', body: event.data.text() };
  }

  const title = data.title ?? 'TrustFlow';
  const eventType = data.data?.event_type ?? data.type ?? '';
  const taskId = data.data?.task_id ?? null;
  const pipelineId = data.data?.pipeline_id ?? null;

  const isHigh = HIGH_PRIORITY.has(eventType);
  const isLow = LOW_PRIORITY.has(eventType);

  const actions = taskId
    ? [{ action: 'view', title: 'View task' }]
    : pipelineId
    ? [{ action: 'view', title: 'Open pipeline' }]
    : [];

  const options = {
    body: data.body ?? '',
    icon: '/android-chrome-192x192.png',
    badge: '/badge-72.png',
    image: data.data?.image ?? undefined,
    data: data.data ?? {},
    // Group by entity so a stream of updates on the same task replaces rather
    // than stacking — bump renotify so the user still hears it.
    tag: `${eventType || 'tf'}:${taskId || pipelineId || 'global'}`,
    renotify: true,
    requireInteraction: isHigh,
    silent: isLow,
    vibrate: isLow ? undefined : isHigh ? [200, 100, 200, 100, 200] : [100, 50, 100],
    timestamp: Date.now(),
    actions,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const d = event.notification.data ?? {};
  const path = d.task_id
    ? `/task/${d.task_id}`
    : d.pipeline_id
    ? '/admin/pipelines'
    : '/';

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((list) => {
        // If there's an open tab on our origin, focus it and navigate.
        for (const client of list) {
          if ('focus' in client && 'navigate' in client) {
            return client.navigate(path).then(() => client.focus()).catch(() => client.focus());
          }
          if ('focus' in client) return client.focus();
        }
        return clients.openWindow(path);
      })
  );
});
