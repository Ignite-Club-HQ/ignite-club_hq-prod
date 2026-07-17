import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { PeriodType, RotationMode, ValidationMode } from "./types";

interface NetballSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  minutesPerQuarter: number;
  onMinutesPerQuarterChange: (n: number) => void;
  rotationMode: RotationMode;
  onRotationModeChange: (m: RotationMode) => void;
  rotationIntervalMinutes: number;
  onRotationIntervalChange: (n: number) => void;
  validationMode: ValidationMode;
  onValidationModeChange: (m: ValidationMode) => void;
  periodType: PeriodType;
  onPeriodTypeChange: (p: PeriodType) => void;
}

export default function NetballSettingsDialog({
  open,
  onOpenChange,
  minutesPerQuarter,
  onMinutesPerQuarterChange,
  rotationMode,
  onRotationModeChange,
  rotationIntervalMinutes,
  onRotationIntervalChange,
  validationMode,
  onValidationModeChange,
  periodType,
  onPeriodTypeChange,
}: NetballSettingsDialogProps) {
  const periodLabel = periodType === "halves" ? "half" : "quarter";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Game Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="space-y-2">
            <Label>Period structure</Label>
            <Select value={periodType} onValueChange={(v) => onPeriodTypeChange(v as PeriodType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="quarters">Quarters (4 × N mins)</SelectItem>
                <SelectItem value="halves">Halves (2 × N mins)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Switch to halves for junior leagues. Total game time is preserved.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Minutes per {periodLabel}: {minutesPerQuarter}</Label>
            <Slider
              min={5}
              max={periodType === "halves" ? 40 : 20}
              step={1}
              value={[minutesPerQuarter]}
              onValueChange={v => onMinutesPerQuarterChange(v[0])}
            />
          </div>

          <div className="space-y-2">
            <Label>Rotation mode</Label>
            <Select value={rotationMode} onValueChange={v => onRotationModeChange(v as RotationMode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Manual only</SelectItem>
                <SelectItem value="time-based">Time-based (every N mins)</SelectItem>
                <SelectItem value="quarter-break">Quarter breaks only</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {rotationMode === "time-based" && (
            <div className="space-y-2">
              <Label>Rotate every: {rotationIntervalMinutes} mins</Label>
              <Slider
                min={2}
                max={10}
                step={1}
                value={[rotationIntervalMinutes]}
                onValueChange={v => onRotationIntervalChange(v[0])}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label>Position validation</Label>
            <Select
              value={validationMode}
              onValueChange={v => onValidationModeChange(v as ValidationMode)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="free">Free — no checks</SelectItem>
                <SelectItem value="warn">Warn — toast on invalid</SelectItem>
                <SelectItem value="strict">Strict — block invalid moves</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Validation uses each player's preferred positions. Players with none set are eligible
              for any slot.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
