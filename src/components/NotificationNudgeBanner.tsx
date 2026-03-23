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
}

export function NotificationNudgeBanner({
  message = "Enable notifications so you never miss important updates",
  onDismiss,
  onEnable,
  className = "",
}: NotificationNudgeBannerProps) {
  const navigate = useNavigate();
  const isNative = Capacitor.isNativePlatform();

  const handleEnable = async () => {
    if (onEnable) {
      onEnable();
      return;
    }

    if (isNative) {
      // On native, try to trigger system permission prompt
      try {
        const { PushNotifications } = await import("@capacitor/push-notifications");
        const result = await PushNotifications.requestPermissions();
        if (result.receive === "granted") {
          await PushNotifications.register();
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
          const result = await Notification.requestPermission();
          if (result === "granted") {
            navigate("/settings");
          }
        } else {
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
