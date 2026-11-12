import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const events = readFileSync(new URL("../backend/events_domain/src/main.mo", import.meta.url), "utf8");
const messages = readFileSync(new URL("../backend/messaging_domain/src/main.mo", import.meta.url), "utf8");

const body = (source, name) => {
  const start = source.indexOf(`func ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = source.indexOf("  public ", start + 1);
  return source.slice(start, end === -1 ? start + 6000 : end);
};

test("ordinary parent event list consults live club authority and retains team scope", () => {
  const fresh = body(events, "freshMemberCanViewEvent");
  for (const phrase of ["read_has_club_membership", "read_account_list_user_club_roles", 'role == "parent"', 'role == "player"', "teamInEventScope(current, team)", "current.revision != event.revision", "removalReceiver.denied(subject)", "isFenced(event.club_id)"]) {
    assert.ok(fresh.includes(phrase), `missing event guard: ${phrase}`);
  }
  for (const method of ["read_account_list_events", "read_account_list_events_multi"]) {
    const b = body(events, method);
    assert.ok(b.includes("canViewListedEvent(caller, event)"), `${method} must use verified event audience`);
  }
});

test("protected group discovery excludes invite-only groups from ordinary browsing", () => {
  for (const method of ["read_account_list_groups_by_club", "read_account_list_groups_by_team"]) {
    const b = body(messages, method);
    assert.ok(b.includes("requireChatClubMember(caller"), `${method} must verify original member`);
    const entered = b.indexOf("removalReceiver.enter(caller)");
    const admitted = b.indexOf("await admitAccount(caller)");
    assert.ok(entered >= 0 && admitted > entered, `${method} must acquire removal fence before account admission`);
    assert.ok(b.includes("meta.members.any") || b.includes("m.members.any"), `${method} must restrict private group audience`);
    assert.ok(b.includes("removalReceiver.denied(caller)"), `${method} must check removal after awaits`);
    assert.ok(b.includes("c.participants.any"), `${method} must restrict canonical chats`);
  }
  const club = body(messages, "read_account_list_groups_by_club");
  assert.ok(club.includes('joinPolicyOf(m.conversation_id).join_policy != "invite_only"'));
  const team = body(messages, "read_account_list_groups_by_team");
  assert.ok(!team.includes('joinPolicyOf(meta.conversation_id).join_policy != "invite_only"'), "team private groups stay member-only");
});

test("original chat membership remains enforced; no ad hoc role grants", () => {
  assert.ok(messages.includes("await* requireChatClubMember(caller, club_id)"));
  const chat = body(messages, "read_account_list_groups_by_club");
  assert.ok(!chat.includes("add_role_grant"));
  assert.ok(!chat.includes("grant_role"));
});
