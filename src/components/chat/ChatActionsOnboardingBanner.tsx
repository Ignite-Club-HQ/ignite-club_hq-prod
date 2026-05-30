import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { useLongPressBanner } from "@/hooks/useChatActionsOnboarding";

/**
 * Compact, dismissible educational banner shown above the composer.
 * Persists until the user closes it OR successfully long-presses a message.
 * Uses a "New" pill so existing users understand this is a recent change.
 *
 * Hidden entirely while the message action sheet is open so the onboarding
 * tip never competes with the active long-press interaction.
 */
export function ChatActionsOnboardingBanner() {
  const { visible, dismiss } = useLongPressBanner();
  const [actionSheetOpen, setActionSheetOpen] = useState(false);

  useEffect(() => {
    const onToggle = (e: Event) => {
      const detail = (e as CustomEvent<{ open: boolean }>).detail;
      setActionSheetOpen(Boolean(detail?.open));
    };
    window.addEventListener("chat-action-sheet:toggle", onToggle as EventListener);
    return () => window.removeEventListener("chat-action-sheet:toggle", onToggle as EventListener);
  }, []);

  if (!visible || actionSheetOpen) return null;

  return (
    <div className="px-2 pb-1 animate-fade-in">
      <div className="mx-auto flex max-w-md items-center gap-2 rounded-full bg-muted/60 dark:bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground">
        <span className="shrink-0 rounded-full bg-primary/15 text-primary px-1.5 py-[1px] text-[9.5px] font-semibold uppercase tracking-wide leading-none">
          New
        </span>
        <span className="flex-1 leading-tight tracking-tight truncate">
          Press and hold messages for reactions and replies
        </span>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 -mr-0.5 rounded-full p-0.5 text-muted-foreground/70 hover:text-foreground transition-colors"
          aria-label="Dismiss tip"
        >
          <X className="h-3 w-3" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
