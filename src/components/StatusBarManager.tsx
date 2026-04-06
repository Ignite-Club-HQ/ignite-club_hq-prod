import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';
import { App } from '@capacitor/app';
import { applyStatusBar, refreshStatusBar } from '@/lib/statusBarControl';
import { scheduleIOSNativeOverlayRecovery } from '@/lib/iosNativeOverlayRecovery';

/**
 * Manages native status bar appearance on Capacitor apps.
 * Delegates all style calls to the serialized queue in statusBarControl
 * to prevent interleaved async calls that cause icon color mismatches.
 */
export function StatusBarManager() {
  useEffect(() => {
    const isNativePlatform = Capacitor.isNativePlatform();
    const isNativeIOS = isNativePlatform && Capacitor.getPlatform() === 'ios';
    const isNativeAndroid = isNativePlatform && Capacitor.getPlatform() === 'android';
    let cancelIOSRecovery: (() => void) | null = null;

    // Set a stable viewport height CSS variable without letting keyboard-driven viewport changes shrink it.
    const setStableVh = () => {
      const visualViewportHeight = window.visualViewport?.height ?? 0;
      const stableHeight = Math.max(window.innerHeight, visualViewportHeight);
      document.documentElement.style.setProperty('--stable-vh', `${stableHeight}px`);
    };
    setStableVh();
    // Only update on orientation change, not on keyboard resize
    const handleOrientationChange = () => {
      setTimeout(setStableVh, 150);
    };
    window.addEventListener('orientationchange', handleOrientationChange);

    const queueIOSRecovery = () => {
      if (!isNativeIOS || typeof document === 'undefined') return;
      if (document.visibilityState === 'hidden') return;
      setStableVh();
      window.setTimeout(setStableVh, 250);
      window.setTimeout(setStableVh, 1000);
      cancelIOSRecovery?.();
      cancelIOSRecovery = scheduleIOSNativeOverlayRecovery([0, 320, 1100, 1800]);
    };

    // Initial apply (synchronous theme read inside statusBarControl)
    applyStatusBar();

    // iOS keyboard config
    if (isNativeIOS) {
      Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => {});
    }

    // Scroll focused input into view when keyboard appears (Android + iOS)
    let keyboardShowListener: { remove: () => void } | undefined;
    if (isNativePlatform) {
      Keyboard.addListener('keyboardDidShow', () => {
        setTimeout(() => {
          const activeElement = document.activeElement as HTMLElement | null;
          if (!activeElement) return;

          const isFormField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeElement.tagName);
          if (!isFormField) return;

          const hasKeyboardScrollLock = activeElement.closest('[data-lock-keyboard-scroll="true"]');
          if (hasKeyboardScrollLock) return;

          activeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
      }).then(handle => { keyboardShowListener = handle; });
    }

    // Re-apply on app resume with a small delay to let WebView settle
    let appListener: { remove: () => void } | undefined;
    if (isNativePlatform) {
      App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          if (isNativeIOS) {
            queueIOSRecovery();
          } else {
            // Android can reset status bar colors during resume – apply twice
            setTimeout(() => refreshStatusBar(), 80);
            setTimeout(() => refreshStatusBar(), 500);
          }
        }
      }).then(handle => { appListener = handle; });
    }

    const handleViewportResume = () => {
      queueIOSRecovery();
    };

    if (isNativeIOS && typeof document !== 'undefined' && typeof window !== 'undefined') {
      window.addEventListener('focus', handleViewportResume);
      window.addEventListener('pageshow', handleViewportResume);
      document.addEventListener('visibilitychange', handleViewportResume);
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
      keyboardShowListener?.remove();
      cancelIOSRecovery?.();
      window.removeEventListener('orientationchange', handleOrientationChange);
      if (isNativeIOS && typeof document !== 'undefined' && typeof window !== 'undefined') {
        window.removeEventListener('focus', handleViewportResume);
        window.removeEventListener('pageshow', handleViewportResume);
        document.removeEventListener('visibilitychange', handleViewportResume);
      }
    };
  }, []);

  return null;
}
