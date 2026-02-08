import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

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

  const applyStatusBarStyle = async (theme: 'light' | 'dark') => {
    if (!Capacitor.isNativePlatform()) return;
    if (lastAppliedTheme.current === theme) return; // Skip if already applied
    
    lastAppliedTheme.current = theme;
    console.log('[StatusBar] Applying style for theme:', theme);

    try {
      // Set status bar style based on current theme
      // Dark theme = light icons, Light theme = dark icons
      if (theme === 'dark') {
        await StatusBar.setStyle({ style: Style.Dark });
        // On Android, also set the background color
        if (Capacitor.getPlatform() === 'android') {
          await StatusBar.setBackgroundColor({ color: '#0f1512' }); // dark background color
        }
      } else {
        await StatusBar.setStyle({ style: Style.Light });
        // On Android, also set the background color
        if (Capacitor.getPlatform() === 'android') {
          await StatusBar.setBackgroundColor({ color: '#f5f7f6' }); // light background color
        }
      }

      // Don't overlay - let the native platform handle status bar spacing
      await StatusBar.setOverlaysWebView({ overlay: false });
    } catch (error) {
      console.log('[StatusBar] Error configuring status bar:', error);
    }
  };

  useEffect(() => {
    // Apply immediately on mount using synchronous theme detection
    const initialTheme = getThemeSync();
    applyStatusBarStyle(initialTheme);

    // Watch for theme changes via DOM class mutations (authoritative source)
    const observer = new MutationObserver(() => {
      const currentTheme = getThemeSync();
      applyStatusBarStyle(currentTheme);
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => observer.disconnect();
  }, []);

  return null;
}
