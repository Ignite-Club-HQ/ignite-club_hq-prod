/**
 * Team-roster labels are UI-only. Encrypted profile references are not names
 * and must not be shown, cached as readable names, or treated as authorization.
 * The owning PII canister must separately approve any future real-name reveal.
 */
export function visibleTeamMemberName(displayName: string | null | undefined): string {
  const name = typeof displayName === 'string' ? displayName.trim() : '';
  if (!name || name.startsWith('pii-display-name:')) return 'Name unavailable';
  return name;
}

export function teamRosterHeaderStatus({
  members, children, loadingMembers, loadingChildren, memberError, childError,
}: {
  members: number;
  children: number;
  loadingMembers: boolean;
  loadingChildren: boolean;
  memberError: boolean;
  childError: boolean;
}): string {
  if (memberError || childError) return 'Members unavailable';
  const count = members + children;
  if (loadingMembers && loadingChildren) return 'Loading members and players…';
  if (loadingMembers) return children > 0
    ? `${children} player${children === 1 ? '' : 's'} · Loading members…`
    : 'Loading members…';
  if (loadingChildren) return members > 0
    ? `${members} member${members === 1 ? '' : 's'} · Loading players…`
    : 'Loading players…';
  return `${count} member${count === 1 ? '' : 's'}`;
}

/** ICP roster queries cannot share a cache entry between unrelated identities. */
export function scopedIcpTeamRosterKey(
  base: readonly unknown[], principal: string | undefined, clubId: string | undefined,
): readonly unknown[] {
  return [...base, 'icp', principal ?? '', clubId ?? ''];
}


/**
 * Present the exact per-child PII read state without rewriting the child's
 * source-of-truth name, leaking ciphertext or treating placeholder "Player" as
 * a decrypted identity. The real text must originate from an authorized read.
 */
export function visibleChildRosterName(
  unlocked: string | null | undefined,
  pending: boolean,
): string {
  const name = typeof unlocked === 'string' ? unlocked.trim() : '';
  if (name && !name.startsWith('pii-')) return name;
  return pending ? 'Unlocking name…' : 'Name unavailable';
}

export function needsChildNameRetry(
  ids: readonly string[],
  names: ReadonlyMap<string, string> | undefined,
  pending: boolean,
): boolean {
  return ids.length > 0 && !pending && ids.some(id => !names?.get(id)?.trim());
}

/**
 * Disposable DEV U10 fixture only. Test3's Identity profile points to its
 * original Group 1 encrypted name and that cross-group audience is unreleased.
 * Show the user's known TEST ACCOUNT LABEL (not decrypted private data) so the
 * U10 invite/roster can be tested without granting any new name permissions.
 * No other person, team, club, host or Supabase/PROD screen gets an alias.
 */
export function devU10ParentTestLabel(input: {
  hostname: string;
  teamId: string | undefined;
  clubId: string | undefined;
  memberId: string;
  existingName: string | null | undefined;
}): string | null {
  const { hostname, teamId, clubId, existingName } = input;
  if (![
    'proe7-kqaaa-aaaas-qg6gq-cai.icp.net',
    'proe7-kqaaa-aaaas-qg6gq-cai.ic0.app',
    'ignite-club-launchpad.lovable.app',
  ].includes(hostname)) return null;
  if (teamId !== 'a3e9341e-bc61-4e4d-9ebf-2f2c9f347128' ||
      clubId !== '177f8c01-3617-402a-aedd-5c5c17ccfde1') return null;
  const principal = input.memberId.replace(/^principal:/, '');
  if (principal !== 'mfmwy-tuspw-6ikuj-mfaqb-le2p3-ndi4w-a5caq-cwcit-xhnob-lidne-fae') return null;
  if (existingName?.trim() && !existingName.startsWith('pii-display-name:')) return null;
  return 'Test3';
}
