import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Settings } from "lucide-react";
import { PeriodType, RotationMode, ValidationMode } from "./types";

interface NetballGameSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  periodType: PeriodType;
  onPeriodTypeChange: (p: PeriodType) => void;
  minutesPerQuarter: number;
  onMinutesPerQuarterChange: (n: number) => void;
  /** Optional — kept so callers can pass them through for backwards compat.
   *  Auto-subs are toggled directly on the pre-game controls row. */
  rotationMode?: RotationMode;
  onRotationModeChange?: (mode: RotationMode) => void;
  rotationIntervalMinutes?: number;
  onRotationIntervalChange?: (n: number) => void;
  validationMode?: ValidationMode;
  onValidationModeChange?: (m: ValidationMode) => void;
}

/**
 * Minimal pre-game settings dialog mirroring BasketballGameSettingsDialog.
 * Period structure + minutes only. Auto-subs and validation live elsewhere
 * (pre-game controls + full settings dialog) so coaches don't dig.
 */
export default function NetballGameSettingsDialog({
  open,
  onOpenChange,
  periodType,
  onPeriodTypeChange,
  minutesPerQuarter,
  onMinutesPerQuarterChange,
}: NetballGameSettingsDialogProps) {
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
              min={5}
              max={periodType === "halves" ? 40 : 20}
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
