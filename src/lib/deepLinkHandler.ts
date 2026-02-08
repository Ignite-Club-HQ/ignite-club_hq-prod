import { App, URLOpenListenerEvent } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/integrations/supabase/client';

/**
 * Initialize deep link handling for native apps
 * This captures OAuth callbacks when the system browser redirects back to the app
 */
export function initDeepLinkHandler() {
  if (!Capacitor.isNativePlatform()) {
    return;
  }

  console.log('[DeepLink] Initializing deep link handler for native platform');

  App.addListener('appUrlOpen', async (event: URLOpenListenerEvent) => {
    console.log('[DeepLink] App opened with URL:', event.url);

    try {
      const url = new URL(event.url);
      
      // Check for OAuth callback tokens in hash or search params
      const hashParams = new URLSearchParams(url.hash.substring(1));
      const searchParams = url.searchParams;
      
      // Supabase OAuth returns tokens in the hash fragment
      const accessToken = hashParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token');
      
      // PKCE flow returns code in search params
      const code = searchParams.get('code');
      
      if (accessToken && refreshToken) {
        console.log('[DeepLink] OAuth tokens found in hash, setting session...');
        
        const { data, error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        
        if (error) {
          console.error('[DeepLink] Error setting session:', error);
        } else {
          console.log('[DeepLink] Session set successfully, user:', data.user?.id);
          
          // Navigate to the intended path or home
          const path = url.pathname || '/';
          if (path !== '/' && path !== '') {
            window.location.href = path;
          } else {
            // Force a refresh to trigger auth state change
            window.location.href = '/';
          }
        }
      } else if (code) {
        console.log('[DeepLink] OAuth code found, exchanging for session...');
        
        // Exchange the code for a session (PKCE flow)
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        
        if (error) {
          console.error('[DeepLink] Error exchanging code:', error);
        } else {
          console.log('[DeepLink] Code exchanged successfully, user:', data.user?.id);
          
          // Navigate to home after successful auth
          window.location.href = '/';
        }
      } else {
        // Not an OAuth callback, handle as regular deep link navigation
        const path = url.pathname;
        if (path && path !== '/') {
          console.log('[DeepLink] Navigating to path:', path);
          window.location.href = path;
        }
      }
    } catch (err) {
      console.error('[DeepLink] Error processing deep link:', err);
    }
  });
}
