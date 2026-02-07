import { useState, useEffect } from "react";
import { X, Share, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import igniteIcon from "@/assets/ignite-icon.png";

const STORAGE_KEY = "ios-install-prompt-dismissed";
const DISMISS_DURATION_DAYS = 7;

export function IOSInstallPrompt() {
  const [showPrompt, setShowPrompt] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    try {
      // Skip if running as native Capacitor app
      const isNativeApp = !!(window as any).Capacitor?.isNativePlatform?.();
      if (isNativeApp) {
        return;
      }

      // Check if iOS Safari (not in standalone mode)
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
      const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
      const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
      
      if (!isIOS || isStandalone || !isSafari) {
        return;
      }

      // Check if user has dismissed recently
      try {
        const dismissed = localStorage.getItem(STORAGE_KEY);
        if (dismissed) {
          const dismissedAt = parseInt(dismissed, 10);
          const daysSinceDismiss = (Date.now() - dismissedAt) / (1000 * 60 * 60 * 24);
          if (daysSinceDismiss < DISMISS_DURATION_DAYS) {
            return;
          }
        }
      } catch {
        // localStorage not available (Safari private mode)
      }

      // Show prompt after a short delay
      const timer = setTimeout(() => {
        setShowPrompt(true);
        // Start animation after prompt shows
        setTimeout(() => setIsAnimating(true), 300);
      }, 2000);

      return () => clearTimeout(timer);
    } catch (error) {
      console.warn('IOSInstallPrompt check failed:', error);
    }
  }, []);

  const handleDismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, Date.now().toString());
    } catch {
      // localStorage not available
    }
    setShowPrompt(false);
  };

  if (!showPrompt) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/40 z-40 animate-in fade-in duration-300"
        onClick={handleDismiss}
      />
      
      {/* Prompt Card */}
      <div className="fixed bottom-0 left-0 right-0 z-50 animate-in slide-in-from-bottom duration-300">
        <div className="bg-card border-t border-border rounded-t-3xl shadow-2xl p-6 pb-8 mx-auto max-w-lg">
          {/* Close button */}
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-4 right-4 h-8 w-8 rounded-full"
            onClick={handleDismiss}
          >
            <X className="h-4 w-4" />
          </Button>

          {/* Header with app icon */}
          <div className="flex flex-col items-center text-center mb-6">
            <img 
              src={igniteIcon} 
              alt="Ignite Club HQ" 
              className="h-16 w-16 rounded-2xl shadow-lg mb-3"
            />
            <h3 className="text-xl font-bold text-foreground">
              Install Ignite Club HQ
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Add to your home screen for the best experience
            </p>
          </div>

          {/* Steps */}
          <div className="space-y-4 mb-6">
            <div className="flex items-center gap-4 p-3 rounded-xl bg-muted/50">
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary text-primary-foreground font-bold">
                1
              </div>
              <div className="flex-1">
                <p className="font-medium text-foreground">Tap the Share button</p>
                <p className="text-xs text-muted-foreground">In Safari's bottom toolbar</p>
              </div>
              <div className={`p-2 rounded-lg bg-primary/10 ${isAnimating ? 'animate-bounce' : ''}`}>
                <Share className="h-5 w-5 text-primary" />
              </div>
            </div>

            <div className="flex items-center gap-4 p-3 rounded-xl bg-muted/50">
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary text-primary-foreground font-bold">
                2
              </div>
              <div className="flex-1">
                <p className="font-medium text-foreground">Add to Home Screen</p>
                <p className="text-xs text-muted-foreground">Scroll down and tap the option</p>
              </div>
              <div className="p-2 rounded-lg bg-primary/10">
                <Plus className="h-5 w-5 text-primary" />
              </div>
            </div>
          </div>

          {/* Benefits */}
          <div className="flex justify-center gap-6 text-xs text-muted-foreground mb-4">
            <div className="flex items-center gap-1.5">
              <span className="text-base">⚡</span>
              <span>Faster loading</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-base">🔔</span>
              <span>Push notifications</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-base">📱</span>
              <span>Full screen</span>
            </div>
          </div>

          {/* Dismiss link */}
          <button 
            onClick={handleDismiss}
            className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Maybe later
          </button>
        </div>

        {/* Arrow pointing to share button */}
        <div className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 transition-opacity duration-500 ${isAnimating ? 'opacity-100' : 'opacity-0'}`}>
          <div className="text-primary text-2xl animate-bounce">↓</div>
        </div>
      </div>
    </>
  );
}
