// Source-level guard for the club_domain roster boundary. This DOES NOT
// replace the PocketIC runtime regression in test-linked-membership-replica.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const motoko = readFileSync(new URL("../../backend/club_domain/src/main.mo", import.meta.url), "utf8");

function bodyFor(method) {
  const prefix = `func ${method}(`;
  const i = motoko.indexOf(prefix);
  assert.notEqual(i, -1, `expected ${method} in club_domain`);
  // The first 2,000 characters contain the roster gate and row selection,
  // before the next public method. Limit this to avoid matching other gates.
  return motoko.slice(i, i + 2000);
}

test("both roster entry points require an administrator, not merely a club role", () => {
  for (const method of ["get_club_roster", "read_account_get_club_roster"]) {
    const body = bodyFor(method);
    assert.match(body, /if \(not isAdmin\(caller, club_id\)\) return #Err\("Club admin required"\)/);
    assert.doesNotMatch(body, /if \(not acl\.roles\.any\(/);
  }
});

test("both roster entry points use the same team-aware club child boundary", () => {
  for (const method of ["get_club_roster", "read_account_get_club_roster"]) {
    const body = bodyFor(method);
    assert.match(body, /let scopedTeamIds = clubTeamIds\(club_id\)/);
    assert.match(body, /children = acl\.children\.filter\(func\(c\) = clubChild\(club_id, scopedTeamIds, c\)\)/);
  }
  assert.match(motoko, /func clubChild\(club : Text, ids : \[Text\], c : Types\.Child\) : Bool = c\.club_id == \?club or c\.teams\.any/);
});
