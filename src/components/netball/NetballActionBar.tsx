import { Button } from "@/components/ui/button";
import {
  Calendar,
  Settings,
  UserCog,
  Zap,
} from "lucide-react";
import { Quarter, RotationMode } from "./types";

interface NetballActionBarProps {
  onOpenSquad: () => void;
  onOpenLineups: () => void;
  onOpenSettings: () => void;
  onApplyLineup: () => void;
  currentQuarter: Quarter;
  rotationMode: RotationMode;
  rotationIntervalMinutes: number;
}

export default function NetballActionBar({
  onOpenSquad,
  onOpenLineups,
  onOpenSettings,
  onApplyLineup,
  currentQuarter,
  rotationMode,
  rotationIntervalMinutes,
}: NetballActionBarProps) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 border-b bg-muted/30 overflow-x-auto">
      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onOpenSquad}>
        <UserCog className="h-3.5 w-3.5 mr-1" /> Squad
      </Button>
      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onOpenLineups}>
        <Calendar className="h-3.5 w-3.5 mr-1" /> Lineups
      </Button>
      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onApplyLineup}>
        <Zap className="h-3.5 w-3.5 mr-1" /> Apply Q{currentQuarter}
      </Button>
      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onOpenSettings}>
        <Settings className="h-3.5 w-3.5 mr-1" /> Settings
      </Button>
      {rotationMode !== "off" && (
        <span className="text-[10px] text-muted-foreground ml-auto whitespace-nowrap">
          Auto: {rotationMode === "time-based" ? `${rotationIntervalMinutes}m` : "qtr-break"}
        </span>
      )}
    </div>
  );
}
