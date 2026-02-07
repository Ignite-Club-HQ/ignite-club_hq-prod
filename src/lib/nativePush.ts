/**
 * Native Push Notifications using Capacitor + Firebase Cloud Messaging
 * 
 * This module handles push notifications for native Android/iOS apps
 * wrapped with Capacitor. Falls back gracefully when running in web browser.
 */

import { Capacitor } from '@capacitor/core';
import { PushNotifications, Token, ActionPerformed, PushNotificationSchema } from '@capacitor/push-notifications';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { supabase } from '@/integrations/supabase/client';

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
    // Check if plugin is available before calling it
    if (!PushNotifications || typeof PushNotifications.requestPermissions !== 'function') {
      console.warn('[NativePush] PushNotifications plugin not available');
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
    // Don't let this crash the app - just return denied
    return 'denied';
  }
}

// Check current permission status
export async function checkNativePermission(): Promise<'granted' | 'denied' | 'prompt'> {
  if (!isNativePlatform()) {
    return 'denied';
  }

  try {
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
    // Request permission - wrapped in try/catch to handle plugin not available
    let permission: 'granted' | 'denied' | 'prompt';
    try {
      permission = await requestNativePermission();
    } catch (permErr) {
      console.warn('[NativePush] Permission request failed (plugin may not be configured):', permErr);
      return { success: false, error: 'Push plugin not available' };
    }
    
    if (permission !== 'granted') {
      return { success: false, error: 'Push notification permission denied' };
    }

    // Register with FCM - this can crash if Firebase is not configured
    try {
      await PushNotifications.register();
      console.log('[NativePush] Registered with push service');
    } catch (regErr) {
      console.warn('[NativePush] Registration failed (Firebase may not be configured):', regErr);
      return { success: false, error: 'Push registration failed - Firebase not configured' };
    }

    // Get FCM token - wrapped separately to catch Firebase-specific errors
    let token: string | undefined;
    try {
      const tokenResult = await FirebaseMessaging.getToken();
      token = tokenResult.token;
    } catch (tokenErr) {
      console.warn('[NativePush] Failed to get FCM token (Firebase not configured?):', tokenErr);
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
    // Catch-all for any unexpected errors - should never crash the app
    console.error('[NativePush] Unexpected error initializing:', err);
    return { success: false, error: String(err) };
  }
}

// Setup push notification listeners
export function setupNativePushListeners(
  onNotificationReceived?: (notification: PushNotificationSchema) => void,
  onNotificationAction?: (notification: ActionPerformed) => void,
  onTokenRefresh?: (token: string) => void
): () => void {
  if (!isNativePlatform()) {
    return () => {};
  }

  console.log('[NativePush] Setting up listeners');

  // Wrap all listener setup in try/catch to prevent crashes if plugins aren't ready
  let receivedListener: Promise<any> | null = null;
  let actionListener: Promise<any> | null = null;
  let tokenListener: Promise<any> | null = null;

  try {
    // Listen for push notifications received while app is in foreground
    receivedListener = PushNotifications.addListener(
      'pushNotificationReceived',
      (notification) => {
        console.log('[NativePush] Notification received:', notification);
        onNotificationReceived?.(notification);
      }
    );
  } catch (err) {
    console.warn('[NativePush] Failed to add received listener:', err);
  }

  try {
    // Listen for push notification actions (user tapped notification)
    actionListener = PushNotifications.addListener(
      'pushNotificationActionPerformed',
      (notification) => {
        console.log('[NativePush] Notification action:', notification);
        onNotificationAction?.(notification);
        
        // Handle deep linking based on notification data
        const data = notification.notification.data;
        if (data?.url) {
          // Navigate to the URL
          window.location.href = data.url;
        }
      }
    );
  } catch (err) {
    console.warn('[NativePush] Failed to add action listener:', err);
  }

  try {
    // Listen for token refresh
    tokenListener = FirebaseMessaging.addListener(
      'tokenReceived',
      (event) => {
        console.log('[NativePush] Token refreshed');
        onTokenRefresh?.(event.token);
      }
    );
  } catch (err) {
    console.warn('[NativePush] Failed to add token listener:', err);
  }

  // Return cleanup function
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
    // Get current token before unregistering
    const tokenResult = await FirebaseMessaging.getToken();
    if (tokenResult.token) {
      await removeFCMToken(userId, tokenResult.token);
    }

    // Delete the FCM token
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
