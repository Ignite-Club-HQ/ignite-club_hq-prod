/** Device copy of parent names already unlocked for a team, shown instantly
 * while the authorized read refreshes. ignite_ prefix: swept on sign-out and
 * account switch by clearUserScopedCaches. Expires after 7 days; any fresh
 * read replaces it, so removed members drop out on the next successful load. */
export type SavedRosterName = { account_id: string; display_name: string };
const PREFIX = 'ignite_roster_names_v1:';
export const SAVED_ROSTER_NAMES_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const slot = (user: string, club: string, team: string) => `${PREFIX}${user}:${club}:${team}`;

export function loadSavedRosterNames(user: string, club: string, team: string, now = Date.now()): SavedRosterName[] | undefined {
  try {
    const raw = localStorage.getItem(slot(user, club, team));
    if (!raw) return undefined;
    const { exp, rows } = JSON.parse(raw) as { exp: number; rows: SavedRosterName[] };
    if (typeof exp !== 'number' || exp < now || !Array.isArray(rows)) { localStorage.removeItem(slot(user, club, team)); return undefined; }
    return rows.filter(r => typeof r?.account_id === 'string' && typeof r?.display_name === 'string' && r.display_name.trim());
  } catch { return undefined; }
}

export function saveRosterNames(user: string, club: string, team: string, rows: ReadonlyArray<{ account_id: unknown; display_name: string | null; name_error?: string }>, now = Date.now()): void {
  try {
    const named = rows.filter(r => r.display_name?.trim() && !r.name_error)
      .map(r => ({ account_id: String(r.account_id), display_name: r.display_name as string }));
    localStorage.setItem(slot(user, club, team), JSON.stringify({ exp: now + SAVED_ROSTER_NAMES_TTL_MS, rows: named }));
  } catch { /* storage full — fresh reads still work */ }
}
