import { useState, useEffect } from "react";

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

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(globalDeferredPrompt);
  const [canPrompt, setCanPrompt] = useState(!!globalDeferredPrompt);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isReady, setIsReady] = useState(false);

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
        setIsInstalled(true);
        setCanPrompt(false);
        setDeferredPrompt(null);
        globalDeferredPrompt = null;
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
    if (!promptToUse) return false;

    try {
      await promptToUse.prompt();
      const { outcome } = await promptToUse.userChoice;
      
      if (outcome === "accepted") {
        setIsInstalled(true);
        setCanPrompt(false);
      }
      
      setDeferredPrompt(null);
      globalDeferredPrompt = null;
      return outcome === "accepted";
    } catch (error) {
      console.error("Error installing app:", error);
      return false;
    }
  };

  return {
    canPrompt,
    isInstalled,
    isIOS,
    isReady,
    installApp,
  };
}
