'use strict';

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: 'TrustFlow', body: event.data.text() };
  }

  const title = data.title ?? 'TrustFlow';
  const options = {
    body: data.body ?? '',
    icon: '/favicon.png',
    badge: '/favicon.png',
    data: data.data ?? {},
    tag: data.data?.task_id ?? data.data?.pipeline_id ?? 'trustflow',
    renotify: true,
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
        for (const client of list) {
          if ('focus' in client) return client.focus();
        }
        return clients.openWindow(path);
      })
  );
});
