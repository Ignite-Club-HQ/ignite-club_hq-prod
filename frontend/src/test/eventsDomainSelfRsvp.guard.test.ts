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
    expect(body).toContain("cd.read_has_club_membership(caller, event.club_id)");
    expect(body).toContain("cd.read_account_list_user_club_roles(caller, event.club_id)");
    expect(body).toContain('role == "parent"');
    expect(body).toContain("current.revision != event.revision");
    expect(body).toContain("childGuardians.any");
    expect(body).toContain("childTeamAssignments.any");
    expect(body).toContain("clubDomainCanister != ?authority");
    expect(body).toContain("return false");
  });
});
