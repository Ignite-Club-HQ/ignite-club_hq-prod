import type { Annotation, ArrowGeometry, DrillObject, TextGeometry } from "./types";

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
 * Sort player objects in the canonical squad-substitution order so the same
 * index → squad slot mapping is shared by every helper in this module.
 *   1. attackers (sky-blue / unset colour)
 *   2. defenders (red)
 *   3. everything else (servers / GKs / coaches)
 */
function sortPlayerObjectsForSubstitution<T extends DrillObject>(playerObjs: T[]): T[] {
  return [...playerObjs].sort((a, b) => {
    const score = (o: DrillObject) => {
      if (!o.color || o.color === "#0ea5e9") return 0;
      if (o.color === "#ef4444") return 1;
      return 2;
    };
    return score(a) - score(b);
  });
}

function getPlayerBucket(o: DrillObject): 0 | 1 | 2 {
  if (!o.color || o.color === "#0ea5e9") return 0;
  if (o.color === "#ef4444") return 1;
  return 2;
}

function compareByVisualPriority(a: DrillObject, b: DrillObject): number {
  const ay = typeof a.y === "number" ? a.y : 1000;
  const by = typeof b.y === "number" ? b.y : 1000;
  if (ay !== by) return ay - by;

  const ax = typeof a.x === "number" ? a.x : 1000;
  const bx = typeof b.x === "number" ? b.x : 1000;
  if (ax !== bx) return ax - bx;

  return String(a.id).localeCompare(String(b.id));
}

/**
 * When the real squad is smaller than the authored drill roster, coaches expect
 * the visible chips to stay in the active / front-of-line spots for each frame
 * rather than being tied forever to placeholder IDs like S1, S2, S3.
 *
 * So:
 * - full roster available  → preserve authored placeholder ordering
 * - partial roster only    → fill each role bucket by visual priority
 *                           (front/active spots first, queues behind)
 */
function getRenderablePlayerOrder<T extends DrillObject>(
  playerObjs: T[],
  rosterSize: number
): T[] {
  if (rosterSize >= playerObjs.length) {
    return sortPlayerObjectsForSubstitution(playerObjs);
  }

  const buckets: [T[], T[], T[]] = [[], [], []];
  for (const obj of playerObjs) {
    buckets[getPlayerBucket(obj)].push(obj);
  }

  return buckets.flatMap((bucket) => [...bucket].sort(compareByVisualPriority));
}

/**
 * Replace the labels of `player` objects in the drill frame with real team player
 * names (in order). The mapping is deterministic: first player object → first team
 * player, second → second, etc. Players beyond the team size keep their drill label.
 *
 * Non-player objects (cones, balls, goals, defenders) are returned unchanged so
 * tactical roles like "D" or "S" are preserved.
 *
 * Pass `orphanEquipmentIds` (computed via `getOrphanEquipmentIds` from the full
 * frame list) so balls/cones owned by dropped chips stay hidden throughout the
 * animation, not only when the chip is co-located in the current keyframe.
 */
