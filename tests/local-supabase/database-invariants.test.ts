import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSyntheticLocalMarker, createSecurityFixture, service, type SecurityFixture } from "./fixtures";

describe("local database: critical relational invariants", () => {
  let fixture: SecurityFixture;
  beforeAll(async () => { await assertSyntheticLocalMarker(); fixture = await createSecurityFixture(); });
  afterAll(async () => { await fixture?.cleanup(); });

  it("rejects duplicate roles in the exact same scope", async () => {
    const duplicate = await service.from("user_roles").insert({
      user_id: fixture.memberA.id, role: "player", club_id: fixture.clubA, team_id: fixture.teamA,
    });
    expect(duplicate.error).not.toBeNull();
  });

  it("rejects a non-global role without a club or team scope", async () => {
    const result = await service.from("user_roles").insert({ user_id: fixture.memberA.id, role: "player" });
    expect(result.error).not.toBeNull();
  });

  it("rejects a guardian relationship to a missing child", async () => {
    const result = await service.from("child_guardians").insert({
      child_id: crypto.randomUUID(), guardian_id: fixture.memberA.id,
    });
    expect(result.error).not.toBeNull();
  });

  it("rejects duplicate child-guardian relationships", async () => {
    expect((await service.from("child_guardians").insert({
      child_id: fixture.childA, guardian_id: fixture.memberA.id,
    })).error).toBeNull();
    expect((await service.from("child_guardians").insert({
      child_id: fixture.childA, guardian_id: fixture.memberA.id,
    })).error).not.toBeNull();
  });

  it("requires an RSVP actor while allowing a guardian to represent a child", async () => {
    const event = await service.from("events").insert({
      club_id: fixture.clubA, team_id: fixture.teamA, created_by: fixture.adminA.id,
      title: "Synthetic RSVP invariant", type: "training", event_date: "2099-01-02T10:00:00Z",
    }).select("id").single();
    expect(event.error).toBeNull();
    const neither = await service.from("rsvps").insert({ event_id: event.data!.id, status: "going" });
    const both = await service.from("rsvps").insert({
      event_id: event.data!.id, user_id: fixture.memberA.id, child_id: fixture.childA, status: "going",
    });
    expect(neither.error).not.toBeNull();
    expect(both.error).toBeNull();
  });

  it("rejects duplicate user RSVPs for one event", async () => {
    const event = await service.from("events").insert({
      club_id: fixture.clubA, team_id: fixture.teamA, created_by: fixture.adminA.id,
      title: "Synthetic duplicate RSVP", type: "training", event_date: "2099-01-03T10:00:00Z",
    }).select("id").single();
    expect((await service.from("rsvps").insert({
      event_id: event.data!.id, user_id: fixture.memberA.id, status: "going",
    })).error).toBeNull();
    expect((await service.from("rsvps").insert({
      event_id: event.data!.id, user_id: fixture.memberA.id, status: "maybe",
    })).error).not.toBeNull();
  });

  it("rejects an event whose team belongs to a different club", async () => {
    const result = await service.from("events").insert({
      club_id: fixture.clubA, team_id: fixture.teamB, created_by: fixture.adminA.id,
      title: "Synthetic cross-club mismatch", type: "game", event_date: "2099-01-04T10:00:00Z",
    });
    expect(result.error).not.toBeNull();
  });
});
