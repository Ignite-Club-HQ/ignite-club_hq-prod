import { type ReactNode } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/**
 * Shared attendance row used across Going / Maybe / Not Going / No Response.
 *
 * Layout: [Avatar] [Name · RoleBadge] [RightSlot]
 *
 *  - Avatar     → fixed width, never shrinks
 *  - Name       → flex-1, min-w-0, single line, truncates with ellipsis
 *  - RoleBadge  → inline with name, never wraps to a new line, never shrinks
 *  - RightSlot  → fixed-width zone for status / actions, never shrinks
 *
 * The whole row is vertically centered with consistent padding so every
 * attendance section feels structurally unified.
 */
export interface AttendanceRowProps {
  name: string;
  avatarUrl?: string | null;
  /** Pre-formatted role badge text — e.g. "coach", "committee member", "Child", "Guest". */
  roleLabel?: string | null;
  /** Visual tone for the role badge. Defaults to "neutral" (blue). */
  roleTone?: "neutral" | "child" | "guest";
  /** Optional secondary line under the name (e.g. RSVP notes). Stays truncated. */
  secondaryLine?: ReactNode;
  /** Right-hand zone for status / actions. Always shrink-0. */
  rightSlot?: ReactNode;
  /** Optional custom avatar fallback content (defaults to first letter of name). */
  avatarFallback?: string;
  className?: string;
}

const roleToneClasses: Record<NonNullable<AttendanceRowProps["roleTone"]>, string> = {
  neutral:
    "bg-blue-500/15 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400",
  child:
    "bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400",
  guest:
    "bg-muted text-muted-foreground border border-border",
};

export function AttendanceRow({
  name,
  avatarUrl,
  roleLabel,
  roleTone = "neutral",
  secondaryLine,
  rightSlot,
  avatarFallback,
  className,
}: AttendanceRowProps) {
  const fallback =
    avatarFallback ?? (name?.charAt(0)?.toUpperCase() || "?");

  return (
    <div
      className={cn(
        "flex items-center gap-3 py-2.5 min-w-0",
        className,
      )}
    >
      {/* Avatar — fixed */}
      <Avatar className="h-9 w-9 shrink-0">
        {avatarUrl ? <AvatarImage src={avatarUrl} /> : null}
        <AvatarFallback className="text-xs bg-muted">
          {fallback}
        </AvatarFallback>
      </Avatar>

      {/* Name + role — flexible, single line, truncates */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="font-semibold text-sm truncate min-w-0"
            title={name}
          >
            {name || "Unknown"}
          </span>
          {roleLabel && (
            <span
              className={cn(
                "shrink-0 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize whitespace-nowrap leading-none",
                roleToneClasses[roleTone],
              )}
            >
              {roleLabel}
            </span>
          )}
        </div>
        {secondaryLine && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {secondaryLine}
          </p>
        )}
      </div>

      {/* Right-side action / status — fixed */}
      {rightSlot && (
        <div className="flex items-center gap-2 shrink-0">{rightSlot}</div>
      )}
    </div>
  );
}
