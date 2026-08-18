import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSyntheticLocalMarker, createSecurityFixture, service, type SecurityFixture } from "./fixtures";

describe("local journey: event lifecycle and attendance permissions", () => {
  let fixture: SecurityFixture;

  beforeAll(async () => {
    await assertSyntheticLocalMarker();
    fixture = await createSecurityFixture();
  });

  afterAll(async () => {
    await fixture?.cleanup();
  });

  it("protects creation, attendance, editing and cancellation across club boundaries", async () => {
    const unauthorizedCreate = await fixture.memberA.client.from("events").insert({
      club_id: fixture.clubA,
      team_id: fixture.teamA,
      created_by: fixture.memberA.id,
      title: "Synthetic Unauthorized Event",
      type: "training",
      event_date: "2099-03-01T10:00:00.000Z",
    });
    expect(unauthorizedCreate.error).not.toBeNull();

    const created = await fixture.adminA.client.from("events").insert({
      club_id: fixture.clubA,
      team_id: fixture.teamA,
      created_by: fixture.adminA.id,
      title: "Synthetic Lifecycle Training",
      description: "Initial details",
      type: "training",
      event_date: "2099-03-02T10:00:00.000Z",
    }).select("id, title, is_cancelled").single();
    expect(created.error).toBeNull();
    expect(created.data).toMatchObject({ title: "Synthetic Lifecycle Training", is_cancelled: false });
    const eventId = created.data!.id;

    const [memberView, outsiderView] = await Promise.all([
      fixture.memberA.client.from("events").select("id, title").eq("id", eventId),
      fixture.outsiderB.client.from("events").select("id").eq("id", eventId),
    ]);
    expect(memberView.data).toEqual([{ id: eventId, title: "Synthetic Lifecycle Training" }]);
    expect(outsiderView.data).toEqual([]);

    const attendance = await fixture.memberA.client.from("rsvps").insert({
      event_id: eventId,
      user_id: fixture.memberA.id,
      status: "going",
    }).select("id, status").single();
    expect(attendance.error).toBeNull();
    expect(attendance.data?.status).toBe("going");

    const outsiderAttendance = await fixture.outsiderB.client.from("rsvps").insert({
      event_id: eventId,
      user_id: fixture.outsiderB.id,
      status: "going",
    });
    expect(outsiderAttendance.error).not.toBeNull();

    const memberEdit = await fixture.memberA.client.from("events")
      .update({ title: "Member must not edit" }).eq("id", eventId).select("id");
    expect(memberEdit.error).toBeNull();
    expect(memberEdit.data).toEqual([]);

    const crossClubEdit = await fixture.outsiderB.client.from("events")
      .update({ title: "Outsider must not edit" }).eq("id", eventId).select("id");
    expect(crossClubEdit.error).toBeNull();
    expect(crossClubEdit.data).toEqual([]);

    const edited = await fixture.adminA.client.from("events")
      .update({ title: "Synthetic Updated Training", description: "Updated details" })
      .eq("id", eventId).select("title, description").single();
    expect(edited.error).toBeNull();
    expect(edited.data).toEqual({ title: "Synthetic Updated Training", description: "Updated details" });

    const changedAttendance = await fixture.memberA.client.from("rsvps")
      .update({ status: "maybe" }).eq("id", attendance.data!.id).select("status").single();
    expect(changedAttendance.error).toBeNull();
    expect(changedAttendance.data?.status).toBe("maybe");

    const cancelled = await fixture.adminA.client.from("events")
      .update({ is_cancelled: true }).eq("id", eventId).select("id, is_cancelled").single();
    expect(cancelled.error).toBeNull();
    expect(cancelled.data).toEqual({ id: eventId, is_cancelled: true });

    const cancelledMemberView = await fixture.memberA.client.from("events")
      .select("id, title, is_cancelled").eq("id", eventId).single();
    expect(cancelledMemberView.error).toBeNull();
    expect(cancelledMemberView.data).toEqual({
      id: eventId,
      title: "Synthetic Updated Training",
      is_cancelled: true,
    });

    const persistedAttendance = await service.from("rsvps")
      .select("status").eq("id", attendance.data!.id).single();
    expect(persistedAttendance.data?.status).toBe("maybe");
  });
});
