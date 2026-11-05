/**
 * Device-local favourite opponents for Internet Identity sessions (no ICP table yet).
 * `ignite_` prefix so clearUserScopedCaches sweeps it; keyed per principal.
 */
export interface LocalFavoriteOpponent {
  id: string;
  opponent_name: string;
  club_id: string | null;
  team_id: string | null;
}

const key = (userId: string) => `ignite_favorite_opponents:${userId}`;

function read(userId: string): LocalFavoriteOpponent[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key(userId)) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(userId: string, rows: LocalFavoriteOpponent[]) {
  localStorage.setItem(key(userId), JSON.stringify(rows.slice(0, 200)));
}

export function listLocalFavorites(userId: string, clubId?: string, teamId?: string): LocalFavoriteOpponent[] {
  const seen = new Set<string>();
  return read(userId)
    .filter((f) => (teamId ? !f.team_id || f.team_id === teamId : clubId ? !f.club_id || f.club_id === clubId : true))
    .sort((a, b) => a.opponent_name.localeCompare(b.opponent_name))
    .filter((f) => {
      const k = f.opponent_name.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

export function addLocalFavorite(userId: string, name: string, clubId?: string, teamId?: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const rows = read(userId);
  if (rows.some((r) => r.opponent_name.toLowerCase() === trimmed.toLowerCase())) return;
  rows.push({ id: crypto.randomUUID(), opponent_name: trimmed, club_id: clubId || null, team_id: teamId || null });
  write(userId, rows);
}

export function removeLocalFavorite(userId: string, id: string) {
  write(userId, read(userId).filter((r) => r.id !== id));
}
