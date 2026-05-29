import { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { ChatBackButton } from "@/components/chat/ChatBackButton";
import { ConversationAvatar } from "@/components/chat/ConversationAvatar";
import { cn } from "@/lib/utils";

type ChatHeaderType = "team" | "club" | "group" | "dm" | "broadcast" | "support" | "league";

interface ChatHeaderShellProps {
  type: ChatHeaderType;
  name: string;
  sublabel?: string | null;
  avatarUrl?: string | null;
  onOpenDetails?: () => void;
  /** Right-side action buttons (search / mute / menu, etc.) */
  rightSlot?: ReactNode;
  /** Optional content rendered before the back button (e.g. inline search bar wrapper) */
  leftSlot?: ReactNode;
  /** Disable the tap-to-open affordance (e.g. when no details panel is wired up) */
  interactive?: boolean;
  /** Render an "online" indicator (green dot on avatar + "Online" subtitle). */
  showOnlineDot?: boolean;
}

/**
 * Premium, consistent chat header used across all thread types.
 * Layout:  [Back]  [Avatar]  [Title / Subtitle ▸]   [Actions]
 */
export function ChatHeaderShell({
  type,
  name,
  sublabel,
  avatarUrl,
  onOpenDetails,
  rightSlot,
  leftSlot,
  interactive = true,
  showOnlineDot = false,
}: ChatHeaderShellProps) {
  const TitleEl: any = interactive && onOpenDetails ? "button" : "div";
  const titleProps =
    interactive && onOpenDetails
      ? {
          type: "button" as const,
          onClick: onOpenDetails,
          "aria-label": `Open chat details for ${name}`,
        }
      : {};

  return (
    <div
      data-chat-chrome="true"
      className={cn(
        "relative flex items-center gap-2 px-2.5 py-2 shrink-0",
        "border-b border-border/70 bg-background/95",
        "shadow-[0_1px_0_hsl(var(--border)/0.4)]",
        "min-h-14",
      )}
    >
      {leftSlot}
      <ChatBackButton />

      <TitleEl
        {...titleProps}
        className={cn(
          // ml-1 keeps a real gap from the back button's hit area so taps
          // near the back button's right edge don't open the details panel.
          "flex items-center gap-2.5 flex-1 min-w-0 min-h-[44px] rounded-lg px-1 ml-1 -mr-1",
          "text-left",
          interactive && onOpenDetails && "active:opacity-70 transition-opacity touch-manipulation",
        )}
      >
        <div className="relative shrink-0">
          <ConversationAvatar
            type={type}
            name={name}
            avatarUrl={avatarUrl}
            className="h-9 w-9 ring-1 ring-border/60 shadow-sm"
          />
          {showOnlineDot && (
            <span
              aria-label="Online"
              className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ring-2 ring-background"
              style={{ backgroundColor: "hsl(var(--success))" }}
            />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 min-w-0">
            <h1 className="text-[15px] font-semibold tracking-tight truncate">{name}</h1>
            {interactive && onOpenDetails && (
              <ChevronRight
                className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0"
                strokeWidth={2.5}
                aria-hidden="true"
              />
            )}
          </div>
          {showOnlineDot ? (
            <p
              className="text-[12px] leading-tight truncate mt-0.5"
              style={{ color: "hsl(var(--success))" }}
            >
              Online
            </p>
          ) : sublabel ? (
            <p className="text-[12px] leading-tight text-muted-foreground truncate mt-0.5">
              {sublabel}
            </p>
          ) : null}
        </div>
      </TitleEl>

      {rightSlot ? (
        <div className="flex items-center gap-0.5 shrink-0 [&_button]:transition-transform [&_button]:active:scale-95">
          {rightSlot}
        </div>
      ) : null}
    </div>
  );
}
