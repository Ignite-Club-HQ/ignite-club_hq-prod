// Service Worker for Push Notifications v5
// Enhanced reliability with better error handling and keepalive
// IMPORTANT: This file must be served from the root with proper MIME type

const SW_VERSION = '5.0.0';

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

// Push notification handler with enhanced error handling
self.addEventListener('push', (event) => {
  console.log('[SW v' + SW_VERSION + '] Push received');
  
  let data = {
    title: 'Ignite Club HQ',
    body: 'You have a new notification',
    url: '/',
    tag: 'ignite-' + Date.now()
  };
  
  if (event.data) {
    try {
      const payload = event.data.json();
      data = { ...data, ...payload };
      console.log('[SW v' + SW_VERSION + '] Push payload parsed:', data.title);
    } catch (e) {
      console.log('[SW v' + SW_VERSION + '] Could not parse push data as JSON, using text');
      try {
        data.body = event.data.text();
      } catch (e2) {
        console.error('[SW v' + SW_VERSION + '] Could not read push data');
      }
    }
  }
  
  const options = {
    body: data.body,
    icon: '/ignite-logo.png',
    badge: '/badge-96.png',
    data: { 
      url: data.url,
      notificationId: data.notificationId,
      timestamp: Date.now()
    },
    tag: data.tag || 'ignite-notification',
    renotify: true,
    requireInteraction: false,
    vibrate: [200, 100, 200],
    // Add actions for richer interaction
    actions: [
      { action: 'open', title: 'View' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };
  
  // Use waitUntil to ensure the notification is shown
  event.waitUntil(
    self.registration.showNotification(data.title, options)
      .then(() => {
        console.log('[SW v' + SW_VERSION + '] Notification shown successfully');
      })
      .catch((error) => {
        console.error('[SW v' + SW_VERSION + '] Failed to show notification:', error);
        // Try a simpler notification as fallback
        return self.registration.showNotification('Ignite Club HQ', {
          body: data.body || 'You have a new notification',
          icon: '/ignite-logo.png',
          tag: 'ignite-fallback'
        });
      })
  );
});

// Notification click handler with robust navigation
self.addEventListener('notificationclick', (event) => {
  console.log('[SW v' + SW_VERSION + '] Notification clicked, action:', event.action);
  event.notification.close();
  
  // If user clicked dismiss, just close
  if (event.action === 'dismiss') {
    return;
  }
  
  const url = event.notification.data?.url || '/';
  const fullUrl = new URL(url, self.location.origin).href;
  
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        // Try to find an existing window and focus it
        for (const client of clients) {
          // Check if this client is at our origin
          if (client.url.startsWith(self.location.origin) && 'focus' in client) {
            return client.focus().then((focusedClient) => {
              // Navigate to the notification URL
              if (focusedClient && 'navigate' in focusedClient) {
                return focusedClient.navigate(fullUrl);
              }
              return focusedClient;
            }).catch(() => {
              // Focus failed, try to open new window
              return self.clients.openWindow(fullUrl);
            });
          }
        }
        // No existing window found, open new one
        return self.clients.openWindow(fullUrl);
      })
      .catch((error) => {
        console.error('[SW v' + SW_VERSION + '] Error handling notification click:', error);
        // Last resort - try to open the URL
        return self.clients.openWindow(fullUrl);
      })
  );
});

// Notification close handler (for analytics/tracking if needed)
self.addEventListener('notificationclose', (event) => {
  console.log('[SW v' + SW_VERSION + '] Notification closed:', event.notification.tag);
});

// Subscription change handler - notify clients to resubscribe
self.addEventListener('pushsubscriptionchange', (event) => {
  console.log('[SW v' + SW_VERSION + '] Subscription changed, notifying clients...');
  
  event.waitUntil(
    Promise.all([
      // Notify all clients
      self.clients.matchAll({ includeUncontrolled: true }).then(clients => {
        clients.forEach(client => {
          client.postMessage({ 
            type: 'PUSH_SUBSCRIPTION_CHANGED',
            timestamp: Date.now()
          });
        });
        console.log('[SW v' + SW_VERSION + '] Notified', clients.length, 'client(s) of subscription change');
      }),
      // Try to resubscribe automatically if we have the old subscription
      (async () => {
        try {
          if (event.oldSubscription) {
            console.log('[SW v' + SW_VERSION + '] Attempting automatic resubscription...');
            const newSubscription = await self.registration.pushManager.subscribe(
              event.oldSubscription.options
            );
            console.log('[SW v' + SW_VERSION + '] Auto-resubscribed successfully');
            // Notify clients of new subscription
            const clients = await self.clients.matchAll({ includeUncontrolled: true });
            clients.forEach(client => {
              client.postMessage({
                type: 'PUSH_SUBSCRIPTION_RENEWED',
                subscription: newSubscription.toJSON(),
                timestamp: Date.now()
              });
            });
          }
        } catch (error) {
          console.error('[SW v' + SW_VERSION + '] Auto-resubscription failed:', error);
        }
      })()
    ])
  );
});

// Message handler for communication with main thread
self.addEventListener('message', (event) => {
  const data = event.data;
  
  // Simple ping for version check
  if (data === 'ping') {
    event.ports[0]?.postMessage({ version: SW_VERSION, active: true });
    return;
  }
  
  // Typed message handlers
  if (data && typeof data === 'object') {
    switch (data.type) {
      case 'PING':
        // Keepalive ping - respond with PONG
        event.source?.postMessage({ type: 'PONG', version: SW_VERSION, timestamp: Date.now() });
        break;
        
      case 'GET_VERSION':
        event.source?.postMessage({ type: 'VERSION', version: SW_VERSION });
        break;
        
      case 'CHECK_SUBSCRIPTION':
        // Check if push subscription is active
        self.registration.pushManager.getSubscription()
          .then(subscription => {
            event.source?.postMessage({
              type: 'SUBSCRIPTION_STATUS',
              hasSubscription: !!subscription,
              endpoint: subscription?.endpoint?.substring(0, 50)
            });
          })
          .catch(error => {
            event.source?.postMessage({
              type: 'SUBSCRIPTION_STATUS',
              hasSubscription: false,
              error: error.message
            });
          });
        break;
        
      default:
        console.log('[SW v' + SW_VERSION + '] Unknown message type:', data.type);
    }
  }
});

// Periodic sync for background updates (if supported)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'push-keepalive') {
    console.log('[SW v' + SW_VERSION + '] Periodic sync: push-keepalive');
    event.waitUntil(
      self.registration.pushManager.getSubscription()
        .then(subscription => {
          if (!subscription) {
            console.log('[SW v' + SW_VERSION + '] No subscription during periodic sync');
            // Notify clients
            return self.clients.matchAll({ includeUncontrolled: true }).then(clients => {
              clients.forEach(client => {
                client.postMessage({ type: 'PUSH_SUBSCRIPTION_CHANGED' });
              });
            });
          }
          console.log('[SW v' + SW_VERSION + '] Subscription healthy during periodic sync');
        })
    );
  }
});
