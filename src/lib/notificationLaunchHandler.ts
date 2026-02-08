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

// Store pending navigation URL until the app is ready to handle it
let pendingNavigationUrl: string | null = null;
let navigationHandled = false;

/**
 * Get any pending navigation URL from a notification tap
 */
export function getPendingNotificationNavigation(): string | null {
  const url = pendingNavigationUrl;
  if (url) {
    pendingNavigationUrl = null; // Clear after reading
    navigationHandled = true;
  }
  return url;
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
          
          if (url) {
            console.log('[NotificationLaunch] Found URL in notification:', url);
            
            // If we're still in early startup, store for later navigation
            // Otherwise, navigate immediately
            if (document.readyState === 'loading') {
              console.log('[NotificationLaunch] App still loading, storing URL for later');
              pendingNavigationUrl = url;
            } else {
              console.log('[NotificationLaunch] Navigating immediately to:', url);
              // Give the app a moment to finish any initialization
              setTimeout(() => {
                navigateToUrl(url);
              }, 100);
            }
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
