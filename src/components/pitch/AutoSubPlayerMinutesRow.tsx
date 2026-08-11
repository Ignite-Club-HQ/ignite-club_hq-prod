import { GripVertical } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { FairnessReport, PlannerPlayer, PlayerTimeForecast } from "./planner/analysis";

interface DisplayPlayer extends PlannerPlayer {
  number?: number;
}

export default function AutoSubPlayerMinutesRow({
  forecast,
  fairnessReport,
  draggable,
}: {
  forecast: PlayerTimeForecast<DisplayPlayer>;
  fairnessReport: FairnessReport | null;
  draggable: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: forecast.player.id,
    disabled: !draggable,
  });
  const stat = fairnessReport?.perPlayer.find((item) => item.playerId === forecast.player.id);

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
      }}
      data-testid={`player-minutes-${forecast.player.id}`}
      className={cn(
        "flex items-center gap-2 p-2 rounded-lg bg-muted/50",
        isDragging && "ring-2 ring-primary/40",
      )}
    >
      {draggable ? (
        <button
          type="button"
          aria-label={`Reorder ${forecast.player.name} playing-time priority`}
          className="touch-none p-1 -ml-1 text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      ) : (
        <div className="w-6 shrink-0" aria-hidden />
      )}
      <div className="flex items-center justify-center w-7 h-7 rounded-full bg-primary/20 text-primary text-xs font-bold shrink-0">
        {forecast.player.number || "?"}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium truncate">{forecast.player.name}</span>
          <Badge
            variant="outline"
            className={cn(
              "text-xs px-1.5 py-0",
              forecast.startsOnPitch ? "border-emerald-500/50 text-emerald-500" : "border-muted-foreground/50",
            )}
          >
            {forecast.startsOnPitch ? "Start" : "Bench"}
          </Badge>
          {forecast.gkRole && (
            <Badge variant="outline" className="text-xs px-1.5 py-0 border-amber-500/50 text-amber-600">
              {forecast.gkRole === "full" ? "GK" : forecast.gkRole === "1h" ? "GK 1H" : "GK 2H"}
            </Badge>
          )}
          {!!stat?.shortShifts && (
            <Badge variant="outline" className="text-xs px-1.5 py-0 border-red-500/50 text-red-500">
              {stat.shortShifts} very short
            </Badge>
          )}
          {!!stat?.bounceBacks && (
            <Badge variant="outline" className="text-xs px-1.5 py-0 border-purple-500/50 text-purple-500">
              {stat.bounceBacks} bounce
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Progress value={forecast.percentageOfGame} className="h-2 flex-1" />
          <span className="text-xs text-muted-foreground w-20 text-right shrink-0 tabular-nums">
            {forecast.predictedMinutes}' ({forecast.percentageOfGame}%)
          </span>
        </div>
      </div>
    </div>
  );
}
