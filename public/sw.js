// Service Worker for Push Notifications v6
// Enhanced reliability with aggressive recovery, better error handling, and auto-renewal
// IMPORTANT: This file must be served from the root with proper MIME type

const SW_VERSION = '6.2.0';

// Retry configuration
const MAX_NOTIFICATION_RETRIES = 2;
const RETRY_DELAY_MS = 500;

// Track recent notifications to prevent duplicates
const recentNotifications = new Map();
const NOTIFICATION_DEDUP_WINDOW_MS = 5000;

// ============================================
// LIFECYCLE EVENTS
// ============================================

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
      caches.keys().then(names => Promise.all(names.map(name => caches.delete(name)))),
      // Notify clients of activation
      notifyClients({ type: 'SW_ACTIVATED', version: SW_VERSION }),
    ]).then(() => {
      console.log('[SW v' + SW_VERSION + '] Activated and claimed clients');
    })
  );
});

// ============================================
// HELPER FUNCTIONS
// ============================================

async function notifyClients(message) {
  try {
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    clients.forEach(client => {
      try {
        client.postMessage(message);
      } catch (e) {
        // Ignore individual client errors
      }
    });
  } catch (e) {
    console.warn('[SW v' + SW_VERSION + '] Error notifying clients:', e);
  }
}

async function showNotificationWithRetry(title, options, attempt = 1) {
  try {
    await self.registration.showNotification(title, options);
    console.log('[SW v' + SW_VERSION + '] Notification shown successfully');
    return true;
  } catch (error) {
    console.error('[SW v' + SW_VERSION + '] Notification attempt', attempt, 'failed:', error);
    
    if (attempt < MAX_NOTIFICATION_RETRIES) {
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      return showNotificationWithRetry(title, options, attempt + 1);
    }
    
    // Final fallback - simpler notification
    try {
      await self.registration.showNotification('Ignite Club HQ', {
        body: options.body || 'You have a new notification',
        icon: '/ignite-logo.png',
        tag: 'ignite-fallback-' + Date.now(),
      });
      console.log('[SW v' + SW_VERSION + '] Fallback notification shown');
      return true;
    } catch (fallbackError) {
      console.error('[SW v' + SW_VERSION + '] Even fallback notification failed:', fallbackError);
      return false;
    }
  }
}

function isDuplicateNotification(tag) {
  const now = Date.now();
  
  // Clean old entries
  for (const [key, timestamp] of recentNotifications.entries()) {
    if (now - timestamp > NOTIFICATION_DEDUP_WINDOW_MS) {
      recentNotifications.delete(key);
    }
  }
  
  if (recentNotifications.has(tag)) {
    return true;
  }
  
  recentNotifications.set(tag, now);
  return false;
}

// ============================================
// PUSH HANDLER
// ============================================

self.addEventListener('push', (event) => {
  console.log('[SW v' + SW_VERSION + '] Push received at', new Date().toISOString());
  
  // CRITICAL: Must call event.waitUntil synchronously
  // Chrome PWA can terminate SW if we don't extend the lifetime immediately
  const handlePush = async () => {
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
        console.log('[SW v' + SW_VERSION + '] Push payload:', JSON.stringify({ title: data.title, body: data.body?.substring(0, 50) }));
      } catch (e) {
        console.log('[SW v' + SW_VERSION + '] Parsing as text');
        try {
          data.body = event.data.text();
        } catch (e2) {
          console.error('[SW v' + SW_VERSION + '] Could not read push data');
        }
      }
    }
    
    // Generate unique tag - avoid collapsing notifications unintentionally
    // For Chrome PWA, using timestamp ensures each notification is shown
    const notificationTag = data.tag || ('ignite-' + (data.notificationId || Date.now()));
    
    // Deduplicate only within very short window
    if (isDuplicateNotification(notificationTag)) {
      console.log('[SW v' + SW_VERSION + '] Duplicate notification ignored:', notificationTag);
      // IMPORTANT: Still show a notification to keep SW alive on Chrome PWA
      // Chrome can kill the SW if push doesn't result in notification
      return self.registration.showNotification('Ignite Club HQ', {
        body: 'Notification already shown',
        tag: 'ignite-dedup-placeholder',
        silent: true,
      }).then(() => {
        // Immediately close the placeholder
        return self.registration.getNotifications({ tag: 'ignite-dedup-placeholder' })
          .then(notifications => notifications.forEach(n => n.close()));
      }).catch(() => {});
    }
    
    // Forward the full push payload in `data` so the client can preload
    // the message into the chat cache for instant render on tap.
    const { title: _t, body: _b, ...payloadRest } = data;
    const options = {
      body: data.body,
      icon: '/ignite-logo.png',
      badge: '/badge-96.png',
      data: {
        url: data.url,
        notificationId: data.notificationId,
        timestamp: Date.now(),
        payload: payloadRest,
      },
      tag: notificationTag,
      renotify: true,
      requireInteraction: false,
      vibrate: [200, 100, 200],
      // Chrome Android PWA needs silent: false explicitly
      silent: false,
      actions: [
        { action: 'open', title: 'View' },
        { action: 'dismiss', title: 'Dismiss' }
      ],
    };
    
    console.log('[SW v' + SW_VERSION + '] Showing notification with tag:', notificationTag);
    
    // Show the notification
    const shown = await showNotificationWithRetry(data.title, options);
    
    if (shown) {
      console.log('[SW v' + SW_VERSION + '] Notification displayed successfully');
    } else {
      console.error('[SW v' + SW_VERSION + '] Failed to display notification');
    }
    
    return shown;
  };
  
  // CRITICAL: Call waitUntil immediately and synchronously
  event.waitUntil(handlePush());
});

