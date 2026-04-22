import type { DrillObject } from "./types";

export interface TeamPlayerLite {
  id: string;
  name: string;
}

/**
 * Map members (roles + profiles) into a simple list of team players (player role only).
 * Mirrors how PitchBoard derives `realPlayers` so the label set matches the squad.
 */
export function membersToTeamPlayers(
  members?: Array<{
    id: string;
    user_id: string;
    role: string;
    profiles: { display_name: string | null; avatar_url: string | null } | null;
  }> | null
): TeamPlayerLite[] {
  if (!members || members.length === 0) return [];
  return members
    .filter((m) => m.role === "player")
    .map((m) => ({
      id: m.id,
      name: m.profiles?.display_name?.trim() || "Player",
    }));
}

/**
 * Returns just the first name (or the original string if there's only one token).
 * Keeps the on-pitch label compact so it still fits inside the player chip.
 */
export function shortPlayerLabel(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "Player";
  const first = trimmed.split(/\s+/)[0];
  return first.length > 10 ? `${first.slice(0, 9)}…` : first;
}

/**
 * Replace the labels of `player` objects in the drill frame with real team player
 * names (in order). The mapping is deterministic: first player object → first team
 * player, second → second, etc. Players beyond the team size keep their drill label.
 *
 * Non-player objects (cones, balls, goals, defenders) are returned unchanged so
 * tactical roles like "D" or "S" are preserved.
 */
export function applyTeamPlayersToObjects<T extends DrillObject>(
  objects: T[],
  players: TeamPlayerLite[]
): T[] {
  if (!players.length) return objects;

  // Identify which player slots represent the *attacking* squad. The seeded
  // drills colour defenders red (#ef4444) and orange (#f97316 — coach/server),
  // so we only substitute names onto the sky-blue ("our team") players.
  const ourTeamPlayers = objects.filter(
    (o) => o.type === "player" && (!o.color || o.color === "#0ea5e9")
  );

  const substitutions = new Map<string, string>();
  ourTeamPlayers.forEach((obj, idx) => {
    const player = players[idx];
    if (player) substitutions.set(obj.id, shortPlayerLabel(player.name));
  });

  if (substitutions.size === 0) return objects;

  return objects.map((obj) => {
    const replacement = substitutions.get(obj.id);
    return replacement ? { ...obj, label: replacement } : obj;
  });
}
