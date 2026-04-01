import { useState } from "react";
import { MoreVertical, RefreshCw, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface ChatHeaderMenuProps {
  onRefresh?: () => Promise<void>;
  isRefreshing?: boolean;
  onEditGroup?: () => void;
  onDeleteGroup?: () => void;
}

export function ChatHeaderMenu({
  onRefresh,
  isRefreshing = false,
  onEditGroup,
  onDeleteGroup,
}: ChatHeaderMenuProps) {
  const hasAnyAction = !!onRefresh || !!onEditGroup || !!onDeleteGroup;
  if (!hasAnyAction) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          aria-label="More options"
        >
          <MoreVertical className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-popover min-w-[180px]">
        {(onEditGroup || onDeleteGroup) && (
          <>
            {onEditGroup && (
              <DropdownMenuItem onClick={onEditGroup}>
                <Pencil className="h-4 w-4 mr-2" />
                Edit group
              </DropdownMenuItem>
            )}
            {onDeleteGroup && (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={onDeleteGroup}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete group
              </DropdownMenuItem>
            )}
            {onRefresh && <DropdownMenuSeparator />}
          </>
        )}

        {onRefresh && (
          <DropdownMenuItem
            onClick={() => void onRefresh()}
            disabled={isRefreshing}
          >
            <RefreshCw className={cn("h-4 w-4 mr-2", isRefreshing && "animate-spin")} />
            Refresh messages
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
