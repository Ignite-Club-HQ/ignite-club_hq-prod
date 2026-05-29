import { memo } from "react";
import { Check, CheckCheck } from "lucide-react";

interface MessageReadIndicatorProps {
  readCount: number;
  isOwn: boolean;
  readerName?: string | null;
}

/**
 * iMessage / WhatsApp-style delivery indicator.
 *  - 0 readers  → single check (sent)
 *  - ≥1 readers → double check, tinted primary when at least one read
 * Sits inline next to the timestamp so metadata reads as one quiet line.
 */
export const MessageReadIndicator = memo(function MessageReadIndicator({
  readCount,
  isOwn,
  readerName,
}: MessageReadIndicatorProps) {
  if (!isOwn) return null;

  const hasReaders = readCount > 0;
  const Icon = hasReaders ? CheckCheck : Check;
  const ariaLabel = hasReaders
    ? readerName
      ? `Read by ${readerName}`
      : `Read by ${readCount}`
    : "Sent";

  return (
    <span
      className={`inline-flex items-center ml-0.5 ${hasReaders ? "text-primary" : "text-muted-foreground/60"}`}
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      <Icon className="h-3 w-3" strokeWidth={2.5} />
    </span>
  );
});
