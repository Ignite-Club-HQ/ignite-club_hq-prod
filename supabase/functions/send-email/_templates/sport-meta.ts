// Shared helpers for sport-aware email templates.
// Used by team-invite, child-added, and the index.ts subject rewriter.

export type TeamType = 'junior' | 'senior' | 'mixed' | string | null | undefined;

export function sportEmoji(sport?: string | null): string {
  const s = (sport || '').toLowerCase().trim();
  switch (s) {
    case 'soccer':
    case 'football':
    case 'futsal':
      return '⚽';
    case 'cricket':
      return '🏏';
    case 'basketball':
      return '🏀';
    case 'netball':
      return '🏐';
    case 'afl':
    case 'australian football':
    case 'aussie rules':
    case 'aussie_rules':
    case 'rugby':
    case 'rugby league':
    case 'rugby union':
    case 'rugby_league':
    case 'rugby_union':
      return '🏉';
    case 'hockey':
    case 'field hockey':
    case 'field_hockey':
    case 'ice hockey':
      return '🏑';
    case 'baseball':
      return '⚾';
    case 'softball':
      return '🥎';
    case 'tennis':
      return '🎾';
    case 'volleyball':
      return '🏐';
    case 'lacrosse':
      return '🥍';
    case 'golf':
      return '⛳';
    case 'swimming':
      return '🏊';
    case 'athletics':
    case 'track':
      return '🏃';
    default:
      return '🏆';
  }
}

const SPORT_EMOJI_CLASS = /[\u26BD\u26BE\u{1F3CF}\u{1F3C0}\u{1F3D0}\u{1F3C9}\u{1F3D1}\u{1F94E}\u{1F3BE}\u{1F94D}\u26F3\u{1F3CA}\u{1F3C3}\u{1F3C6}]/u;

/** Replace a trailing sport-style emoji on a subject line with the club's sport emoji. */
export function swapTrailingSportEmoji(subject: string, sport?: string | null): string {
  if (!subject) return subject;
  const emoji = sportEmoji(sport);
  // strip any existing trailing sport emoji (+ surrounding whitespace), then append the right one
  const stripped = subject.replace(new RegExp(`\\s*${SPORT_EMOJI_CLASS.source}\\s*$`, 'u'), '').trimEnd();
  return `${stripped} ${emoji}`;
}

export function isJuniorTeam(teamType?: TeamType): boolean {
  const t = (teamType || '').toLowerCase();
  return t === 'junior' || t === 'juniors' || t === 'youth' || t === 'kids';
}

export function isSeniorTeam(teamType?: TeamType): boolean {
  const t = (teamType || '').toLowerCase();
  return t === 'senior' || t === 'seniors' || t === 'adult' || t === 'adults';
}

/**
 * Decide whether an invite should use parent-oriented copy
 * (talking about "their child") vs player-oriented copy
 * (talking directly to the recipient as a player).
 */
export function isParentAudience(opts: {
  roleName?: string | null;
  childrenNames?: string[] | null;
  teamType?: TeamType;
}): boolean {
  if ((opts.childrenNames?.length ?? 0) > 0) return true;
  const role = (opts.roleName || '').toLowerCase();
  if (role === 'parent' || role === 'guardian') return true;
  // Adult/senior teams default to player audience even if role is generic "Player"
  if (isSeniorTeam(opts.teamType)) return false;
  // Junior team with no explicit role-of-parent → still likely an adult/coach/player; default to parent if junior
  if (isJuniorTeam(opts.teamType) && role === '') return true;
  return false;
}
