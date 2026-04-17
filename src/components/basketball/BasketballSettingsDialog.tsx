import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { RotationMode, ValidationMode } from "./types";

interface BasketballSettingsDialogProps {
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
  timeoutsPerHalf: number;
  onTimeoutsPerHalfChange: (n: number) => void;
}

export default function BasketballSettingsDialog({
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
  timeoutsPerHalf,
  onTimeoutsPerHalfChange,
}: BasketballSettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Game Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="space-y-2">
            <Label>Minutes per quarter: {minutesPerQuarter}</Label>
            <Slider
              min={4}
              max={15}
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
                max={8}
                step={1}
                value={[rotationIntervalMinutes]}
                onValueChange={v => onRotationIntervalChange(v[0])}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label>Timeouts per half: {timeoutsPerHalf}</Label>
            <Slider
              min={0}
              max={5}
              step={1}
              value={[timeoutsPerHalf]}
              onValueChange={(v) => onTimeoutsPerHalfChange(v[0])}
            />
            <p className="text-[11px] text-muted-foreground">
              FIBA: 2 in H1, 3 in H2 (set to 3 to keep it simple). Auto-resets at Q3.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Position style</Label>
            <Select
              value={validationMode}
              onValueChange={v => onValidationModeChange(v as ValidationMode)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="free">Free — positionless (default)</SelectItem>
                <SelectItem value="structured">Structured — keep 1 per role</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Basketball positions are flexible. Free mode is recommended for juniors;
              Structured mode just hints when the same role is doubled up.
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
