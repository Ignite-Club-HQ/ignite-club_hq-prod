import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Settings, LayoutGrid, Maximize2, MoreHorizontal, Users } from "lucide-react";
import { RotationMode, BasketballCourtView } from "./types";

interface BasketballActionBarProps {
  onOpenSettings: () => void;
  onToggleCourtView: () => void;
  onOpenLineup: () => void;
  rotationMode: RotationMode;
  rotationIntervalMinutes: number;
  courtView: BasketballCourtView;
  /** Players currently on court (out of 5). Drives the contextual primary CTA. */
  onCourtCount: number;
  /** Hide the bar entirely once the game is live to keep focus on play. */
  isLive?: boolean;
}

/**
 * Contextual primary action: "Set starting 5" before tipoff, "Edit lineup" after.
 * All other setup actions tucked behind a kebab menu.
 */
export default function BasketballActionBar({
  onOpenSettings,
  onToggleCourtView,
  onOpenLineup,
  rotationMode,
  rotationIntervalMinutes,
  courtView,
  onCourtCount,
  isLive = false,
}: BasketballActionBarProps) {
  if (isLive) return null;

  const lineupSet = onCourtCount >= 5;

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b bg-background">
      <Button
        size="sm"
        variant={lineupSet ? "outline" : "default"}
        className="flex-1 h-9 text-sm font-semibold"
        onClick={onOpenLineup}
      >
        <Users className="h-4 w-4 mr-1.5" />
        {lineupSet ? "Edit lineup" : `Set starting 5 (${onCourtCount}/5)`}
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="h-9 w-9 shrink-0"
            aria-label="More game options"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="z-[100000] w-56">
          <DropdownMenuLabel>Game</DropdownMenuLabel>
          <DropdownMenuItem onClick={onOpenSettings}>
            <Settings className="h-4 w-4 mr-2" />
            Game setup
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onToggleCourtView}>
            {courtView === "half" ? (
              <>
                <Maximize2 className="h-4 w-4 mr-2" />
                Switch to full court
              </>
            ) : (
              <>
                <LayoutGrid className="h-4 w-4 mr-2" />
                Switch to half court
              </>
            )}
          </DropdownMenuItem>
          {rotationMode !== "off" && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] uppercase font-normal text-muted-foreground">
                Auto-subs: {rotationMode === "time-based" ? `every ${rotationIntervalMinutes}m` : "quarter break"}
              </DropdownMenuLabel>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
