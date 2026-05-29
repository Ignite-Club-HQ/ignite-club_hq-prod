import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ChatComposerShellProps {
  children: ReactNode;
  className?: string;
}

/**
 * Unified composer container styled like WhatsApp / iMessage.
 *
 * Design intent (premium messaging feel):
 * - The entire bottom region (composer + safe area) reads as ONE surface,
 *   visually distinct from the conversation above it. Achieved with a
 *   subtle background tint + soft top shadow instead of a hard border.
 * - The composer pill sits ON that surface — no outline, just a soft
 *   raised fill so it feels like a native control, not a form input.
 * - Rounded corners preserved. Depth comes from layering, not lines.
 */
export function ChatComposerShell({ children, className }: ChatComposerShellProps) {
  return (
    <div
      className={cn(
        // Dedicated bottom surface. Slight tint differentiates it from the
        // conversation surface above without a hard divider line. The soft
        // top shadow provides the separation that the border used to do,
        // but reads as depth rather than a rule.
        "px-2 pt-2 pb-2",
        "bg-background",
        "dark:bg-muted/20",
        "shadow-[0_-1px_0_0_hsl(var(--border)/0.35),0_-10px_24px_-18px_rgba(0,0,0,0.18)]",
        "dark:shadow-[0_-1px_0_0_hsl(var(--border)/0.5),0_-10px_24px_-14px_rgba(0,0,0,0.6)]",
      )}
    >
      <div
        className={cn(
          // Single optical centre line for icons + textarea (matches iMessage).
          "flex w-full max-w-full min-w-0 items-center gap-1.5 overflow-visible",
          // Pill fill — no border, just a subtle raised surface that sits
          // on the bottom area. Slightly stronger in dark mode for contrast.
          "rounded-[26px] bg-muted/70 dark:bg-muted/50",
          "shadow-[inset_0_0.5px_0_0_hsl(var(--background)/0.6)]",
          "dark:shadow-[inset_0_0.5px_0_0_hsl(var(--foreground)/0.04)]",
          "pl-1.5 pr-2 py-1 min-h-[52px]",
          "transition-[background-color,box-shadow] duration-150",
          "focus-within:bg-muted/85 dark:focus-within:bg-muted/65",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
