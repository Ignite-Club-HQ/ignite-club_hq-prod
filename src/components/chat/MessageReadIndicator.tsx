import { memo } from "react";
import { Eye } from "lucide-react";

interface MessageReadIndicatorProps {
  readCount: number;
  isOwn: boolean;
  readerName?: string | null;
}

/**
 * Compact inline read state shown next to a timestamp when avatar clusters
 * aren't available (e.g. non-last own messages). Uses warm, human phrasing
 * ("Seen by …") with a small eye glyph to feel social rather than technical.
 * Deliberately avoids WhatsApp-style ticks.
 */
export const MessageReadIndicator = memo(function MessageReadIndicator({
  readCount,
  isOwn,
  readerName,
}: MessageReadIndicatorProps) {
  if (!isOwn) return null;

  if (readCount <= 0) {
    return <span className="text-[10px] leading-none text-muted-foreground/55 tracking-tight">Sent</span>;
  }

  const label = readerName
    ? `Seen by ${readerName.split(" ")[0]}`
    : `Seen by ${readCount}`;

  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] leading-none text-muted-foreground/65 tracking-tight">
      <Eye className="h-2.5 w-2.5 opacity-70" strokeWidth={2.25} />
      {label}
    </span>
  );
});
