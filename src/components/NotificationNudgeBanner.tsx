import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Capacitor } from "@capacitor/core";
import { useNavigate } from "react-router-dom";

const APP_STORE_URL = "https://apps.apple.com/au/app/ignite-club-hq/id6758928691";

interface NotificationNudgeBannerProps {
  message?: string;
  onDismiss: () => void;
  onEnable?: () => void;
  className?: string;
  userId?: string;
}

export function NotificationNudgeBanner({
  message = "Enable notifications so you never miss important updates",
  onDismiss,
  onEnable,
  className = "",
  userId,
}: NotificationNudgeBannerProps) {
  const navigate = useNavigate();
  const isNative = Capacitor.isNativePlatform();

  const handleEnable = async () => {
    if (onEnable) {
      onEnable();
      return;
    }

    if (isNative) {
      // On native, use initializeNativePush which handles the full flow:
      // permission request → register → get FCM token → save to database
      try {
        const { initializeNativePush } = await import("@/lib/nativePush");
        if (userId) {
          const result = await initializeNativePush(userId);
          console.log("[NotificationNudge] initializeNativePush result:", result);
        } else {
          // Fallback: just request permission (token won't be saved until next app resume)
          const { PushNotifications } = await import("@capacitor/push-notifications");
          const result = await PushNotifications.requestPermissions();
          if (result.receive === "granted") {
            await PushNotifications.register();
          }
        }
      } catch (err) {
        console.error("[NotificationNudge] Error requesting permissions:", err);
      }
    } else {
      // On web, direct to app store or settings
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      if (isIOS) {
        window.open(APP_STORE_URL, "_blank");
      } else {
        // Try web push permission
        if ("Notification" in window && Notification.permission === "default") {
          await Notification.requestPermission();
          // Permission granted or denied - just dismiss the banner
          // The push subscription health hook will handle subscribing automatically
        } else if ("Notification" in window && Notification.permission === "denied") {
          // Permission was previously denied - direct to settings for instructions
          navigate("/settings");
        } else {
          // Permission already granted but no subscription - go to settings
          navigate("/settings");
        }
      }
    }
    onDismiss();
  };

  return (
    <div className={`flex items-center gap-2 px-3 py-2 bg-primary/10 border border-primary/20 rounded-lg text-sm ${className}`}>
      <Bell className="h-4 w-4 text-primary shrink-0" />
      <p className="flex-1 text-foreground/80 text-xs">{message}</p>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-primary hover:text-primary font-medium shrink-0"
        onClick={handleEnable}
      >
        Enable
      </Button>
      <button
        onClick={onDismiss}
        className="text-muted-foreground hover:text-foreground p-0.5 shrink-0"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}