import { createRoot } from "react-dom/client"; // rebuild v2
import App from "./App.tsx";
import "./index.css";

// Declare global types
declare global {
  interface Window {
    __swRegistration?: ServiceWorkerRegistration;
    __swReady: Promise<ServiceWorkerRegistration | undefined>;
  }
}

// Register service worker with simplified, robust handling
const registerServiceWorker = (): Promise<ServiceWorkerRegistration | undefined> => {
  return new Promise((resolve) => {
    if (!('serviceWorker' in navigator)) {
      console.log('[Main] Service workers not supported');
      resolve(undefined);
      return;
    }

    // Register the service worker with cache-busting version
    const SW_VERSION = '4.0.0';
    navigator.serviceWorker.register(`/sw.js?v=${SW_VERSION}`, { scope: '/' })
      .then((registration) => {
        console.log('[Main] SW registered, scope:', registration.scope, 'version:', SW_VERSION);
        
        // If already active, we're done
        if (registration.active) {
          console.log('[Main] SW already active, version check...');
          window.__swRegistration = registration;
          resolve(registration);
          return;
        }
        
        // Wait for activation
        const worker = registration.installing || registration.waiting;
        if (worker) {
          console.log('[Main] Waiting for SW activation, state:', worker.state);
          
          const onStateChange = () => {
            console.log('[Main] SW state:', worker.state);
            if (worker.state === 'activated') {
              window.__swRegistration = registration;
              resolve(registration);
            }
          };
          
          worker.addEventListener('statechange', onStateChange);
          
          // Also check if it activated while we were setting up listener
          if (worker.state === 'activated') {
            window.__swRegistration = registration;
            resolve(registration);
          }
        } else {
          // No worker at all, wait for ready
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
      
    // Also listen for ready as a backup
    navigator.serviceWorker.ready.then((registration) => {
      console.log('[Main] SW ready event, active:', !!registration.active);
      if (!window.__swRegistration) {
        window.__swRegistration = registration;
      }
    }).catch(() => {});
  });
};

// Start registration immediately
window.__swReady = registerServiceWorker();

createRoot(document.getElementById("root")!).render(<App />);
