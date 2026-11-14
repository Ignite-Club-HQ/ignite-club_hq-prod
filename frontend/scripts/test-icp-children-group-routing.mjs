import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../src/pages/IcpChildrenPage.tsx", import.meta.url), "utf8");

test("caller-only child and name reads require every group and full success", () => {
  assert.match(page, /function readAllMyChildren/);
  assert.match(page, /withFeatureBackend<IcpChild\[]>\("membership"/);
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
  assert.match(page, /status === "linked" \? \[team\.id\] : \[\]/);
});
