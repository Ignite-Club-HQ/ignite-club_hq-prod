import { supabase } from "@/integrations/supabase/client";

// VAPID public key - must match the server's VAPID_PUBLIC_KEY
const VAPID_PUBLIC_KEY = 'BIFKB_ZTDn9fhiF-crB2xQk1eNaKQQg0svSjsMV-KvM21y8L05Q6ZwZwDsqMR7-_1ZoV2J4RXRx56gjJFEhfWOw';

// Use sessionStorage-based mutex to prevent issues across page refreshes
// This is more reliable than module-level variables which can get stuck
const SUBSCRIPTION_LOCK_KEY = 'push_subscription_in_progress';

// Chrome Android and Samsung Internet have flaky push service - use shorter timeout
function getLockTimeout(): number {
  const ua = navigator.userAgent;
  const isChromeAndroid = /android/i.test(ua) && /chrome/i.test(ua) && !/samsungbrowser/i.test(ua);
  const isSamsungInternet = /samsungbrowser/i.test(ua);
  return (isChromeAndroid || isSamsungInternet) ? 10000 : 30000; // 10s for problematic browsers, 30s for others
}

type LockData = { timestamp: number; runId: string };

function getLock(): LockData | null {
  try {
    return JSON.parse(sessionStorage.getItem(SUBSCRIPTION_LOCK_KEY) || 'null');
  } catch {
    return null;
  }
}

function isLockStale(): boolean {
  const lock = getLock();
  if (!lock) return false;
  const elapsed = Date.now() - lock.timestamp;
  return elapsed > getLockTimeout();
}

function isSubscriptionLocked(): boolean {
  const lock = getLock();
  if (!lock) return false;

  if (isLockStale()) {
    console.log('[Push] Clearing stale lock');
    sessionStorage.removeItem(SUBSCRIPTION_LOCK_KEY);
    return false;
  }
  return true;
}

function setSubscriptionLock(): string {
  const runId = crypto.randomUUID();
  sessionStorage.setItem(SUBSCRIPTION_LOCK_KEY, JSON.stringify({ timestamp: Date.now(), runId }));
  return runId;
}

function clearSubscriptionLock(runId?: string): void {
  const lock = getLock();
  if (!lock) return;
  // Only clear if this run owns it (prevents a second caller clearing the first)
  if (!runId || lock.runId === runId) {
    sessionStorage.removeItem(SUBSCRIPTION_LOCK_KEY);
  }
}

/**
 * Force clear the subscription lock - use when user manually triggers reset
 */
export function forceUnlockPushSubscription(): void {
  console.log('[Push] Force clearing subscription lock');
  sessionStorage.removeItem(SUBSCRIPTION_LOCK_KEY);
}

/**
 * Clear stale locks on app startup/visibility change
 * Call this early in app initialization
 */
export function clearStalePushLocks(): void {
  if (isLockStale()) {
    console.log('[Push] Clearing stale lock on startup');
    sessionStorage.removeItem(SUBSCRIPTION_LOCK_KEY);
  }
}

/**
 * Wrap a promise with a timeout
 */
async function withTimeout<T>(p: Promise<T>, ms: number, message = 'Operation timed out'): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms))
  ]);
}

/**
 * Convert base64url to Uint8Array for applicationServerKey
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  if (typeof window === 'undefined') {
    return new Uint8Array(0);
  }
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Wait for a specified amount of time
 */
function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Ensure the service worker controls the page before subscribing
 */
async function ensureSWControlsPage(timeoutMs = 8000): Promise<boolean> {
  if (navigator.serviceWorker.controller) return true;

  return await new Promise<boolean>((resolve) => {
    const onChange = () => {
      cleanup();
      resolve(!!navigator.serviceWorker.controller);
    };

    const cleanup = () => {
      clearTimeout(t);
      navigator.serviceWorker.removeEventListener('controllerchange', onChange);
    };

    const t = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);

    navigator.serviceWorker.addEventListener('controllerchange', onChange);
  });
}

