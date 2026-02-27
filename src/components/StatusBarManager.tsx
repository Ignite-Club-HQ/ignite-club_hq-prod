import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Keyboard } from '@capacitor/keyboard';
import { App } from '@capacitor/app';

/**
 * Get theme synchronously from DOM/localStorage (authoritative source)
 */
const getThemeSync = (): 'light' | 'dark' => {
  if (typeof window !== 'undefined') {
    // DOM classes are the authoritative source
    if (document.documentElement.classList.contains('dark')) return 'dark';
    if (document.documentElement.classList.contains('light')) return 'light';
    // Fallback to localStorage
    const stored = localStorage.getItem('app-theme');
    if (stored === 'dark' || stored === 'light') return stored;
  }
  return 'light';
};

/**
 * Manages the native status bar appearance on Capacitor apps.
 * Sets the status bar to have dark icons on light backgrounds
 * and light icons on dark backgrounds.
 * 
 * Uses synchronous DOM/localStorage reading to avoid flash on first launch.
 */
export function StatusBarManager() {
  const lastAppliedTheme = useRef<string | null>(null);

  const applyStatusBarStyle = async (theme: 'light' | 'dark', force = false) => {
    if (!Capacitor.isNativePlatform()) return;
    if (!force && lastAppliedTheme.current === theme) return;
    
    lastAppliedTheme.current = theme;
    console.log('[StatusBar] Applying style for theme:', theme, force ? '(forced)' : '');

    try {
      if (theme === 'dark') {
        await StatusBar.setStyle({ style: Style.Dark });
        if (Capacitor.getPlatform() === 'android') {
          await StatusBar.setBackgroundColor({ color: '#0f1512' });
        }
      } else {
        await StatusBar.setStyle({ style: Style.Light });
        if (Capacitor.getPlatform() === 'android') {
          await StatusBar.setBackgroundColor({ color: '#f5f7f6' });
        }
      }

      await StatusBar.setOverlaysWebView({ overlay: false });
    } catch (error) {
      console.log('[StatusBar] Error configuring status bar:', error);
    }
  };

  const applyIOSKeyboardConfig = async () => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') return;

    try {
      await Keyboard.setAccessoryBarVisible({ isVisible: false });
    } catch (error) {
      console.log('[StatusBar] Error configuring iOS keyboard accessory bar:', error);
    }
  };

  useEffect(() => {
    const initialTheme = getThemeSync();
    void applyStatusBarStyle(initialTheme);
    void applyIOSKeyboardConfig();

    // Re-apply on app resume (Android can reset status bar on background/foreground)
    let appListener: { remove: () => void } | undefined;
    if (Capacitor.isNativePlatform()) {
      App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          const currentTheme = getThemeSync();
          void applyStatusBarStyle(currentTheme, true); // force reapply
          void applyIOSKeyboardConfig();
        }
      }).then(handle => { appListener = handle; });
    }

    // Watch for theme changes via DOM class mutations
    const observer = new MutationObserver(() => {
      const currentTheme = getThemeSync();
      applyStatusBarStyle(currentTheme);
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
