/**
 * Native Push Notifications using Capacitor + Firebase Cloud Messaging
 * 
 * This module handles push notifications for native Android/iOS apps
 * wrapped with Capacitor. Falls back gracefully when running in web browser.
 */

import { Capacitor } from '@capacitor/core';
import { supabase } from '@/integrations/supabase/client';

// Lazy load plugins to prevent import-time crashes when Firebase isn't configured
let PushNotifications: any = null;
let FirebaseMessaging: any = null;

async function loadPlugins(): Promise<boolean> {
  try {
    if (!PushNotifications) {
      const pushModule = await import('@capacitor/push-notifications');
      PushNotifications = pushModule.PushNotifications;
    }
    if (!FirebaseMessaging) {
      const fcmModule = await import('@capacitor-firebase/messaging');
      FirebaseMessaging = fcmModule.FirebaseMessaging;
    }
    return true;
  } catch (err) {
    console.warn('[NativePush] Failed to load plugins:', err);
    return false;
  }
}

// Platform detection
export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

export function getPlatform(): 'android' | 'ios' | 'web' {
  const platform = Capacitor.getPlatform();
  if (platform === 'android') return 'android';
  if (platform === 'ios') return 'ios';
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

// Initialize native push notifications
export async function initializeNativePush(userId: string): Promise<{ success: boolean; error?: string }> {
  if (!isNativePlatform()) {
    return { success: false, error: 'Not a native platform' };
  }

  console.log('[NativePush] Initializing for user:', userId);

  try {
    // Load plugins first
    const loaded = await loadPlugins();
    if (!loaded) {
      return { success: false, error: 'Failed to load push plugins' };
    }

    // Request permission
    let permission: 'granted' | 'denied' | 'prompt';
    try {
      permission = await requestNativePermission();
    } catch (permErr) {
      console.warn('[NativePush] Permission request failed:', permErr);
      return { success: false, error: 'Push plugin not available' };
    }
    
    if (permission !== 'granted') {
      return { success: false, error: 'Push notification permission denied' };
    }

    // Register with FCM
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
        
        const data = notification.notification?.data;
        if (data?.url) {
          window.location.href = data.url;
        }
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
