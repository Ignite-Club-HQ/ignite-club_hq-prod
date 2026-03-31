import { onlineManager, focusManager } from '@tanstack/react-query';
import { Capacitor } from '@capacitor/core';

/**
 * Configures React Query's onlineManager and focusManager for Capacitor
 * native environments where browser events don't fire reliably.
 * Uses @capacitor/network for accurate connectivity detection and
 * @capacitor/app for app foreground/background state.
 */
export function setupReactQueryNativeAdapter() {
  if (!Capacitor.isNativePlatform()) return;

  // --- Online Manager via Capacitor Network plugin ---
  onlineManager.setEventListener((setOnline) => {
    const listenerPromise = import('@capacitor/network').then(({ Network }) => {
      // Set initial state
      Network.getStatus().then((status) => setOnline(status.connected));
      // Listen for changes
      return Network.addListener('networkStatusChange', (status) => {
        setOnline(status.connected);
      });
    });

    return () => {
      listenerPromise.then((listener) => listener.remove());
    };
  });

  // --- Focus Manager via Capacitor App plugin ---
  import('@capacitor/app').then(({ App }) => {
    focusManager.setEventListener((handleFocus) => {
      const listenerPromise = App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) handleFocus();
      });

      return () => {
        listenerPromise.then((listener) => listener.remove());
      };
    });
  });
}