/**
 * Get service worker registration with proper activation handling
 */
async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) {
    console.log('[Push] Service workers not supported');
    return null;
  }

  try {
    console.log('[Push] Getting service worker registration...');
    
    // First, get existing registration for current page or register new one
    let registration = await navigator.serviceWorker.getRegistration();
    
    if (!registration) {
      console.log('[Push] No existing registration, registering new SW...');
      registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    }
    
    console.log('[Push] Registration found, state:', {
      active: !!registration.active,
      waiting: !!registration.waiting,
      installing: !!registration.installing
    });
    
    // If already active, return immediately
    if (registration.active) {
      console.log('[Push] SW already active');
      return registration;
    }
    
    // Wait for activation
    const worker = registration.installing || registration.waiting;
    if (worker) {
      console.log('[Push] Waiting for SW to activate, current state:', worker.state);
      
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          console.log('[Push] SW activation timeout after 10s');
          resolve(); // Don't reject, just continue
        }, 10000);
        
        const checkState = () => {
          if (worker.state === 'activated' || registration?.active) {
            clearTimeout(timeout);
            console.log('[Push] SW activated');
            resolve();
          } else if (worker.state === 'redundant') {
            clearTimeout(timeout);
            reject(new Error('Service worker became redundant'));
          }
        };
        
        worker.addEventListener('statechange', checkState);
        checkState(); // Check immediately in case already activated
      });
    }
    
    // Wait a bit more for the SW to fully stabilize
    await wait(500);
    
    // Re-fetch registration to ensure we have the latest state
    registration = await navigator.serviceWorker.getRegistration();
    
    if (registration?.active) {
      console.log('[Push] SW ready and active');
      return registration;
    }
    
    // Last resort: use navigator.serviceWorker.ready
    console.log('[Push] Falling back to navigator.serviceWorker.ready...');
    const readyRegistration = await Promise.race([
      navigator.serviceWorker.ready,
      wait(5000).then(() => null)
    ]);
    
    if (readyRegistration?.active) {
      return readyRegistration;
    }
    
    console.log('[Push] Could not get active SW');
    return null;
  } catch (error) {
    console.error('[Push] Error getting SW:', error);
    return null;
  }
}

/**
 * Check if we're in an iframe (Lovable preview, etc.)
 */
function isInIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/**
 * Check if we're in Lovable preview environment (where push won't work)
 */
function isLovablePreview(): boolean {
  try {
    const hostname = window.location.hostname;
    if (hostname === 'igniteclubhq.app' || hostname.endsWith('.igniteclubhq.app')) {
      return false;
    }
    if ((hostname.includes('lovableproject.com') || hostname.includes('lovable.app')) && isInIframe()) {
      console.log('[Push] Blocked: in Lovable preview iframe');
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Request notification permission
 */
async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'denied';
  }

  if (isInIframe()) {
    return window.Notification.permission;
  }

  if (window.Notification.permission === 'granted') {
    return 'granted';
  }

  if (window.Notification.permission === 'denied') {
    return 'denied';
  }

  try {
    const permission = await window.Notification.requestPermission();
    console.log('[Push] Permission request result:', permission);
    return permission;
  } catch (error) {
    console.error('[Push] Permission request error:', error);
    return 'denied';
  }
}

/**
 * Detect platform for analytics
 */
function detectPlatform(): string {
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/android/.test(ua)) return 'android';
  if (/mac/.test(ua)) return 'macos';
  if (/win/.test(ua)) return 'windows';
  return 'web';
}

/**
 * Subscribe to push notifications
 */
