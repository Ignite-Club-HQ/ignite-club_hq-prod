import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  buildFixtureClubOptions,
  buildFixtureTeamOptions,
  collectExternalTeamIds,
  filterCompetitionFixtures,
  groupFixturesByRound,
  mapClubsByExternalTeam,
  normalizeFixtureFilter,
  summarizeFixtureRounds,
} from "./fixtureListModel";
import { competitionFixtureKeys } from "./queryKeys";
import { fetchLinkedCompetitionTeams } from "./repository";
import type { CompetitionFixtureRow } from "./types";

const ALL_FIXTURE_FILTER = "_all";

export function useFixtureListController(
  competitionId: string,
  matches: CompetitionFixtureRow[],
) {
  const [divisionId, setDivisionId] = useState(ALL_FIXTURE_FILTER);
  const [teamId, setTeamId] = useState(ALL_FIXTURE_FILTER);
  const [clubId, setClubId] = useState(ALL_FIXTURE_FILTER);
  const [teamSheetOpen, setTeamSheetOpen] = useState(false);
  const externalTeamIds = useMemo(() => collectExternalTeamIds(matches), [matches]);
  const { data: linkedTeams = [] } = useQuery({
    queryKey: competitionFixtureKeys.linkedTeams(competitionId, externalTeamIds.length),
    enabled: externalTeamIds.length > 0,
    queryFn: () => fetchLinkedCompetitionTeams(externalTeamIds),
  });
  const clubsByExternalTeam = useMemo(
    () => mapClubsByExternalTeam(linkedTeams),
    [linkedTeams],
  );
  const teamOptions = useMemo(
    () => buildFixtureTeamOptions(matches, divisionId),
    [matches, divisionId],
  );
  const clubOptions = useMemo(
    () => buildFixtureClubOptions(matches, divisionId, clubsByExternalTeam),
    [matches, divisionId, clubsByExternalTeam],
  );
  const filteredMatches = useMemo(
    () => filterCompetitionFixtures(matches, { divisionId, teamId, clubId }, clubsByExternalTeam),
    [matches, divisionId, teamId, clubId, clubsByExternalTeam],
  );

  useEffect(() => {
    const normalized = normalizeFixtureFilter(teamId, teamOptions);
    if (normalized !== teamId) setTeamId(normalized);
  }, [teamId, teamOptions]);
  useEffect(() => {
    const normalized = normalizeFixtureFilter(clubId, clubOptions);
    if (normalized !== clubId) setClubId(normalized);
  }, [clubId, clubOptions]);

  const groups = useMemo(() => groupFixturesByRound(filteredMatches), [filteredMatches]);
  const summary = useMemo(() => summarizeFixtureRounds(filteredMatches), [filteredMatches]);

  return {
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
  };
}
