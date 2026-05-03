import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';
import { App } from '@capacitor/app';
import { applyStatusBar, refreshStatusBar } from '@/lib/statusBarControl';
import { scheduleIOSNativeOverlayRecovery } from '@/lib/iosNativeOverlayRecovery';
import { readSafeAreaInsetBottomPx, readSafeAreaInsetTopPx } from '@/lib/iosLayoutStability';

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
    const isIOSLike = (() => {
      if (typeof navigator === 'undefined') return isNativeIOS;
      const userAgent = navigator.userAgent;
      const isIOSDevice = /iPad|iPhone|iPod/.test(userAgent);
      const isIpadOSDesktopMode = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
      return isNativeIOS || isIOSDevice || isIpadOSDesktopMode;
    })();
    let cancelIOSRecovery: (() => void) | null = null;
    let lockedIOSSafeAreaTop = 0;
    let lockedIOSStableVh = 0;

    const getNativeSafeAreaTopFloor = () => {
      if (!isIOSLike || typeof window === 'undefined') return 0;
      const shortestSide = Math.min(window.screen.width, window.screen.height);
      const longestSide = Math.max(window.screen.width, window.screen.height);
      const aspectRatio = longestSide / Math.max(shortestSide, 1);

      if (shortestSide >= 768) return 24;
      return aspectRatio >= 2 ? 44 : 20;
    };

    const setSafeAreaInsets = (options?: { resetTopLock?: boolean }) => {
      if (typeof document === 'undefined') return;

      const measuredTop = readSafeAreaInsetTopPx();
      const measuredBottom = readSafeAreaInsetBottomPx();
      const currentComputedTop = Number.parseFloat(
        window.getComputedStyle(document.documentElement).getPropertyValue('--safe-area-top') || '0',
      );
      const safeTopBase = isIOSLike
        ? Math.max(measuredTop, getNativeSafeAreaTopFloor())
        : measuredTop;
      const preservedTop = isIOSLike && !options?.resetTopLock
        ? Math.max(
            lockedIOSSafeAreaTop,
            Number.isFinite(currentComputedTop) ? currentComputedTop : 0,
          )
        : 0;
      const safeTop = isIOSLike ? Math.max(safeTopBase, preservedTop) : safeTopBase;

      lockedIOSSafeAreaTop = safeTop;

      document.documentElement.style.setProperty('--safe-area-top', `${safeTop}px`);
      document.documentElement.style.setProperty('--safe-area-bottom', `${Math.max(measuredBottom, 0)}px`);
    };

    // Set a stable viewport height CSS variable using the actually visible native viewport.
    const setStableVh = (options?: { resetLock?: boolean }) => {
      const visualViewportHeight = window.visualViewport?.height ?? 0;
      const innerHeight = window.innerHeight ?? 0;
      const measuredHeight = Math.max(visualViewportHeight, innerHeight);
      const stableHeight = isIOSLike && !options?.resetLock
        ? Math.max(measuredHeight, lockedIOSStableVh)
        : measuredHeight;
      if (!stableHeight) return;
      lockedIOSStableVh = stableHeight;
      document.documentElement.style.setProperty('--stable-vh', `${stableHeight}px`);
    };
    setStableVh({ resetLock: true });
    setSafeAreaInsets({ resetTopLock: true });
    // Only update on orientation change, not on keyboard resize
    const handleOrientationChange = () => {
      setTimeout(() => {
        setStableVh({ resetLock: true });
        setSafeAreaInsets({ resetTopLock: true });
      }, 150);
    };
    window.addEventListener('orientationchange', handleOrientationChange);

    const visualViewport = window.visualViewport;
    const handleViewportInsetChange = () => {
      setStableVh();
      setSafeAreaInsets();
    };

    visualViewport?.addEventListener('resize', handleViewportInsetChange);
    visualViewport?.addEventListener('scroll', handleViewportInsetChange);

    const queueIOSRecovery = () => {
      if (!isNativeIOS || typeof document === 'undefined') return;
      if (document.visibilityState === 'hidden') return;
      setStableVh();
      setSafeAreaInsets();
      window.setTimeout(setStableVh, 250);
      window.setTimeout(setStableVh, 1000);
      window.setTimeout(() => setSafeAreaInsets(), 250);
      window.setTimeout(() => setSafeAreaInsets(), 1000);
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
      visualViewport?.removeEventListener('resize', handleViewportInsetChange);
      visualViewport?.removeEventListener('scroll', handleViewportInsetChange);
      if (isNativeIOS && typeof document !== 'undefined' && typeof window !== 'undefined') {
        window.removeEventListener('focus', handleViewportResume);
        window.removeEventListener('pageshow', handleViewportResume);
        document.removeEventListener('visibilitychange', handleViewportResume);
      }
    };
  }, []);

  return null;
}
