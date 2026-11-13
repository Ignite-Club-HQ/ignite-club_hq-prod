import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "../backend/events_domain/src/main.mo"),
  "utf8",
);

function selfRsvpMethod() {
  const start = source.indexOf("public shared ({ caller }) func set_rsvp(");
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf("public shared ({ caller }) func set_child_rsvp(", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("events_domain self RSVP authorization", () => {
  it("allows a caller to RSVP only for their own visible event account", () => {
    const method = selfRsvpMethod();
    expect(method).toContain("account_id != caller.toText()");
    expect(method).toContain("not canSelfRsvp(caller, event)");
    const policyStart = source.indexOf("func canSelfRsvp(");
    const policyEnd = source.indexOf("func canGuardianRsvpForChild(", policyStart);
    expect(policyStart).toBeGreaterThanOrEqual(0);
    expect(policyEnd).toBeGreaterThan(policyStart);
    expect(source.slice(policyStart, policyEnd)).toContain("not canView(caller, event)");
    expect(method).not.toContain("requireManage(caller, event_id)");
  });

  it("keeps cross-account RSVP writes on the separate admin endpoint", () => {
    expect(source).toContain("func admin_upsert_rsvp(");
    expect(source).toContain("requireManage(caller, event_id)");
  });
});
function methodBlock(startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start,end);
}

describe("events_domain RSVP integrity and guardian authorization", () => {
  it("updates only the self row, leaving every child row intact", () => {
    const method = selfRsvpMethod();
    expect(method).toContain("item.account_id == account_id and item.child_id == null");
    expect(method).toContain("retainedPaid");
    expect(method).toContain("retainedNotes");
    expect(method).toContain("has_paid = retainedPaid");
    expect(method).not.toContain("not (item.event_id == event_id and item.account_id == account_id))");
  });

  it("child RSVP uses a verified guardian relationship rather than a management permission", () => {
    const method = methodBlock("public shared ({ caller }) func set_child_rsvp(", "public shared ({ caller }) func set_rsvp_note(");
    expect(method).not.toContain("requireManage(caller, event_id)");
    expect(method).toContain("freshGuardianRsvpForChild(caller, event, account_id, child_id)");
    expect(method).toContain("item.child_id == ?child_id");
    expect(method).toContain("has_paid = retainedPaid");
    expect(method).toContain("notes = retainedNotes");
  });

  it("fresh guardian authorization must check current roles, membership, team assignment and event revision", () => {
    const body = methodBlock("func freshGuardianRsvpForChild(", "// Parent RSVPs their own child");
    expect(body).toContain("account_id != caller.toText()");
    expect(body).toContain("Principal.isAnonymous(caller)");
    expect(body).toContain("cd.read_can_guardian_rsvp_child(caller, child_id, event.club_id, current.team_id, targets)");
    expect(body).not.toContain("requireManage(caller");
    expect(body).not.toContain("child.parent_id == ?callerId");
    expect(body).toContain('restricted.any(func(role) = role == "player")');
    expect(body).toContain('event.rsvp_audience == ?"parents_only"');
    expect(body).toContain("current.revision != event.revision");
    expect(body).not.toContain("childGuardians.any");
    expect(body).not.toContain("childTeamAssignments.any");
    expect(body).toContain("clubDomainCanister != ?authority");
    expect(body).toContain("return false");
  });
});

describe("member-owned child RSVP UX and read authorization", () => {
  it("allows parent-owned children and explicit guardians to read their own child RSVPs", () => {
    const method = methodBlock("public shared ({ caller }) func read_account_my_child_rsvps(", "public shared ({ caller }) func read_account_child_is_in_event_audience(");
    expect(method).toContain("club.read_can_list_guardian_children(caller)");
    expect(method).toContain("linkedIds.any(func(linkedId) = id == linkedId)");
    expect(method).toContain("freshGuardianRsvpForChild(caller, event, caller.toText(), childId)");
    expect(method).toContain("clubDomainCanister != ?authority");
    expect(method).toContain("candidates.size() > 500");
    expect(method).not.toContain("childGuardians.filter");
    expect(method).not.toContain("accessibleChildIds");
  });
  it("uses the dedicated guardian-scoped endpoint in the event carousel, not the admin endpoint", () => {
    const carousel = readFileSync(resolve(process.cwd(), "src/components/NextUpCarousel.tsx"),"utf8");
    expect(carousel).toContain("setLiveChildRsvp(ctx, event.id, accountId, childId, status)");
    expect(carousel).not.toContain("adminUpsertLiveRsvp(");
  });
});

describe("authoritative club-domain child RSVP eligibility", () => {
  const club = readFileSync(resolve(process.cwd(), "../backend/club_domain/src/main.mo"), "utf8");
  const ui = readFileSync(resolve(process.cwd(), "src/lib/resolveEventChildScope.ts"), "utf8");
  it("restricts the authority method to the configured events canister and current membership", () => {
    const start = club.indexOf("func read_can_guardian_rsvp_child(");
    const end = club.indexOf("// The user's role grants", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const body = club.slice(start, end);
    expect(body).toContain("eventsDomainCanister");
    expect(body).toContain("caller");
    expect(body).toContain("currentChildGuardian(user, child_id)");
    expect(body).toContain("isMember(user, club_id)");
    expect(body).toContain("isTransferFenced(club_id)");
    expect(body).toContain("team.club_id == club_id");
    expect(body).toContain("team.is_active and not team.archived");
    expect(body).toContain("target_team_ids.any");
    expect(body).toContain("team_id");
  });
  it("reads parent children from club authority rather than stale events mirror", () => {
    expect(ui).toContain("listMyLiveOwnChildren(ctx)");
    expect(ui).toContain("listLiveTeams(ctx, scope.clubId)");
    expect(ui).not.toContain("getLiveMyChildTeamAssignments");
    expect(ui).not.toContain("getLiveMyChildren");
  });
});

describe("club-sourced guardian child listing", () => {
  const club = readFileSync(resolve(process.cwd(), "../backend/club_domain/src/main.mo"), "utf8");
  it("serves only current guardian records to the configured events canister", () => {
    const a = club.indexOf("func read_can_list_guardian_children(");
    const b = club.indexOf("// The user's role grants", a);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThan(a);
    const body = club.slice(a,b);
    expect(body).toContain("eventsDomainCanister");
    expect(body).toContain("currentChildGuardian(user, child.id)");
    expect(body).toContain("removalReceiver.denied(user)");
    expect(body).toContain("isTransferFenced(club)");
  });
  it("routes a signed-in event child roster read through club authority", () => {
    const body = methodBlock("public shared ({ caller }) func read_account_my_children(", "public shared ({ caller }) func read_account_list_child_team_assignments(");
    expect(body).toContain("read_can_list_guardian_children(caller)");
    expect(body).not.toContain("childGuardians.filter");
    expect(body).toContain("clubDomainCanister != ?authority");
  });
});

describe("native ICP child read routing", () => {
  const feature = readFileSync(resolve(process.cwd(), "src/live/features/events.ts"), "utf8");
  it("uses account-scoped child and RSVP reads instead of stale legacy queries", () => {
    expect(feature).toContain("actor.read_account_my_children()");
    expect(feature).toContain("actor.read_account_my_child_rsvps(candidOpt(eventId), candidOpt(clubId))");
    expect(feature).not.toContain("actor.my_child_rsvps(");
  });
});
