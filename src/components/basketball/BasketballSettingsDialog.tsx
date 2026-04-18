import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Settings, Users, Calendar, Bookmark, Zap, UserPlus, ChevronDown, SlidersHorizontal, Play } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { PeriodType, RotationMode, ValidationMode } from "./types";

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
  periodType: PeriodType;
  onPeriodTypeChange: (p: PeriodType) => void;

  // Game setup actions (mirror soccer pitch board's PitchSettingsDialog)
  onOpenSquad?: () => void;
  onOpenLineups?: () => void;
  onOpenPresets?: () => void;
  onApplyLineup?: () => void;
  onAddFillIn?: () => void;
  currentQuarter?: number;
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
  periodType,
  onPeriodTypeChange,
  onOpenSquad,
  onOpenLineups,
  onOpenPresets,
  onApplyLineup,
  onAddFillIn,
  currentQuarter,
}: BasketballSettingsDialogProps) {
  const periodLabel = periodType === "halves" ? "half" : "quarter";
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const close = () => onOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-2">
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Game Setup
          </DialogTitle>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 min-h-0 px-6 py-2 space-y-5">
          {/* Step 1: Squad */}
          {onOpenSquad && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Step 1 — Roster
              </p>
              <Button
                variant="outline"
                className="w-full h-10 justify-start"
                onClick={() => {
                  onOpenSquad();
                  close();
                }}
              >
                <Users className="h-4 w-4 mr-2" />
                Manage Squad
              </Button>
            </div>
          )}

          {/* Step 2: Lineups */}
          {(onOpenLineups || onOpenPresets) && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Step 2 — Starting Lineup
              </p>
              <div className="grid grid-cols-2 gap-2">
                {onOpenLineups && (
                  <Button
                    variant="outline"
                    className="h-10"
                    onClick={() => {
                      onOpenLineups();
                      close();
                    }}
                  >
                    <Calendar className="h-4 w-4 mr-1.5" />
                    Lineups
                  </Button>
                )}
                {onOpenPresets && (
                  <Button
                    variant="outline"
                    className="h-10"
                    onClick={() => {
                      onOpenPresets();
                      close();
                    }}
                  >
                    <Bookmark className="h-4 w-4 mr-1.5" />
                    Presets
                  </Button>
                )}
              </div>
              {onApplyLineup && currentQuarter && (
                <Button
                  variant="default"
                  className="w-full h-10"
                  onClick={() => {
                    onApplyLineup();
                    close();
                  }}
                >
                  <Zap className="h-4 w-4 mr-1.5" />
                  Apply Lineup for Q{currentQuarter}
                </Button>
              )}
              {onAddFillIn && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full h-9 text-xs"
                  onClick={() => {
                    onAddFillIn();
                    close();
                  }}
                >
                  <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                  Add Fill-In Player
                </Button>
              )}
            </div>
          )}

          {/* Step 3: Game rules */}
          <div className="space-y-3 pt-1">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              Step 3 — Game Rules
            </p>

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
            </div>

            <div className="space-y-2">
              <Label>Minutes per {periodLabel}: {minutesPerQuarter}</Label>
              <Slider
                min={4}
                max={periodType === "halves" ? 30 : 15}
                step={1}
                value={[minutesPerQuarter]}
                onValueChange={(v) => onMinutesPerQuarterChange(v[0])}
              />
            </div>
          </div>

          {/* Advanced — collapsed */}
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                <span>More Options</span>
              </div>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 transition-transform",
                  advancedOpen && "rotate-180"
                )}
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Rotation mode</Label>
                <Select value={rotationMode} onValueChange={(v) => onRotationModeChange(v as RotationMode)}>
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
                    onValueChange={(v) => onRotationIntervalChange(v[0])}
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
                  FIBA: 2 in H1, 3 in H2. Auto-resets at Q3.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Position style</Label>
                <Select
                  value={validationMode}
                  onValueChange={(v) => onValidationModeChange(v as ValidationMode)}
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
                  Free mode is recommended for juniors.
                </p>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <div className="shrink-0 px-6 py-3 border-t">
          <Button className="w-full" onClick={close}>
            <Play className="h-4 w-4 mr-1.5" />
            Done — Back to Court
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
