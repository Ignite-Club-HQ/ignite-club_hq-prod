import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.igniteteamhub',
  appName: 'Ignite Club HQ',
  webDir: 'dist',
  // Remove server.url to bundle web app locally for offline support
  // Only use server.url during development for hot-reload
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    // NOTE: FirebaseMessaging is intentionally NOT configured here
    // to prevent app crashes when google-services.json is missing.
    // Firebase will be initialized lazily via JavaScript when available.
    // Once you add google-services.json (Android) or GoogleService-Info.plist (iOS),
    // you can optionally add FirebaseMessaging config here for better performance.
  },
  android: {
    allowMixedContent: true,
    // Keep all navigation inside the WebView
    appendUserAgent: 'IgniteClubHQ-Android',
  },
  ios: {
    contentInset: 'automatic',
    // Keep all navigation inside the WebView
    appendUserAgent: 'IgniteClubHQ-iOS',
    allowsLinkPreview: false,
  },
  // Server configuration - keep navigation in app
  server: {
    // Don't open links in external browser
    androidScheme: 'https',
    iosScheme: 'ionic',
    // Handle navigation internally
    hostname: 'ignite.app',
  },
};

export default config;
