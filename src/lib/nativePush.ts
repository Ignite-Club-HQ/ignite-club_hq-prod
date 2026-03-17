/**
 * Native Push Notifications using Capacitor + Firebase Cloud Messaging
 * 
 * This module handles push notifications for native Android/iOS apps
 * wrapped with Capacitor. Falls back gracefully when running in web browser.
 * 
 * IMPORTANT: Firebase must be properly configured with google-services.json (Android)
 * or GoogleService-Info.plist (iOS) for push notifications to work.
 * Without these files, attempting to use Firebase plugins will crash the app.
 */

import { supabase } from '@/integrations/supabase/client';

// Lazy load Capacitor core to prevent crashes if not available
let Capacitor: any = null;
let capacitorLoaded = false;

// Lazy load plugins to prevent import-time crashes when Firebase isn't configured
let PushNotifications: any = null;
let FirebaseMessaging: any = null;
let pluginsChecked = false;
let pluginsAvailable = false;

// Safely load Capacitor core
async function loadCapacitor(): Promise<boolean> {
  if (capacitorLoaded) return Capacitor !== null;
  
  try {
    const capacitorModule = await import('@capacitor/core');
    Capacitor = capacitorModule.Capacitor;
    capacitorLoaded = true;
    return true;
  } catch (err) {
    console.warn('[NativePush] Capacitor not available:', err);
    capacitorLoaded = true;
    return false;
  }
}

