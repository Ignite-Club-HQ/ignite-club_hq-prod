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
 * Only in pinned DEV ICP: omit the signed-in adult from a *remote team-name*
 * batch when their own already-authorised, readable profile name is available
 * for the existing self-name renderer. The canister still verifies the viewer
 * is on the exact team before unlocking ANY other adult's name.
 *
 * No global cache, guessed display name, encrypted reference or placeholder
 * can qualify. PROD and Supabase keep the full existing batch.
 */
export function requestedTeamAdultNameIds(
  ids: readonly string[],
  ownAliases: readonly (string | null | undefined)[],
  ownDisplayName: string | null | undefined,
  devIcp: boolean,
): string[] {
  const name = typeof ownDisplayName === 'string' ? ownDisplayName.trim() : '';
  const ownNameReadable = name !== '' && !name.startsWith('pii-')
    && !/^(unknown user|name unavailable)$/i.test(name);
  const aliases = new Set(ownAliases.filter((id): id is string => typeof id === 'string' && id.length > 0));
  return [...new Set(ids.filter(id =>
    !(devIcp && ownNameReadable && aliases.has(id)),
  ))].sort();
}
