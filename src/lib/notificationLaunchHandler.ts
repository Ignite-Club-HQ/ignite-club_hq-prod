/**
 * Handler for notification taps that launch the app from cold start.
 * 
 * This must be initialized early in the app lifecycle (in main.tsx) to catch
 * the pushNotificationActionPerformed event that fires when the app is opened
 * via a notification tap from the lock screen or notification bar.
 * 
 * The Capacitor PushNotifications plugin fires the 'pushNotificationActionPerformed'
 * event even on cold start, but we need to be listening for it early enough.
 */

import { Capacitor } from '@capacitor/core';
import { preloadMessageFromNotification } from './notificationPreload';
import { captureJumpFromNotification } from './pendingChatJump';

// Store pending navigation URL until the app is ready to handle it
let pendingNavigationUrl: string | null = null;
let navigationHandled = false;

const PENDING_NAV_KEY = 'pendingPushNavigationUrl';

function persistPendingNav(url: string) {
  try { sessionStorage.setItem(PENDING_NAV_KEY, url); } catch {}
}

function readPersistedPendingNav(): string | null {
  try { return sessionStorage.getItem(PENDING_NAV_KEY); } catch { return null; }
}

function clearPersistedPendingNav() {
  try { sessionStorage.removeItem(PENDING_NAV_KEY); } catch {}
}

// Global flag for pending force-update prompt (survives timing races)
let pendingForceUpdatePrompt: { storeUrl?: string } | null = null;

/**
 * Check and consume any pending force-update prompt that fired before the component mounted
 */
export function consumePendingForceUpdatePrompt(): { storeUrl?: string } | null {
  const pending = pendingForceUpdatePrompt;
  pendingForceUpdatePrompt = null;
  return pending;
}

/**
 * Get any pending navigation URL from a notification tap.
 * Falls back to sessionStorage so Android cold-start taps survive a slow
 * auth bootstrap (e.g. token refresh on resume) without losing the route.
 */
export function getPendingNotificationNavigation(): string | null {
  const url = pendingNavigationUrl || readPersistedPendingNav();
  if (url) {
    pendingNavigationUrl = null;
    clearPersistedPendingNav();
    navigationHandled = true;
  }
  return url;
}

/**
 * Clear pending notification navigation without navigating. Use when another
 * handler has already routed for this tap, to prevent the post-auth consumer
 * or retry timers from firing a second navigate() and causing a visible jump.
 */
export function clearPendingNotificationNavigation() {
  pendingNavigationUrl = null;
  clearPersistedPendingNav();
  navigationHandled = true;
}

/**
 * Peek at the pending notification URL without consuming it.
 */
export function peekPendingNotificationNavigation(): string | null {
  return pendingNavigationUrl || readPersistedPendingNav();
}

/**
 * Check if a notification navigation has already been handled
 */
export function isNotificationNavigationHandled(): boolean {
  return navigationHandled;
}

/**
 * Initialize notification launch handler
 * Call this as early as possible in main.tsx
 */
