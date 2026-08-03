import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Loader2, Trophy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { CompetitionDivisionSummary } from "../fixtures/types";
import {
  ALL_LADDER_FILTER,
  buildLadderDivisionOptions,
  buildLadderTeamOptions,
  filterLadderRows,
  groupLadderRows,
  normalizeLadderTeamFilter,
  visibleLadderRows,
} from "./ladderModel";
import { fetchCompetitionLadder } from "./repository";
import type { CompetitionLadderRow, LadderGroup } from "./types";

interface CompetitionLadderDataProps {
  competitionId: string;
  children: (rows: CompetitionLadderRow[]) => ReactNode;
}

/**
 * Owns the ladder read and its loading, failure and genuinely-empty states.
 * Filtering and table presentation remain separate so this boundary can be
 * moved without changing the established ladder behaviour.
 */
export function CompetitionLadderData({
  competitionId,
  children,
}: CompetitionLadderDataProps) {
  const { data: rows = [], isLoading, isError } = useQuery({
    queryKey: ["competition-ladder", competitionId],
    queryFn: () => fetchCompetitionLadder(competitionId),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (isError) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-6 text-center space-y-2">
          <Trophy className="h-8 w-8 text-destructive mx-auto" />
          <h3 className="text-sm font-semibold">Couldn't load the ladder</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Something went wrong loading standings. Please check your connection and try again.
          </p>
        </CardContent>
      </Card>
    );
  }
  if (rows.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-6 text-center space-y-2">
          <Trophy className="h-8 w-8 text-muted-foreground mx-auto" />
          <h3 className="text-sm font-semibold">No ladder yet</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Once teams are accepted into divisions, standings will appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return <>{children(rows)}</>;
}

interface CompetitionLadderViewProps {
  rows: CompetitionLadderRow[];
  divisions: CompetitionDivisionSummary[];
  isAdmin?: boolean;
  renderGroup?: (group: LadderGroup, division: CompetitionDivisionSummary | undefined) => ReactNode;
}

export function CompetitionLadderView({
  rows,
  divisions,
  isAdmin = false,
  renderGroup,
}: CompetitionLadderViewProps) {
  const [filterDivisionId, setFilterDivisionId] = useState(ALL_LADDER_FILTER);
  const [filterTeamId, setFilterTeamId] = useState(ALL_LADDER_FILTER);
  const [teamSheetOpen, setTeamSheetOpen] = useState(false);
  const visibleRows = useMemo(
    () => visibleLadderRows(rows, divisions, isAdmin),
    [rows, divisions, isAdmin],
  );
  const divisionOptions = useMemo(
    () => buildLadderDivisionOptions(visibleRows, divisions),
    [visibleRows, divisions],
  );
  const teamOptions = useMemo(
    () => buildLadderTeamOptions(visibleRows, filterDivisionId),
    [visibleRows, filterDivisionId],
  );

  useEffect(() => {
    const normalized = normalizeLadderTeamFilter(filterTeamId, teamOptions);
    if (normalized !== filterTeamId) setFilterTeamId(normalized);
  }, [filterTeamId, teamOptions]);

  const filteredRows = filterLadderRows(visibleRows, filterDivisionId, filterTeamId);
  const groups = groupLadderRows(filteredRows, divisionOptions);

  return (
    <div className="space-y-4">
      {(divisionOptions.length > 1 || teamOptions.length > 1) && (
        <div className="flex flex-wrap gap-2">
          {divisionOptions.length > 1 && (
            <Select value={filterDivisionId} onValueChange={setFilterDivisionId}>
              <SelectTrigger className="h-9 w-auto min-w-[140px]">
                <SelectValue placeholder="All divisions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_LADDER_FILTER}>All divisions</SelectItem>
                {divisionOptions.map((division) => (
                  <SelectItem key={division.id} value={division.id}>{division.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {teamOptions.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => setTeamSheetOpen(true)}
                className="inline-flex h-9 items-center gap-1 rounded-md border border-input bg-background px-3 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
              >
                {filterTeamId === ALL_LADDER_FILTER
                  ? "All teams"
                  : teamOptions.find((team) => team.id === filterTeamId)?.name ?? "All teams"}
                <ChevronDown className="h-3.5 w-3.5 opacity-50" />
              </button>
              <Sheet open={teamSheetOpen} onOpenChange={setTeamSheetOpen}>
                <SheetContent side="bottom" className="max-h-[85vh] rounded-t-xl p-0">
                  <div className="flex justify-center pt-3 pb-1">
                    <div className="h-1.5 w-12 rounded-full bg-muted-foreground/30" />
                  </div>
                  <SheetHeader className="px-4 pb-2 text-left">
                    <SheetTitle className="text-base">Filter by team</SheetTitle>
                    <SheetDescription className="sr-only">
                      Choose a team to filter the fixture list.
                    </SheetDescription>
                  </SheetHeader>
                  <div className="max-h-[60vh] overflow-y-auto px-4 pb-6">
                    <div className="space-y-1">
                      <button
                        type="button"
                        onClick={() => {
                          setFilterTeamId(ALL_LADDER_FILTER);
                          setTeamSheetOpen(false);
                        }}
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm hover:bg-accent"
                      >
                        <span>All teams</span>
                        {filterTeamId === ALL_LADDER_FILTER && <Check className="h-4 w-4 text-primary" />}
                      </button>
                      {teamOptions.map((team) => (
                        <button
                          key={team.id}
                          type="button"
                          onClick={() => {
                            setFilterTeamId(team.id);
                            setTeamSheetOpen(false);
                          }}
                          className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm hover:bg-accent"
                        >
                          <span>{team.name}</span>
                          {filterTeamId === team.id && <Check className="h-4 w-4 text-primary" />}
                        </button>
                      ))}
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            </>
          )}
        </div>
      )}

      {groups.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            No standings match the current filter.
          </CardContent>
        </Card>
      ) : (
        <TooltipProvider delayDuration={150}>
          {groups.map((group) => {
            const division = divisions.find((item) => item.id === group.divisionId);
            return renderGroup
              ? renderGroup(group, division)
              : (
                <LadderDivisionCard
                  key={group.divisionId}
                  title={division?.name ?? "Overall"}
                  rows={group.rows}
                  isHidden={isAdmin && !!division?.hide_ladder}
                />
              );
          })}
        </TooltipProvider>
      )}
    </div>
  );
}

interface CompetitionLadderPanelProps {
  competitionId: string;
  divisions: CompetitionDivisionSummary[];
  isAdmin?: boolean;
}

export function CompetitionLadderPanel({
  competitionId,
  divisions,
  isAdmin = false,
}: CompetitionLadderPanelProps) {
  return (
    <CompetitionLadderData competitionId={competitionId}>
      {(rows) => (
        <CompetitionLadderView
          rows={rows}
          divisions={divisions}
          isAdmin={isAdmin}
        />
      )}
    </CompetitionLadderData>
  );
}

const COLUMN_TOOLTIPS: Record<string, string> = {
  P: "Played",
  W: "Wins",
  D: "Draws",
  L: "Losses",
  "+/-": "Goal difference (for − against)",
  Pts: "Competition points",
};

function ColumnHeading({ label, className }: { label: string; className?: string }) {
  return (
    <th className={cn("py-2 px-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground/70", className)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help">{label}</span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">{COLUMN_TOOLTIPS[label]}</TooltipContent>
      </Tooltip>
    </th>
  );
}

function TeamAvatar({ row, teamName }: { row: CompetitionLadderRow; teamName: string }) {
  const initials = teamName
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  if (row.teams?.logo_url) {
    return (
      <img
        src={row.teams.logo_url}
        alt={teamName}
        loading="lazy"
        decoding="async"
        className="h-7 w-7 rounded-full object-cover bg-muted shrink-0 ring-1 ring-border/40"
      />
    );
  }
  return (
    <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
      {initials || "?"}
    </div>
  );
}

function LadderDivisionCard({
  title,
  rows,
  isHidden = false,
}: {
  title: string;
  rows: CompetitionLadderRow[];
  isHidden?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const seasonStarted = rows.some((row) => (row.played ?? 0) > 0);

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-primary/5 border-b border-border/60 text-left hover:bg-primary/10 transition-colors"
        aria-expanded={open}
      >
        <Trophy className="h-3.5 w-3.5 text-primary shrink-0" />
        <div className="text-sm font-semibold text-foreground truncate">{title}</div>
        {isHidden && (
          <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 shrink-0">
            Hidden
          </span>
        )}
        <span className="text-[11px] text-muted-foreground shrink-0">
          · {rows.length} {rows.length === 1 ? "team" : "teams"}
          {!seasonStarted && " · Not started"}
        </span>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform ml-auto", !open && "-rotate-90")} />
      </button>

      {open && (
        <div>
          {!seasonStarted ? (
            <div className="px-4 py-8 text-center space-y-2">
              <Trophy className="h-8 w-8 text-muted-foreground/40 mx-auto" />
              <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                No results entered yet. Rankings will appear once matches are completed.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-separate border-spacing-0">
                <thead className="sticky top-0 bg-primary/5">
                  <tr>
                    <th className="py-2 pl-3 pr-1 text-[11px] font-semibold uppercase tracking-wide text-foreground/70 text-left w-9">#</th>
                    <th className="py-2 px-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground/70 text-left">Team</th>
                    <ColumnHeading label="P" className="text-right" />
                    <ColumnHeading label="W" className="text-right" />
                    <ColumnHeading label="D" className="text-right" />
                    <ColumnHeading label="L" className="text-right" />
                    <ColumnHeading label="+/-" className="text-right pl-3" />
                    <ColumnHeading label="Pts" className="text-right pr-3" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => {
                    const rank = index + 1;
                    const goalDifference = row.goal_diff ?? 0;
                    const medalColor = rank === 1
                      ? "bg-amber-400/25 text-amber-700 dark:text-amber-300 ring-1 ring-amber-400/50"
                      : rank === 2
                        ? "bg-slate-400/25 text-slate-700 dark:text-slate-300 ring-1 ring-slate-400/50"
                        : rank === 3
                          ? "bg-orange-500/25 text-orange-700 dark:text-orange-300 ring-1 ring-orange-500/50"
                          : "bg-muted text-muted-foreground";
                    const topTint = rank === 1
                      ? "bg-amber-400/[0.06]"
                      : rank === 2
                        ? "bg-slate-400/[0.06]"
                        : rank === 3
                          ? "bg-orange-500/[0.06]"
                          : index % 2 === 1 ? "bg-muted/20" : "";
                    const teamName = row.teams?.name ?? "?";
                    const rowContent = (
                      <>
                        <td className={cn("py-3 pl-3 pr-1 align-middle", topTint)}>
                          <span className={cn("inline-flex h-6 min-w-[24px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold tabular-nums", medalColor)}>
                            {rank}
                          </span>
                        </td>
                        <td className={cn("py-3 px-1.5 align-middle min-w-0", topTint)}>
                          <div className="flex items-center gap-2 min-w-0">
                            <TeamAvatar row={row} teamName={teamName} />
                            <span className="font-semibold text-foreground truncate">{teamName}</span>
                          </div>
                        </td>
                        <td className={cn("py-3 px-1.5 text-right tabular-nums text-foreground/80", topTint)}>{row.played ?? 0}</td>
                        <td className={cn("py-3 px-1.5 text-right tabular-nums text-foreground/80", topTint)}>{row.wins ?? 0}</td>
                        <td className={cn("py-3 px-1.5 text-right tabular-nums text-foreground/80", topTint)}>{row.draws ?? 0}</td>
                        <td className={cn("py-3 px-1.5 text-right tabular-nums text-foreground/80", topTint)}>{row.losses ?? 0}</td>
                        <td className={cn(
                          "py-3 px-1.5 pl-3 text-right tabular-nums font-medium",
                          goalDifference > 0 && "text-emerald-600 dark:text-emerald-400",
                          goalDifference < 0 && "text-rose-600 dark:text-rose-400",
                          goalDifference === 0 && "text-muted-foreground",
                          topTint,
                        )}>
                          {goalDifference > 0 ? `+${goalDifference}` : goalDifference}
                        </td>
                        <td className={cn("py-3 px-1.5 pr-3 text-right tabular-nums font-bold text-foreground", topTint)}>
                          {row.points ?? 0}
                        </td>
                      </>
                    );
                    return row.team_id ? (
                      <tr
                        key={row.team_id}
                        className="group cursor-pointer hover:bg-accent/40 active:bg-accent/60 transition-colors"
                        onClick={() => { window.location.href = `/teams/${row.team_id}`; }}
                      >
                        {rowContent}
                      </tr>
                    ) : (
                      <tr key={`row-${index}`}>{rowContent}</tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
