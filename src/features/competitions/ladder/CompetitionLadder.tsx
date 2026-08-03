import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Trophy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { fetchCompetitionLadder } from "./repository";
import type { CompetitionLadderRow } from "./types";

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
