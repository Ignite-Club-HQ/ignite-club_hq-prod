export type ClubWideEventType = "game" | "social" | "training";

export type EventTeamTargetingInput = {
  eventType: string;
  teamId?: string | null;
  targetTeamIds: readonly string[] | null;
  rsvpGrouping?: "" | "level" | "team" | null;
};

export type EventTeamTargetingResult =
  | {
      valid: true;
      scope: "single_team" | "all_club" | "multiple_teams";
      targetTeamIds: string[] | null;
      rsvpGrouping: "level" | "team" | null;
    }
  | {
      valid: false;
      reason: "too_few_distinct_teams";
    };

export function supportsClubWideEventScope(eventType: string): eventType is ClubWideEventType {
  return eventType === "game" || eventType === "social" || eventType === "training";
}

export function shouldClearEventTeamTargets(eventType: string, teamId?: string | null): boolean {
  return Boolean(teamId) || !supportsClubWideEventScope(eventType);
}

/**
 * Converts the create/edit form state into the database contract.
 * `null` means all club members; a non-null target list must contain at least
 * two distinct teams. Single-team events use events.team_id instead.
 */
export function resolveEventTeamTargeting(
  input: EventTeamTargetingInput,
): EventTeamTargetingResult {
  const teamId = input.teamId?.trim() || null;
  if (teamId) {
    return { valid: true, scope: "single_team", targetTeamIds: null, rsvpGrouping: null };
  }

  if (!supportsClubWideEventScope(input.eventType)) {
    return { valid: true, scope: "all_club", targetTeamIds: null, rsvpGrouping: null };
  }

  const grouping = input.rsvpGrouping === "level" || input.rsvpGrouping === "team"
    ? input.rsvpGrouping
    : null;

  if (input.targetTeamIds === null) {
    return { valid: true, scope: "all_club", targetTeamIds: null, rsvpGrouping: grouping };
  }

  const distinctTargets = [
    ...new Set(input.targetTeamIds.map((id) => id.trim()).filter(Boolean)),
  ];
  if (distinctTargets.length < 2) {
    return { valid: false, reason: "too_few_distinct_teams" };
  }

  return {
    valid: true,
    scope: "multiple_teams",
    targetTeamIds: distinctTargets,
    rsvpGrouping: grouping,
  };
}
