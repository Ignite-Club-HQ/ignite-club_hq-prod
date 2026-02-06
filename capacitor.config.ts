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
    FirebaseMessaging: {
      // Auto-initialize FCM
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
  android: {
    allowMixedContent: true,
  },
  ios: {
    contentInset: 'automatic',
  },
};

export default config;
