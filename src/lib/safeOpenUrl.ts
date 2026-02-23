import { Capacitor } from '@capacitor/core';

/**
 * Safely open a URL on both web and native platforms.
 *
 * On web: uses window.open (standard behaviour).
 * On native (Capacitor): uses the Capacitor Browser plugin which opens an
 * in-app SFSafariViewController / Chrome Custom Tab — keeping the user inside
 * the app and avoiding App Store rejections for "leaving the app unexpectedly".
 *
 * Falls back to window.open if the Browser plugin isn't available.
 */
export async function safeOpenUrl(url: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    window.open(url, '_blank');
    return;
  }

  try {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url });
  } catch {
    // Fallback if Browser plugin unavailable
    window.open(url, '_blank');
  }
}
