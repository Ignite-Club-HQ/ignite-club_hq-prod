export interface CompetitionTeamSummary {
  id: string;
  name: string;
  logo_url?: string | null;
}

export interface CompetitionDivisionSummary {
  id: string;
  name?: string;
  day_start_time?: string | null;
  day_end_time?: string | null;
  play_weekdays?: number[] | null;
  hide_ladder?: boolean | null;
  [key: string]: unknown;
}

export interface CompetitionEntrySummary {
  team_id: string;
  division_id?: string | null;
  status: string;
  teams?: CompetitionTeamSummary | null;
  [key: string]: unknown;
}

export interface CompetitionFixtureRow {
  id: string;
  competition_id: string;
  division_id?: string | null;
  round_number?: number | null;
  scheduled_at?: string | null;
  duration_minutes?: number | null;
  pitch_number?: string | null;
  home_team_id?: string | null;
  away_team_id?: string | null;
  external_home_team_id?: string | null;
  external_away_team_id?: string | null;
  home_team_name?: string | null;
  away_team_name?: string | null;
  home_score?: number | null;
  away_score?: number | null;
  status?: string | null;
  source?: string | null;
  manually_overridden_at?: string | null;
  venue?: string | null;
  arrival_minutes_before?: number | null;
  notes?: string | null;
  home?: CompetitionTeamSummary | null;
  away?: CompetitionTeamSummary | null;
  competition_divisions?: { name?: string | null } | null;
  [key: string]: unknown;
}

export interface LinkedCompetitionTeam {
  id: string;
  name: string;
  playhq_team_id?: string | null;
  club_id?: string | null;
  clubs?: { id: string; name: string } | null;
}
