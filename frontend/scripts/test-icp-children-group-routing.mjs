import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../src/pages/IcpChildrenPage.tsx", import.meta.url), "utf8");

const invite = readFileSync(new URL("../src/pages/JoinTeamPage.tsx", import.meta.url), "utf8");
const duplicate = readFileSync(new URL("../src/features/membership/verifyIcpChildNameAcrossGroups.ts", import.meta.url), "utf8");
const club = readFileSync(new URL("../src/live/features/club.ts", import.meta.url), "utf8");
const membership = readFileSync(new URL("../src/live/features/membership.ts", import.meta.url), "utf8");

test("Group 2 child and guardian reads use protected consensus account APIs", () => {
  assert.match(club, /actor\.read_account_list_my_children\(\)/);
  assert.match(club, /actor\.read_account_list_child_guardians\(childId\)/);
  assert.match(membership, /actor\.read_account_list_team_role_grants\(teamId\)/);
  assert.doesNotMatch(club, /actor\.list_my_children\(\)/);
  assert.doesNotMatch(club, /actor\.list_child_guardians\(childId\)/);
});


test("invite and My Children both check duplicate names across every group before create", () => {
  assert.match(invite, /await verifyIcpChildNameAcrossGroups\(addedLabel\)/);
  assert.match(page, /await verifyIcpChildNameAcrossGroups\(trimmed\)/);
  assert.match(duplicate, /everyGroup: true, requireComplete: true/);
  assert.match(duplicate, /vault\.resolveLivePiiTextBatch\(/);
  assert.match(duplicate, /assertMayCreateChild\(name, existing, true\)/);
  assert.doesNotMatch(duplicate, /createMyLiveChild\(|create_own_child\(/);
});

test("authoritative child inventory remains all-groups complete while early member preview is read-only", () => {
  assert.match(page, /function readChildrenFromVerifiedSources/);
  assert.match(page, /mode === 'member'/);
  assert.match(page, /memberGroups: true/);
  assert.match(page, /everyGroup: true, requireComplete: true/);
  assert.match(page, /withFeatureBackend<IcpChild\[]>\("membership"/);
  assert.match(page, /inventoryComplete = !!completeChildRows && !isError/);
  assert.match(page, /disabled=\{!inventoryComplete\}/);
  assert.match(page, /existingNamesResolved = inventoryComplete/);
  // Principal-scoped query keys must not briefly display the prior account's
  // children when users switch between Internet Identity sessions.
  assert.doesNotMatch(page, /placeholderData:\s*\(prev\)\s*=>\s*prev/);
  assert.ok((page.match(/everyGroup: true, requireComplete: true/g) ?? []).length >= 3);
  assert.match(page, /sourceClubCanisterId = requireSourceClubCanisterId\(scoped\.target\)/);
  assert.match(page, /childSourceKey\(\{ id, sourceClubCanisterId \}\)/);
  assert.match(page, /vault\.resolveLivePiiTextBatch\(scoped, ids/);
  assert.doesNotMatch(page, /supabase\.(?:from|rpc|functions\.invoke)\(/);
});
test("all mutations use verified source and cannot cross groups", () => {
  assert.match(page, /function withVerifiedChildGroup/);
  assert.match(page, /runForVerifiedOwnedChild\(/);
  assert.match(page, /assertChildSourceMatchesTeam\(child, team\)/);
  assert.match(page, /withVerifiedChildGroup\(child, ctx => club\.deleteMyLiveChild\(ctx, child\.id\)\)/);
  assert.match(page, /withVerifiedChildGroup\(child, async ctx =>/);
  assert.match(page, /setMyLiveChildGuardian\(ctx, child\.id, p, linked\)/);
});
test("new child has an explicit team placement and an unretried create", () => {
  assert.match(page, /assertMayCreateChild\(trimmed, children, !!existingNamesResolved\)/);
  assert.match(page, /if \(!availableNewChildTeam\) throw new Error/);
  assert.match(page, /createIcpInviteChild\(\{/);
  assert.match(page, /createAttempted\.current = true/);
  assert.match(page, /writeOnce\(\{ clubId: team\.club_id \}\)/);
  assert.match(page, /teamLinked = result\.status !== "created_unlinked"/);
  assert.match(page, /teams: teamLinked \? \[team\.id\] : \[\]/);
});

test("parent invite child creation preflights current club membership and locks only the write", () => {
  assert.match(invite, /await verifyIcpChildNameAcrossGroups\(addedLabel\)/);
  assert.match(invite, /club\.isMyLiveClubMember\(ctx, clubId\)/);
  assert.match(invite, /readTeam: async \(\) => \{/);
  assert.match(invite, /createOwnChild: \(\) => \{/);
  assert.match(invite, /icpChildCreateAttempted\.current = true;\s*return club\.createMyLiveChild\(ctx\)/);
  assert.match(invite, /icpChildSubmissionPending\.current\) return/);
  assert.match(invite, /icpChildSubmissionPending\.current = true/);
  assert.match(invite, /icpChildSubmissionPending\.current = false/);
  assert.match(invite, /writeOnce\(\{ clubId: verifiedClubId \}\)/);
  assert.match(invite, /vault\.registerLiveChildNamePiiOrThrow\(ctx, id, addedLabel, parent, clubId\)/);
  assert.match(invite, /result\.status !== "linked"/);
  assert.match(invite, /result\.status === "linked_without_name"/);
  // A parent must never link an arbitrary other family's child with a client-only grant.
  assert.match(invite, /Ask your team admin to link you to an existing child/);
});


const teamRoster = readFileSync(new URL("../src/lib/teamRosterReads.ts", import.meta.url), "utf8");
const clubBackend = readFileSync(new URL("../../backend/club_domain/src/main.mo", import.meta.url), "utf8");
const privateNameBackend = readFileSync(new URL("../../backend/pii_access_control/src/main.mo", import.meta.url), "utf8");

test("team child roster uses caller-authorized canonical group placement, not the Events mirror", () => {
  assert.match(teamRoster, /listLiveTeamChildIds\(ctx, clubId, teamId\)/);
  assert.match(club, /actor\.read_account_list_team_child_ids\(clubId, teamId\)/);
  assert.match(clubBackend, /func read_account_list_team_child_ids\(club_id : Text, team_id : Text\)/);
  assert.match(clubBackend, /not teamInClub\(team_id, club_id\)/);
  assert.match(clubBackend, /not isMember\(caller, club_id\)/);
  assert.match(clubBackend, /acl\.children\.filter\(func\(child\) = child\.teams\.any/);
  assert.match(teamRoster, /if \(!\/has no/);
  assert.doesNotMatch(teamRoster, /catch \{\s*return \[\]/);
});

test("parents see only authorized same-team child names; private fields stay restricted", () => {
  // Existing adult profile display remains relationship-authorized rather than
  // returning names or guardian metadata in the roster-ID endpoint.
  assert.match(clubBackend, /func read_can_team_child_name_visibility/);
  assert.match(clubBackend, /switch \(piiCanister\)/);
  assert.match(clubBackend, /configured\.equal\(caller\)/);
  assert.match(clubBackend, /isOnTeam\(viewer, teamId\)/);
  assert.match(clubBackend, /not isExcluded\(viewer, clubId\)/);
  assert.match(clubBackend, /not isTransferFenced\(clubId\)/);
  assert.match(clubBackend, /not \(isOnTeam\(caller, team_id\) or canManageTeam\(caller, club_id, \?team_id\)\)/);
  assert.match(privateNameBackend, /func verifiedTeamChildNames/);
  assert.match(privateNameBackend, /fieldId != "name"/);
  assert.match(privateNameBackend, /read_can_team_child_name_visibility\(viewer, ids\)/);
  assert.match(privateNameBackend, /let teamChildNames = await verifiedTeamChildNames\(caller, pii_ids, field_id\)/);
  assert.match(privateNameBackend, /let freshTeamChildNames = await verifiedTeamChildNames\(caller, \[pii_id\], field_id\)/);
  assert.doesNotMatch(teamRoster, /return .*child\.name/);
});
