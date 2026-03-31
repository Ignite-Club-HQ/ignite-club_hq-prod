import { onlineManager, focusManager } from '@tanstack/react-query';
import { Capacitor } from '@capacitor/core';

/**
 * Configures React Query's onlineManager and focusManager for Capacitor
 * native environments where browser events don't fire reliably.
 */
export function setupReactQueryNativeAdapter() {
  if (!Capacitor.isNativePlatform()) return;

  // --- Online Manager ---
  // Listen for browser online/offline events (works in most webviews)
  // and also reconcile on app resume
  onlineManager.setEventListener((setOnline) => {
    const onlineHandler = () => setOnline(true);
    const offlineHandler = () => setOnline(false);

    window.addEventListener('online', onlineHandler);
    window.addEventListener('offline', offlineHandler);

    // Set initial state
    setOnline(navigator.onLine);

    return () => {
      window.removeEventListener('online', onlineHandler);
      window.removeEventListener('offline', offlineHandler);
    };
  });

  // --- Focus Manager ---
  // Use Capacitor App plugin to detect app resume/foreground
  import('@capacitor/app').then(({ App }) => {
    App.addListener('appStateChange', ({ isActive }) => {
      focusManager.setFocused(isActive);
    });

    // Also listen to visibilitychange as a fallback
    focusManager.setEventListener((setFocused) => {
      const handler = () => setFocused(document.visibilityState === 'visible');
      document.addEventListener('visibilitychange', handler);
      return () => document.removeEventListener('visibilitychange', handler);
    });
  });
}
