/**
 * DEV-only, READ-ONLY preflight for the exact Ted -> ChatGPT Plugin Test U10
 * reconciliation. This file intentionally exports NO transfer/create/delete/
 * assignment operation. The original G1 child identity cannot be imported
 * into G2 by the current canister API.
 *
 * The pin is not an authorization credential; real authority is the user's
 * Internet Identity and the canister ACLs, checked again on every read.
 */
import { withFeatureBackend } from "@/live/featureRouter";
import { requireSourceClubCanisterId } from "./icpChildrenGroupSafety";
import { listMyLiveOwnChildren, listLiveChildGuardians, getLiveTeam, isMyLiveClubMember } from "@/live/features/club";
import { resolveLivePiiTextBatch } from "@/live/features/vault";

export const DEV_TED_U10 = Object.freeze({
  sourceCanister: "mzzzv-taaaa-aaaal-qxlrq-cai",
  destinationCanister: "yfwyv-nyaaa-aaaal-qxpyq-cai",
  sourceChildId: "child-own-3-12562284057",
  parentPrincipal: "edt5h-vbtif-a523i-cfe6i-ieemk-2ljzi-frngv-3vjyy-mxf3o-safv3-fae",
  targetClubId: "177f8c01-3617-402a-aedd-5c5c17ccfde1",
  targetTeamId: "a3e9341e-bc61-4e4d-9ebf-2f2c9f347128",
  expectedName: "Ted",
  expectedTeamName: "ChatGPT Plugin Test U10",
});
const DEV_HOSTS = new Set([
  "proe7-kqaaa-aaaas-qg6gq-cai.icp.net",
  "proe7-kqaaa-aaaas-qg6gq-cai.ic0.app",
  "ignite-club-launchpad.lovable.app",
]);

export interface DevTedSourceReadback {
  group: string;
  id: string;
  name: string | null;
  owner: string | null;
  teams: string[];
  guardians: string[];
}
export interface DevTedDestinationReadback {
  group: string;
  caller: string;
  club: string;
  team: string | null;
  teamName: string | null;
  member: boolean;
  existingChildIds: string[];
}
export interface DevTedPreflight {
  readonly sourceChildId: string;
  readonly sourceCanister: string;
  readonly targetCanister: string;
  readonly targetClubId: string;
  readonly targetTeamId: string;
  readonly name: "Ted";
  readonly parentPrincipal: string;
  readonly destinationEmpty: true;
  readonly writeAuthorised: false;
}

export function validateDevTedPreflight(
  hostname: string,
  source: readonly DevTedSourceReadback[],
  destination: DevTedDestinationReadback,
): DevTedPreflight {
  const pin = DEV_TED_U10;
  if (!DEV_HOSTS.has(hostname.toLowerCase())) throw new Error("This read-only review is restricted to Ignite DEV.");
  if (source.length !== 1) throw new Error("Ted's original Group 1 record could not be uniquely verified.");
  const child = source[0];
  if (child.group !== pin.sourceCanister || child.id !== pin.sourceChildId ||
      child.owner !== pin.parentPrincipal || child.name?.trim() !== pin.expectedName) {
    throw new Error("The encrypted name, primary Parent, or pinned source record did not match. No transfer is possible.");
  }
  if (child.teams.length !== 0) throw new Error("Ted is assigned to a source team. A cross-group reconciliation cannot proceed.");
  if (child.guardians.length !== 1 || child.guardians[0] !== pin.parentPrincipal) {
    throw new Error("Ted has an unexpected guardian relationship; preserve existing family permissions.");
  }
  if (destination.group !== pin.destinationCanister || destination.caller !== pin.parentPrincipal ||
      destination.club !== pin.targetClubId || destination.team !== pin.targetTeamId ||
      destination.teamName !== pin.expectedTeamName || !destination.member) {
    throw new Error("Group 2 club, team, or Parent membership could not be verified.");
  }
  if (destination.existingChildIds.length !== 0) {
    throw new Error("The destination already has children for this Parent. Reconcile them before any migration.");
  }
  return {
    sourceChildId: pin.sourceChildId, sourceCanister: pin.sourceCanister,
    targetCanister: pin.destinationCanister,
    targetClubId: pin.targetClubId, targetTeamId: pin.targetTeamId,
    name: "Ted", parentPrincipal: pin.parentPrincipal,
    destinationEmpty: true, writeAuthorised: false,
  };
}

