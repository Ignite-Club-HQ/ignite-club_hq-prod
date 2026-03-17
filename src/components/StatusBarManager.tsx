import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';
import { App } from '@capacitor/app';
import { applyStatusBar, refreshStatusBar } from '@/lib/statusBarControl';

/**
 * Manages native status bar appearance on Capacitor apps.
 * Delegates all style calls to the serialized queue in statusBarControl
 * to prevent interleaved async calls that cause icon color mismatches.
 */
export function StatusBarManager() {
  useEffect(() => {
    // Initial apply (synchronous theme read inside statusBarControl)
    applyStatusBar();

    // iOS keyboard config
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios') {
      Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => {});
    }

    // Re-apply on app resume with a small delay to let WebView settle
    let appListener: { remove: () => void } | undefined;
    if (Capacitor.isNativePlatform()) {
      App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          // Delay 80ms – Android can reset status bar colors during resume
          setTimeout(() => refreshStatusBar(), 80);
        }
      }).then(handle => { appListener = handle; });
    }

    // Watch for theme changes via DOM class mutations
    const observer = new MutationObserver(() => {
      applyStatusBar(); // dedup handled inside queue
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => {
      observer.disconnect();
      appListener?.remove();
    };
  }, []);

  return null;
}
