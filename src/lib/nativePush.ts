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
    // Request permission
    const permission = await requestNativePermission();
    if (permission !== 'granted') {
      return { success: false, error: 'Push notification permission denied' };
    }

    // Register with FCM
    await PushNotifications.register();
    console.log('[NativePush] Registered with push service');

    // Get FCM token
    const tokenResult = await FirebaseMessaging.getToken();
    const token = tokenResult.token;
    
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
    console.error('[NativePush] Error initializing:', err);
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

  // Listen for push notifications received while app is in foreground
  const receivedListener = PushNotifications.addListener(
    'pushNotificationReceived',
    (notification) => {
      console.log('[NativePush] Notification received:', notification);
      onNotificationReceived?.(notification);
    }
  );

  // Listen for push notification actions (user tapped notification)
  const actionListener = PushNotifications.addListener(
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

  // Listen for token refresh
  const tokenListener = FirebaseMessaging.addListener(
    'tokenReceived',
    (event) => {
      console.log('[NativePush] Token refreshed');
      onTokenRefresh?.(event.token);
    }
  );

  // Return cleanup function
  return () => {
    receivedListener.then(l => l.remove());
    actionListener.then(l => l.remove());
    tokenListener.then(l => l.remove());
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
