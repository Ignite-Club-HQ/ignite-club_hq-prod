import { useEffect, useState } from "react";
import { Download, Share, PlusSquare, X, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePWAInstall } from "@/hooks/usePWAInstall";

interface PWAInstallDialogProps {
  forceShow?: boolean;
  autoShow?: boolean;
  onClose?: () => void;
  /** Unique key to track dismissal per location (e.g., "auth", "home") */
  promptKey?: string;
}

export function PWAInstallDialog({ forceShow = false, autoShow = true, onClose, promptKey = "default" }: PWAInstallDialogProps) {
  const [open, setOpen] = useState(false);
  const [hasTriggered, setHasTriggered] = useState(false);
  const { canPrompt, isInstalled, isIOS, installApp } = usePWAInstall();

  const sessionKey = `pwa-install-prompt-shown-${promptKey}`;

  useEffect(() => {
    // Only run once per mount - prevent multiple triggers
    if (hasTriggered || isInstalled) return;

    // Check for URL param or forceShow
    const params = new URLSearchParams(window.location.search);
    const urlPrompt = params.get("install") === "true";
    
    // Show if: forceShow, URL param, autoShow (first visit), or browser can prompt (after uninstall)
    const shouldPrompt = forceShow || urlPrompt || autoShow || canPrompt;
    
    if (!shouldPrompt) return;

    // Check if we've already shown the prompt this session for THIS specific location
    try {
      const shown = sessionStorage.getItem(sessionKey);
      if (shown && !canPrompt) return;
    } catch {
      // sessionStorage not available
    }

    // Mark as triggered to prevent re-runs
    setHasTriggered(true);

    // Show prompt after delay - wait for cookie banner to settle
    const timer = setTimeout(() => {
      setOpen(true);
      try {
        sessionStorage.setItem(sessionKey, "true");
      } catch {
        // sessionStorage not available
      }
    }, 3000);

    return () => clearTimeout(timer);
  }, [forceShow, autoShow, isInstalled, canPrompt, hasTriggered]);

  const handleInstall = async () => {
    const success = await installApp();
    if (success) {
      setOpen(false);
      onClose?.();
    }
  };

  const handleClose = () => {
    setOpen(false);
    onClose?.();
  };

  // Don't render anything if already installed
  if (isInstalled) return null;

  return (
    <Dialog open={open} onOpenChange={(val) => { if (!val) handleClose(); else setOpen(val); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex justify-center mb-4">
            <div className="p-4 rounded-2xl bg-primary/10">
              <Smartphone className="h-10 w-10 text-primary" />
            </div>
          </div>
          <DialogTitle className="text-center">Install Ignite Club HQ</DialogTitle>
          <DialogDescription className="text-center">
            Get the best experience with our app! Access your team anytime, even offline.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {isIOS ? (
            // iOS instructions
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground text-center">
                Add Ignite to your home screen:
              </p>
              <div className="space-y-2">
                <div className="flex items-center gap-3 text-sm">
                  <span className="flex items-center justify-center w-7 h-7 rounded-full bg-primary/10 text-primary font-medium">1</span>
                  <span className="flex items-center gap-2">
                    Tap the <Share className="h-4 w-4 text-primary" /> Share button
                  </span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="flex items-center justify-center w-7 h-7 rounded-full bg-primary/10 text-primary font-medium">2</span>
                  <span className="flex items-center gap-2">
                    Scroll and tap <PlusSquare className="h-4 w-4 text-primary" /> "Add to Home Screen"
                  </span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="flex items-center justify-center w-7 h-7 rounded-full bg-primary/10 text-primary font-medium">3</span>
                  <span>Tap "Add" to install</span>
                </div>
              </div>
            </div>
          ) : canPrompt ? (
            // Android/Chrome can prompt directly
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Download className="h-5 w-5 text-primary" />
                  <span>Quick install - just one tap!</span>
                </div>
              </div>
              <Button onClick={handleInstall} className="w-full" size="lg">
                <Download className="h-4 w-4 mr-2" />
                Install App
              </Button>
            </div>
          ) : (
            // Fallback instructions for other browsers
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground text-center">
                Add Ignite to your home screen from your browser menu.
              </p>
              <div className="text-sm text-muted-foreground text-center">
                Look for "Add to Home Screen" or "Install App" option.
              </div>
            </div>
          )}

          <div className="pt-2 border-t border-border">
            <ul className="text-xs text-muted-foreground space-y-1">
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                Works offline
              </li>
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                Get push notifications
              </li>
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                Fast access from home screen
              </li>
            </ul>
          </div>
        </div>

        <Button variant="ghost" onClick={handleClose} className="w-full">
          Maybe Later
        </Button>
      </DialogContent>
    </Dialog>
  );
}
