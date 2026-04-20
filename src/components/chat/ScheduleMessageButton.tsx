import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ScheduleMessageButtonProps {
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Composer button that opens the schedule-message dialog. Visually matches
 * the other inline composer icons (44x44, ghost, primary on hover).
 */
export function ScheduleMessageButton({
  onClick,
  disabled,
  className,
}: ScheduleMessageButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onClick}
      disabled={disabled}
      aria-label="Schedule message"
      title="Schedule message"
      className={cn(
        "h-10 w-10 min-h-0 min-w-0 shrink-0 text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      <Clock className="h-5 w-5" strokeWidth={2} />
    </Button>
  );
}
