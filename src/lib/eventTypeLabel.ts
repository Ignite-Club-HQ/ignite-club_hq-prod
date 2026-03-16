/**
 * Returns a human-friendly label for an event type.
 * game → "Game", training → "Training", mini_league → "Session", social → "Event"
 * If a miniLeagueId is present, prefer "Session" even when legacy records still store type as "game".
 */
export function getEventTypeLabel(
  type?: string | null,
  options?: { miniLeagueId?: string | null }
): string {
  if (options?.miniLeagueId) {
    return "Session";
  }

  switch (type) {
    case "game":
      return "Game";
    case "training":
      return "Training";
    case "mini_league":
      return "Session";
    default:
      return "Event";
  }
}
