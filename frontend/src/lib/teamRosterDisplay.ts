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
