import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../backend/club_domain/src/main.mo", import.meta.url), "utf8");
const marker = "func accept_team_invite_link(";
const start = source.indexOf(marker);
const end = source.indexOf("// ---- Pending invites:", start);
assert(start > 0 && end > start, "invitation flow must exist");
const accept = source.slice(start, end);

test("accepting a Parent link does not grant any extra administrative role", () => {
  assert.match(accept, /role = link\.role/);
  assert.match(accept, /team = \?link\.team_id/);
  assert.doesNotMatch(accept, /role = "club_admin"|role = "app_admin"/);
});

test("accepting a link synchronizes both canonical chats after membership grant", () => {
  const grant = accept.indexOf("accountRoles := accountRoles.concat");
  const clubChat = accept.indexOf("fanOutEnsureConversation(link.club_id, null, clubChatParticipants(link.club_id))");
  const teamChat = accept.indexOf("fanOutEnsureConversation(link.club_id, ?link.team_id, teamChatParticipants(link.club_id, link.team_id))");
  assert(grant > 0 && clubChat > grant && teamChat > clubChat, "refresh chats only after storing role");
  assert.match(accept, /ignore fanOutEnsureConversation\(/, "best-effort chat provision must not roll back valid membership");
});

test("invitation remains idempotent and bounded to its exact team", () => {
  assert.match(accept, /if \(not acl\.roles\.any\(/);
  assert.match(accept, /link\.club_id/);
  assert.match(accept, /link\.team_id/);
  assert.doesNotMatch(accept, /fanOutEnsureClubConversations\(/, "avoid a whole-club sweep for each invited parent");
});
