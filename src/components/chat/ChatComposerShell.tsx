import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ChatActionsOnboardingBanner } from "./ChatActionsOnboardingBanner";

interface ChatComposerShellProps {
  children: ReactNode;
  className?: string;
}

/**
 * Unified composer container styled like WhatsApp / iMessage.
 *
 * Design intent:
 * - Bottom area = clean system surface (bg-background), no heavy shadow.
 * - Composer pill = a tonally distinct fill that visibly sits ON the
 *   surface as an interactive control. Contrast comes from fill tone,
 *   not borders or drop shadows.
 */
export function ChatComposerShell({ children, className }: ChatComposerShellProps) {
  return (
    <div
      className={cn(
        // Clean bottom surface. Hairline top edge gives gentle separation
        // from the conversation without reading as a border.
        "px-1 pt-2 pb-2 bg-background",
        "shadow-[0_-1px_0_0_hsl(var(--border)/0.25)]",
        "dark:shadow-[0_-1px_0_0_hsl(var(--border)/0.4)]",
      )}
    >
      <ChatActionsOnboardingBanner />
      <div
        className={cn(
          // Single optical centre line for icons + textarea. Tight gap so the
          // emoji icon reads as part of the input field (WhatsApp-style),
          // maximising horizontal width for the textarea.
          "flex w-full max-w-full min-w-0 items-center gap-0.5 overflow-visible",
          // Pill — tonally distinct from the bottom surface so it reads as
          // an interactive control, not a flat strip. Slightly stronger in
          // dark mode where muted tokens compress.
          "rounded-[26px] bg-muted dark:bg-muted/60",
          // Slightly wider right padding gives the text area ~4px of breathing
          // room before the send button so content doesn't feel compressed.
          "pl-0.5 pr-2 py-1 min-h-[52px]",

          "transition-[background-color] duration-150",
          "focus-within:bg-muted/90 dark:focus-within:bg-muted/75",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
