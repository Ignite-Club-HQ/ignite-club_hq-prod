import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Settings } from "lucide-react";
import { PeriodType, RotationMode } from "./types";

interface BasketballGameSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  periodType: PeriodType;
  onPeriodTypeChange: (p: PeriodType) => void;
  minutesPerQuarter: number;
  onMinutesPerQuarterChange: (n: number) => void;
  /** Optional — kept for backwards compat with callers that still pass them.
   *  Auto-subs are now a direct toggle in the pre-game controls row, so this
   *  dialog no longer renders rotation controls. */
  rotationMode?: RotationMode;
  onRotationModeChange?: (mode: RotationMode) => void;
  rotationIntervalMinutes?: number;
  onRotationIntervalChange?: (n: number) => void;
}

/**
 * Minimal pre-game settings: period structure + minutes only.
 * Auto-subs live as a direct on/off toggle on the pre-game controls row,
 * so coaches don't dig into settings to enable rotation.
 */
export default function BasketballGameSettingsDialog({
  open,
  onOpenChange,
  periodType,
  onPeriodTypeChange,
  minutesPerQuarter,
  onMinutesPerQuarterChange,
}: BasketballGameSettingsDialogProps) {
  const periodLabel = periodType === "halves" ? "half" : "quarter";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Settings className="h-4 w-4" />
            Game Settings
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          <div className="space-y-2">
            <Label className="text-sm">Period structure</Label>
            <Select value={periodType} onValueChange={(v) => onPeriodTypeChange(v as PeriodType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="quarters">Quarters (4 × N mins)</SelectItem>
                <SelectItem value="halves">Halves (2 × N mins)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-sm">
              Minutes per {periodLabel}: <span className="font-bold tabular-nums">{minutesPerQuarter}</span>
            </Label>
            <Slider
              min={4}
              max={periodType === "halves" ? 30 : 15}
              step={1}
              value={[minutesPerQuarter]}
              onValueChange={(v) => onMinutesPerQuarterChange(v[0])}
            />
          </div>
        </div>

        <Button className="w-full mt-4" onClick={() => onOpenChange(false)}>
          Done
        </Button>
      </DialogContent>
    </Dialog>
  );
}
