import { MatchScoreCard } from "./MatchScoreCard";
import type { MatchScoreSectionModel } from "@/features/events/matchScoreSectionPolicy";

export function EventMatchScoreSection({ model, eventId, teamId, teamName, sport }: {
  model: MatchScoreSectionModel;
  eventId: string;
  teamId?: string | null;
  teamName?: string | null;
  sport?: string | null;
}) {
  if (!model.visible || !teamId) return null;
  return <MatchScoreCard
    eventId={eventId}
    teamId={teamId}
    teamName={teamName || "Our Team"}
    opponent={model.opponent}
    sport={sport}
    canEdit={model.canEdit}
  />;
}
