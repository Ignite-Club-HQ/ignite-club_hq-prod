import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type AutoSubPlanMode = 1 | 2;

const MODES: { id: AutoSubPlanMode; title: string; tradeoff: string }[] = [
  {
    id: 1,
    title: "Standard",
    tradeoff: "Fewer substitutions, longer shifts. Minutes may differ a little more between players.",
  },
  {
    id: 2,
    title: "Frequent",
    tradeoff: "More substitutions, tighter rotation. Minutes even out faster across the squad.",
  },
];

export default function AutoSubPlanModeToggle({
  activeMode,
  onChange,
  readOnly,
  disabledModes = [],
}: {
  activeMode: AutoSubPlanMode;
  onChange: (mode: AutoSubPlanMode) => void;
  readOnly: boolean;
  disabledModes?: AutoSubPlanMode[];
}) {
  if (readOnly) return null;

  return (
    <div className="space-y-1.5 mb-2">
      <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground px-0.5">
        Rotation mode
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        {MODES.map((mode) => {
          const isActive = activeMode === mode.id;
          const isDisabled = disabledModes.includes(mode.id);
          return (
            <button
              key={mode.id}
              type="button"
              disabled={isDisabled}
              onClick={() => !isDisabled && onChange(mode.id)}
              aria-disabled={isDisabled}
              aria-pressed={isActive}
              title={isDisabled ? "Not available for this squad size and match length" : undefined}
              className={cn(
                "text-left rounded-md border transition-colors p-2.5 min-h-[40px]",
                isActive ? "border-primary bg-primary/10" : "border-border bg-background hover:bg-muted/60",
                isDisabled && "opacity-50 cursor-not-allowed hover:bg-background",
              )}
            >
              <span className="flex items-center gap-1.5">
                <span className="block text-xs font-semibold text-foreground">{mode.title}</span>
                {isActive && !isDisabled && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                    <Check className="h-2.5 w-2.5" />
                    On
                  </span>
                )}
                {isDisabled && (
                  <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    Unavailable
                  </span>
                )}
              </span>
              <span className="block text-[11px] text-muted-foreground leading-snug mt-0.5">{mode.tradeoff}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
