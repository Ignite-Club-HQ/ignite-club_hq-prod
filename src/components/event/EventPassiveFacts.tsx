import { Clock, DollarSign, Users } from "lucide-react";

export function EventPassiveFacts({ eventType, opponent, arrivalTime, arrivalMinutes, price }: {
  eventType: string;
  opponent?: string | null;
  arrivalTime?: string | null;
  arrivalMinutes?: number | null;
  price?: number | null;
}) {
  const isGame = eventType === "game";
  const showArrival = isGame && arrivalMinutes != null && !!arrivalTime;
  const showPrice = eventType === "social" && price != null && price > 0;
  return <>
    {isGame && opponent && <div className="flex items-center gap-3">
      <Users className="h-5 w-5 text-primary" /><span>vs {opponent}</span>
    </div>}
    {showArrival && <div className="flex items-center gap-3">
      <Clock className="h-5 w-5 text-warning" />
      <span>Arrive by {arrivalTime}{" "}<span className="text-muted-foreground">({arrivalMinutes} min before kickoff)</span></span>
    </div>}
    {showPrice && <div className="flex items-center gap-3">
      <DollarSign className="h-5 w-5 text-primary" /><span>${Number(price).toFixed(2)} per person</span>
    </div>}
  </>;
}
