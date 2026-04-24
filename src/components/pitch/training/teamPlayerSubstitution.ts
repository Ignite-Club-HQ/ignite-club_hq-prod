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
  const canonical = sortPlayerObjectsForSubstitution(playerObjs);
  if (rosterSize >= playerObjs.length) {
    return canonical;
  }

  const buckets: [T[], T[], T[]] = [[], [], []];
  for (const obj of playerObjs) {
    buckets[getPlayerBucket(obj)].push(obj);
  }

  const visibleIds = new Set(
    buckets
      .flatMap((bucket) => [...bucket].sort(compareByVisualPriority))
      .slice(0, rosterSize)
      .map((obj) => obj.id)
  );

  return canonical.filter((obj) => visibleIds.has(obj.id));
}

/**
 * Replace the labels of `player` objects in the drill frame with real team player
 * names. With a full squad we preserve authored placeholder ordering; with a
 * partial squad we assign names to the currently visible/front spots first.
 *
 * Non-player objects are returned unchanged unless they are visually attached to
 * a dropped player chip in the current frame, in which case balls/cones are
 * removed too so the pitch does not show ghost equipment.
 */
export function applyTeamPlayersToObjects<T extends DrillObject>(
  objects: T[],
  players: TeamPlayerLite[]
): T[] {
  if (!players.length) return objects;

  const playerObjs = objects.filter((o) => o.type === "player");
  if (playerObjs.length === 0) return objects;

  const orderedPlayerObjs = getRenderablePlayerOrder(playerObjs, players.length);

  const substitutions = new Map<string, string>();
  orderedPlayerObjs.forEach((obj, idx) => {
    const player = players[idx];
    if (player) substitutions.set(obj.id, shortPlayerLabel(player.name));
  });

  if (substitutions.size === 0) {
    return objects.filter((o) => o.type !== "player");
  }

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
    if (obj.type !== "ball" && obj.type !== "cone") return false;
    const ox = (obj as { x?: number }).x;
    const oy = (obj as { y?: number }).y;
    if (typeof ox !== "number" || typeof oy !== "number") return false;
    return droppedPositions.some((p) => Math.hypot(p.x - ox, p.y - oy) < 3);
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

  const orderedPlayerObjs = getRenderablePlayerOrder(playerObjs, players.length);

  const dropped: Array<{ x: number; y: number }> = [];
  orderedPlayerObjs.forEach((obj, idx) => {
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
 * chips actually rendered after squad substitution.
 */
export function filterOrphanAnnotations(
  annotations: Annotation[],
  objects: DrillObject[],
  players: TeamPlayerLite[]
): Annotation[] {
  if (!players.length) return annotations;
  const dropped = getDroppedPlayerPositions(objects, players);
  if (dropped.length === 0) return annotations;

  const NEAR = 4;
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
 */
export function substitutePlayerNamesInNotes<T extends DrillObject>(
  notes: string,
  objects: T[],
  players: TeamPlayerLite[]
): string {
  if (!notes || !players.length) return notes;

  const playerObjs = objects.filter((o) => o.type === "player");
  const ordered = getRenderablePlayerOrder(playerObjs, players.length);
  if (ordered.length === 0) return notes;

  const playerName = (idx: number): string | undefined => {
    const p = players[idx];
    return p ? shortPlayerLabel(p.name) : undefined;
  };

  const tokenToName = new Map<string, string>();
  ordered.forEach((obj, idx) => {
    const name = playerName(idx);
    if (!name || !obj.label) return;

    const raw = obj.label.toUpperCase();
    tokenToName.set(raw, name);

    const match = raw.match(/^(A|D|S|GK)?(\d{1,2})$/);
    if (!match) return;

    const [, prefix, n] = match;
    if (prefix) tokenToName.set(`${prefix}${n}`, name);
    tokenToName.set(n, name);
  });

  if (tokenToName.size === 0) return notes;

  let out = notes.replace(/\b[Pp]layer\s+(\d{1,2})\b/g, (_m, n) => {
    return tokenToName.get(String(n).toUpperCase()) ?? `Player ${n}`;
  });

  out = out.replace(/\b([A-Za-z]{1,3}\d{1,2}|\d{1,2})\b/g, (match) => {
    const replacement = tokenToName.get(match.toUpperCase());
    return replacement ?? match;
  });

  return out;
}
