import { Trophy, Dumbbell, PartyPopper, CalendarDays, type LucideIcon } from "lucide-react";

/**
 * Returns a Lucide icon component for an event type. Used as a small visual
 * cue next to the event title so we can drop the redundant "Training"/"Match"
 * pills from the top of cards.
 */
export function getEventTypeIcon(
  type?: string | null,
  options?: { miniLeagueId?: string | null }
): LucideIcon {
  if (options?.miniLeagueId) return Trophy;
  switch (type) {
    case "game":
    case "mini_league":
      return Trophy;
    case "training":
      return Dumbbell;
    case "social":
      return PartyPopper;
    default:
      return CalendarDays;
  }
}