export function applyTeamPlayersToObjects<T extends DrillObject>(
  objects: T[],
  players: TeamPlayerLite[],
  orphanEquipmentIds?: Set<string>
): T[] {
  if (!players.length) return objects;

  // Substitute real names onto EVERY player chip (attackers + defenders + GKs).
  // Coaches want to see who's doing what, regardless of which side they're on.
  // Non-player objects (cones, balls, goals) are untouched so equipment labels
  // like "ball" or "cone" stay intact.
  // Order: attackers first (sky-blue / unset), then defenders (red), then any
  // remaining roles. This keeps the highest-availability players on the side
  // the drill is teaching.
  const playerObjs = objects.filter((o) => o.type === "player");
  if (playerObjs.length === 0) return objects;

  const sortedPlayerObjs = sortPlayerObjectsForSubstitution(playerObjs);

  const substitutions = new Map<string, string>();
  sortedPlayerObjs.forEach((obj, idx) => {
    const player = players[idx];
    if (player) substitutions.set(obj.id, shortPlayerLabel(player.name));
  });

  if (substitutions.size === 0) {
    // No real players matched — strip every player chip so the pitch never
    // shows fake numeric placeholders. Equipment (cones, balls, goals) stays
    // unless caller supplied a stable orphan list.
    return objects.filter(
      (o) => o.type !== "player" && !(orphanEquipmentIds?.has(o.id) ?? false)
    );
  }

  // Drop any player chip that didn't get a real squad name. This keeps the
  // pitch limited to actual attendees instead of padding with "Player 4",
  // "Player 5" etc. that confuse coaches and parents.
  // Track the on-pitch positions of dropped players so we can also drop any
  // ball/cone that was visually attached to them — otherwise the pitch shows
  // a "ghost" ball rolling on its own with no owner chip nearby.
  // When a stable `orphanEquipmentIds` set is supplied (computed from the
  // entire drill via `getOrphanEquipmentIds`), it takes precedence so that
  // orphan balls/cones stay hidden DURING animation too — not just when the
  // dropped chip happens to be co-located in the current keyframe.
  const droppedPositions: Array<{ x: number; y: number }> = [];
  for (const obj of playerObjs) {
    if (substitutions.has(obj.id)) continue;
    const px = (obj as { x?: number }).x;
    const py = (obj as { y?: number }).y;
    if (typeof px === "number" && typeof py === "number") {
      droppedPositions.push({ x: px, y: py });
    }
  }
  const isOrphanEquipment = (obj: DrillObject): boolean => {
    if (orphanEquipmentIds?.has(obj.id)) return true;
    // Fallback (no precomputed set): drop balls/cones that sit on top of a
    // dropped player chip in the CURRENT frame.
    if (obj.type !== "ball" && obj.type !== "cone") return false;
    const ox = (obj as { x?: number }).x;
    const oy = (obj as { y?: number }).y;
    if (typeof ox !== "number" || typeof oy !== "number") return false;
    return droppedPositions.some(
      (p) => Math.hypot(p.x - ox, p.y - oy) < 3
    );
  };

  return objects.flatMap((obj) => {
    if (obj.type === "player") {
      const replacement = substitutions.get(obj.id);
      if (!replacement) return [];
      return [{ ...obj, label: replacement }];
    }
    if (isOrphanEquipment(obj)) return [];
    return [obj];
  });
}

/**
 * Compute on-pitch positions of player chips that WILL be dropped by
 * `applyTeamPlayersToObjects` for the current squad. Used by callers to also
 * strip annotations (arrows, labels) anchored on those ghost spots.
 */
function getDroppedPlayerPositions(
  objects: DrillObject[],
  players: TeamPlayerLite[]
): Array<{ x: number; y: number }> {
  if (!players.length) return [];
  const playerObjs = objects.filter((o) => o.type === "player");
  if (playerObjs.length === 0) return [];

  const sortedPlayerObjs = [...playerObjs].sort((a, b) => {
    const score = (o: DrillObject) => {
      if (!o.color || o.color === "#0ea5e9") return 0;
      if (o.color === "#ef4444") return 1;
      return 2;
    };
    return score(a) - score(b);
  });

  const dropped: Array<{ x: number; y: number }> = [];
  sortedPlayerObjs.forEach((obj, idx) => {
    if (players[idx]) return;
    const px = (obj as { x?: number }).x;
    const py = (obj as { y?: number }).y;
    if (typeof px === "number" && typeof py === "number") {
      dropped.push({ x: px, y: py });
    }
  });
  return dropped;
}

/**
 * Filter out arrows that start or end at a dropped player chip, and text
 * labels anchored on top of one. Keeps the pitch consistent with whichever
 * chips actually rendered after squad substitution — no more "S2 plays the
 * pass" arrow when S2 was dropped because the squad was too small.
 */
