import type { PlannerPlayer, PlannerSubstitutionEvent } from "./analysis";

export function isPlanPlayableFromPlayers<
  P extends Pick<PlannerPlayer, "id" | "position">,
  S extends Pick<
    PlannerSubstitutionEvent,
    "half" | "time" | "playerOut" | "playerIn" | "executed" | "skipped"
  >,
>(players: P[], plan: S[], halfDurationSeconds: number): boolean {
  const playerIds = new Set(players.map((player) => player.id));
  const onPitch = new Set(
    players.filter((player) => player.position !== null).map((player) => player.id),
  );
  const remainingPlan = plan
    .filter((substitution) => !substitution.executed && !substitution.skipped)
    .sort((a, b) =>
      (a.half === 1 ? a.time : halfDurationSeconds + a.time) -
      (b.half === 1 ? b.time : halfDurationSeconds + b.time));

  for (const substitution of remainingPlan) {
    if (!playerIds.has(substitution.playerOut.id) || !playerIds.has(substitution.playerIn.id)) {
      return false;
    }
    if (!onPitch.has(substitution.playerOut.id) || onPitch.has(substitution.playerIn.id)) {
      return false;
    }
    onPitch.delete(substitution.playerOut.id);
    onPitch.add(substitution.playerIn.id);
  }

  return true;
}
