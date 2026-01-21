// Service Worker for Push Notifications v4
// Ultra-minimal static SW - push notifications only
// IMPORTANT: This file must be served from the root with proper MIME type

const SW_VERSION = '4.2.0';

// Install - skip waiting to activate immediately
self.addEventListener('install', (event) => {
  console.log('[SW v' + SW_VERSION + '] Installing...');
  event.waitUntil(self.skipWaiting());
});

// Activate - claim all clients immediately
self.addEventListener('activate', (event) => {
  console.log('[SW v' + SW_VERSION + '] Activating...');
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Clear any old caches
      caches.keys().then(names => Promise.all(names.map(name => caches.delete(name))))
    ]).then(() => {
      console.log('[SW v' + SW_VERSION + '] Activated and claimed clients');
    })
  );
});

// Push notification handler
self.addEventListener('push', (event) => {
  console.log('[SW v' + SW_VERSION + '] Push received');
  
  let data = {
    title: 'Ignite Club HQ',
    body: 'You have a new notification',
    url: '/'
  };
  
  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch (e) {
      data.body = event.data.text();
    }
  }
  
  const options = {
    body: data.body,
    icon: '/ignite-logo.png',
    badge: '/badge-96.png',
    data: { url: data.url },
    tag: 'ignite-notification',
    renotify: true,
    requireInteraction: false,
    vibrate: [200, 100, 200]
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  console.log('[SW v' + SW_VERSION + '] Notification clicked');
  event.notification.close();
  
  const url = event.notification.data?.url || '/';
  
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Try to focus existing window
      for (const client of clients) {
        if ('focus' in client) {
          return client.focus().then((focused) => {
            if (focused && 'navigate' in focused) {
              return focused.navigate(url);
            }
          });
        }
      }
      // Open new window if none exists
      return self.clients.openWindow(url);
    })
  );
});

// Subscription change handler - notify clients to resubscribe
self.addEventListener('pushsubscriptionchange', (event) => {
  console.log('[SW v' + SW_VERSION + '] Subscription changed');
  event.waitUntil(
    self.clients.matchAll().then(clients => {
      clients.forEach(client => client.postMessage({ type: 'PUSH_SUBSCRIPTION_CHANGED' }));
    })
  );
});

// Message handler for debugging
self.addEventListener('message', (event) => {
  if (event.data === 'ping') {
    event.ports[0]?.postMessage({ version: SW_VERSION, active: true });
  }
});
