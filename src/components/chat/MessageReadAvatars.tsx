import { memo } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { ReaderInfo } from "@/hooks/useMessageReads";

interface MessageReadAvatarsProps {
  readers: ReaderInfo[];
  isOwn: boolean;
}

/**
 * Trailing "Seen by" indicator — quiet label + overlapping avatars,
 * matching iMessage / Messenger conventions. Sits flush with the last
 * own message so the chat tail reads as a single calm line.
 */
export const MessageReadAvatars = memo(function MessageReadAvatars({
  readers,
  isOwn,
}: MessageReadAvatarsProps) {
  if (readers.length === 0) return null;

  const visible = readers.slice(0, 4);
  const overflow = readers.length - visible.length;

  return (
    <div className={`flex items-center gap-1.5 mt-0.5 ${isOwn ? "justify-end" : ""}`}>
      <span className="text-[10.5px] font-medium text-muted-foreground/70 tracking-tight">
        Seen
      </span>
      <div className="flex items-center -space-x-1">
        {visible.map((reader) => (
          <Avatar
            key={reader.user_id}
            className="h-[16px] w-[16px] ring-[1.5px] ring-background"
            title={reader.display_name || undefined}
          >
            <AvatarImage src={reader.avatar_url || undefined} />
            <AvatarFallback className="text-[8px] font-semibold bg-muted text-muted-foreground">
              {(reader.display_name || "?").charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        ))}
        {overflow > 0 && (
          <span className="inline-flex items-center justify-center h-[16px] min-w-[16px] px-1 rounded-full bg-muted text-muted-foreground/80 text-[8.5px] font-semibold ring-[1.5px] ring-background">
            +{overflow}
          </span>
        )}
      </div>
    </div>
  );
});
