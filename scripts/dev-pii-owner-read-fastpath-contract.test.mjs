// Source-level fail-closed regression contract for the PII owner's fast path.
// The real implementation is in Motoko. This does not replace isolated
// PocketIC authority tests or grant release permission.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../backend/pii_access_control/src/main.mo", import.meta.url), "utf8");
function section(start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, "Expected live protected PII method boundaries");
  return source.slice(a, b);
}
const guard = section("func ownsEveryRequestedChildName(", "func verifiedTeamChildNames(");
const keyRead = section("public shared ({ caller }) func get_encrypted_pii_vetkeys_batch(", "type PrivateNameScope =");
const ciphertextRead = section("public shared ({ caller }) func get_encrypted_pii_batch(", "public shared ({ caller }) func grant_pii_read(");

test("only a nonanonymous owner of EVERY existing exact child name qualifies", () => {
  assert.match(guard, /caller\.isAnonymous\(\)/);
  assert.match(guard, /fieldId != "name"/);
  assert.match(guard, /ids\.size\(\) == 0/);
  assert.match(guard, /ids\.all\(/);
  assert.match(guard, /pii_records\.find\(func\(r\) = r\.pii_id == id and r\.field_id == fieldId\)/);
  assert.match(guard, /case \(\?record\) record\.domain_owner == caller/);
  assert.match(guard, /case null false/);
  // Guardian, club member, explicit reader, arbitrary IDs and browser-supplied
  // team claims cannot become an owner: there is no override in this predicate.
  for (const forbidden of ["readers.any", "isVerifiedGuardian", "isMember", "isOnTeam", "club_read_grants"]) {
    assert.ok(!guard.includes(forbidden), "Owner fast-path predicate must not trust " + forbidden);
  }
});

function checkRead(method, label) {
  assert.match(method, /await admitAccount\(caller\);\s*auth\(caller\);/, label + " must authenticate before inspecting records");
  assert.match(method, /if \(pii_ids\.size\(\) > (25|100)\)/, label + " retains its size limit");
  assert.match(method, /let epoch = mediaAuthEpoch;/);
  assert.match(method, /let ownerChildNames = ownsEveryRequestedChildName\(caller, pii_ids, field_id\);/);
  for (const methodName of ["resolveAllowedClubs", "resolveAllowedCompetitions", "verifiedTeamChildNames"]) {
    assert.ok(
      method.includes(`if (ownerChildNames) [] else await ${methodName}(caller, pii_ids, field_id)`),
      label + " must retain external checks unless direct owner covers the entire batch",
    );
  }
  assert.match(method, /let direct = await directRead\(caller, r\);/);
  assert.match(method, /let allowed = direct or canReadViaClub\(r, allowedClubs\) or canReadViaCompetition\(r, allowedCompetitions\) or teamChildNames\.any\(/);
  assert.match(method, /log_audit\(caller, pii_id, field_id,/);
  assert.match(method, /await admitAccount\(caller\);[\s\S]*?if \(epoch != mediaAuthEpoch\) return #Err\("PII authorization changed"\);\s*#Ok\(out\)/);
}

test("ciphertext read retains all non-owner checks and closing account/epoch fences", () => {
  checkRead(ciphertextRead, "ciphertext");
  assert.match(ciphertextRead, /if \(teamChildNames\.size\(\) > 0 and \(await verifiedTeamChildNames\(caller, pii_ids, field_id\)\) != teamChildNames\)/);
  assert.match(ciphertextRead, /#Err\("Team child-name authorization changed"\)/);
  assert.match(ciphertextRead, /ciphertext = r\.ciphertext/);
  assert.doesNotMatch(ciphertextRead, /encryptionDeriveKey/);
});

test("encrypted key relay retains per-record post-derivation authorization and no extra keys", () => {
  checkRead(keyRead, "vetkey");
  assert.match(keyRead, /let encryptedKey = await encryptionDeriveKey<system>\(/);
  assert.match(keyRead, /if \(ownerChildNames\) \[\] else await resolveAllowedClubs\(caller, \[pii_id\], field_id\)/);
  assert.match(keyRead, /if \(ownerChildNames\) \[\] else await resolveAllowedCompetitions\(caller, \[pii_id\], field_id\)/);
  assert.match(keyRead, /let freshDirect = await directRead\(caller, r\);/);
  assert.match(keyRead, /if \(ownerChildNames\) \[\] else await verifiedTeamChildNames\(caller, \[pii_id\], field_id\)/);
  assert.match(keyRead, /if \(epoch != mediaAuthEpoch or not \(freshDirect or canReadViaClub/);
  assert.match(keyRead, /await admitAccount\(caller\);/);
});