export async function subscribeToPushNotifications(userId: string, silent = false): Promise<{ success: boolean; error?: string }> {
  console.log('[Push] === Starting subscription ===');
  console.log('[Push] User ID:', userId);
  console.log('[Push] Silent mode:', silent);
  console.log('[Push] URL:', window.location.href);

  // Check for concurrent subscription using sessionStorage-based lock (survives page refresh)
  const existingLock = getLock();
  if (existingLock) {
    const lockAge = Date.now() - existingLock.timestamp;
    console.log('[Push] Lock exists, age:', lockAge, 'ms');
    
    // If lock is older than timeout, clear it
    if (lockAge > getLockTimeout()) {
      console.log('[Push] Clearing stale lock');
      sessionStorage.removeItem(SUBSCRIPTION_LOCK_KEY);
    } else {
      console.log('[Push] Subscription lock active, not proceeding to prevent AbortError');
      return { success: false, error: 'Push setup already in progress. If this persists, tap Reset Push Notifications.' };
    }
  }

  const runId = setSubscriptionLock();
  console.log('[Push] Lock acquired:', runId);

  try {
    // Check if in Lovable preview
    if (isLovablePreview()) {
      return { 
        success: false, 
        error: 'Push notifications are not available in the preview. Please open the published app directly.' 
      };
    }

    // Check browser support
    if (!('serviceWorker' in navigator)) {
      return { success: false, error: 'Service workers not supported in this browser' };
    }
    
    if (!('PushManager' in window)) {
      return { success: false, error: 'Push notifications not supported in this browser' };
    }

    if (typeof window === 'undefined' || !('Notification' in window)) {
      return { success: false, error: 'Notifications not supported in this browser' };
    }

    // Fail fast if notifications aren't actually usable
    if (!('showNotification' in ServiceWorkerRegistration.prototype)) {
      return { success: false, error: 'Notifications not supported on this device/browser.' };
    }

    console.log('[Push] Current notification permission:', window.Notification.permission);

    // In silent mode, only proceed if permission is already granted
    if (silent && window.Notification.permission !== 'granted') {
      return { success: false, error: 'Permission not granted' };
    }

    // Request permission
    const permission = await requestNotificationPermission();
    console.log('[Push] Permission result:', permission);
    
    if (permission === 'denied') {
      return { 
        success: false, 
        error: 'Notifications are blocked. Please enable them in your browser settings (click the lock icon in the address bar).' 
      };
    }

    if (permission !== 'granted') {
      return { success: false, error: 'Notification permission not granted.' };
    }

    // Get service worker registration
    console.log('[Push] Getting service worker...');
    const registration = await getServiceWorkerRegistration();
    
    if (!registration) {
      return { 
        success: false, 
        error: isInIframe() 
          ? 'Push requires the app to be opened directly. Please open in a new tab.'
          : 'Service worker not available. Please refresh and try again.' 
      };
    }

    if (!registration.active) {
      return { success: false, error: 'Service worker not active. Please refresh the page.' };
    }

    console.log('[Push] Service worker active:', registration.active.scriptURL);

    // Prepare VAPID key
    const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
    console.log('[Push] VAPID key prepared, length:', applicationServerKey.byteLength);
    
    if (applicationServerKey.byteLength !== 65) {
      return { success: false, error: 'Invalid VAPID key configuration' };
    }

    // Check for existing subscription first
    let subscription: PushSubscription | null = null;
    
    try {
      const existingSub = await registration.pushManager.getSubscription();
      console.log('[Push] Existing subscription:', existingSub ? 'found' : 'none');
      
      if (existingSub) {
        // We have an existing browser subscription - ALWAYS try to reuse it
        // Unsubscribing and resubscribing often causes AbortError on mobile
        console.log('[Push] Existing subscription found - will reuse it');
        
        // Check if this subscription is already in the database for this user
        try {
          const { data: existingDbSub } = await supabase
            .from('push_subscriptions')
            .select('endpoint')
            .eq('user_id', userId)
            .eq('endpoint', existingSub.endpoint)
            .maybeSingle();
          
          if (existingDbSub) {
            // Already fully set up - no need to do anything!
            console.log('[Push] Subscription already exists in database - returning success immediately');
            clearSubscriptionLock(runId);
            return { success: true };
          }
          
          // Browser subscription exists but NOT in database
          // Reuse the existing subscription and save it to the database
          console.log('[Push] Browser subscription exists but not in DB - adding to database');
          subscription = existingSub;
        } catch (dbError) {
          console.warn('[Push] Error checking DB for existing subscription:', dbError);
          // DB check failed - try to reuse the browser subscription anyway
          console.log('[Push] Reusing existing browser subscription (DB check failed)');
          subscription = existingSub;
        }
      }
    } catch (e) {
      console.warn('[Push] Error checking existing subscription:', e);
    }

    // Create new subscription if needed
    if (!subscription) {
      console.log('[Push] Creating new subscription...');
      
      // Ensure SW is ready + controlling
      const readyReg = await navigator.serviceWorker.ready;
      
      const controlled = await ensureSWControlsPage();
      console.log('[Push] controller?', !!navigator.serviceWorker.controller);
      console.log('[Push] readyReg scope:', readyReg.scope);
      console.log('[Push] controller script:', navigator.serviceWorker.controller?.scriptURL);
      
      if (!controlled) {
        return {
          success: false,
          error: 'Service worker not controlling this page yet. Please refresh once and try again.'
        };
      }
      
      // Always use the controlling registration for subscribe/getSubscription
      const controllingReg = readyReg;
      
      // Clear any stale subscription first (helps prevent AbortError)
      try {
        const stale = await controllingReg.pushManager.getSubscription();
        if (stale) {
          console.log('[Push] Found stale subscription, unsubscribing before re-subscribe...');
          await stale.unsubscribe();
          // Chrome Android needs extra time after unsubscribe
          await wait(800);
        }
      } catch (e) {
        console.warn('[Push] Error clearing stale subscription:', e);
      }
      
      // Detect if Chrome on Android or Samsung Internet - needs special handling
      const isChromeAndroid = /android/i.test(navigator.userAgent) && /chrome/i.test(navigator.userAgent) && !/samsungbrowser/i.test(navigator.userAgent);
      const isSamsungInternet = /samsungbrowser/i.test(navigator.userAgent);
      const needsSpecialHandling = isChromeAndroid || isSamsungInternet;
      console.log('[Push] Chrome Android detected:', isChromeAndroid);
      console.log('[Push] Samsung Internet detected:', isSamsungInternet);
      
      // Try subscribing with retry logic for AbortError
      let lastError: Error | null = null;
      const maxAttempts = needsSpecialHandling ? 5 : 3; // More retries for problematic browsers
      const retryDelays = needsSpecialHandling 
        ? [2000, 3000, 4000, 5000] // Longer delays for Chrome Android / Samsung
        : [1500, 2000, 2500];
      
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          console.log(`[Push] Subscribe attempt ${attempt}/${maxAttempts}...`);
          
          // Chrome Android / Samsung Internet workaround: Check push manager state before subscribe
          if (needsSpecialHandling && attempt > 1) {
            // Wait for push service to stabilize
            console.log('[Push] Android browser: waiting for push service to stabilize...');
            await wait(retryDelays[Math.min(attempt - 2, retryDelays.length - 1)]);
            
            // Re-check service worker is still active
            const freshReg = await navigator.serviceWorker.getRegistration();
            if (!freshReg?.active) {
              console.log('[Push] Android browser: SW became inactive, waiting for ready...');
              await navigator.serviceWorker.ready;
            }
          }
          
          subscription = await withTimeout(
            controllingReg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: applicationServerKey.buffer.slice(0) as ArrayBuffer
            }),
            20000, // Longer timeout for flaky mobile connections
            'Subscribe timed out'
          );
          
          console.log('[Push] Subscription created successfully!');
          lastError = null;
          break;
          
        } catch (subscribeError: any) {
          lastError = subscribeError;
          console.error(`[Push] Subscribe attempt ${attempt} failed:`, subscribeError?.name, '-', subscribeError?.message);
          
          if (subscribeError?.name === 'NotAllowedError') {
            // Permission issue, don't retry
            return { 
              success: false, 
              error: 'Push notifications blocked by browser. Enable in settings.' 
            };
          }
          
          // For AbortError on Chrome Android / Samsung Internet, don't wait between first few attempts
          if (attempt < maxAttempts) {
            const delay = needsSpecialHandling && subscribeError?.name === 'AbortError' 
              ? retryDelays[Math.min(attempt - 1, retryDelays.length - 1)]
              : 1500;
            console.log(`[Push] Waiting ${delay}ms before retry...`);
            await wait(delay);
          }
        }
      }
      
      if (lastError) {
        console.error('[Push] All subscription attempts failed:', lastError);
        
        if (lastError.name === 'AbortError') {
          // Chrome Android / Samsung Internet specific advice
          if (needsSpecialHandling) {
            const browserName = isSamsungInternet ? 'Samsung Internet' : 'Chrome on Android';
            return { 
              success: false, 
              error: `${browserName} cancelled the subscription. This is a known browser issue. Please: 1) Close and reopen the app, 2) Try again. If it persists, use "Reset" in Push Diagnostics below.` 
            };
          }
          return { 
            success: false, 
            error: 'Push subscription was cancelled by the browser. This can happen due to browser push service issues. Please try: 1) Use "Reset Push Notifications" button in Edit Profile, 2) Refresh the page, 3) Try again in a few minutes.' 
          };
        }
        
        return { 
          success: false, 
          error: lastError.message || 'Failed to subscribe to push notifications' 
        };
      }
    }
    
    if (!subscription) {
      return { success: false, error: 'Failed to create push subscription' };
    }
    
    console.log('[Push] Subscription ready, saving to database...');
    console.log('[Push] Endpoint:', subscription.endpoint.substring(0, 50) + '...');

    // Extract subscription data
    const json = subscription.toJSON();
    const endpoint = subscription.endpoint;
    const p256dh = json.keys?.p256dh;
    const auth = json.keys?.auth;

    if (!endpoint || !p256dh || !auth) {
      console.error('[Push] Invalid subscription data:', { endpoint: !!endpoint, p256dh: !!p256dh, auth: !!auth });
      return { success: false, error: 'Invalid subscription data from browser' };
    }

    // Save to database - delete old first, then insert
    const { error: deleteError } = await supabase
      .from('push_subscriptions')
      .delete()
      .eq('user_id', userId);

    if (deleteError) {
      console.warn('[Push] Error deleting old subscriptions:', deleteError);
    }

    const { error: insertError } = await supabase
      .from('push_subscriptions')
      .insert({
        user_id: userId,
        endpoint,
        p256dh,
        auth,
        platform: detectPlatform()
      });

    if (insertError) {
      console.error('[Push] Database insert error:', insertError);
      return { success: false, error: 'Failed to save subscription: ' + insertError.message };
    }

    console.log('[Push] === Subscription saved to database ===');
    console.log('[Push] === Subscription complete ===');
    return { success: true };

  } catch (error) {
    console.error('[Push] Unexpected error:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'An unexpected error occurred' 
    };
  } finally {
    clearSubscriptionLock(runId);
  }
}

