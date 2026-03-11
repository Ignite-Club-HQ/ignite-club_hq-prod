import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.igniteteamhub',
  appName: 'Ignite',
  webDir: 'dist',
  // Remove server.url to bundle web app locally for offline support
  // Only use server.url during development for hot-reload
  plugins: {
    App: {
      url: "igniteclubhq" // registers igniteclubhq:// scheme
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    FirebaseMessaging: {
      // Use custom notification icon for Android
      presentationOptions: ['badge', 'sound', 'alert'],
    },
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
    // Use https for both platforms - capacitor:// scheme can cause CORS/resource loading issues on iOS
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
