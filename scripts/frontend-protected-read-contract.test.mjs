// Frontend-only safety contract: protected account reads are direct consensus
// methods. Never replace caller-scoped reads with anonymous or global queries.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const events = read("../frontend/src/live/features/events.ts");
const membership = read("../frontend/src/live/features/membership.ts");
const club = read("../frontend/src/live/features/club.ts");
const adapters = read("../frontend/src/live/accountReadAdapter.mjs");

const area = (src, start, end) => {
  const i = src.indexOf(start), j = src.indexOf(end, i + start.length);
  assert.ok(i >= 0 && j > i, "required scoped read method must exist");
  return src.slice(i, j);
};

test("event listing batches strictly protected signed reads by canister context", () => {
  const code = area(events, "async function listLiveEventsRaw(", "export async function getLiveMatchEventIds(");
  assert.match(code, /batched\(\s*ctx, "events:list", key, eventsConn\(ctx\)/);
  assert.match(code, /actor\.read_account_list_events_multi\(clubs, teams\)/);
  assert.match(code, /actor\.read_account_list_events\(\[k\.slice\(2\)\], \[\]\)/);
  assert.match(code, /actor\.read_account_list_events\(\[\], \[k\.slice\(2\)\]\)/);
  assert.match(code, /actor\.read_account_list_events\(candidOpt\(clubId\), candidOpt\(teamId\)\)/);
  assert.doesNotMatch(code, /actor\.list_events(?:_multi)?\(/);
});
test("own RSVP and children reads use exact protected account methods", () => {
  const own = area(events, "export async function listLiveMyRsvps(", "export async function createLiveEvent(");
  assert.match(own, /actor\.read_account_my_rsvps\(\)/);
  assert.doesNotMatch(own, /actor\.my_rsvps\(\)/);
  const children = area(membership, "export async function listLiveChildren(", "export async function listLiveMembershipClubs(");
  assert.match(children, /actor\.read_account_list_children\(\)/);
  assert.doesNotMatch(children, /actor\.list_children\(\)/);
  assert.match(club, /return actor\.read_account_list_my_children\(\)/, "existing own children path remains protected");
});
test("remote account adapter retains exact-signature fallbacks for other legacy consumers", () => {
  assert.match(adapters, /exactSignatureTwins\(service/);
  assert.match(adapters, /PROTECTED_READ_TRAP/);
  assert.match(adapters, /return twin\.apply\(target, args\)/);
});
