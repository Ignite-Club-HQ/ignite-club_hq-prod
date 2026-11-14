import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const plan = readFileSync(new URL("../src/features/membership/devTedU10TransferPreflight.ts",import.meta.url),"utf8");
const page = readFileSync(new URL("../src/pages/IcpChildrenPage.tsx",import.meta.url),"utf8");
const feature = readFileSync(new URL("../src/live/features/club.ts",import.meta.url),"utf8");

test("read-only preview never calls child create/assign/delete or PII writes", () => {
  assert.doesNotMatch(plan, /\b(?:createMyLiveChild|deleteMyLiveChild|setMyLiveChildTeam|registerLiveChildNamePii|setMyLiveChildGuardian|grantLiveClubChildNameRead)\s*\(/);
  assert.match(plan, /readonly writeAuthorised: false/);
  assert.match(plan, /writeAuthorised: false/);
  assert.match(plan, /everyGroup: true, requireComplete: true/);
  assert.match(plan, /read_account_list_my_children|listMyLiveOwnChildren/);
  assert.match(plan, /resolveLivePiiTextBatch/);
  assert.match(plan, /listLiveChildGuardians/);
  assert.match(plan, /clubId: DEV_TED_U10\.targetClubId/);
});
test("My Children teams are discovered inside each verified group", () => {
  assert.match(page, /club\.listMyLiveGroupRoleGrants\(scoped\)/);
  assert.match(page, /sourceClubCanisterId = requireSourceClubCanisterId\(scoped\.target\)/);
  assert.match(page, /everyGroup: true, requireComplete: true/);
  assert.doesNotMatch(page, /membership\.getLiveMyRoleGrants\(ctx\)/);
  assert.match(feature, /actor\.read_account_my_role_grants\(\)/);
});
test("browser offers a read-only review, never a transfer button or write action", () => {
  assert.match(page, /isDevTedU10PreviewCandidate\(window\.location\.hostname, c\)/);
  assert.match(page, /previewDevTedU10Transfer\(window\.location\.hostname\)/);
  assert.match(page, /No move, duplicate, child creation, guardian update or deletion has been performed/);
  assert.doesNotMatch(page, /executeDevTedTransfer\(|transferDevTed\(/);
});
