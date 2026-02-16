import { memo } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { ReaderInfo } from "@/hooks/useMessageReads";

interface MessageReadAvatarsProps {
  readers: ReaderInfo[];
  isOwn: boolean;
}

export const MessageReadAvatars = memo(function MessageReadAvatars({
  readers,
  isOwn,
}: MessageReadAvatarsProps) {
  if (readers.length === 0) return null;

  return (
    <div className={`flex items-center gap-1.5 mt-1 ${isOwn ? "justify-end" : ""}`}>
      {readers.slice(0, 5).map((reader) => (
        <Avatar key={reader.user_id} className="h-7 w-7" title={reader.display_name || undefined}>
          <AvatarImage src={reader.avatar_url || undefined} />
          <AvatarFallback className="text-[11px] bg-muted text-muted-foreground">
            {(reader.display_name || "?").charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      ))}
      {readers.length > 5 && (
        <span className="text-xs text-muted-foreground ml-0.5">
          +{readers.length - 5}
        </span>
      )}
    </div>
  );
});
