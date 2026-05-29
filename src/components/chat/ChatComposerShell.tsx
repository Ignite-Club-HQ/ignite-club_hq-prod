import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ChatComposerShellProps {
  children: ReactNode;
  className?: string;
}

/**
 * Unified composer container styled like WhatsApp / iMessage:
 * a single rounded pill that visually fuses the attachment "+" button,
 * the input field, and the send button into one cohesive control.
 *
 * Pages place this around their ChatImageInput / MentionInput / ChatSendButton
 * row. The inner MentionInput should be rendered with `bare` so it doesn't
 * paint its own pill background on top of this one.
 */
export function ChatComposerShell({ children, className }: ChatComposerShellProps) {
  return (
    <div
      className={cn(
        // Subtle elevation lifts the composer off the conversation without a
        // hard divider. Slightly more breathing room above + below than the
        // previous flush row.
        "px-2 pt-2 pb-2",
        "border-t border-border/40",
        "shadow-[0_-4px_12px_-10px_rgba(0,0,0,0.18)] dark:shadow-[0_-4px_12px_-10px_rgba(0,0,0,0.5)]",
      )}
    >
      <div
        className={cn(
          // items-center: every icon + the single-line textarea share one
          // optical centre line. When the textarea grows to multiple lines
          // it expands symmetrically; the buttons remain centred on the
          // first row, which is the same behaviour as iMessage / WhatsApp.
          "flex w-full max-w-full min-w-0 items-center gap-1.5 overflow-visible",
          "rounded-[26px] bg-muted/55 dark:bg-muted/40",
          // Slightly more right padding so the send button doesn't touch
          // the pill edge optically.
          "pl-1.5 pr-2 py-1 min-h-[52px]",
          "transition-[background-color,box-shadow] duration-150",
          "focus-within:bg-muted/70 dark:focus-within:bg-muted/55",
          "focus-within:ring-1 focus-within:ring-ring/40",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

