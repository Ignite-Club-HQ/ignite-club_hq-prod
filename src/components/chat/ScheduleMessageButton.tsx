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
        "min-h-[44px] min-w-[44px] shrink-0 text-muted-foreground hover:text-primary",
        className,
      )}
    >
      <Clock className="h-[22px] w-[22px]" strokeWidth={2.25} />
    </Button>
  );
}
