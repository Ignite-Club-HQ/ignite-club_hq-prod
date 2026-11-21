/**
 * Read-only, count-only triage of DEV G1/G2 name-audit blockers.
 * This is NOT a deletion plan. Do not infer orphan status from missing
 * Identity account aliases, legacy display names or stale role edges.
 *
 * Deliberately never returns principal, club, account or name identifiers.
 */
const txt = value => typeof value === 'string' ? value : value?.toText?.();
const clubId = role => role?.club?.[0] ?? (typeof role?.club === 'string' ? role.club : null);
const isActive = status => status === 'Active' || !!status && Object.hasOwn(status,'Active');
const display = account => {
  const p = Array.isArray(account?.profile) ? account.profile[0] : account?.profile;
  return p?.display_name;
};
export function triageDevNameBlockers(snapshot, expectedIssues) {
  if (!snapshot || !Array.isArray(snapshot.g1) || !Array.isArray(snapshot.g2) ||
      !Array.isArray(snapshot.accounts) || !expectedIssues)
    throw Error('Complete, governor-authorised DEV snapshot and audit blockers required');
  const sources = [['g1', snapshot.g1], ['g2', snapshot.g2]];
  const clubs = new Map(), family = new Set(), excluded = new Set(), aliases = new Map();
  for (const row of snapshot.accounts) {
    if (!row || !Array.isArray(row.principals)) throw Error('Invalid account snapshot');
    for (const p of row.principals) {
      const key = txt(p);
      if (!key || aliases.has(key)) throw Error('Duplicate or empty account alias');
      aliases.set(key,row);
    }
  }
  for (const [group,edges] of sources) for (const e of edges) {
    if (e.Club) {
      if (clubs.has(e.Club.id)) throw Error('Ambiguous DEV club owner');
      clubs.set(e.Club.id,{group,deleted:e.Club.deleted});
    }
    if (e.Parent || e.Guardian) {
      const key = txt((e.Parent || e.Guardian).subject);
      if (key) family.add(key);
    }
    if (e.Excluded) excluded.add(JSON.stringify([e.Excluded.club,txt(e.Excluded.subject)]));
  }
  const count = {
    missingAccount: {familyLinked:0, noFamilyLinkObserved:0},
    legacyName: {activeAccountRequiresOwnerReview:0},
    ambiguousMembership: {deletedClub:0, differentGroup:0, unknownClub:0},
  };
  for (const [group,edges] of sources) for (const e of edges) {
    if (!e.Role) continue;
    const club = clubId(e.Role), subject = txt(e.Role.subject);
    if (!club) continue; // Global app-admin role, not a club membership
    if (!subject) throw Error('Invalid role subject');
    const owner = clubs.get(club);
    if (!owner) {count.ambiguousMembership.unknownClub++;continue}
    if (owner.deleted) {count.ambiguousMembership.deletedClub++;continue}
    if (owner.group!==group) {count.ambiguousMembership.differentGroup++;continue}
    if (excluded.has(JSON.stringify([club,subject]))) continue;
    const account = aliases.get(subject);
    if (!account) {
      if (family.has(subject)) count.missingAccount.familyLinked++;
      else count.missingAccount.noFamilyLinkObserved++;
      continue;
    }
    if (!isActive(account.status)) continue;
    const name = display(account);
    if (typeof name === 'string' && name.length > 0 && name.length <= 256 &&
        !name.startsWith('pii-display-name:'))
      count.legacyName.activeAccountRequiresOwnerReview++;
  }
  const observed = {
    missing_account: count.missingAccount.familyLinked + count.missingAccount.noFamilyLinkObserved,
    legacy_plaintext: count.legacyName.activeAccountRequiresOwnerReview,
    ambiguous_membership: count.ambiguousMembership.deletedClub +
      count.ambiguousMembership.differentGroup + count.ambiguousMembership.unknownClub,
  };
  for (const [issue, n] of Object.entries(observed))
    if (expectedIssues[issue] !== n)
      throw Error('Triage no longer agrees with canonical audit: '+issue);
  return {
    ...count,
    observedIssues: observed,
    automaticDeletionCandidates:0,
    // Without verified account ownership, child/guardian links, other roles,
    // linked clubs and a fresh revision-pinned write, NO row is deletion-safe.
    authorisedDeletion:false,
    requiresSeparateExactRecordReview:true,
    identityAndClubIdentifiersExported:false,
    prodOrSupabaseTouched:false,
  };
}
