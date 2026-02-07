import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { useTheme } from 'next-themes';

/**
 * Manages the native status bar appearance on Capacitor apps.
 * Sets the status bar to have dark icons on light backgrounds
 * and light icons on dark backgrounds.
 */
export function StatusBarManager() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const updateStatusBar = async () => {
      if (!Capacitor.isNativePlatform()) return;

      try {
        // Set status bar style based on current theme
        // Dark theme = light icons, Light theme = dark icons
        if (resolvedTheme === 'dark') {
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

        // Make status bar overlay the WebView (for immersive look)
        await StatusBar.setOverlaysWebView({ overlay: true });
      } catch (error) {
        console.log('[StatusBar] Error configuring status bar:', error);
      }
    };

    updateStatusBar();
  }, [resolvedTheme]);

  return null;
}