export function isDevTedU10PreviewCandidate(hostname: string, child: {
  id: string; name: string; isPrimary: boolean; sourceClubCanisterId: string;
}): boolean {
  return DEV_HOSTS.has(hostname.toLowerCase()) && child.isPrimary &&
    child.id === DEV_TED_U10.sourceChildId &&
    child.sourceClubCanisterId === DEV_TED_U10.sourceCanister &&
    child.name.trim() === DEV_TED_U10.expectedName;
}

export async function previewDevTedU10Transfer(hostname: string): Promise<DevTedPreflight> {
  // Refuse other sites BEFORE consulting any private canister records.
  if (!DEV_HOSTS.has(hostname.toLowerCase())) throw new Error("This review is restricted to Ignite DEV.");
  // Every group must answer, including the original shared service. A failed
  // or slow leg never counts as an absent child. Nothing is written.
  const source = await withFeatureBackend<DevTedSourceReadback[]>("membership", {
    supabase: async () => { throw new Error("This review is restricted to Internet Identity."); },
    icp: async ctx => {
      const canister = requireSourceClubCanisterId(ctx.target);
      if (canister !== DEV_TED_U10.sourceCanister) return [];
      const principal = ctx.identity.getPrincipal().toText();
      if (principal !== DEV_TED_U10.parentPrincipal) throw new Error("Sign in as the exact Test full access Parent.");
      const list = await listMyLiveOwnChildren(ctx);
      const match = list.filter(x => x.id === DEV_TED_U10.sourceChildId);
      if (match.length !== 1) throw new Error("Ted's exact source child record is missing or duplicated.");
      const child = match[0];
      const [guardians, names] = await Promise.all([
        listLiveChildGuardians(ctx, child.id),
        resolveLivePiiTextBatch(ctx, [child.id], "name", "read", "dev_ted_transfer_preflight"),
      ]);
      return [{
        group: canister, id: child.id, owner: child.parent?.[0]?.toText() ?? null,
        name: names.get(child.id) ?? null, teams: [...child.teams],
        guardians: guardians.map(x => x.toText()),
      }];
    },
  }, { everyGroup: true, requireComplete: true, merge: parts => parts.flat() });
  const destination = await withFeatureBackend<DevTedDestinationReadback>("membership", {
    supabase: async () => { throw new Error("This review is restricted to Internet Identity."); },
    icp: async ctx => {
      const group = requireSourceClubCanisterId(ctx.target);
      const caller = ctx.identity.getPrincipal().toText();
      if (group !== DEV_TED_U10.destinationCanister || caller !== DEV_TED_U10.parentPrincipal)
        throw new Error("The requested Group 2 Parent identity changed.");
      const [teamRows, member, children] = await Promise.all([
        getLiveTeam(ctx, DEV_TED_U10.targetTeamId),
        isMyLiveClubMember(ctx, DEV_TED_U10.targetClubId),
        listMyLiveOwnChildren(ctx),
      ]);
      const team = teamRows[0];
      return {
        group, caller, club: DEV_TED_U10.targetClubId,
        team: team?.club_id === DEV_TED_U10.targetClubId ? team.id : null,
        teamName: team?.name ?? null, member,
        existingChildIds: children.map(x => x.id),
      };
    },
  }, { clubId: DEV_TED_U10.targetClubId });
  return validateDevTedPreflight(hostname, source, destination);
}
