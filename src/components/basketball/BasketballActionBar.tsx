import { Button } from "@/components/ui/button";
import { Calendar, Settings, UserCog, Zap, Bookmark, LayoutGrid, Maximize2, UserPlus } from "lucide-react";
import { Quarter, RotationMode, BasketballCourtView } from "./types";

interface BasketballActionBarProps {
  onOpenSquad: () => void;
  onOpenLineups: () => void;
  onOpenSettings: () => void;
  onOpenPresets: () => void;
  onApplyLineup: () => void;
  onToggleCourtView: () => void;
  onAddFillIn?: () => void;
  currentQuarter: Quarter;
  rotationMode: RotationMode;
  rotationIntervalMinutes: number;
  courtView: BasketballCourtView;
}

export default function BasketballActionBar({
  onOpenSquad,
  onOpenLineups,
  onOpenSettings,
  onOpenPresets,
  onApplyLineup,
  onToggleCourtView,
  onAddFillIn,
  currentQuarter,
  rotationMode,
  rotationIntervalMinutes,
  courtView,
}: BasketballActionBarProps) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 border-b bg-muted/30 overflow-x-auto">
      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onOpenSquad}>
        <UserCog className="h-3.5 w-3.5 mr-1" /> Squad
      </Button>
      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onOpenLineups}>
        <Calendar className="h-3.5 w-3.5 mr-1" /> Lineups
      </Button>
      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onOpenPresets}>
        <Bookmark className="h-3.5 w-3.5 mr-1" /> Presets
      </Button>
      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onApplyLineup}>
        <Zap className="h-3.5 w-3.5 mr-1" /> Apply Q{currentQuarter}
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        onClick={onToggleCourtView}
        aria-label={courtView === "half" ? "Switch to full court" : "Switch to half court"}
      >
        {courtView === "half" ? (
          <>
            <Maximize2 className="h-3.5 w-3.5 mr-1" /> Full
          </>
        ) : (
          <>
            <LayoutGrid className="h-3.5 w-3.5 mr-1" /> Half
          </>
        )}
      </Button>
      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onOpenSettings}>
        <Settings className="h-3.5 w-3.5 mr-1" /> Settings
      </Button>
      {onAddFillIn && (
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onAddFillIn}>
          <UserPlus className="h-3.5 w-3.5 mr-1" /> Fill-In
        </Button>
      )}
      {rotationMode !== "off" && (
        <span className="text-[10px] text-muted-foreground ml-auto whitespace-nowrap">
          Auto: {rotationMode === "time-based" ? `${rotationIntervalMinutes}m` : "qtr-break"}
        </span>
      )}
    </div>
  );
}