export function filterOrphanAnnotations(
  annotations: Annotation[],
  objects: DrillObject[],
  players: TeamPlayerLite[]
): Annotation[] {
  if (!players.length) return annotations;
  const dropped = getDroppedPlayerPositions(objects, players);
  if (dropped.length === 0) return annotations;

  const NEAR = 4; // pitch-% radius for "anchored on" a dropped chip
  const nearDropped = (x: number, y: number) =>
    dropped.some((p) => Math.hypot(p.x - x, p.y - y) < NEAR);

  return annotations.filter((a) => {
    if (a.type === "arrow-solid" || a.type === "arrow-dashed") {
      const g = a.geometry as ArrowGeometry;
      return !nearDropped(g.from.x, g.from.y) && !nearDropped(g.to.x, g.to.y);
    }
    if (a.type === "text") {
      const g = a.geometry as TextGeometry;
      return !nearDropped(g.x, g.y);
    }
    return true;
  });
}

/**
 * Replace generic player placeholders inside drill notes (e.g. "A1", "D2", "GK1",
 * "S1") with real squad names so the on-pitch chip and the coaching note line up.
 *
 * Token convention used in `drill_frames.notes`:
 *   - `A<n>` attackers (sky-blue chips, default colour)
 *   - `D<n>` defenders (red chips, #ef4444)
 *   - `GK<n>` / `S<n>` keepers / servers (any other player chip)
 *   - case-insensitive, whole-word matched so "A1" inside "MA1N" is left alone
 *
 * The mapping mirrors `applyTeamPlayersToObjects`: attackers consume the first
 * squad slots, defenders the next, then everything else. Tokens with no matching
 * squad slot are left untouched.
 */
export function substitutePlayerNamesInNotes<T extends DrillObject>(
  notes: string,
  objects: T[],
  players: TeamPlayerLite[]
): string {
  if (!notes || !players.length) return notes;

  const attackers = objects.filter(
    (o) => o.type === "player" && (!o.color || o.color === "#0ea5e9")
  );
  const defenders = objects.filter(
    (o) => o.type === "player" && o.color === "#ef4444"
  );
  const others = objects.filter(
    (o) => o.type === "player" && o.color && o.color !== "#0ea5e9" && o.color !== "#ef4444"
  );

  // Build label-to-name maps. Drill labels for attackers usually omit the "A"
  // prefix ("1", "2"...), so we key both by the bare numeric label AND the
  // prefixed token coaches actually type in notes ("A1", "D2"...).
  const playerName = (idx: number): string | undefined => {
    const p = players[idx];
    return p ? shortPlayerLabel(p.name) : undefined;
  };

  const tokenToName = new Map<string, string>();
  let cursor = 0;
  attackers.forEach((obj, i) => {
    const name = playerName(cursor++);
    if (!name) return;
    tokenToName.set(`A${i + 1}`, name);
    // Also support bare numeric tokens that match the chip label.
    if (obj.label) tokenToName.set(obj.label.toUpperCase(), name);
  });
  defenders.forEach((_, i) => {
    const name = playerName(cursor++);
    if (name) tokenToName.set(`D${i + 1}`, name);
  });
  others.forEach((obj, i) => {
    const name = playerName(cursor++);
    if (!name) return;
    tokenToName.set(`GK${i + 1}`, name);
    tokenToName.set(`S${i + 1}`, name);
    if (obj.label) tokenToName.set(obj.label.toUpperCase(), name);
  });

  if (tokenToName.size === 0) return notes;

  // First pass: spaced "Player N" / "player N" → real name. Drills authored as
  // a generic loop ("Player 2 pushes forward...") read much better when those
  // numbers become the actual squad member's name.
  let out = notes.replace(/\b[Pp]layer\s+(\d{1,2})\b/g, (_m, n) => {
    return tokenToName.get(String(n).toUpperCase()) ?? `Player ${n}`;
  });

  // Second pass: compact tokens (A1, D2, GK1, S1, or bare "1") still in the
  // string get swapped for real names too.
  out = out.replace(/\b([A-Za-z]{1,3}\d{1,2}|\d{1,2})\b/g, (match) => {
    const replacement = tokenToName.get(match.toUpperCase());
    return replacement ?? match;
  });

  return out;
}
