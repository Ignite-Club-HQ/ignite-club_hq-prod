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
          const pathWithQuery = `${url.pathname || '/'}${url.search || ''}`;
          if (pathWithQuery !== '/' && pathWithQuery !== '') {
            window.location.href = pathWithQuery;
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
        const rawPath = url.pathname || '/';
        const isHttpLike = url.protocol === 'http:' || url.protocol === 'https:';
        let path = rawPath;

        // Custom scheme links like igniteclubhq://events/123 have host="events", pathname="/123"
        if (!isHttpLike && url.host && !url.host.includes('.')) {
          path = `/${url.host}${rawPath === '/' ? '' : rawPath}`;
        }

        const fullSearch = url.search;
        const fullHash = url.hash;

        // Handle payment deep link callbacks
        if (path === '/payment-success' || url.host === 'payment-success') {
          console.log('[DeepLink] Payment success callback received');
          sessionStorage.setItem('paymentDeepLinkResult', 'success');
          // Navigate to home — Realtime listener handles actual status
          window.location.href = '/';
          return;
        }
        if (path === '/payment-cancel' || url.host === 'payment-cancel') {
          console.log('[DeepLink] Payment cancel callback received');
          sessionStorage.setItem('paymentDeepLinkResult', 'cancel');
          window.location.href = '/';
          return;
        }

        // Check for Google Drive OAuth callback (code param on /vault path)
        if (path === '/vault' && searchParams.get('code')) {
          const driveCode = searchParams.get('code');
          console.log('[DeepLink] Google Drive OAuth code detected, saving for VaultPage');
          sessionStorage.setItem('googleDriveOAuthCode', driveCode!);
          window.location.href = '/vault';
          return;
        }

        // Check for Google Drive OAuth error
        if (path === '/vault' && searchParams.get('error')) {
          const driveError = searchParams.get('error');
          console.log('[DeepLink] Google Drive OAuth error:', driveError);
          sessionStorage.setItem('googleDriveOAuthError', driveError!);
          window.location.href = '/vault';
          return;
        }

        if (path && path !== '/') {
          const destination = `${path}${fullSearch || ''}${fullHash || ''}`;
          console.log('[DeepLink] Navigating to path:', destination);
          window.location.href = destination;
        }
      }
    } catch (err) {
      console.error('[DeepLink] Error processing deep link:', err);
    }
  });
}
