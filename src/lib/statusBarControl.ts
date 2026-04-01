import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

/**
 * Centralized status bar control with serial queue to prevent
 * interleaved async calls that cause icon color mismatches.
 */

let pending: Promise<void> = Promise.resolve();
let lastApplied: string | null = null;

const getThemeSync = (): 'light' | 'dark' => {
  if (typeof window !== 'undefined') {
    if (document.documentElement.classList.contains('dark')) return 'dark';
    if (document.documentElement.classList.contains('light')) return 'light';
    const stored = localStorage.getItem('app-theme');
    if (stored === 'dark' || stored === 'light') return stored;
  }
  return 'light';
};

/**
 * Apply status bar style for the given theme.
 * Calls are serialized so concurrent invocations never interleave.
 */
export const applyStatusBar = (theme?: 'light' | 'dark', force = false): void => {
  const resolved = theme ?? getThemeSync();

  // Enqueue – each call waits for the previous one to finish
  pending = pending
    .then(() => applyInternal(resolved, force))
    .catch((err) => console.warn('[StatusBar] queue error', err));
};

/**
 * Re-read the current theme from DOM and force-apply.
 * Useful after app resume or overlay unmount.
 */
export const refreshStatusBar = (): void => {
  lastApplied = null; // force re-apply even if theme hasn't changed
  applyStatusBar(getThemeSync(), true);
};

/**
 * Apply dark status bar for fullscreen image/video viewers.
 * Goes through the serial queue to prevent interleaving.
 */
export const applyStatusBarForViewer = (): void => {
  pending = pending
    .then(() => applyViewerInternal())
    .catch((err) => console.warn('[StatusBar] viewer queue error', err));
};

// ── internal ────────────────────────────────────────────────
async function applyInternal(theme: 'light' | 'dark', force: boolean) {
  if (!Capacitor.isNativePlatform()) return;
  if (!force && lastApplied === theme) return;

  lastApplied = theme;
  const platform = Capacitor.getPlatform();

  try {
    // Ensure status bar is visible first
    await StatusBar.show();

    if (theme === 'dark') {
      await StatusBar.setStyle({ style: Style.Dark });
      if (platform === 'android') {
        await StatusBar.setBackgroundColor({ color: '#0f1512' });
      }
    } else {
      await StatusBar.setStyle({ style: Style.Light });
      if (platform === 'android') {
        await StatusBar.setBackgroundColor({ color: '#f5f7f6' });
      }
    }

    // Avoid re-toggling iOS WebView overlay state after native overlays like Camera,
    // which can leave the viewport/safe-area in a broken state on Capacitor iOS.
    if (platform === 'android') {
      await StatusBar.setOverlaysWebView({ overlay: false });
    }
  } catch (error) {
    console.warn('[StatusBar] Error configuring status bar:', error);
  }
}

// ── viewer (fullscreen black background) ────────────────────
async function applyViewerInternal() {
  if (!Capacitor.isNativePlatform()) return;

  lastApplied = null; // ensure refresh works after viewer closes

  try {
    await StatusBar.setStyle({ style: Style.Dark });
    if (Capacitor.getPlatform() === 'android') {
      await StatusBar.setBackgroundColor({ color: '#000000' });
      await StatusBar.setOverlaysWebView({ overlay: true });
    }
  } catch (error) {
    console.warn('[StatusBar] Error configuring viewer status bar:', error);
  }
}
