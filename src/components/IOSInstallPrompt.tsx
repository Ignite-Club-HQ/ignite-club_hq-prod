import { useState, useEffect } from "react";
import { X, Share, PlusSquare } from "lucide-react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "ios-install-prompt-dismissed";
const DISMISS_DURATION_DAYS = 7;

export function IOSInstallPrompt() {
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    try {
      // Check if iOS Safari (not in standalone mode)
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
      const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
      const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
      
      if (!isIOS || isStandalone || !isSafari) {
        return;
      }

      // Check if user has dismissed recently (with localStorage safety check)
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
      }, 3000);

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
    <div className="fixed bottom-20 left-4 right-4 z-50 animate-in slide-in-from-bottom-4 duration-300">
      <div className="bg-card border border-border rounded-xl shadow-lg p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <h3 className="font-semibold text-foreground mb-1">
              Install Ignite Club HQ
            </h3>
            <p className="text-sm text-muted-foreground mb-3">
              Add to your home screen for the best experience with push notifications.
            </p>
            
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-medium">1</span>
                <span>Tap the</span>
                <Share className="h-4 w-4 text-primary" />
                <span>Share button below</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-medium">2</span>
                <span>Scroll and tap</span>
                <PlusSquare className="h-4 w-4 text-primary" />
                <span>"Add to Home Screen"</span>
              </div>
            </div>
          </div>
          
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={handleDismiss}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        
        <div className="mt-3 pt-3 border-t border-border">
          <p className="text-xs text-muted-foreground text-center">
            📱 Push notifications work best when added to home screen
          </p>
        </div>
      </div>
    </div>
  );
}
