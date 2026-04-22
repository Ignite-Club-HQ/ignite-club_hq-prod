import { memo } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { X, ChevronRight, ListChecks } from "lucide-react";
import {
  useSessionDrills,
  useRemoveFromSession,
  useClearSession,
} from "@/hooks/useDrillLibrary";
import { loadDrill } from "./drillStorage";
import type { Drill } from "./types";
import { toast } from "sonner";

interface SessionPlanStripProps {
  /** Currently loaded drill id (to highlight) */
  loadedDrillId?: string | null;
  /** Open a drill on the board */
  onOpenDrill: (drill: Drill) => void;
}

function SessionPlanStripImpl({ loadedDrillId, onOpenDrill }: SessionPlanStripProps) {
  const { data: session } = useSessionDrills();
  const removeMut = useRemoveFromSession();
  const clearMut = useClearSession();

  if (!session || session.length === 0) return null;

  const handleOpen = async (drillId: string) => {
    try {
      const drill = await loadDrill(drillId);
      onOpenDrill(drill);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to open drill");
    }
  };

  const handleClear = () => {
    if (!window.confirm("Clear today's session plan?")) return;
    clearMut.mutate(undefined, {
      onSuccess: () => toast.success("Session cleared"),
    });
  };

  return (
    <div className="shrink-0 border-b border-border bg-muted/30">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <ListChecks className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium text-muted-foreground shrink-0">
          Today's session ({session.length})
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleClear}
          className="ml-auto h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          Clear
        </Button>
      </div>
      <div className="flex items-center gap-1.5 px-3 pb-2 overflow-x-auto no-scrollbar">
        {session.map((s, i) => {
          const isActive = s.drillId === loadedDrillId;
          return (
            <div
              key={s.id}
              className={cn(
                "shrink-0 flex items-center gap-1 rounded-md border bg-background pl-2 pr-1 py-1 transition-colors",
                isActive ? "border-primary ring-1 ring-primary" : "border-border"
              )}
            >
              <button
                type="button"
                onClick={() => handleOpen(s.drillId)}
                className="flex items-center gap-1.5 text-xs"
              >
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                  {i + 1}
                </span>
                <span className="font-medium max-w-[140px] truncate">{s.drill.name}</span>
                {s.drill.durationMinutes != null && (
                  <span className="text-muted-foreground">{s.drill.durationMinutes}m</span>
                )}
              </button>
              <button
                type="button"
                onClick={() =>
                  removeMut.mutate(s.id, {
                    onSuccess: () => toast.success("Removed from session"),
                  })
                }
                aria-label={`Remove ${s.drill.name}`}
                className="h-5 w-5 rounded hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
        <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
      </div>
    </div>
  );
}

export const SessionPlanStrip = memo(SessionPlanStripImpl);
