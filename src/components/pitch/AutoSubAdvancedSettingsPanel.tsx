import { ChevronDown, RotateCcw, Sliders } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ADVANCED_OVERRIDE_DEFAULTS,
  type PlannerAdvancedOverrides,
} from "./planner/advancedOverrides";

function formatSeconds(seconds: number): string {
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60} min`;
  if (seconds >= 60) return `${(seconds / 60).toFixed(1)} min`;
  return `${seconds}s`;
}

function NumberRow({
  label,
  hint,
  value,
  defaultValue,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (next: number | undefined) => void;
}) {
  const isOverridden = value !== defaultValue;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium text-foreground">{label}</label>
        <div className="flex items-center gap-2">
          <span className={cn(
            "text-xs tabular-nums",
            isOverridden ? "text-primary font-semibold" : "text-muted-foreground",
          )}>
            {formatSeconds(value)}
          </span>
          {isOverridden && !disabled && (
            <button
              type="button"
              aria-label={`Reset ${label}`}
              onClick={() => onChange(undefined)}
              className="text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              reset
            </button>
          )}
        </div>
      </div>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-primary disabled:opacity-50"
      />
      <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>
    </div>
  );
}

export default function AutoSubAdvancedSettingsPanel({
  open,
  onToggle,
  overrides,
  readOnly,
  onChange,
  defaultMaxSpreadMinutes,
}: {
  open: boolean;
  onToggle: () => void;
  overrides: PlannerAdvancedOverrides;
  readOnly: boolean;
  onChange: (next: PlannerAdvancedOverrides) => void;
  defaultMaxSpreadMinutes: number;
}) {
  const defaultMaxSpreadSec = Math.round(defaultMaxSpreadMinutes * 60);
  const values = {
    standardTargetIntervalSec: overrides.standardTargetIntervalSec ?? ADVANCED_OVERRIDE_DEFAULTS.standardTargetIntervalSec,
    standardIntervalFloorSec: overrides.standardIntervalFloorSec ?? ADVANCED_OVERRIDE_DEFAULTS.standardIntervalFloorSec,
    frequentIntervalFloorSec: overrides.frequentIntervalFloorSec ?? ADVANCED_OVERRIDE_DEFAULTS.frequentIntervalFloorSec,
    minShiftSeconds: overrides.minShiftSeconds ?? ADVANCED_OVERRIDE_DEFAULTS.minShiftSeconds,
    halftimeGuardSeconds: overrides.halftimeGuardSeconds ?? ADVANCED_OVERRIDE_DEFAULTS.halftimeGuardSeconds,
    maxSpreadOverrideSec: overrides.maxSpreadOverrideSec ?? defaultMaxSpreadSec,
  };
  const overrideCount = (Object.keys(overrides) as (keyof PlannerAdvancedOverrides)[])
    .filter((key) => overrides[key] !== undefined).length;

  const set = (
    key: Exclude<keyof PlannerAdvancedOverrides, "playerPriorityOrder">,
    next: number | undefined,
  ) => {
    if (readOnly) return;
    const merged = { ...overrides };
    if (next === undefined) delete merged[key];
    else merged[key] = next;
    onChange(merged);
  };

  return (
    <div className="mt-4 rounded-lg border border-border bg-muted/20">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Sliders className="h-4 w-4" />
          Show expert controls
          {overrideCount > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{overrideCount} custom</Badge>
          )}
        </span>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 space-y-4 border-t border-border">
          <p className="text-[11px] leading-snug text-muted-foreground">
            Raw planner thresholds. Most coaches won't need these — use the suggested fixes above instead.
          </p>
          {readOnly && (
            <p className="text-[11px] text-muted-foreground italic">
              These thresholds are controlled by the parent screen and can't be changed here.
            </p>
          )}

          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Balance game time</p>
            <NumberRow
              label="Fairer minutes vs fewer stoppages"
              hint="Lower = more substitution moments and fairer minutes. Higher = fewer interruptions but a wider playing-time spread."
              value={values.standardTargetIntervalSec}
              defaultValue={ADVANCED_OVERRIDE_DEFAULTS.standardTargetIntervalSec}
              min={180} max={900} step={30} disabled={readOnly}
              onChange={(next) => set("standardTargetIntervalSec", next)}
            />
            <NumberRow
              label="Max playing-time spread"
              hint="The biggest acceptable gap between your most-played and least-played outfielder by full-time. Tighter = fairer minutes but more subs."
              value={values.maxSpreadOverrideSec}
              defaultValue={defaultMaxSpreadSec}
              min={120} max={720} step={30} disabled={readOnly}
              onChange={(next) => set("maxSpreadOverrideSec", next)}
            />
          </div>

          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Prevent awkward timing</p>
            <NumberRow
              label="Space out substitution moments"
              hint="Lower = more frequent substitution moments and fairer minutes. Higher = calmer match flow."
              value={values.standardIntervalFloorSec}
              defaultValue={ADVANCED_OVERRIDE_DEFAULTS.standardIntervalFloorSec}
              min={120} max={600} step={30} disabled={readOnly}
              onChange={(next) => set("standardIntervalFloorSec", next)}
            />
            <NumberRow
              label="Space out substitution moments (Frequent mode)"
              hint="Applies only when Frequent mode is selected. Lower = more rotations, busier match flow."
              value={values.frequentIntervalFloorSec}
              defaultValue={ADVANCED_OVERRIDE_DEFAULTS.frequentIntervalFloorSec}
              min={60} max={420} step={15} disabled={readOnly}
              onChange={(next) => set("frequentIntervalFloorSec", next)}
            />
          </div>

          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Player shift protection</p>
            <NumberRow
              label="Allow short cameos vs protect player shifts"
              hint="Lower = players can come off sooner so minutes balance faster. Higher = no cameo shifts but a wider playing-time spread."
              value={values.minShiftSeconds}
              defaultValue={ADVANCED_OVERRIDE_DEFAULTS.minShiftSeconds}
              min={60} max={360} step={15} disabled={readOnly}
              onChange={(next) => set("minShiftSeconds", next)}
            />
          </div>

          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Halftime protection</p>
            <NumberRow
              label="Allow halftime subs vs keep halftime clean"
              hint="Lower = subs can land near the halftime whistle. Higher = halftime stays untouched but rotations may shift earlier or later."
              value={values.halftimeGuardSeconds}
              defaultValue={ADVANCED_OVERRIDE_DEFAULTS.halftimeGuardSeconds}
              min={0} max={420} step={15} disabled={readOnly}
              onChange={(next) => set("halftimeGuardSeconds", next)}
            />
          </div>

          <div className="rounded-md bg-muted/40 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
            <span className="font-medium text-foreground">Current tuning:</span>{" "}
            subs roughly every {Math.round(values.standardTargetIntervalSec / 60)} min,
            minimum {Math.round(values.standardIntervalFloorSec / 60)} min between sub moments,
            players stay on at least {Math.round(values.minShiftSeconds / 60)} min.
          </div>

          {!readOnly && overrideCount > 0 && (
            <div className="flex justify-end pt-1">
              <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => onChange({})}>
                <RotateCcw className="h-3 w-3" />
                Reset all to defaults
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
