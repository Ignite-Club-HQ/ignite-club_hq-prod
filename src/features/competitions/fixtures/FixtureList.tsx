import type { ReactNode } from "react";
import { CalendarPlus, Check, ChevronDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ALL_FIXTURES_FILTER, type FixtureRoundGroup, type FixtureRoundSummary } from "./fixtureListModel";
import type { CompetitionDivisionSummary, CompetitionFixtureRow } from "./types";
import { useFixtureListController } from "./useFixtureListController";

interface FixtureListProps {
  matches: CompetitionFixtureRow[];
  divisions: CompetitionDivisionSummary[];
  isAdmin: boolean;
  competitionId: string;
  source?: string;
  renderRound: (group: FixtureRoundGroup) => ReactNode;
  renderSummaryAction?: (summary: FixtureRoundSummary) => ReactNode;
}

export function FixtureList({
  matches,
  divisions,
  isAdmin,
  competitionId,
  source,
  renderRound,
  renderSummaryAction,
}: FixtureListProps) {
  const {
    filters: { divisionId, teamId, clubId },
    setDivisionId,
    setTeamId,
    setClubId,
    teamSheetOpen,
    setTeamSheetOpen,
    teamOptions,
    clubOptions,
    filteredMatches,
    groups,
    summary,
  } = useFixtureListController(competitionId, matches);
  const divisionLabel = source === "playhq" ? "Grade" : "Division";

  if (matches.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-6 text-center space-y-2">
          <CalendarPlus className="h-8 w-8 text-muted-foreground mx-auto" />
          <h3 className="text-sm font-semibold">No fixtures yet</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            {isAdmin
              ? "Invite teams first, then generate a round-robin fixture or add matches manually."
              : "Fixtures will appear here once the organiser adds them."}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {(divisions.length > 1 || teamOptions.length > 1) && (
        <div className="sticky top-0 z-20 -mx-1 px-1 py-2 bg-background/95 backdrop-blur-0 border-b border-border/40 flex flex-wrap gap-2">
          {divisions.length > 1 && (
            <Select value={divisionId} onValueChange={setDivisionId}>
              <SelectTrigger className="h-8 w-auto min-w-[130px] text-xs">
                <SelectValue placeholder={`All ${divisionLabel.toLowerCase()}s`} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_FIXTURES_FILTER}>All {divisionLabel.toLowerCase()}s</SelectItem>
                {divisions.map((division) => (
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
                className="inline-flex h-8 items-center gap-1 rounded-md border border-input bg-background px-3 text-xs font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
              >
                {teamId === ALL_FIXTURES_FILTER
                  ? "All teams"
                  : teamOptions.find((team) => team.id === teamId)?.name ?? "All teams"}
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
                          setTeamId(ALL_FIXTURES_FILTER);
                          setTeamSheetOpen(false);
                        }}
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm hover:bg-accent"
                      >
                        <span>All teams</span>
                        {teamId === ALL_FIXTURES_FILTER && <Check className="h-4 w-4 text-primary" />}
                      </button>
                      {teamOptions.map((team) => (
                        <button
                          key={team.id}
                          type="button"
                          onClick={() => {
                            setTeamId(team.id);
                            setTeamSheetOpen(false);
                          }}
                          className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm hover:bg-accent"
                        >
                          <span>{team.name}</span>
                          {teamId === team.id && <Check className="h-4 w-4 text-primary" />}
                        </button>
                      ))}
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            </>
          )}
          {clubOptions.length > 1 && (
            <Select value={clubId} onValueChange={setClubId}>
              <SelectTrigger className="h-8 w-auto min-w-[130px] text-xs">
                <SelectValue placeholder="All clubs" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_FIXTURES_FILTER}>All clubs</SelectItem>
                {clubOptions.map((club) => (
                  <SelectItem key={club.id} value={club.id}>{club.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}

      {filteredMatches.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            No fixtures match the current filter.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {summary.totalRounds > 0 && (
            <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs">
              <span className="font-medium text-foreground">
                {summary.totalRounds} round{summary.totalRounds === 1 ? "" : "s"} scheduled
                <span className="text-muted-foreground font-normal ml-2 tabular-nums">
                  (max: {summary.maximumRound})
                </span>
              </span>
              {isAdmin && source !== "playhq" && renderSummaryAction?.(summary)}
            </div>
          )}
          {groups.map(renderRound)}
        </div>
      )}
    </>
  );
}
