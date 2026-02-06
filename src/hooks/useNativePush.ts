/**
 * React hook for managing native push notifications
 * 
 * Handles:
 * - Automatic initialization when user logs in
 * - Token refresh handling
 * - Notification listeners
 * - Cleanup on logout
 */

import { useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  isNativePlatform,
  initializeNativePush,
  setupNativePushListeners,
  unregisterNativePush,
  getPlatform,
} from '@/lib/nativePush';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface UseNativePushOptions {
  enabled?: boolean;
}

export function useNativePush(userId: string | undefined, options: UseNativePushOptions = {}) {
  const { enabled = true } = options;
  const navigate = useNavigate();
  const cleanupRef = useRef<(() => void) | null>(null);
  const initializedRef = useRef(false);

  // Save refreshed token to database
  const handleTokenRefresh = useCallback(async (token: string) => {
    if (!userId) return;
    
    console.log('[useNativePush] Token refreshed, saving...');
    try {
      const platform = getPlatform();
      // Use 'as any' since table may not be in generated types yet
      await supabase
        .from('fcm_tokens' as any)
        .upsert(
          {
            user_id: userId,
            token,
            platform,
            updated_at: new Date().toISOString(),
          },
          {
            onConflict: 'user_id,token',
          }
        );
    } catch (err) {
      console.error('[useNativePush] Error saving refreshed token:', err);
    }
  }, [userId]);

  // Handle notification tap - navigate to relevant page
  const handleNotificationAction = useCallback((notification: any) => {
    const data = notification.notification?.data;
    if (data?.url) {
      // Parse the URL and navigate
      try {
        const url = new URL(data.url, window.location.origin);
        navigate(url.pathname + url.search);
      } catch {
        // Fallback to direct navigation
        navigate(data.url);
      }
    }
  }, [navigate]);

  // Initialize native push when user is available
  useEffect(() => {
    if (!userId || !enabled || !isNativePlatform() || initializedRef.current) {
      return;
    }

    const init = async () => {
      console.log('[useNativePush] Initializing native push...');
      
      const result = await initializeNativePush(userId);
      
      if (result.success) {
        console.log('[useNativePush] Native push initialized successfully');
        initializedRef.current = true;
        
        // Setup listeners
        cleanupRef.current = setupNativePushListeners(
          // onNotificationReceived - show toast for foreground notifications
          (notification) => {
            toast(notification.title || 'New notification', {
              description: notification.body,
            });
          },
          // onNotificationAction - handle tap
          handleNotificationAction,
          // onTokenRefresh - save new token
          handleTokenRefresh
        );
      } else {
        console.warn('[useNativePush] Failed to initialize:', result.error);
      }
    };

    init();

    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [userId, enabled, handleNotificationAction, handleTokenRefresh]);

  // Cleanup on logout
  const cleanup = useCallback(async () => {
    if (!userId) return;
    
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    
    await unregisterNativePush(userId);
    initializedRef.current = false;
  }, [userId]);

  return {
    isNative: isNativePlatform(),
    cleanup,
  };
}
