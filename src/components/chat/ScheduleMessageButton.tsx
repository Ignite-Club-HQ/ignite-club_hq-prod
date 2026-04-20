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
        "h-11 w-11 min-h-0 min-w-0 shrink-0 rounded-full text-foreground/75 hover:text-foreground hover:bg-accent active:bg-accent/80 active:scale-95 transition-all duration-100 disabled:opacity-40 disabled:active:scale-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        className,
      )}
    >
      <Clock className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
    </Button>
  );
}