/**
 * Unsubscribe from push notifications
 */
export async function unsubscribeFromPushNotifications(userId: string): Promise<boolean> {
  console.log('[Push] Unsubscribing user:', userId);
  
  try {
    // Remove from database
    await supabase
      .from('push_subscriptions')
      .delete()
      .eq('user_id', userId);

    // Unsubscribe from browser
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await subscription.unsubscribe();
        console.log('[Push] Unsubscribed from browser');
      }
    }

    return true;
  } catch (error) {
    console.error('[Push] Unsubscribe error:', error);
    return false;
  }
}

/**
 * Check if user has an active push subscription (checks browser subscription)
 * @param userId - Optional user ID to also verify subscription exists in database
 */
export async function checkPushSubscription(userId?: string): Promise<boolean> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      return false;
    }
    
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    
    if (!subscription) {
      return false;
    }
    
    // If userId provided, also verify it exists in database
    if (userId) {
      try {
        const { data } = await supabase
          .from('push_subscriptions')
          .select('id')
          .eq('user_id', userId)
          .eq('endpoint', subscription.endpoint)
          .maybeSingle();
        
        return !!data;
      } catch (e) {
        // If DB check fails, fall back to browser-only check
        console.warn('[Push] DB check failed, using browser subscription only:', e);
        return true;
      }
    }
    
    return true;
  } catch (error) {
    console.error('[Push] Check subscription error:', error);
    return false;
  }
}

