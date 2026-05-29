// =====================================================
// CRITICAL: Capture OAuth callback params IMMEDIATELY
// This MUST run before any React code or imports that might cause redirects
// =====================================================
(function captureOAuthCallbackBeforeAnythingElse() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const code = urlParams.get('code');
    const error = urlParams.get('error');
    
    // Check if this is a Supabase OAuth callback with tokens in hash
    // This happens when Google OAuth redirects back to the app
    const accessToken = hashParams.get('access_token');
    const refreshToken = hashParams.get('refresh_token');
    
    if (accessToken && refreshToken) {
      console.log("[Main] EARLY CAPTURE: Supabase OAuth tokens detected in hash");
      // The tokens are in the hash - Supabase client will automatically detect them
      // Just log for debugging - the client handles this automatically
      // Do NOT clear the hash here - let Supabase client process it first
    }
    
    // Check if this looks like a Google Drive OAuth callback (has code and we're on /vault)
    if (window.location.pathname === '/vault' && code) {
      console.log("[Main] EARLY CAPTURE: Google Drive OAuth code detected");
      sessionStorage.setItem('googleDriveOAuthCode', code);
      // Clean the URL immediately to prevent any interference from routing
      window.history.replaceState({}, '', '/vault');
    }
    
    // Handle OAuth error
    if (window.location.pathname === '/vault' && error) {
      console.log("[Main] EARLY CAPTURE: Google Drive OAuth error:", error);
      sessionStorage.setItem('googleDriveOAuthError', error);
      window.history.replaceState({}, '', '/vault');
    }
  } catch (e) {
    console.error("[Main] OAuth capture error:", e);
  }
})();

// IMPORTANT: silencer must be imported before anything that logs on evaluation
import "./lib/prodConsoleSilencer";
// Install AFTER silencer so we wrap the (potentially silenced) console fns.
// console.info is preserved in production so [TimerAudit] entries are captured.
import { installTimerAuditCapture } from "./lib/timerAuditLog";
installTimerAuditCapture();
import { createRoot } from "react-dom/client"; // rebuild v2
import App from "./App.tsx";
import "./index.css";
import { initDeepLinkHandler } from "./lib/deepLinkHandler";
import { initNotificationLaunchHandler } from "./lib/notificationLaunchHandler";
import { initWebVitalsReporter } from "./lib/webVitalsReporter";
import { setupChatPerfDiagnostics } from "./lib/chatPerfDiagnostics";
import { installSupabaseAuthRetry } from "./lib/supabaseAuthRetry";

// Install global Supabase fetch interceptor that refreshes the JWT once and
// retries on 401, so a stale token mid-session can't silently empty Schedule /
// Media / Pro-check screens on iOS.
installSupabaseAuthRetry();

// Chat performance diagnostics — disabled unless `?chatPerfDiag=1` or
// localStorage `ff:chat-perf-diag=1`. Patches ResizeObserver + installs a
// longtask PerformanceObserver to track main-thread blocks during chat use.
setupChatPerfDiagnostics();

// Declare global types
declare global {
  interface Window {
    __swRegistration?: ServiceWorkerRegistration;
    __swReady: Promise<ServiceWorkerRegistration | undefined>;
  }
}

const isNative = !!(window as any).Capacitor?.isNativePlatform?.();

// Initialize Crashlytics FIRST on native (dynamic import, no React dependency)
if (isNative) {
  import('@capacitor-firebase/crashlytics').then(({ FirebaseCrashlytics }) => {
    FirebaseCrashlytics.setEnabled({ enabled: true }).then(() => {
      console.log('[Main] Crashlytics enabled');
      FirebaseCrashlytics.log({ message: 'App boot started' });
    });
  }).catch(e => console.warn('[Main] Crashlytics unavailable:', e));
}

// Camera permissions are now requested on-demand when the user
// first tries to upload a photo, not at app startup.

// iOS WKWebView scrolls the document up on input focus to lift the input
// above the keyboard. Our chat composers are position:fixed and anchored
// manually to the keyboard top, so that OS behavior just rips the composer
// offscreen on the first tap (before per-page React effects can call
// Keyboard.setScroll). Disable it once globally at boot.
if (isNative) {
  import('@capacitor/keyboard').then(({ Keyboard }) => {
    Keyboard.setScroll({ isDisabled: true }).catch((err) => {
      console.warn('[Main] Keyboard.setScroll(disabled) failed:', err);
    });
  }).catch((err) => {
    console.warn('[Main] @capacitor/keyboard import failed:', err);
  });
}

// Initialize native handlers (wrapped to prevent crashes)
try {
  initDeepLinkHandler();
} catch (e) {
  console.error('[Main] Deep link handler init failed:', e);
}
try {
  initNotificationLaunchHandler();
} catch (e) {
  console.error('[Main] Notification launch handler init failed:', e);
}

// Register service worker - SKIP on native platforms (Capacitor bundles locally)
const registerServiceWorker = (): Promise<ServiceWorkerRegistration | undefined> => {
  return new Promise((resolve) => {
    // Native apps don't use service workers
    if (isNative) {
      console.log('[Main] Native platform - skipping SW registration');
      resolve(undefined);
      return;
    }

    if (!('serviceWorker' in navigator)) {
      console.log('[Main] Service workers not supported');
      resolve(undefined);
      return;
    }

    const SW_VERSION = '4.0.0';
    navigator.serviceWorker.register(`/sw.js?v=${SW_VERSION}`, { scope: '/' })
      .then((registration) => {
        console.log('[Main] SW registered, scope:', registration.scope, 'version:', SW_VERSION);
        
        if (registration.active) {
          window.__swRegistration = registration;
          resolve(registration);
          return;
        }
        
        const worker = registration.installing || registration.waiting;
        if (worker) {
          const onStateChange = () => {
            if (worker.state === 'activated') {
              window.__swRegistration = registration;
              resolve(registration);
            }
          };
          worker.addEventListener('statechange', onStateChange);
          if (worker.state === 'activated') {
            window.__swRegistration = registration;
            resolve(registration);
          }
        } else {
          navigator.serviceWorker.ready.then((reg) => {
            window.__swRegistration = reg;
            resolve(reg);
          });
        }
      })
      .catch((err) => {
        console.error('[Main] SW registration failed:', err);
        resolve(undefined);
      });
      
    navigator.serviceWorker.ready.then((registration) => {
      if (!window.__swRegistration) {
        window.__swRegistration = registration;
      }
    }).catch(() => {});
  });
};

// Start registration immediately
window.__swReady = registerServiceWorker();

// Start Web Vitals reporting (samples 25% of page loads)
initWebVitalsReporter();

createRoot(document.getElementById("root")!).render(<App />);
