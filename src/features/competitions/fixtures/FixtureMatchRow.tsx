import { useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { MapPin, Pencil, Save, Settings2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { competitionFixtureKeys } from "./queryKeys";
import {
  buildMatchResultUpdate,
  deleteCompetitionMatch,
  updateCompetitionMatch,
} from "./matchWorkflows";
import type { CompetitionFixtureRow } from "./types";

function FixtureTeamAvatar({
  name,
  logoUrl,
  initials,
}: {
  name: string;
  logoUrl?: string | null;
  initials: string;
}) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={name}
        loading="lazy"
        decoding="async"
        className="h-6 w-6 rounded-full object-cover bg-muted shrink-0 ring-1 ring-border/40"
      />
    );
  }
  return (
    <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
      {initials || "?"}
    </div>
  );
}
interface FixtureMatchRowProps {
  match: CompetitionFixtureRow;
  isAdmin: boolean;
  competitionId: string;
  source?: string;
  renderEditDetails?: (props: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) => ReactNode;
}

export function FixtureMatchRow({
  match,
  isAdmin,
  competitionId,
  source,
  renderEditDetails,
}: FixtureMatchRowProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [editDetailsOpen, setEditDetailsOpen] = useState(false);
  const [home, setHome] = useState<string>(match.home_score?.toString() ?? "");
  const [away, setAway] = useState<string>(match.away_score?.toString() ?? "");
  const [status, setStatus] = useState<string>(match.status ?? "scheduled");
  const [manageOpen, setManageOpen] = useState(false);
  const tapStartRef = useRef<{ x: number; y: number } | null>(null);

  const save = async () => {
    // PlayHQ-sourced rows are sync-locked. The first local edit stamps
    // manually_overridden_at, which the DB trigger uses to release the row
    // from future sync overwrites.
    const { payload, nextStatus, createsLocalOverride } = buildMatchResultUpdate({
      homeScore: home,
      awayScore: away,
      status,
      source: match.source,
      manuallyOverriddenAt: match.manually_overridden_at,
    });
    const { error } = await updateCompetitionMatch(match.id, payload);
    if (error) {
      toast({ title: "Could not save", description: error.message, variant: "destructive" });
      return;
    }
    setStatus(nextStatus);
    toast({
      title: "Match updated",
      description: createsLocalOverride
        ? "This match is now locally overridden — future PlayHQ syncs won't change it."
        : undefined,
    });
    setEditing(false);
    qc.invalidateQueries({ queryKey: competitionFixtureKeys.matches(competitionId) });
    qc.invalidateQueries({ queryKey: ["competition-ladder", competitionId] });
  };


  const remove = async () => {
    if (!window.confirm("Delete this match?")) return;
    const { error } = await deleteCompetitionMatch(match.id);
    if (error) {
      toast({ title: "Could not delete", description: error.message, variant: "destructive" });
      return;
    }
    qc.invalidateQueries({ queryKey: competitionFixtureKeys.matches(competitionId) });
    qc.invalidateQueries({ queryKey: ["competition-ladder", competitionId] });
  };

  const statusLabel = (match.status ?? "scheduled").replace("_", " ");
  const hasScore = match.home_score != null || match.away_score != null;
  const venueName = match.venue ? String(match.venue).split(",")[0].trim() : null;
  const venueLine = venueName
    ? `${venueName}${match.pitch_number ? ` · Pitch ${match.pitch_number}` : ""}`
    : null;

  const scheduledDate = match.scheduled_at ? new Date(match.scheduled_at) : null;
  const isCompleted = match.status === "completed";
  const isCancelled = match.status === "cancelled";
  const isPostponed = match.status === "postponed";
  const isInProgress = match.status === "in_progress";

  // Color-coded status pill
  const statusPillClass =
    isCompleted ? "bg-muted text-muted-foreground"
    : isCancelled ? "bg-rose-500/15 text-rose-600 dark:text-rose-400"
    : isPostponed ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
    : isInProgress ? "bg-rose-500/15 text-rose-600 dark:text-rose-400 animate-pulse"
    : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";

  const homeName = match.home?.name ?? "TBD";
  const awayName = match.away?.name ?? "TBD";
  const homeInitials = homeName.split(/\s+/).map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
  const awayInitials = awayName.split(/\s+/).map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();

  const homeWon = hasScore && match.home_score != null && match.away_score != null && match.home_score > match.away_score;
  const awayWon = hasScore && match.home_score != null && match.away_score != null && match.away_score > match.home_score;


  const isScheduled = !isCompleted && !isCancelled && !isPostponed && !isInProgress;
  return (
    <Card className={`overflow-hidden w-full box-border shadow-sm hover:shadow-md transition-shadow ${isCancelled ? "opacity-60" : ""}`}>
      <CardContent className="px-4 pt-4 pb-3.5 space-y-4">
        {/* 1. Time — compact metadata row */}
        {!editing && (
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-base font-semibold text-foreground tabular-nums leading-snug">
              {scheduledDate ? format(scheduledDate, "h:mm a") : "Time TBD"}
            </span>
            <span className="text-sm text-muted-foreground leading-snug">
              {scheduledDate ? format(scheduledDate, "EEE d MMM") : "Date TBD"}
            </span>
            <div className="flex-1 min-w-0" />
            {match.source && match.source !== "manual" && (
              <span
                className="shrink-0 inline-flex items-center px-1.5 py-px rounded text-[9px] font-semibold uppercase tracking-wider bg-sky-500/15 text-sky-700 dark:text-sky-400"
                title={match.manually_overridden_at
                  ? `Synced from ${match.source} · locally overridden`
                  : `Synced from ${match.source}`}
              >
                {match.manually_overridden_at ? `${match.source} · local` : match.source}
              </span>
            )}
            {!isScheduled && (
              <span className={`shrink-0 inline-flex items-center px-1.5 py-px rounded text-[9px] font-semibold uppercase tracking-wider ${statusPillClass}`}>
                {statusLabel}
              </span>
            )}
          </div>
        )}

        {/* 2. Teams — primary visual focus */}
        {editing ? (
          <div className="space-y-3 py-1">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Home</div>
                <div className="text-sm font-bold break-words">{homeName}</div>
                <Input type="number" inputMode="numeric" value={home} onChange={(e) => setHome(e.target.value)} className="h-9 text-center text-lg font-bold tabular-nums" />
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground pt-5">vs</span>
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold text-right">Away</div>
                <div className="text-sm font-bold break-words text-right">{awayName}</div>
                <Input type="number" inputMode="numeric" value={away} onChange={(e) => setAway(e.target.value)} className="h-9 text-center text-lg font-bold tabular-nums" />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Entering both scores marks this match as completed. Use the settings menu → Edit details to change status (e.g. postponed, cancelled).
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" className="h-9 w-full" onClick={save}>
                <Save className="h-4 w-4 mr-1" /> Save
              </Button>
              <Button size="sm" variant="ghost" className="h-9 w-full" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
            {/* Home */}
            <div className="flex items-center gap-2 min-w-0">
              <FixtureTeamAvatar name={homeName} logoUrl={match.home?.logo_url} initials={homeInitials} />
              <div
                className={`flex-1 min-w-0 text-[15px] font-semibold leading-tight tracking-[-0.01em] truncate ${awayWon ? "text-muted-foreground" : "text-foreground"}`}
                title={homeName}
              >
                {homeName}
              </div>
            </div>

            {/* Score / vs */}
            <div className="flex flex-col items-center justify-center px-1 shrink-0">
              {hasScore ? (
                <div className="flex items-center gap-1 text-xl font-bold tabular-nums leading-none">
                  <span className={homeWon ? "" : awayWon ? "text-muted-foreground" : ""}>{match.home_score ?? "–"}</span>
                  <span className="text-muted-foreground text-sm">-</span>
                  <span className={awayWon ? "" : homeWon ? "text-muted-foreground" : ""}>{match.away_score ?? "–"}</span>
                </div>
              ) : (
                <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/70">vs</span>
              )}
            </div>

            {/* Away — mirrored: avatar on outside, name flush to centre */}
            <div className="flex flex-row-reverse items-center gap-2 min-w-0">
              <FixtureTeamAvatar name={awayName} logoUrl={match.away?.logo_url} initials={awayInitials} />
              <div
                className={`flex-1 min-w-0 text-[15px] font-semibold leading-tight tracking-[-0.01em] truncate text-right ${homeWon ? "text-muted-foreground" : "text-foreground"}`}
                title={awayName}
              >
                {awayName}
              </div>
            </div>
          </div>
        )}

        {/* 3. Admin actions moved above; venue rendered below as bottom metadata */}


        {/* 4. Admin actions — compact, flush to bottom */}
        {isAdmin && !editing && source !== "playhq" && (
          <div className="flex items-center justify-between gap-2">
            <Button
              size="sm"
              variant={hasScore ? "ghost" : "outline"}
              className={
                hasScore
                  ? "h-9 flex-1 px-3 text-sm text-muted-foreground hover:text-foreground"
                  : "h-9 flex-1 px-3 text-sm font-semibold text-primary border-primary/40 hover:bg-primary/5"
              }
              onClick={() => setEditing(true)}
            >
              <Pencil className="h-4 w-4 mr-1.5" />
              {hasScore ? "Edit score" : "Enter score"}
            </Button>
            <DropdownMenu open={manageOpen} onOpenChange={setManageOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  aria-label="Fixture settings"
                  className="h-9 w-9 p-0 text-muted-foreground select-none touch-manipulation shrink-0"

                  onPointerDown={(e) => {
                    tapStartRef.current = { x: e.clientX, y: e.clientY };
                  }}
                  onPointerUp={(e) => {
                    const start = tapStartRef.current;
                    tapStartRef.current = null;
                    if (!start) return;
                    const dx = e.clientX - start.x;
                    const dy = e.clientY - start.y;
                    if (Math.sqrt(dx * dx + dy * dy) > 10) {
                      e.preventDefault();
                      e.stopPropagation();
                    }
                  }}
                  onPointerCancel={() => { tapStartRef.current = null; }}
                  onContextMenu={(e) => e.preventDefault()}
                >
                  <Settings2 className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={() => setEditDetailsOpen(true)}>
                  <Settings2 className="h-4 w-4 mr-2" /> Edit details
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setEditing(true)}>
                  <Pencil className="h-4 w-4 mr-2" /> Edit score
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={remove} className="text-destructive focus:text-destructive">
                  <Trash2 className="h-4 w-4 mr-2" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {/* 4. Venue + Pitch — bottom metadata, subtle */}
        {!editing && (venueLine || match.pitch_number) && (
          <div className="flex items-center gap-1.5 pt-3 text-sm text-muted-foreground leading-relaxed border-t border-border/40">
            <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{venueLine || `Pitch ${match.pitch_number}`}</span>
          </div>
        )}
      </CardContent>


      {isAdmin && editDetailsOpen && renderEditDetails?.({
        open: editDetailsOpen,
        onOpenChange: setEditDetailsOpen,
      })}
    </Card>
  );
}
