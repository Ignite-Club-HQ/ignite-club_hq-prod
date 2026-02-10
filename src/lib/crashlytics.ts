/**
 * Firebase Crashlytics integration for native crash reporting.
 * Only active on native platforms (Android/iOS via Capacitor).
 */

let crashlyticsPlugin: any = null;
let initialized = false;

/**
 * Initialize Crashlytics on native platforms.
 * Call this early in the app lifecycle (main.tsx).
 */
export async function initCrashlytics(): Promise<void> {
  if (initialized) return;
  initialized = true;

  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) {
      console.log('[Crashlytics] Not a native platform, skipping');
      return;
    }

    const { FirebaseCrashlytics } = await import('@capacitor-firebase/crashlytics');
    crashlyticsPlugin = FirebaseCrashlytics;

    // Enable crash collection
    await FirebaseCrashlytics.setEnabled({ enabled: true });
    console.log('[Crashlytics] Initialized successfully');

    // Log app start as a breadcrumb
    await FirebaseCrashlytics.log({ message: 'App started' });
  } catch (err) {
    console.warn('[Crashlytics] Failed to initialize:', err);
  }
}

/**
 * Log a message as a Crashlytics breadcrumb
 */
export async function logCrashlytics(message: string): Promise<void> {
  try {
    if (crashlyticsPlugin) {
      await crashlyticsPlugin.log({ message });
    }
  } catch {}
}

/**
 * Set a user identifier for crash reports
 */
export async function setCrashlyticsUser(userId: string): Promise<void> {
  try {
    if (crashlyticsPlugin) {
      await crashlyticsPlugin.setUserId({ userId });
    }
  } catch {}
}
