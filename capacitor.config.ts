import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.igniteteamhub',
  appName: 'Ignite',
  webDir: 'dist',
  // Remove server.url to bundle web app locally for offline support
  // Only use server.url during development for hot-reload
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    App: {
      url: "igniteclubhq" // registers igniteclubhq:// scheme
    },
    Keyboard: {
      // Prevent viewport resize on Android when keyboard opens
      // Pages that need keyboard-aware layout handle it via keyboardDidShow events
      resize: 'none',
      resizeOnFullScreen: false,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    FirebaseMessaging: {
      // IMPORTANT: leave presentationOptions empty.
      // Both @capacitor/push-notifications and @capacitor-firebase/messaging
      // listen to incoming FCM messages. If BOTH present the system notification,
      // users see duplicate notifications (especially noticeable on DMs).
      // We rely on @capacitor/push-notifications + the OS to display the alert
      // once, and only use FirebaseMessaging for token management.
      presentationOptions: [],
    },
  },
  android: {
    allowMixedContent: true,
    // Keep all navigation inside the WebView
    appendUserAgent: 'IgniteClubHQ-Android',
    // Disable native overscroll glow/spinner
    overScrollMode: 'never' as any,
  },
  ios: {
    // Let the WebView span edge-to-edge; the app already applies safe-area padding in CSS.
    contentInset: 'never',
    // Keep all navigation inside the WebView
    appendUserAgent: 'IgniteClubHQ-iOS',
    allowsLinkPreview: false,
    backgroundColor: '#0f1a14',
  },
  // Server configuration - keep navigation in app
  server: {
    // Use standard Capacitor schemes
    androidScheme: 'https',
    iosScheme: 'https',
  },
};

export default config;

/*
 * IMPORTANT: Deep Linking Setup for Google OAuth
 * ================================================
 * 
 * For Google OAuth to return to the native app after authentication,
 * you need to configure App Links (Android) and Universal Links (iOS).
 * 
 * ANDROID: Add to android/app/src/main/AndroidManifest.xml inside <activity>:
 * 
 *   <intent-filter android:autoVerify="true">
 *     <action android:name="android.intent.action.VIEW" />
 *     <category android:name="android.intent.category.DEFAULT" />
 *     <category android:name="android.intent.category.BROWSABLE" />
 *     <data android:scheme="https" 
 *           android:host="ignite-club-launchpad.lovable.app" />
 *   </intent-filter>
 * 
 * iOS: Add to ios/App/App/Info.plist:
 * 
 *   <key>CFBundleURLTypes</key>
 *   <array>
 *     <dict>
 *       <key>CFBundleURLSchemes</key>
 *       <array>
 *         <string>app.lovable.igniteteamhub</string>
 *       </array>
 *     </dict>
 *   </array>
 * 
 * And add Associated Domains in Xcode:
 *   applinks:ignite-club-launchpad.lovable.app
 * 
 * HOSTING: You also need to host verification files:
 *   - Android: /.well-known/assetlinks.json
 *   - iOS: /.well-known/apple-app-site-association
 */
