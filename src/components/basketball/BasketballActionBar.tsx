import { Button } from "@/components/ui/button";
import { Settings, LayoutGrid, Maximize2 } from "lucide-react";
import { RotationMode, BasketballCourtView } from "./types";

interface BasketballActionBarProps {
  onOpenSettings: () => void;
  onToggleCourtView: () => void;
  rotationMode: RotationMode;
  rotationIntervalMinutes: number;
  courtView: BasketballCourtView;
}

/**
 * Minimal action bar — mirrors the soccer pitch board pattern where the
 * Settings dialog is the single entry point for game setup (squad, lineups,
 * presets, fill-ins, etc.). We keep the court view toggle here because it's
 * a frequent in-game tweak, not a setup decision.
 */
export default function BasketballActionBar({
  onOpenSettings,
  onToggleCourtView,
  rotationMode,
  rotationIntervalMinutes,
  courtView,
}: BasketballActionBarProps) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 border-b bg-muted/30">
      <Button size="sm" variant="default" className="h-8 text-xs" onClick={onOpenSettings}>
        <Settings className="h-3.5 w-3.5 mr-1" /> Game Setup
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-8 text-xs"
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
      {rotationMode !== "off" && (
        <span className="text-[10px] text-muted-foreground ml-auto whitespace-nowrap">
          Auto: {rotationMode === "time-based" ? `${rotationIntervalMinutes}m` : "qtr-break"}
        </span>
      )}
    </div>
  );
}