// Check if we're on a native platform (must be called after loadCapacitor)
function checkIsNative(): boolean {
  if (!Capacitor) return false;
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

async function loadPlugins(): Promise<boolean> {
  // Only check once to avoid repeated failures
  if (pluginsChecked) return pluginsAvailable;
  pluginsChecked = true;
  
  // First ensure Capacitor is loaded
  const capacitorOk = await loadCapacitor();
  if (!capacitorOk || !checkIsNative()) {
    console.log('[NativePush] Not a native platform, skipping plugin load');
    return false;
  }
  
  try {
    // Load PushNotifications first - this is less likely to crash
    if (!PushNotifications) {
      const pushModule = await import('@capacitor/push-notifications');
      PushNotifications = pushModule.PushNotifications;
    }
    
    // Try loading Firebase - this WILL fail if google-services.json is missing
    // The try/catch here helps, but the native side may still crash
    if (!FirebaseMessaging) {
      try {
        const fcmModule = await import('@capacitor-firebase/messaging');
        FirebaseMessaging = fcmModule.FirebaseMessaging;
        
        // Test if Firebase is actually usable by checking a simple method
        // This can throw if Firebase isn't properly initialized on native side
        await FirebaseMessaging.checkPermissions();
        console.log('[NativePush] Firebase Messaging loaded and available');
      } catch (fcmErr: any) {
        // Firebase not configured - this is expected if google-services.json is missing
        console.warn('[NativePush] Firebase Messaging not available:', fcmErr?.message || fcmErr);
        FirebaseMessaging = null;
        // Continue without Firebase - at least basic push might work
      }
    }
    
    pluginsAvailable = PushNotifications !== null;
    return pluginsAvailable;
  } catch (err) {
    console.warn('[NativePush] Failed to load plugins:', err);
    return false;
  }
}

// Platform detection - safe synchronous checks
export function isNativePlatform(): boolean {
  // Check window.Capacitor which is injected by Capacitor in native WebViews
  // This works synchronously without needing dynamic imports
  const windowCapacitor = (window as any).Capacitor;
  
  if (windowCapacitor) {
    // Cache it for later use
    if (!Capacitor) {
      Capacitor = windowCapacitor;
      capacitorLoaded = true;
    }
    try {
      const isNative = windowCapacitor.isNativePlatform?.() ?? false;
      console.log('[NativePush] isNativePlatform check (window.Capacitor):', isNative);
      return isNative;
    } catch {
      return false;
    }
  }
  
  // Fallback to cached Capacitor if already loaded via async
  if (capacitorLoaded && Capacitor) {
    const isNative = checkIsNative();
    console.log('[NativePush] isNativePlatform check (cached):', isNative);
    return isNative;
  }
  
  // Not loaded yet and no window.Capacitor - assume web
  console.log('[NativePush] isNativePlatform: no Capacitor detected, assuming web');
  return false;
}

export function getPlatform(): 'android' | 'ios' | 'web' {
  if (!Capacitor) return 'web';
  try {
    const platform = Capacitor.getPlatform();
    if (platform === 'android') return 'android';
    if (platform === 'ios') return 'ios';
  } catch {
    // Capacitor not properly initialized
  }
  return 'web';
}

// FCM token types (since table is new and not in generated types yet)
interface FCMToken {
  id: string;
  user_id: string;
  token: string;
  platform: 'android' | 'ios';
  created_at: string;
  updated_at: string;
}

// Store FCM token in database
async function saveFCMToken(userId: string, token: string): Promise<boolean> {
  console.log('[NativePush] Saving FCM token for user:', userId);
  
  try {
    const platform = getPlatform();
    
    // IMPORTANT: Use security definer RPC to remove this token from other users.
    // Direct .delete() is blocked by RLS since users can't delete other users' rows.
    await supabase.rpc('cleanup_fcm_token_for_user', {
      p_token: token,
      p_user_id: userId,
    });
    
    // Use direct upsert - 'as any' needed since fcm_tokens is new and not in generated types
    const { error: insertError } = await supabase
      .from('fcm_tokens' as any)
      .upsert(
        {
          user_id: userId,
          token,
          platform,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,token' }
      );
    
    if (insertError && !insertError.message?.includes('duplicate')) {
      console.error('[NativePush] Error saving token:', insertError);
      return false;
    }
    
    console.log('[NativePush] Token saved successfully');
    return true;
  } catch (err) {
    console.error('[NativePush] Error in saveFCMToken:', err);
    return false;
  }
}

// Remove FCM token from database
async function removeFCMToken(userId: string, token: string): Promise<void> {
  try {
    await supabase
      .from('fcm_tokens' as any)
      .delete()
      .eq('user_id', userId)
      .eq('token', token);
  } catch (err) {
    console.error('[NativePush] Error removing token:', err);
  }
}

// Request permission for native push notifications
export async function requestNativePermission(): Promise<'granted' | 'denied' | 'prompt'> {
  if (!isNativePlatform()) {
    console.log('[NativePush] Not a native platform, skipping');
    return 'denied';
  }

  try {
    const loaded = await loadPlugins();
    if (!loaded || !PushNotifications) {
      console.warn('[NativePush] Plugins not available');
      return 'denied';
    }
    
    const result = await PushNotifications.requestPermissions();
    console.log('[NativePush] Permission result:', result.receive);
    
    if (result.receive === 'granted') {
      return 'granted';
    } else if (result.receive === 'denied') {
      return 'denied';
    }
    return 'prompt';
  } catch (err) {
    console.error('[NativePush] Error requesting permission:', err);
    return 'denied';
  }
}

// Check current permission status
export async function checkNativePermission(): Promise<'granted' | 'denied' | 'prompt'> {
  if (!isNativePlatform()) {
    return 'denied';
  }

  try {
    const loaded = await loadPlugins();
    if (!loaded || !PushNotifications) return 'denied';
    
    const result = await PushNotifications.checkPermissions();
    if (result.receive === 'granted') return 'granted';
    if (result.receive === 'denied') return 'denied';
    return 'prompt';
  } catch {
    return 'denied';
  }
}

// Check for launch notification (notification that opened the app from cold start)
export async function getLaunchNotification(): Promise<any | null> {
  if (!isNativePlatform()) return null;
  
  try {
    const loaded = await loadPlugins();
    if (!loaded || !PushNotifications) return null;
    
    // This returns the notification that was used to launch the app
    const launchNotification = await PushNotifications.getDeliveredNotifications();
    console.log('[NativePush] Checking for launch notification, delivered:', launchNotification);
    
    // On Android, we can also check the launch URL from App plugin
    return null; // Capacitor doesn't directly expose this, but pushNotificationActionPerformed should fire
  } catch (err) {
    console.warn('[NativePush] Error checking launch notification:', err);
    return null;
  }
}

// Initialize native push notifications
export async function initializeNativePush(userId: string): Promise<{ success: boolean; error?: string }> {
  console.log('[NativePush] initializeNativePush called with userId:', userId);
  
  if (!isNativePlatform()) {
    console.log('[NativePush] Not a native platform, returning early');
    return { success: false, error: 'Not a native platform' };
  }

  console.log('[NativePush] Initializing for user:', userId);

  try {
    // Load plugins first
    console.log('[NativePush] Loading plugins...');
    const loaded = await loadPlugins();
    console.log('[NativePush] Plugins loaded:', loaded);
    
    if (!loaded) {
      return { success: false, error: 'Failed to load push plugins' };
    }

    // Request permission
    console.log('[NativePush] Requesting permission...');
    let permission: 'granted' | 'denied' | 'prompt';
    try {
      permission = await requestNativePermission();
      console.log('[NativePush] Permission result:', permission);
    } catch (permErr) {
      console.warn('[NativePush] Permission request failed:', permErr);
      return { success: false, error: 'Push plugin not available' };
    }
    
    if (permission !== 'granted') {
      return { success: false, error: 'Push notification permission denied' };
    }

    // Register with FCM
    console.log('[NativePush] Registering with push service...');
    try {
      await PushNotifications.register();
      console.log('[NativePush] Registered with push service');
    } catch (regErr) {
      console.warn('[NativePush] Registration failed:', regErr);
      return { success: false, error: 'Push registration failed' };
    }

    // Get FCM token
    let token: string | undefined;
    try {
      if (!FirebaseMessaging) {
        return { success: false, error: 'Firebase not configured' };
      }
      const tokenResult = await FirebaseMessaging.getToken();
      token = tokenResult.token;
    } catch (tokenErr) {
      console.warn('[NativePush] Failed to get FCM token:', tokenErr);
      return { success: false, error: 'FCM token retrieval failed' };
    }
    
    if (!token) {
      return { success: false, error: 'Failed to get FCM token' };
    }

    console.log('[NativePush] Got FCM token:', token.substring(0, 20) + '...');

    // Save token to database
    const saved = await saveFCMToken(userId, token);
    if (!saved) {
      return { success: false, error: 'Failed to save FCM token' };
    }

    return { success: true };
  } catch (err) {
    console.error('[NativePush] Unexpected error initializing:', err);
    return { success: false, error: String(err) };
  }
}

// Setup push notification listeners
export function setupNativePushListeners(
  onNotificationReceived?: (notification: any) => void,
  onNotificationAction?: (notification: any) => void,
  onTokenRefresh?: (token: string) => void
): () => void {
  if (!isNativePlatform()) {
    return () => {};
  }

  // If plugins haven't been loaded yet, we can't set up listeners
  if (!PushNotifications) {
    console.warn('[NativePush] Cannot setup listeners - plugins not loaded');
    return () => {};
  }

  console.log('[NativePush] Setting up listeners');

  let receivedListener: Promise<any> | null = null;
  let actionListener: Promise<any> | null = null;
  let tokenListener: Promise<any> | null = null;

  try {
    receivedListener = PushNotifications.addListener(
      'pushNotificationReceived',
      (notification: any) => {
        console.log('[NativePush] Notification received:', notification);
        onNotificationReceived?.(notification);
      }
    );
  } catch (err) {
    console.warn('[NativePush] Failed to add received listener:', err);
  }

  try {
    actionListener = PushNotifications.addListener(
      'pushNotificationActionPerformed',
      (notification: any) => {
        console.log('[NativePush] Notification action:', notification);
        onNotificationAction?.(notification);
        // Navigation is handled by onNotificationAction callback via React Router
        // Do NOT use window.location.href here - it bypasses the SPA router and causes 404s
      }
    );
  } catch (err) {
    console.warn('[NativePush] Failed to add action listener:', err);
  }

  try {
    if (FirebaseMessaging) {
      tokenListener = FirebaseMessaging.addListener(
        'tokenReceived',
        (event: any) => {
          console.log('[NativePush] Token refreshed');
          onTokenRefresh?.(event.token);
        }
      );
    }
  } catch (err) {
    console.warn('[NativePush] Failed to add token listener:', err);
  }

  return () => {
    receivedListener?.then(l => l.remove()).catch(() => {});
    actionListener?.then(l => l.remove()).catch(() => {});
    tokenListener?.then(l => l.remove()).catch(() => {});
  };
}

// Unregister from push notifications
export async function unregisterNativePush(userId: string): Promise<void> {
  if (!isNativePlatform()) return;

  try {
    const loaded = await loadPlugins();
    if (!loaded || !FirebaseMessaging) return;
    
    const tokenResult = await FirebaseMessaging.getToken();
    if (tokenResult.token) {
      await removeFCMToken(userId, tokenResult.token);
    }

    await FirebaseMessaging.deleteToken();
    console.log('[NativePush] Unregistered successfully');
  } catch (err) {
    console.error('[NativePush] Error unregistering:', err);
  }
}

// Check if native push is available and enabled
export async function isNativePushAvailable(): Promise<boolean> {
  if (!isNativePlatform()) return false;
  
  try {
    const permission = await checkNativePermission();
    return permission === 'granted';
  } catch {
    return false;
  }
}
