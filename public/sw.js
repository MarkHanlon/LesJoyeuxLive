// Required for Chrome on Android to consider the site PWA-installable
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request));
  }
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  const { title, body, url } = event.data.json();
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, {
        body,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        data: { url: url || '/' },
      }),
      // Nudge any open app windows to re-fetch immediately (Layer 2 instant refresh).
      self.clients
        .matchAll({ type: 'window', includeUncontrolled: true })
        .then((windowClients) => {
          for (const client of windowClients) {
            client.postMessage({ type: 'refresh', reason: 'push', url: url || '/' });
          }
        }),
    ])
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        const url = event.notification.data?.url || '/';
        for (const client of windowClients) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        return clients.openWindow(url);
      })
  );
});
