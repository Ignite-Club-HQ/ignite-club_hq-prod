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
    <div className="px-2 pt-1 pb-1.5">
      <div
        className={cn(
          "flex w-full max-w-full min-w-0 items-end gap-1 overflow-visible",
          "rounded-[24px] bg-muted/55 dark:bg-muted/40",
          "px-1 py-1 min-h-[44px]",
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
