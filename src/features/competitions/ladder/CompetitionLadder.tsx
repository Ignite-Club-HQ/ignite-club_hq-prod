import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Loader2, Trophy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
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
  renderGroup: (group: LadderGroup, division: CompetitionDivisionSummary | undefined) => ReactNode;
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
          {groups.map((group) => renderGroup(
            group,
            divisions.find((division) => division.id === group.divisionId),
          ))}
        </TooltipProvider>
      )}
    </div>
  );
}
