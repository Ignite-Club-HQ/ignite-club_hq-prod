import { useState, useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Bell, CheckCircle, XCircle } from "lucide-react";

const NATIVE_NOTIFICATION_PROMPTED_KEY = "native-notification-prompted";

interface NativeNotificationPromptProps {
  userId?: string;
}

export function NativeNotificationPrompt({ userId }: NativeNotificationPromptProps) {
  const [showResult, setShowResult] = useState<'success' | 'denied' | null>(null);

  useEffect(() => {
    // Only run on native platforms
    if (!Capacitor.isNativePlatform()) return;
    
    // Only proceed if user is logged in
    if (!userId) return;
    
    // Check if we've already prompted
    const hasPrompted = localStorage.getItem(NATIVE_NOTIFICATION_PROMPTED_KEY);
    if (hasPrompted) return;
    
    // Small delay to let the app settle, then directly request system permission
    const timer = setTimeout(async () => {
      // Mark as prompted immediately to prevent re-triggering
      localStorage.setItem(NATIVE_NOTIFICATION_PROMPTED_KEY, "true");
      
      try {
        // Dynamically import to avoid issues on web
        const { initializeNativePush } = await import("@/lib/nativePush");
        
        const result = await initializeNativePush(userId);
        if (result.success) {
          console.log("[NativeNotificationPrompt] Push notifications enabled successfully");
          setShowResult('success');
        } else {
          console.warn("[NativeNotificationPrompt] Failed to enable push:", result.error);
          // Only show denied message if user explicitly denied (not for technical errors)
          if (result.error?.includes('denied')) {
            setShowResult('denied');
          }
        }
      } catch (err) {
        console.error("[NativeNotificationPrompt] Error enabling notifications:", err);
      }
    }, 1500);
    
    return () => clearTimeout(timer);
  }, [userId]);

  const handleDismiss = () => {
    setShowResult(null);
  };

  // Show a brief confirmation dialog after permission result
  if (showResult === 'success') {
    return (
      <AlertDialog open={true} onOpenChange={handleDismiss}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <div className="flex justify-center mb-4">
              <div className="p-4 rounded-full bg-green-500/10">
                <CheckCircle className="h-8 w-8 text-green-500" />
              </div>
            </div>
            <AlertDialogTitle className="text-center">
              Notifications Enabled
            </AlertDialogTitle>
            <AlertDialogDescription className="text-center">
              You'll receive updates about match times, team messages, and important announcements.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={handleDismiss} className="w-full">
              Got it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  if (showResult === 'denied') {
    return (
      <AlertDialog open={true} onOpenChange={handleDismiss}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <div className="flex justify-center mb-4">
              <div className="p-4 rounded-full bg-muted">
                <Bell className="h-8 w-8 text-muted-foreground" />
              </div>
            </div>
            <AlertDialogTitle className="text-center">
              Notifications Disabled
            </AlertDialogTitle>
            <AlertDialogDescription className="text-center">
              You can enable notifications later in your device settings or in your profile.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={handleDismiss} className="w-full">
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return null;
}
