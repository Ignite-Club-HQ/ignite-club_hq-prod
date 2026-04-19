import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Repeat, Settings } from "lucide-react";
import { PeriodType, RotationMode } from "./types";

interface BasketballGameSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  periodType: PeriodType;
  onPeriodTypeChange: (p: PeriodType) => void;
  minutesPerQuarter: number;
  onMinutesPerQuarterChange: (n: number) => void;

  /** Auto-sub plan controls — shown pre-game so the coach can set fairness
   *  rotation up front and then forget about it. Optional so existing call
   *  sites that don't pass these still work. */
  rotationMode?: RotationMode;
  onRotationModeChange?: (mode: RotationMode) => void;
  rotationIntervalMinutes?: number;
  onRotationIntervalChange?: (n: number) => void;
}

/**
 * Pre-game settings: period structure, minutes, and (optional) auto-sub plan.
 * Auto-sub plan setup lives here so coaches can pre-configure rotation before
 * tip-off; once the game is live the plan runs silently in the background.
 */
export default function BasketballGameSettingsDialog({
  open,
  onOpenChange,
  periodType,
  onPeriodTypeChange,
  minutesPerQuarter,
  onMinutesPerQuarterChange,
  rotationMode,
  onRotationModeChange,
  rotationIntervalMinutes,
  onRotationIntervalChange,
}: BasketballGameSettingsDialogProps) {
  const periodLabel = periodType === "halves" ? "half" : "quarter";
  const showAutoSub = !!onRotationModeChange;

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

          {showAutoSub && (
            <div className="space-y-3 pt-2 border-t">
              <div className="flex items-center gap-2">
                <Repeat className="h-3.5 w-3.5 text-primary" />
                <Label className="text-sm font-semibold">Auto-sub plan</Label>
              </div>

              <Select
                value={rotationMode ?? "off"}
                onValueChange={(v) => onRotationModeChange?.(v as RotationMode)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">Off — manual subs only</SelectItem>
                  <SelectItem value="time-based">Time-based — rotate on a clock</SelectItem>
                  <SelectItem value="quarter-break">
                    {periodType === "halves" ? "Half breaks" : "Quarter breaks"} — rotate between periods
                  </SelectItem>
                </SelectContent>
              </Select>

              {rotationMode === "time-based" && (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    Rotate every{" "}
                    <span className="font-bold tabular-nums text-foreground">
                      {rotationIntervalMinutes ?? 4}
                    </span>{" "}
                    min
                  </Label>
                  <Slider
                    min={2}
                    max={Math.max(2, minutesPerQuarter)}
                    step={1}
                    value={[rotationIntervalMinutes ?? 4]}
                    onValueChange={(v) => onRotationIntervalChange?.(v[0])}
                  />
                </div>
              )}

              <p className="text-[11px] text-muted-foreground leading-snug">
                {rotationMode === "off"
                  ? "Coach controls every substitution manually. Recommendations still appear quietly."
                  : rotationMode === "time-based"
                  ? "Plan generates fair rotations on a clock. You can override or skip any sub during the game."
                  : "Whole-bench rotation suggestions appear at every period break. You confirm before they apply."}
              </p>
            </div>
          )}
        </div>

        <Button className="w-full mt-4" onClick={() => onOpenChange(false)}>
          Done
        </Button>
      </DialogContent>
    </Dialog>
  );
}
