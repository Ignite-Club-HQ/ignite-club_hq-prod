import { useState, useEffect, useRef } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Store the prompt globally so it persists across component remounts
let globalDeferredPrompt: BeforeInstallPromptEvent | null = null;

// Set up global listener early
if (typeof window !== 'undefined') {
  window.addEventListener("beforeinstallprompt", (e: Event) => {
    e.preventDefault();
    globalDeferredPrompt = e as BeforeInstallPromptEvent;
  });
}

// Minimum time to show "Installing..." state (in ms)
const MIN_INSTALLING_TIME = 3000;

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(globalDeferredPrompt);
  const [canPrompt, setCanPrompt] = useState(!!globalDeferredPrompt);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isReady, setIsReady] = useState(false);
  
  // Track when installation was accepted and when appinstalled event fired
  const installAcceptedAt = useRef<number | null>(null);
  const appInstalledEventFired = useRef(false);

  useEffect(() => {
    try {
      // Check if app is already installed (running as standalone)
      if (window.matchMedia("(display-mode: standalone)").matches) {
        setIsInstalled(true);
        setIsReady(true);
        return;
      }

      // Check if iOS
      const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
      setIsIOS(isIOSDevice);

      // Check if we already have a deferred prompt from global listener
      if (globalDeferredPrompt) {
        setDeferredPrompt(globalDeferredPrompt);
        setCanPrompt(true);
      }

      const handleBeforeInstallPrompt = (e: Event) => {
        e.preventDefault();
        globalDeferredPrompt = e as BeforeInstallPromptEvent;
        setDeferredPrompt(e as BeforeInstallPromptEvent);
        setCanPrompt(true);
      };

      const handleAppInstalled = () => {
        console.log("[PWA] appinstalled event fired");
        appInstalledEventFired.current = true;
        
        // Check if minimum time has passed since user accepted
        const acceptedAt = installAcceptedAt.current;
        if (acceptedAt) {
          const elapsed = Date.now() - acceptedAt;
          const remaining = MIN_INSTALLING_TIME - elapsed;
          
          if (remaining > 0) {
            // Wait for remaining time before transitioning
            console.log(`[PWA] Waiting ${remaining}ms before completing`);
            setTimeout(() => {
              console.log("[PWA] Minimum install time elapsed, completing");
              setIsInstalling(false);
              setIsInstalled(true);
              setCanPrompt(false);
              setDeferredPrompt(null);
              globalDeferredPrompt = null;
            }, remaining);
          } else {
            // Minimum time already passed
            console.log("[PWA] Minimum time passed, completing immediately");
            setIsInstalling(false);
            setIsInstalled(true);
            setCanPrompt(false);
            setDeferredPrompt(null);
            globalDeferredPrompt = null;
          }
        } else {
          // User hasn't accepted yet (edge case), just set installed
          console.log("[PWA] No accept timestamp, completing immediately");
          setIsInstalling(false);
          setIsInstalled(true);
          setCanPrompt(false);
          setDeferredPrompt(null);
          globalDeferredPrompt = null;
        }
      };

      window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.addEventListener("appinstalled", handleAppInstalled);

      // Mark as ready after a short delay to allow beforeinstallprompt to fire
      const readyTimeout = setTimeout(() => {
        setIsReady(true);
      }, 500);

      return () => {
        window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
        window.removeEventListener("appinstalled", handleAppInstalled);
        clearTimeout(readyTimeout);
      };
    } catch (error) {
      console.warn("PWA install check failed:", error);
      setIsReady(true);
    }
  }, []);

  const installApp = async () => {
    const promptToUse = deferredPrompt || globalDeferredPrompt;
    if (!promptToUse) {
      // No prompt available - reset state to reflect reality
      setCanPrompt(false);
      return false;
    }

    try {
      console.log("[PWA] Showing install prompt...");
      
      // Reset tracking state
      installAcceptedAt.current = null;
      appInstalledEventFired.current = false;
      
      await promptToUse.prompt();
      const { outcome } = await promptToUse.userChoice;
      console.log("[PWA] User choice:", outcome);
      
      if (outcome === "accepted") {
        // Record the time user accepted and start installing state
        installAcceptedAt.current = Date.now();
        setIsInstalling(true);
        console.log("[PWA] User accepted install, isInstalling = true");
        
        // If appinstalled already fired (rare), handle it now with minimum delay
        if (appInstalledEventFired.current) {
          console.log("[PWA] appinstalled already fired, waiting minimum time");
          setTimeout(() => {
            console.log("[PWA] Minimum install time elapsed after accept");
            setIsInstalling(false);
            setIsInstalled(true);
            setCanPrompt(false);
            setDeferredPrompt(null);
            globalDeferredPrompt = null;
          }, MIN_INSTALLING_TIME);
        }
      }
      
      // Always clear prompt after use (it's single-use) and update canPrompt
      setDeferredPrompt(null);
      globalDeferredPrompt = null;
      setCanPrompt(false);
      
      return outcome === "accepted";
    } catch (error) {
      console.error("Error installing app:", error);
      // Clear stale state on error
      setDeferredPrompt(null);
      globalDeferredPrompt = null;
      setCanPrompt(false);
      setIsInstalling(false);
      installAcceptedAt.current = null;
      return false;
    }
  };

  return {
    canPrompt,
    isInstalled,
    isInstalling,
    isIOS,
    isReady,
    installApp,
  };
}