// ============================================
// NOTIFICATION INTERACTION HANDLERS
// ============================================

self.addEventListener('notificationclick', (event) => {
  console.log('[SW v' + SW_VERSION + '] Notification clicked, action:', event.action);
  event.notification.close();

  if (event.action === 'dismiss') {
    return;
  }

  const url = event.notification.data?.url || '/';
  const payload = event.notification.data?.payload || null;
  const fullUrl = new URL(url, self.location.origin).href;

  // Broadcast IMMEDIATELY (in parallel with focus) so any listening client can
  // preload the message cache and start navigating without waiting for the
  // focus() promise to resolve. Cuts ~50-300ms off the perceived tap latency.
  try {
    const bc = new BroadcastChannel('push-nav');
    bc.postMessage({ url, data: payload });
    bc.close();
  } catch (e) {
    console.warn('[SW v' + SW_VERSION + '] Early BroadcastChannel failed:', e);
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if (client.url.startsWith(self.location.origin) && 'focus' in client) {
            // Send postMessage backup before focus so it's queued for the client
            try {
              client.postMessage({
                type: 'NOTIFICATION_CLICK_NAVIGATE',
                url,
                data: payload,
              });
            } catch {}
            return client.focus().catch(() => self.clients.openWindow(fullUrl));
          }
        }
        // No existing window - open new one
        return self.clients.openWindow(fullUrl);
      })
      .catch((error) => {
        console.error('[SW v' + SW_VERSION + '] Error handling click:', error);
        return self.clients.openWindow(fullUrl);
      })
  );
});

self.addEventListener('notificationclose', (event) => {
  console.log('[SW v' + SW_VERSION + '] Notification closed:', event.notification.tag);
});

// ============================================
// SUBSCRIPTION CHANGE HANDLER (CRITICAL FOR RELIABILITY)
// ============================================

self.addEventListener('pushsubscriptionchange', (event) => {
  console.log('[SW v' + SW_VERSION + '] Subscription changed - attempting recovery');
  
  event.waitUntil(
    (async () => {
      // Notify all clients immediately
      await notifyClients({ 
        type: 'PUSH_SUBSCRIPTION_CHANGED',
        timestamp: Date.now(),
        reason: 'pushsubscriptionchange event',
      });
      
      // Try to resubscribe automatically
      if (event.oldSubscription) {
        try {
          console.log('[SW v' + SW_VERSION + '] Attempting automatic resubscription...');
          const newSubscription = await self.registration.pushManager.subscribe(
            event.oldSubscription.options
          );
          console.log('[SW v' + SW_VERSION + '] Auto-resubscribed successfully');
          
          // Notify clients of new subscription
          await notifyClients({
            type: 'PUSH_SUBSCRIPTION_RENEWED',
            subscription: newSubscription.toJSON(),
            timestamp: Date.now(),
          });
        } catch (error) {
          console.error('[SW v' + SW_VERSION + '] Auto-resubscription failed:', error);
          // Client-side code will handle resubscription
        }
      }
    })()
  );
});

// ============================================
// MESSAGE HANDLER
// ============================================

self.addEventListener('message', (event) => {
  const data = event.data;
  
  // Simple ping for version check
  if (data === 'ping') {
    event.ports[0]?.postMessage({ version: SW_VERSION, active: true });
    return;
  }
  
  if (data && typeof data === 'object') {
    switch (data.type) {
      case 'PING':
        event.source?.postMessage({ 
          type: 'PONG', 
          version: SW_VERSION, 
          timestamp: Date.now(),
        });
        break;
        
      case 'GET_VERSION':
        event.source?.postMessage({ type: 'VERSION', version: SW_VERSION });
        break;
        
      case 'SKIP_WAITING':
        self.skipWaiting();
        break;
        
      case 'CHECK_SUBSCRIPTION':
        self.registration.pushManager.getSubscription()
          .then(subscription => {
            event.source?.postMessage({
              type: 'SUBSCRIPTION_STATUS',
              hasSubscription: !!subscription,
              endpoint: subscription?.endpoint?.substring(0, 50),
            });
          })
          .catch(error => {
            event.source?.postMessage({
              type: 'SUBSCRIPTION_STATUS',
              hasSubscription: false,
              error: error.message,
            });
          });
        break;
        
      case 'FORCE_RESUBSCRIBE':
        // Trigger subscription change flow
        self.registration.pushManager.getSubscription()
          .then(sub => {
            if (sub) {
              return sub.unsubscribe().then(() => {
                event.source?.postMessage({ type: 'UNSUBSCRIBED' });
              });
            }
            event.source?.postMessage({ type: 'NO_SUBSCRIPTION' });
          })
          .catch(error => {
            event.source?.postMessage({ type: 'ERROR', error: error.message });
          });
        break;
        
      default:
        console.log('[SW v' + SW_VERSION + '] Unknown message type:', data.type);
    }
  }
});

// ============================================
// PERIODIC SYNC (Background health check)
// ============================================

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'push-health-check') {
    console.log('[SW v' + SW_VERSION + '] Periodic sync: push-health-check');
    event.waitUntil(
      self.registration.pushManager.getSubscription()
        .then(subscription => {
          if (!subscription) {
            console.log('[SW v' + SW_VERSION + '] No subscription during periodic sync');
            return notifyClients({ type: 'PUSH_SUBSCRIPTION_CHANGED' });
          }
          console.log('[SW v' + SW_VERSION + '] Subscription healthy during periodic sync');
        })
    );
  }
});

// ============================================
// ERROR HANDLING
// ============================================

self.addEventListener('error', (event) => {
  console.error('[SW v' + SW_VERSION + '] Uncaught error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('[SW v' + SW_VERSION + '] Unhandled rejection:', event.reason);
});
