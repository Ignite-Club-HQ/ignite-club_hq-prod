import type { PitchPosition } from "@/components/pitch/PositionBadge";

export const TEST_PLAYER_POSITIONS: PitchPosition[] = ["GK", "DEF", "MID", "FWD"] as PitchPosition[];

export interface TestPlayerRow {
  id: string;
  club_id: string;
  team_id: string;
  name: string;
  shirt_number: number | null;
  positions: string[];
  age_group: string | null;
}

export interface TestPlayerPitchMember {
  id: string;
  user_id: string;
  role: string;
  profiles: { display_name: string | null; avatar_url: string | null };
  is_test_player: true;
  jersey_number: number | null;
  preferred_positions: PitchPosition[];
}

export const isTestPlayerId = (id: string | null | undefined) => !!id && id.startsWith("tp-");

/** Maps canister test players into Pitch Board roster members. */
export function testPlayersToPitchMembers(rows: TestPlayerRow[]): TestPlayerPitchMember[] {
  const seen = new Set<string>();
  return rows
    .filter((row) => isTestPlayerId(row.id) && !seen.has(row.id) && (seen.add(row.id), true))
    .map((row) => ({
      id: `test-${row.id}`,
      user_id: row.id,
      role: "player",
      profiles: { display_name: row.name, avatar_url: null },
      is_test_player: true,
      jersey_number: row.shirt_number ?? null,
      preferred_positions: row.positions.filter((p): p is PitchPosition =>
        (TEST_PLAYER_POSITIONS as string[]).includes(p)),
    }));
}

/** Normalises a raw Candid test-player record (opt fields arrive as [] | [v] or null). */
export function normaliseTestPlayer(raw: any): TestPlayerRow {
  const opt = (v: any) => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  const shirt = opt(raw.shirt_number);
  return {
    id: String(raw.id),
    club_id: String(raw.club_id),
    team_id: String(raw.team_id),
    name: String(raw.name),
    shirt_number: shirt == null ? null : Number(shirt),
    positions: Array.from(raw.positions ?? [], String),
    age_group: opt(raw.age_group),
  };
}
