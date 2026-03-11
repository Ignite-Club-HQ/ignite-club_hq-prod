import { RefreshCw, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface ChatRefreshButtonProps {
  onRefresh: () => Promise<void>;
  isRefreshing: boolean;
  className?: string;
}

export function ChatRefreshButton({ onRefresh, isRefreshing, className }: ChatRefreshButtonProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("shrink-0", className)}
          aria-label="More options"
        >
          <MoreVertical className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-popover">
        <DropdownMenuItem
          onClick={() => void onRefresh()}
          disabled={isRefreshing}
        >
          <RefreshCw className={cn("h-4 w-4 mr-2", isRefreshing && "animate-spin")} />
          Refresh messages
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
