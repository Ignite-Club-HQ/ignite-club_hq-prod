/**
 * Cross-group child provenance. Child IDs are NOT a routing scope:
 * create_own_child starts with club_id=null and IDs can collide across
 * canisters. Never infer a child's owner from its selected team or name.
 */
export interface ChildProvenance {
  id: string;
  sourceClubCanisterId: string;
}
export interface ChildNameForCheck extends ChildProvenance {
  name: string;
  isPrimary: boolean;
}
export interface TeamProvenance {
  id: string;
  club_id: string;
  sourceClubCanisterId: string;
}

export function requireSourceClubCanisterId(target: { canisterIds: Record<string, string> }): string {
  const id = target.canisterIds.club_domain;
  if (!id) throw new Error("The signed-in club group has no club_domain canister; child changes are disabled.");
  return id;
}

/** Keep identities distinct even when two groups generate the same child ID. */
export function childSourceKey(row: ChildProvenance): string {
  if (!row.id || !row.sourceClubCanisterId) throw new Error("Child group provenance is missing");
  return `${row.sourceClubCanisterId}:${row.id}`;
}

export function collectVerifiedChildren<T extends ChildProvenance>(groups: readonly (readonly T[])[]): T[] {
  const result = groups.flat();
  if (result.length > 1000) throw new Error("Child inventory exceeds safe display limit");
  const seen = new Set<string>();
  for (const child of result) {
    const key = childSourceKey(child);
    // Duplicate source rows indicate an inconsistent routing/read inventory,
    // never quietly overwrite or pick a favorite.
    if (seen.has(key)) throw new Error("A child was returned twice from the same group; check routing before changing children");
    seen.add(key);
  }
  return result;
}

export function assertChildSourceMatchesTeam(child: ChildProvenance, team: TeamProvenance): void {
  if (!team.club_id || !team.id || !team.sourceClubCanisterId ||
      child.sourceClubCanisterId !== team.sourceClubCanisterId)
    throw new Error("This child and team are on different ICP canister groups. No child was moved or assigned.");
}

export function assertMayCreateChild(
  name: string,
  knownChildren: readonly ChildNameForCheck[] | undefined,
  namesResolved: boolean,
): void {
  if (!name.trim()) throw new Error("Enter a child's name");
  if (!knownChildren || !namesResolved) {
    throw new Error("Your existing children must be checked across all groups before a new child can be created.");
  }
  // Never assume an encrypted or unavailable name is a different child.
  if (knownChildren.some(c => !c.name.trim())) {
    throw new Error("An existing child's name could not be confirmed. Resolve it before creating another child.");
  }
  if (knownChildren.some(c => c.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase())) {
    throw new Error(`${name.trim()} already appears in your children. An existing child cannot be copied between groups automatically.`);
  }
}

/** Source must match AND the child must still be owned by the caller when writing.
 * This is a local safety guard; canister ACLs remain the source of authority. */
export async function runForVerifiedOwnedChild<Context, Result>(
  child: ChildProvenance,
  contexts: readonly Context[],
  sourceOf: (ctx: Context) => string,
  callerOwns: (ctx: Context, childId: string) => Promise<boolean>,
  action: (ctx: Context) => Promise<Result>,
): Promise<Result> {
  const matching = contexts.filter(ctx => sourceOf(ctx) === child.sourceClubCanisterId);
  if (matching.length !== 1) {
    throw new Error("Child's original canister group could not be uniquely verified. No change was made.");
  }
  const selected = matching[0];
  if (!(await callerOwns(selected, child.id))) {
    throw new Error("This child is no longer linked to this account in its original group. No change was made.");
  }
  return action(selected);
}
