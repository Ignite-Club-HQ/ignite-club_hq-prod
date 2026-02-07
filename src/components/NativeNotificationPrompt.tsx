import { useState, useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Bell } from "lucide-react";

const NATIVE_NOTIFICATION_PROMPTED_KEY = "native-notification-prompted";

interface NativeNotificationPromptProps {
  userId?: string;
}

export function NativeNotificationPrompt({ userId }: NativeNotificationPromptProps) {
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    // Only show on native platforms
    if (!Capacitor.isNativePlatform()) return;
    
    // Only show if user is logged in
    if (!userId) return;
    
    // Check if we've already prompted
    const hasPrompted = localStorage.getItem(NATIVE_NOTIFICATION_PROMPTED_KEY);
    if (hasPrompted) return;
    
    // Small delay to let the app settle before showing prompt
    const timer = setTimeout(() => {
      setShowPrompt(true);
    }, 1500);
    
    return () => clearTimeout(timer);
  }, [userId]);

  const handleEnableNotifications = async () => {
    // Mark as prompted
    localStorage.setItem(NATIVE_NOTIFICATION_PROMPTED_KEY, "true");
    setShowPrompt(false);
    
    try {
      // Dynamically import to avoid issues on web
      const { initializeNativePush } = await import("@/lib/nativePush");
      
      if (userId) {
        const result = await initializeNativePush(userId);
        if (result.success) {
          console.log("[NativeNotificationPrompt] Push notifications enabled successfully");
        } else {
          console.warn("[NativeNotificationPrompt] Failed to enable push:", result.error);
        }
      }
    } catch (err) {
      console.error("[NativeNotificationPrompt] Error enabling notifications:", err);
    }
  };

  const handleSkip = () => {
    // Mark as prompted so we don't ask again
    localStorage.setItem(NATIVE_NOTIFICATION_PROMPTED_KEY, "true");
    setShowPrompt(false);
  };

  if (!showPrompt) return null;

  return (
    <AlertDialog open={showPrompt} onOpenChange={setShowPrompt}>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <div className="flex justify-center mb-4">
            <div className="p-4 rounded-full bg-primary/10">
              <Bell className="h-8 w-8 text-primary" />
            </div>
          </div>
          <AlertDialogTitle className="text-center">
            Enable Notifications
          </AlertDialogTitle>
          <AlertDialogDescription className="text-center">
            Stay updated with match times, team messages, and important club announcements. 
            You can change this anytime in settings.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
          <AlertDialogAction 
            onClick={handleEnableNotifications}
            className="w-full"
          >
            Enable Notifications
          </AlertDialogAction>
          <AlertDialogCancel 
            onClick={handleSkip}
            className="w-full"
          >
            Maybe Later
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
