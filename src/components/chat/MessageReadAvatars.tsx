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

  const visible = readers.slice(0, 5);
  const overflow = readers.length - visible.length;

  return (
    <div className={`flex items-center mt-1 ${isOwn ? "justify-end" : ""}`}>
      <div className="flex items-center -space-x-1.5">
        {visible.map((reader) => (
          <Avatar
            key={reader.user_id}
            className="h-[18px] w-[18px] ring-1 ring-background"
            title={reader.display_name || undefined}
          >
            <AvatarImage src={reader.avatar_url || undefined} />
            <AvatarFallback className="text-[9px] bg-muted text-muted-foreground">
              {(reader.display_name || "?").charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        ))}
        {overflow > 0 && (
          <span className="inline-flex items-center justify-center h-[18px] min-w-[18px] px-1 rounded-full bg-muted text-muted-foreground/80 text-[9px] font-medium ring-1 ring-background">
            +{overflow}
          </span>
        )}
      </div>
    </div>
  );
});
