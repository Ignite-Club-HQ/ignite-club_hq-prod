import { supabase } from "@/integrations/supabase/client";
import type { CompetitionFixtureRow, LinkedCompetitionTeam } from "./types";

const FIXTURE_SELECT =
  "*, home:home_team_id(id, name, logo_url), away:away_team_id(id, name, logo_url), competition_divisions:division_id(name)";

const LINKED_TEAM_SELECT =
  "id, name, playhq_team_id, club_id, clubs:club_id(id, name)";

export async function fetchCompetitionFixtures(
  competitionId: string,
): Promise<CompetitionFixtureRow[]> {
  const { data, error } = await supabase
    .from("competition_matches")
    .select(FIXTURE_SELECT)
    .eq("competition_id", competitionId)
    .order("round_number", { ascending: true, nullsFirst: false })
    .order("scheduled_at", { ascending: true, nullsFirst: false });

  if (error) throw error;
  return (data ?? []) as unknown as CompetitionFixtureRow[];
}

export async function fetchLinkedCompetitionTeams(
  externalTeamIds: string[],
): Promise<LinkedCompetitionTeam[]> {
  const { data, error } = await supabase
    .from("teams")
    .select(LINKED_TEAM_SELECT)
    .in("playhq_team_id", externalTeamIds);

  if (error) throw error;
  return (data ?? []) as unknown as LinkedCompetitionTeam[];
}
