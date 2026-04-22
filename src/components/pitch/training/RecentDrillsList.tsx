import { memo } from "react";
import { Clock, ChevronRight } from "lucide-react";
import { useDrillList } from "@/hooks/useDrillLibrary";
import { loadDrill } from "./drillStorage";
import type { Drill } from "./types";
import { toast } from "sonner";

interface RecentDrillsListProps {
  teamId?: string;
  onOpenDrill: (drill: Drill) => void;
}

/**
 * Compact "recent drills" rail for the drill home screen.
 * Renders nothing when the coach has no recent drills — keeps the landing
 * screen quiet for first-time users (no empty placeholder card).
 */
function RecentDrillsListImpl({ teamId, onOpenDrill }: RecentDrillsListProps) {
  // "recent" tab is sorted by last_used_at desc on the server.
  const { data, isLoading } = useDrillList("recent", teamId);
  const recents = (data ?? []).slice(0, 3);

  if (isLoading || recents.length === 0) return null;

  const handleOpen = async (drillId: string) => {
    try {
      const drill = await loadDrill(drillId);
      onOpenDrill(drill);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to open drill");
    }
  };

  return (
    <div className="w-full mt-2">
      <div className="flex items-center gap-1.5 mb-2 px-1">
        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Recent drills
        </span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {recents.map((d) => (
          <li key={d.id}>
            <button
              type="button"
              onClick={() => handleOpen(d.id)}
              className="w-full group flex items-center gap-3 rounded-lg border border-border bg-card hover:bg-accent/50 active:bg-accent transition-colors px-3 py-2.5 text-left"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{d.name}</p>
                {(d.durationMinutes != null || d.focus?.length) && (
                  <p className="text-xs text-muted-foreground truncate">
                    {d.durationMinutes != null && <>{d.durationMinutes} min</>}
                    {d.durationMinutes != null && d.focus?.length ? " · " : null}
                    {d.focus?.slice(0, 2).join(", ")}
                  </p>
                )}
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const RecentDrillsList = memo(RecentDrillsListImpl);
export default RecentDrillsList;
