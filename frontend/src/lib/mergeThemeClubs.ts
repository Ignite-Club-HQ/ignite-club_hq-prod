/**
 * Combines club-theme picker rows read from every group. The same club can be
 * returned by more than one group (shared + its own group), so keep one row
 * per club id, then one per name, preferring the row with the most unlocked
 * theme state.
 */
export type ThemeClubRow = { clubId: string; clubName: string; isSelectable: boolean; hasPro: boolean; hasTheme: boolean; themeEnabled: boolean };
const rank = (c: ThemeClubRow) => (c.isSelectable ? 8 : 0) + (c.hasPro ? 4 : 0) + (c.hasTheme ? 2 : 0) + (c.themeEnabled ? 1 : 0);
export function mergeThemeClubs<T extends ThemeClubRow>(parts: T[][]): T[] {
  const best = new Map<string, T>();
  for (const club of parts.flat()) {
    const key = club.clubName.toLowerCase().replace(/\s+/g, " ").trim() || club.clubId;
    const byId = [...best.entries()].find(([, c]) => c.clubId === club.clubId);
    const slot = byId ? byId[0] : key;
    const existing = best.get(slot);
    if (!existing || rank(club) > rank(existing)) best.set(slot, club);
  }
  return [...best.values()];
}
