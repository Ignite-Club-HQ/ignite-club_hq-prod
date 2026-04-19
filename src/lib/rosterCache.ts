// Lightweight roster cache (team & club member lists).
// Excludes avatar binaries — we cache only display_name, avatar_url path, and roles
// so storage stays well under the ~10MB budget.

const TEAM_ROSTER_PREFIX = "ignite_team_roster_";
const CLUB_ROSTER_PREFIX = "ignite_club_roster_";
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

export interface CachedRosterMember {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  role?: string | null;
  [key: string]: unknown;
}

interface Entry {
  members: CachedRosterMember[];
  timestamp: number;
}

function get(key: string): CachedRosterMember[] | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry: Entry = JSON.parse(raw);
    if (Date.now() - entry.timestamp > EXPIRY_MS) {
      try { localStorage.removeItem(key); } catch {}
      return null;
    }
    return entry.members;
  } catch {
    return null;
  }
}

function set(key: string, members: CachedRosterMember[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    const entry: Entry = { members: members.slice(0, 200), timestamp: Date.now() };
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // ignore quota
  }
}

export const getCachedTeamRoster = (teamId: string) => get(TEAM_ROSTER_PREFIX + teamId);
export const cacheTeamRoster = (teamId: string, members: CachedRosterMember[]) =>
  set(TEAM_ROSTER_PREFIX + teamId, members);

export const getCachedClubRoster = (clubId: string) => get(CLUB_ROSTER_PREFIX + clubId);
export const cacheClubRoster = (clubId: string, members: CachedRosterMember[]) =>
  set(CLUB_ROSTER_PREFIX + clubId, members);