/**
 * Reset push notifications - clears all state for a fresh start
 * @param userId - User ID to clear subscriptions for
 * @param reloadAfter - If true, will reload the page after reset to fully clear browser state
 */
export async function resetPushNotifications(userId?: string, reloadAfter = false): Promise<{ success: boolean; error?: string }> {
  console.log('[Push] === Resetting push notifications ===');
  console.log('[Push] Reload after:', reloadAfter);
  
  const isChromeAndroid = /android/i.test(navigator.userAgent) && /chrome/i.test(navigator.userAgent);
  
  try {
    // 1. Clear subscription lock
    clearSubscriptionLock();
    
    // 2. Remove from database
    if (userId) {
      await supabase
        .from('push_subscriptions')
        .delete()
        .eq('user_id', userId);
      console.log('[Push] Cleared database subscriptions');
    }

    // 3. Unsubscribe from all push subscriptions and unregister service workers
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      console.log('[Push] Found', registrations.length, 'service worker registrations');
      
      for (const registration of registrations) {
        try {
          const subscription = await registration.pushManager.getSubscription();
          if (subscription) {
            await subscription.unsubscribe();
            console.log('[Push] Unsubscribed from', registration.scope);
            // Chrome Android needs extra time between unsubscribe and unregister
            if (isChromeAndroid) {
              await new Promise(r => setTimeout(r, 500));
            }
          }
        } catch (e) {
          console.warn('[Push] Error unsubscribing:', e);
        }
        
        // Unregister the service worker
        try {
          await registration.unregister();
          console.log('[Push] Unregistered SW:', registration.scope);
        } catch (e) {
          console.warn('[Push] Error unregistering SW:', e);
        }
      }
      
      // Chrome Android: wait for cleanup to fully propagate
      if (isChromeAndroid) {
        console.log('[Push] Chrome Android: waiting for cleanup to propagate...');
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    // 4. Clear cached registration
    if (typeof window !== 'undefined') {
      delete window.__swRegistration;
    }

    // 5. Clear caches
    if ('caches' in window) {
      try {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(name => caches.delete(name)));
        console.log('[Push] Cleared', cacheNames.length, 'caches');
      } catch (e) {
        console.warn('[Push] Error clearing caches:', e);
      }
    }
    
    // 6. Clear any IndexedDB push-related data
    if ('indexedDB' in window) {
      try {
        // Some browsers store push state in IndexedDB
        const dbNames = ['push-notifications', 'workbox-precache', 'workbox-background-sync'];
        for (const dbName of dbNames) {
          try {
            indexedDB.deleteDatabase(dbName);
          } catch (e) {
            // Ignore
          }
        }
        console.log('[Push] Cleared IndexedDB databases');
      } catch (e) {
        console.warn('[Push] Error clearing IndexedDB:', e);
      }
    }

    console.log('[Push] === Reset complete ===');
    
    // 7. Reload page if requested - this fully clears browser push state
    if (reloadAfter && typeof window !== 'undefined') {
      console.log('[Push] Reloading page to fully clear browser state...');
      // Set a flag so we know we just reset
      try {
        sessionStorage.setItem('push_just_reset', 'true');
      } catch (e) {
        // Ignore storage errors
      }
      window.location.reload();
      return { success: true };
    }
    
    return { success: true };
  } catch (error) {
    console.error('[Push] Reset error:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Check if push was just reset (after page reload)
 */
export function wasJustReset(): boolean {
  try {
    const wasReset = sessionStorage.getItem('push_just_reset') === 'true';
    if (wasReset) {
      sessionStorage.removeItem('push_just_reset');
    }
    return wasReset;
  } catch {
    return false;
  }
}
