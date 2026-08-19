import { supabase } from "@/integrations/supabase/client";
import {
  addAcceptedEntryPlaceholders,
  collectLadderTeamIds,
  enrichLadderRows,
} from "./ladderModel";
import type {
  AcceptedCompetitionEntry,
  CompetitionLadderRow,
  CompetitionLadderTeam,
} from "./types";

export async function fetchCompetitionLadder(
  competitionId: string,
): Promise<CompetitionLadderRow[]> {
  const [ladderResult, entriesResult] = await Promise.all([
    supabase
      .from("competition_ladder")
      .select("*")
      .eq("competition_id", competitionId)
      .order("points", { ascending: false })
      .order("goal_diff", { ascending: false })
      .order("goals_for", { ascending: false }),
    supabase
      .from("competition_entries")
      .select("team_id, division_id, status, teams!inner(deleted_at)")
      .eq("competition_id", competitionId)
      .eq("status", "accepted")
      .is("teams.deleted_at", null),
  ]);
  if (ladderResult.error) throw ladderResult.error;
  if (entriesResult.error) throw entriesResult.error;

  const rows = addAcceptedEntryPlaceholders(
    competitionId,
    (ladderResult.data ?? []) as CompetitionLadderRow[],
    (entriesResult.data ?? []) as AcceptedCompetitionEntry[],
  );
  const teamIds = collectLadderTeamIds(rows);
  if (teamIds.length === 0) return rows;

  const { data: teams, error } = await supabase
    .from("teams")
    .select("id, name, logo_url")
    .in("id", teamIds);
  if (error) throw error;
  return enrichLadderRows(rows, (teams ?? []) as CompetitionLadderTeam[]);
}
