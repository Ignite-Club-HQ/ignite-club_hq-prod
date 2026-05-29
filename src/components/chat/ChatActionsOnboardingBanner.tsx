import { Hand, X } from "lucide-react";
import { useLongPressBanner } from "@/hooks/useChatActionsOnboarding";

/**
 * Subtle, dismissible educational banner shown above the composer for the
 * first few chat sessions after the long-press interaction launched.
 * Auto-hides after 6s and stops appearing once the user has long-pressed
 * a message (handled inside the hook).
 */
export function ChatActionsOnboardingBanner() {
  const { visible, dismiss } = useLongPressBanner();

  if (!visible) return null;

  return (
    <div className="px-2 pb-1.5 animate-fade-in">
      <div className="mx-auto flex max-w-md items-center gap-2 rounded-full bg-muted/70 dark:bg-muted/50 px-3 py-1.5 text-[11.5px] text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border)/0.3)]">
        <Hand className="h-3.5 w-3.5 shrink-0 opacity-70" strokeWidth={2.25} />
        <span className="flex-1 leading-tight tracking-tight">
          Press and hold messages for reactions, replies and more
        </span>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 -mr-1 rounded-full p-1 text-muted-foreground/70 hover:text-foreground transition-colors"
          aria-label="Dismiss tip"
        >
          <X className="h-3 w-3" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
