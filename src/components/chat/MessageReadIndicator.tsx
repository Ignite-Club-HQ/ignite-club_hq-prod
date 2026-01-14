import { memo } from "react";

interface MessageReadIndicatorProps {
  readCount: number;
  isOwn: boolean;
}

export const MessageReadIndicator = memo(function MessageReadIndicator({
  readCount,
  isOwn,
}: MessageReadIndicatorProps) {
  // Only show for own messages
  if (!isOwn) return null;

  return (
    <span className="text-[10px] text-muted-foreground ml-1">
      {readCount > 0 ? `Read by ${readCount}` : "Sent"}
    </span>
  );
});