export function initNotificationLaunchHandler() {
  // Only run on native platforms
  if (typeof window === 'undefined') return;
  
  const windowCapacitor = (window as any).Capacitor;
  if (!windowCapacitor || !windowCapacitor.isNativePlatform?.()) {
    console.log('[NotificationLaunch] Not a native platform, skipping');
    return;
  }
  
  console.log('[NotificationLaunch] Initializing notification launch handler');
  
  // Dynamically import and set up the listener immediately
  import('@capacitor/push-notifications')
    .then(({ PushNotifications }) => {
      console.log('[NotificationLaunch] Setting up pushNotificationActionPerformed listener');
      
      // Listen for notification taps
      PushNotifications.addListener(
        'pushNotificationActionPerformed',
        (notification) => {
          console.log('[NotificationLaunch] Notification action performed:', JSON.stringify(notification));
          
          // Extract the URL from notification data
          const data = notification.notification?.data;
          const url = data?.url || data?.link || data?.path;
          const storeUrl = data?.store_url;
          const forceUpdatePrompt = data?.force_update_prompt;
          
          // Handle force_update_prompt — open the store directly on notification tap when available
          if (forceUpdatePrompt === 'true') {
            console.log('[NotificationLaunch] Force update prompt detected');

            if (storeUrl) {
              console.log('[NotificationLaunch] Opening store URL from notification tap:', storeUrl);
              import('@capacitor/browser').then(({ Browser }) => {
                Browser.open({ url: storeUrl });
              }).catch(() => {
                window.open(storeUrl, '_system');
              });
              navigationHandled = true;
              return;
            }

            console.log('[NotificationLaunch] No store URL provided, storing prompt fallback');
            pendingForceUpdatePrompt = { storeUrl };
            window.dispatchEvent(new CustomEvent('force-update-prompt', {
              detail: { storeUrl },
            }));
            navigationHandled = true;
            return;
          }
          
          // Handle store_url (e.g. from update reminders) — open externally
          if (storeUrl) {
            console.log('[NotificationLaunch] Store URL detected, opening in browser:', storeUrl);
            import('@capacitor/browser').then(({ Browser }) => {
              Browser.open({ url: storeUrl });
            }).catch(() => {
              window.open(storeUrl, '_system');
            });
            navigationHandled = true;
            return;
          }
          
          // Best-effort preload: hydrate the message cache from the payload so
          // the chat page can render the new message at first paint instead of
          // waiting for the network refetch / realtime subscription. Safe no-op
          // if payload fields are missing.
          try { preloadMessageFromNotification(data); } catch {}

          // Stash the message id so the chat page can still scroll to the new
          // message even if the URL `?message=` search param is lost during
          // the Android cold-start route shuffle.
          try { captureJumpFromNotification(data, url); } catch {}

          if (url) {
            console.log('[NotificationLaunch] Found URL in notification:', url);
            
            // Check if this is an external URL (e.g. App Store / Play Store)
            try {
              const parsed = new URL(url);
              const appDomains = ['igniteclubhq.app', 'lovable.app', 'lovableproject.com', 'localhost'];
              const isExternal = !appDomains.some(d => parsed.hostname.endsWith(d));
              if (isExternal) {
                console.log('[NotificationLaunch] External URL detected, opening in browser:', url);
                import('@capacitor/browser').then(({ Browser }) => {
                  Browser.open({ url });
                }).catch(() => {
                  window.open(url, '_system');
                });
                navigationHandled = true;
                return;
              }
            } catch {
              // Not a full URL, treat as internal path
            }
            
            // Store for React Router navigation (in-memory + sessionStorage)
            // so the URL survives a slow auth bootstrap on Android cold start.
            console.log('[NotificationLaunch] Storing URL for React Router navigation');
            pendingNavigationUrl = url;
            navigationHandled = false;
            persistPendingNav(url);
          } else {
            console.log('[NotificationLaunch] No URL found in notification data:', JSON.stringify(data));
          }
        }
      );
      
      // Also check if app was opened via notification (for some edge cases)
      checkLaunchNotification(PushNotifications);
    })
    .catch((err) => {
      console.warn('[NotificationLaunch] Failed to load PushNotifications:', err);
    });
}

/**
 * Check for any notifications that launched the app
 */
async function checkLaunchNotification(PushNotifications: any) {
  try {
    // Get delivered notifications to see if we were launched from one
    const delivered = await PushNotifications.getDeliveredNotifications();
    console.log('[NotificationLaunch] Delivered notifications:', JSON.stringify(delivered));
  } catch (err) {
    console.warn('[NotificationLaunch] Error checking delivered notifications:', err);
  }
}

/**
 * Navigate to a URL, handling both absolute and relative URLs
 */
function navigateToUrl(url: string) {
  try {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      // Absolute URL - extract the path
      const urlObj = new URL(url);
      const path = urlObj.pathname + urlObj.search + urlObj.hash;
      console.log('[NotificationLaunch] Navigating to path:', path);
      window.location.href = path;
    } else if (url.startsWith('/')) {
      // Relative path
      console.log('[NotificationLaunch] Navigating to relative path:', url);
      window.location.href = url;
    } else {
      // Assume it's a relative path without leading slash
      console.log('[NotificationLaunch] Navigating to path:', '/' + url);
      window.location.href = '/' + url;
    }
    navigationHandled = true;
  } catch (err) {
    console.error('[NotificationLaunch] Error navigating:', err);
    // Fallback: try direct navigation
    window.location.href = url;
  }
}

/**
 * Process any pending notification navigation
 * Call this from a React component after the router is ready
 */
export function processPendingNotificationNavigation(navigate: (path: string) => void): boolean {
  const url = getPendingNotificationNavigation();
  if (url) {
    console.log('[NotificationLaunch] Processing pending navigation to:', url);
    
    // Extract just the path for React Router navigation
    let path = url;
    if (url.startsWith('http://') || url.startsWith('https://')) {
      try {
        const urlObj = new URL(url);
        path = urlObj.pathname + urlObj.search + urlObj.hash;
      } catch {
        path = url;
      }
    }
    
    navigate(path);
    return true;
  }
  return false;
}
