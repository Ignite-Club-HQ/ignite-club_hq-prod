import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ChatRefreshButtonProps {
  onRefresh: () => Promise<void>;
  isRefreshing: boolean;
  className?: string;
}

export function ChatRefreshButton({ onRefresh, isRefreshing, className }: ChatRefreshButtonProps) {
  const handleClick = () => {
    void onRefresh();
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("shrink-0", className)}
      onClick={handleClick}
      disabled={isRefreshing}
      title="Refresh messages"
      aria-label="Refresh messages"
    >
      <RefreshCw className={cn("h-5 w-5", isRefreshing && "animate-spin")} />
    </Button>
  );
}
