import { useState } from "react";
import { Check, Repeat2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTrainingDefault } from "@/hooks/useTrainingDefault";
import { toast } from "@/hooks/use-toast";

interface Props {
  teamId: string | null | undefined;
  /** Pass exactly one of childId or userId. */
  childId?: string | null;
  userId?: string | null;
  /** Display name used in microcopy (e.g. "Teddy" or "you"). */
  subjectName: string;
  /** Most recent RSVP status the user just gave for this event. */
  currentRsvpStatus?: "going" | "maybe" | "not_going" | null;
  /** True only when this event is a training. */
  isTraining: boolean;
}

const DISMISS_KEY = "training-default-prompt-dismissed:v1";

function isDismissed(key: string): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const map = JSON.parse(raw) as Record<string, number>;
    const ts = map[key];
    if (!ts) return false;
    // Dismissal lasts 30 days, then reappears
    return Date.now() - ts < 30 * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function dismiss(key: string) {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[key] = Date.now();
    localStorage.setItem(DISMISS_KEY, JSON.stringify(map));
  } catch {
    /* quota — ignore */
  }
}

/**
 * Inline default-RSVP control shown under the RSVP buttons on training events.
 *
 * - Only renders when isTraining is true.
 * - If a default already exists: shows a small chip with "Auto-going to trainings · Change".
 * - Else if the parent just RSVP'd "going" or "not_going": offers to make it the default.
 * - Else: renders nothing (we don't ask cold).
 */
export function TrainingDefaultControl({
  teamId,
  childId,
  userId,
  subjectName,
  currentRsvpStatus,
  isTraining,
}: Props) {
  const { defaultRow, setDefault, clearDefault, isSaving } = useTrainingDefault({
    teamId,
    childId,
    userId,
  });
  const dismissKey = `${teamId}:${childId ?? userId ?? "self"}`;
  const [locallyDismissed, setLocallyDismissed] = useState(() => isDismissed(dismissKey));

  if (!isTraining || !teamId) return null;

  // Already has a default — render management chip
  if (defaultRow) {
    const label =
      defaultRow.default_status === "going"
        ? `Auto-RSVP'ing ${subjectName} as Going to trainings`
        : `Auto-RSVP'ing ${subjectName} as Not going to trainings`;
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
        <Repeat2 className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="text-foreground/90">{label}</span>
        <button
          type="button"
          disabled={isSaving}
          onClick={() => {
            clearDefault();
            toast({ title: "We'll ask you each time from now on." });
          }}
          className="ml-auto text-muted-foreground underline-offset-2 hover:underline touch-manipulation disabled:opacity-50"
        >
          Stop
        </button>
      </div>
    );
  }

  // Only suggest a default after an explicit going / not_going RSVP
  if (currentRsvpStatus !== "going" && currentRsvpStatus !== "not_going") return null;
  if (isDismissed(dismissKey)) return null;

  const verb = currentRsvpStatus === "going" ? "Going" : "Not going";

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border/70 bg-muted/30 px-3 py-2 text-xs">
      <Repeat2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="text-foreground/90">
        {subjectName} usually <span className="font-medium">{verb.toLowerCase()}</span> to trainings?
      </span>
      <div className="ml-auto flex items-center gap-1">
        <Button
          size="sm"
          variant="default"
          disabled={isSaving}
          className="h-7 px-2 text-xs gap-1"
          onClick={() => {
            setDefault(currentRsvpStatus);
            toast({
              title: `Default set to ${verb}`,
              description: "We'll auto-RSVP for new trainings. Change any one before kickoff.",
            });
          }}
        >
          <Check className="h-3 w-3" /> Set as default
        </Button>
        <button
          type="button"
          aria-label="Dismiss"
          className="p-1 text-muted-foreground hover:text-foreground touch-manipulation"
          onClick={() => {
            dismiss(dismissKey);
            // force re-render via toast; the parent re-reads on next render naturally
            toast({ title: "No default set", description: "We'll ask you each time." });
          }}
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
