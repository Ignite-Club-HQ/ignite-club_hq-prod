import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const copy = readFileSync(new URL("../src/features/membership/devTedU10CopyCoordinator.ts",import.meta.url),"utf8");
const pii = readFileSync(new URL("../src/live/features/vault.ts",import.meta.url),"utf8");
const page = readFileSync(new URL("../src/pages/IcpChildrenPage.tsx",import.meta.url),"utf8");
const invite = readFileSync(new URL("../src/pages/JoinTeamPage.tsx",import.meta.url),"utf8");

test("staged copy is deliberately disconnected from all live screens", () => {
  assert.doesNotMatch(page, /devTedU10CopyCoordinator|beginTedCopyOnce|continueTedCopy/);
  assert.doesNotMatch(invite, /devTedU10CopyCoordinator|beginTedCopyOnce|continueTedCopy/);
  assert.match(copy, /claimCreateOnce\(pending\)/);
  assert.match(copy, /await actions\.advanceReceipt\(pending, created\)/);
  assert.match(copy, /await actions\.preflight\(\)/);
  assert.doesNotMatch(copy, /deleteMyLiveChild|delete_own_child|deleteSource|assignSourceTeam/);
});
test("unknown create/PII/team outcomes never transparently retry", () => {
  assert.match(copy, /if \(await actions\.readReceipt\(\)\) throw/);
  assert.match(copy, /receipt\.phase === "create-pending" \|\| receipt\.phase === "name-pending"/);
  assert.match(copy, /receipt\.phase === "team-pending"/);
  assert.match(copy, /await actions\.registerEncryptedName\(id, "Ted"\)/);
  assert.match(copy, /await actions\.readEncryptedName\(id\)/);
  assert.match(copy, /await actions\.verifyStaffU10Roster\(id\)/);
});
test("strict PII helper propagates all failures; legacy best-effort remains unchanged", () => {
  const first=pii.indexOf("export async function registerLiveChildNamePiiStrict");
  const next=pii.indexOf("export async function registerLiveChildNamePii(",first);
  assert.ok(first>=0 && next>first);
  const strict=pii.slice(first,next);
  assert.match(strict, /await registerLivePii\(/);
  assert.match(strict, /await grantLiveClubPiiRead\(/);
  assert.match(strict, /await grantLivePiiRead\(/);
  assert.doesNotMatch(strict, /catch\s*\(/);
  assert.match(pii.slice(next,next+1400), /catch \(error\)/);
});
