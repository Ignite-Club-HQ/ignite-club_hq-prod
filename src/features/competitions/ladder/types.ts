export interface CompetitionLadderTeam {
  id: string;
  name: string;
  logo_url?: string | null;
}

export interface CompetitionLadderRow {
  competition_id: string;
  team_id: string | null;
  division_id: string | null;
  played?: number | null;
  wins?: number | null;
  draws?: number | null;
  losses?: number | null;
  goals_for?: number | null;
  goals_against?: number | null;
  goal_diff?: number | null;
  points?: number | null;
  teams?: CompetitionLadderTeam | null;
  [key: string]: unknown;
}

export interface AcceptedCompetitionEntry {
  team_id: string | null;
  division_id: string | null;
  status: string;
  teams?: { deleted_at: string | null } | null;
}

export interface LadderFilterOption {
  id: string;
  name: string;
}

export interface LadderGroup {
  divisionId: string;
  rows: CompetitionLadderRow[];
}
