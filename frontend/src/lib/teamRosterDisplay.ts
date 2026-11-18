/**
 * Team-roster labels are UI-only. Encrypted profile references are not names
 * and must not be shown, cached as readable names, or treated as authorization.
 * The owning PII canister must separately approve any future real-name reveal.
 */
export function visibleTeamMemberName(displayName: string | null | undefined, pending = false): string {
  const name = typeof displayName === 'string' ? displayName.trim() : '';
  if (!name || name.startsWith('pii-display-name:')) return pending ? 'Unlocking name…' : 'Name unavailable';
  return name;
}

/** Background revalidation is not an unlock when every rendered name exists. */
export function hasPendingAdultNameDisplay(
  displayNames: readonly (string | null | undefined)[],
  pending: boolean,
): boolean {
  return pending && displayNames.some(name => {
    const text = typeof name === 'string' ? name.trim() : '';
    return !text || text.startsWith('pii-display-name:') ||
      text === 'Name unavailable' || text === 'Unlocking name…';
  });
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

/** Only offer a fresh, exact-team adult-name read after the current read settles.
 * No unscoped profile cache, inferred membership or private reference qualifies.
 */
export function needsAdultNameRetry(
  ids: readonly string[],
  profiles: readonly { account_id: string; display_name: string | null }[],
  pending: boolean,
): boolean {
  if (!ids.length || pending) return false;
  const names = new Map(profiles.map(p => [p.account_id, p.display_name]));
  return ids.some(id => visibleTeamMemberName(names.get(id)) === 'Name unavailable');
}

/**
 * DEV test-club cutover only: use the signed-in member's existing, readable
 * self profile instead of making an unnecessary cross-canister ciphertext/key
 * request for that same member. Never infer an ID from display text or omit a
 * foreign adult. Keeping the legacy batch intact outside the explicit cutover
 * makes this a latency/cycles optimisation, never a new permission path.
 */
export function requestedClubAdultNameIds(
  ids: readonly string[],
  signedInAliases: readonly (string | null | undefined)[],
  selfName: string | null | undefined,
  enabled: boolean,
): string[] {
  const readable = typeof selfName === 'string' &&
    visibleTeamMemberName(selfName) !== 'Name unavailable' &&
    !/^(unknown user|private name|loading)$/i.test(selfName.trim());
  const aliases = new Set(signedInAliases.filter((value): value is string =>
    typeof value === 'string' && value.trim().length > 0,
  ));
  return [...new Set(ids.filter(id => !(enabled && readable && aliases.has(id))))].sort();
}
