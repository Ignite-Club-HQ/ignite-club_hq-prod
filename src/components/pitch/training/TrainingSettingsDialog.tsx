import { useMemo } from "react";
import { Settings2, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useTrainingSettings } from "@/hooks/useTrainingSettings";
import { cn } from "@/lib/utils";

interface TrainingSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SPEED_OPTIONS: Array<{ value: 0.5 | 1 | 2; label: string }> = [
  { value: 0.5, label: "0.5×" },
  { value: 1, label: "1×" },
  { value: 2, label: "2×" },
];

export function TrainingSettingsDialog({
  open,
  onOpenChange,
}: TrainingSettingsDialogProps) {
  const { settings, update, reset } = useTrainingSettings();

  const frameSeconds = useMemo(
    () => (settings.defaultFrameDurationMs / 1000).toFixed(1),
    [settings.defaultFrameDurationMs]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          // Full-screen sheet on mobile, centered modal on tablet+
          "p-0 gap-0 !flex flex-col !overflow-hidden",
          // Mobile: edge-to-edge, full viewport height, no rounded corners
          "!max-w-none !w-screen !h-[100dvh] !max-h-[100dvh] !rounded-none !left-0 !top-0 !translate-x-0 !translate-y-0 !border-0",
          // Tablet+: centered card with comfortable max size
          "sm:!w-auto sm:!h-auto sm:!max-w-md sm:!max-h-[85vh] sm:!rounded-lg sm:!border sm:!left-[50%] sm:!top-[50%] sm:!translate-x-[-50%] sm:!translate-y-[-50%]"
        )}
        onOpenAutoFocus={(e) => {
          // Prevent the underlying training overlay from stealing focus back
          e.preventDefault();
        }}
      >
        <DialogHeader className="px-6 pt-6 sm:pt-6 pb-3 shrink-0 pt-safe">
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5 text-primary" />
            Training Mode Settings
          </DialogTitle>
          <DialogDescription>
            Personal preferences for how drills look and play back. Saved on this device.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0 px-6 pb-2">
          <div className="space-y-5 py-2">
            {/* Players */}
            <Section title="Players">
              <ToggleRow
                id="substitute-real-names"
                label="Use real squad names"
                hint="Show actual player names on chips instead of A, B, D, 1…"
                checked={settings.substituteRealNames}
                onChange={(v) => update({ substituteRealNames: v })}
              />
            </Section>

            <Separator />

            {/* Playback */}
            <Section title="Playback">
              <div className="space-y-2">
                <Label className="text-sm">Default speed</Label>
                <p className="text-xs text-muted-foreground">
                  Used when a drill auto-plays after opening.
                </p>
                <div className="flex gap-2 pt-1">
                  {SPEED_OPTIONS.map((opt) => (
                    <Button
                      key={opt.value}
                      type="button"
                      size="sm"
                      variant={
                        settings.defaultPlaybackSpeed === opt.value ? "default" : "outline"
                      }
                      className="flex-1"
                      onClick={() => update({ defaultPlaybackSpeed: opt.value })}
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
              </div>

              <ToggleRow
                id="loop-playback"
                label="Loop playback"
                hint="Restart from frame 1 when the drill finishes."
                checked={settings.loopPlayback}
                onChange={(v) => update({ loopPlayback: v })}
              />

              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <Label className="text-sm">Default frame duration</Label>
                  <span className="text-xs font-mono text-muted-foreground">
                    {frameSeconds}s
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Time spent on each new frame you add.
                </p>
                <Slider
                  min={500}
                  max={5000}
                  step={250}
                  value={[settings.defaultFrameDurationMs]}
                  onValueChange={([v]) => update({ defaultFrameDurationMs: v })}
                />
              </div>
            </Section>

            <Separator />

            {/* Display */}
            <Section title="Display">
              <ToggleRow
                id="show-pitch-markings"
                label="Show pitch markings"
                hint="Halfway line, centre circle, and 18-yard boxes."
                checked={settings.showPitchMarkings}
                onChange={(v) => update({ showPitchMarkings: v })}
              />
              <ToggleRow
                id="auto-open-preview"
                label="Auto-open in Preview mode"
                hint="Saved drills start in preview (read-only) instead of edit mode."
                checked={settings.autoOpenInPreview}
                onChange={(v) => update({ autoOpenInPreview: v })}
              />
              <ToggleRow
                id="coaching-points-overlay"
                label="Show coaching points in Preview"
                hint="Pin the drill's coaching points over the pitch during preview."
                checked={settings.showCoachingPointsInPreview}
                onChange={(v) => update({ showCoachingPointsInPreview: v })}
              />
            </Section>
          </div>
        </ScrollArea>

        <DialogFooter className="px-6 py-4 pb-safe border-t shrink-0 flex-row justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={reset}
            className="gap-1.5"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </Button>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function ToggleRow({
  id,
  label,
  hint,
  checked,
  onChange,
  className,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3", className)}>
      <div className="min-w-0 flex-1">
        <Label htmlFor={id} className="text-sm cursor-pointer">
          {label}
        </Label>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} className="mt-0.5" />
    </div>
  );
}
