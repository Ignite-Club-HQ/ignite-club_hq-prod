import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

/**
 * Centralized status bar control with serial queue to prevent
 * interleaved async calls that cause icon color mismatches.
 */

let pending: Promise<void> = Promise.resolve();
let lastApplied: string | null = null;

const LIGHT_STATUS_BAR_BG = '#f5f7f6';
const DARK_STATUS_BAR_BG = '#0f1512';
const VIEWER_STATUS_BAR_BG = '#000000';

const getThemeSync = (): 'light' | 'dark' => {
  if (typeof window !== 'undefined') {
    if (document.documentElement.classList.contains('dark')) return 'dark';
    if (document.documentElement.classList.contains('light')) return 'light';
    const stored = localStorage.getItem('app-theme');
    if (stored === 'dark' || stored === 'light') return stored;
  }
  return 'light';
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function syncAndroidStatusBar(style: Style, backgroundColor: string, overlay: boolean) {
  await StatusBar.setOverlaysWebView({ overlay });
  await StatusBar.setBackgroundColor({ color: backgroundColor });
  await StatusBar.setStyle({ style });

  // Android occasionally reverts icon color during startup/resume after background/overlay updates.
  await wait(32);
  await StatusBar.setStyle({ style });
}

/**
 * Apply status bar style for the given theme.
 * Calls are serialized so concurrent invocations never interleave.
 */
export const applyStatusBar = (theme?: 'light' | 'dark', force = false): void => {
  const resolved = theme ?? getThemeSync();

  pending = pending
    .then(() => applyInternal(resolved, force))
    .catch((err) => console.warn('[StatusBar] queue error', err));
};

/**
 * Re-read the current theme from DOM and force-apply.
 * Useful after app resume or overlay unmount.
 */
export const refreshStatusBar = (): void => {
  lastApplied = null;
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
  const style = theme === 'dark' ? Style.Light : Style.Dark;
  const backgroundColor = theme === 'dark' ? DARK_STATUS_BAR_BG : LIGHT_STATUS_BAR_BG;

  try {
    await StatusBar.show();

    if (platform === 'android') {
      await syncAndroidStatusBar(style, backgroundColor, false);
    } else {
      await StatusBar.setStyle({ style });
    }
  } catch (error) {
    console.warn('[StatusBar] Error configuring status bar:', error);
  }
}

// ── viewer (fullscreen black background) ────────────────────
async function applyViewerInternal() {
  if (!Capacitor.isNativePlatform()) return;

  lastApplied = null;

  try {
    if (Capacitor.getPlatform() === 'android') {
      await syncAndroidStatusBar(Style.Light, VIEWER_STATUS_BAR_BG, true);
    } else {
      await StatusBar.setStyle({ style: Style.Light });
    }
  } catch (error) {
    console.warn('[StatusBar] Error configuring viewer status bar:', error);
  }
}
