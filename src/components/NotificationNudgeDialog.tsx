import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Capacitor } from "@capacitor/core";
import { useNavigate } from "react-router-dom";

const APP_STORE_URL = "https://apps.apple.com/au/app/ignite-club-hq/id6758928691";

interface NotificationNudgeDialogProps {
  open: boolean;
  userId?: string;
  message?: string;
  onDismiss: () => void;
}

export function NotificationNudgeDialog({
  open,
  userId,
  message,
  onDismiss,
}: NotificationNudgeDialogProps) {
  const navigate = useNavigate();
  const isNative = Capacitor.isNativePlatform();
  const [submitting, setSubmitting] = useState(false);

  // Small delay to avoid immediate flash on login
  const [readyToShow, setReadyToShow] = useState(false);
  useEffect(() => {
    if (!open) {
      setReadyToShow(false);
      return;
    }
    const t = setTimeout(() => setReadyToShow(true), 600);
    return () => clearTimeout(t);
  }, [open]);

  const defaultMessage = isNative
    ? "You're not set up to receive push notifications. Enable them so you never miss team updates, chat messages, or schedule changes."
    : "You're not receiving push notifications. Install the app or enable browser notifications so you never miss team updates.";

  const handleEnable = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      if (isNative) {
        try {
          const { initializeNativePush } = await import("@/lib/nativePush");
          if (userId) {
            const result = await initializeNativePush(userId);
            console.log("[NotificationNudgeDialog] initializeNativePush result:", result);
          } else {
            const { PushNotifications } = await import("@capacitor/push-notifications");
            const result = await PushNotifications.requestPermissions();
            if (result.receive === "granted") {
              await PushNotifications.register();
            }
          }
        } catch (err) {
          console.error("[NotificationNudgeDialog] Error requesting permissions:", err);
        }
      } else {
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        if (isIOS) {
          window.open(APP_STORE_URL, "_blank");
        } else if ("Notification" in window && Notification.permission === "default") {
          await Notification.requestPermission();
        } else if ("Notification" in window && Notification.permission === "denied") {
          navigate("/settings");
        } else {
          navigate("/settings");
        }
      }
    } finally {
      setSubmitting(false);
      onDismiss();
    }
  };

  return (
    <Dialog open={open && readyToShow} onOpenChange={(next) => { if (!next) onDismiss(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Bell className="h-6 w-6 text-primary" />
          </div>
          <DialogTitle className="text-center">Stay in the loop</DialogTitle>
          <DialogDescription className="text-center">
            {message ?? defaultMessage}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          <Button onClick={handleEnable} disabled={submitting} className="w-full">
            {isNative ? "Enable notifications" : "Get set up"}
          </Button>
          <Button variant="ghost" onClick={onDismiss} className="w-full">
            Not now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
