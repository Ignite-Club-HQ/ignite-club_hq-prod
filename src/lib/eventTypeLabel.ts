/**
 * Returns a human-friendly label for an event type.
 * game → "Game", training → "Training", mini_league → "Session", social → "Event"
 */
export function getEventTypeLabel(type?: string | null): string {
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
