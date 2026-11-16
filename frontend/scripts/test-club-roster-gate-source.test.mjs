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

test("both roster entry points require staff authority, not merely a club role", () => {
  for (const method of ["get_club_roster", "read_account_get_club_roster"]) {
    const body = bodyFor(method);
    assert.match(body, /if \(not canReadClubRoster\(caller, club_id\)\) return #Err\("Club staff role required"\)/);
    assert.doesNotMatch(body, /if \(not acl\.roles\.any\(/);
  }
});

test("staff helper excludes Parent/player from club-wide principal reads", () => {
  const helper = bodyFor("canReadClubRoster");
  assert.match(helper, /isAdmin\(caller, club\)/);
  for (const role of ["team_admin", "coach", "committee_member"]) {
    assert.ok(helper.includes(`grant.role == "${role}"`), `staff role ${role} missing`);
  }
  assert.doesNotMatch(helper, /grant\.role == "parent"|grant\.role == "player"/);
});

test("both roster entry points use the same team-aware club child boundary", () => {
  for (const method of ["get_club_roster", "read_account_get_club_roster"]) {
    const body = bodyFor(method);
    assert.match(body, /let scopedTeamIds = clubTeamIds\(club_id\)/);
    assert.match(body, /children = acl\.children\.filter\(func\(c\) = clubChild\(club_id, scopedTeamIds, c\)\)/);
  }
  assert.match(motoko, /func clubChild\(club : Text, ids : \[Text\], c : Types\.Child\) : Bool = c\.club_id == \?club or c\.teams\.any/);
});

test("notification club switching uses scoped boolean membership, never full family roster", () => {
  const hook = readFileSync(new URL("../src/hooks/useNotificationClubSwitch.ts", import.meta.url), "utf8");
  const feature = readFileSync(new URL("../src/live/features/club.ts", import.meta.url), "utf8");
  assert.doesNotMatch(hook, /getLiveClubRoster\(/);
  assert.match(hook, /isMyLiveClubMember\(scoped, clubId\)/);
  assert.match(hook, /\}, \{ clubId \}\)/);
  assert.match(feature, /actor\.read_account_is_club_member\(ctx\.identity\.getPrincipal\(\), clubId\)/);
});


test("ICP team player roster starts canonical canister read before optional vetKey prewarm", () => {
  const page = readFileSync(new URL("../src/pages/TeamDetailPage.tsx", import.meta.url), "utf8");
  assert.match(page, /void import\('@\/live\/piiVetKeys'\)/);
  assert.match(page, /\.then\(\(\{ prewarmPiiVerificationKey \}\) => prewarmPiiVerificationKey\(ctx\)\)/);
  assert.match(page, /\.catch\(\(\) => undefined\)/);
  assert.doesNotMatch(page, /const \{ prewarmPiiVerificationKey \} = await import/);
  assert.match(page, /return withRosterDeadline\(readTeamChildRows\(ctx, team\.club_id, id\), 30_000/);
  assert.match(page, /retry: isIcpAccount \? 0 : 3/);
  assert.match(page, /enabled: !!id && !useIcpLab && \(!isIcpAccount \|\| !!team\?\.club_id\)/);
});
