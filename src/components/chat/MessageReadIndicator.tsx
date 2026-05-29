import { memo } from "react";

interface MessageReadIndicatorProps {
  readCount: number;
  isOwn: boolean;
  readerName?: string | null;
}

export const MessageReadIndicator = memo(function MessageReadIndicator({
  readCount,
  isOwn,
  readerName,
}: MessageReadIndicatorProps) {
  // Only show for own messages
  if (!isOwn) return null;

  const label = readCount > 0
    ? readerName ? `Read by ${readerName}` : `Read by ${readCount}`
    : "Sent";

  return (
    <span className="text-[10px] text-muted-foreground ml-1">
      {label}
    </span>
  );
});
