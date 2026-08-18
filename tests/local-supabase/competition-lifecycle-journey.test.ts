import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSyntheticLocalMarker, createSecurityFixture, service, type SecurityFixture } from "./fixtures";

describe("local journey: competition creation, invitation and response", () => {
  let fixture: SecurityFixture;

  beforeAll(async () => {
    await assertSyntheticLocalMarker();
    fixture = await createSecurityFixture();
    const teamAdmin = await service.from("user_roles").insert({
      user_id: fixture.outsiderB.id,
      role: "team_admin",
      club_id: fixture.clubB,
      team_id: fixture.teamB,
    });
    if (teamAdmin.error) throw teamAdmin.error;
  });

  afterAll(async () => fixture?.cleanup());

  it("enforces organiser and invited-team permissions through the lifecycle", async () => {
    const [adminCanOrganise, memberCanOrganise] = await Promise.all([
      fixture.adminA.client.rpc("can_organise_competition", {
        _user_id: fixture.adminA.id,
        _club_id: fixture.clubA,
      }),
      fixture.memberA.client.rpc("can_organise_competition", {
        _user_id: fixture.memberA.id,
        _club_id: fixture.clubA,
      }),
    ]);
    expect(adminCanOrganise.error).toBeNull();
    expect(adminCanOrganise.data).toBe(true);
    expect(memberCanOrganise.data).toBe(false);

    const deniedCreate = await fixture.memberA.client.from("competitions").insert({
      organizer_club_id: fixture.clubA,
      name: "Member must not organise",
      created_by: fixture.memberA.id,
    });
    expect(deniedCreate.error).not.toBeNull();

    const created = await fixture.adminA.client.from("competitions").insert({
      organizer_club_id: fixture.clubA,
      name: "Synthetic Cup",
      created_by: fixture.adminA.id,
      status: "open",
      visibility: "private",
    }).select("id, status").single();
    expect(created.error).toBeNull();
    expect(created.data?.status).toBe("open");
    const competitionId = created.data!.id;

    const hiddenBeforeInvite = await fixture.outsiderB.client.from("competitions")
      .select("id").eq("id", competitionId);
    expect(hiddenBeforeInvite.data).toEqual([]);

    const invitation = await fixture.adminA.client.from("competition_entries").insert({
      competition_id: competitionId,
      team_id: fixture.teamB,
      invited_by: fixture.adminA.id,
    }).select("id, status").single();
    expect(invitation.error).toBeNull();
    expect(invitation.data?.status).toBe("invited");

    const duplicate = await fixture.adminA.client.from("competition_entries").insert({
      competition_id: competitionId,
      team_id: fixture.teamB,
      invited_by: fixture.adminA.id,
    });
    expect(duplicate.error?.code).toBe("23505");

    const visibleAfterInvite = await fixture.outsiderB.client.from("competitions")
      .select("id, name").eq("id", competitionId).single();
    expect(visibleAfterInvite.error).toBeNull();
    expect(visibleAfterInvite.data?.name).toBe("Synthetic Cup");

    const accepted = await fixture.outsiderB.client.from("competition_entries").update({
      status: "accepted",
      responded_by: fixture.outsiderB.id,
      responded_at: "2099-01-01T00:00:00.000Z",
    }).eq("id", invitation.data!.id).select("status, responded_by").single();
    expect(accepted.error).toBeNull();
    expect(accepted.data).toEqual({ status: "accepted", responded_by: fixture.outsiderB.id });

    const invitedTeamCannotActivate = await fixture.outsiderB.client.from("competitions")
      .update({ status: "active" }).eq("id", competitionId).select("id");
    expect(invitedTeamCannotActivate.error).toBeNull();
    expect(invitedTeamCannotActivate.data).toEqual([]);

    const activated = await fixture.adminA.client.from("competitions")
      .update({ status: "active" }).eq("id", competitionId).select("status").single();
    expect(activated.error).toBeNull();
    expect(activated.data?.status).toBe("active");

    const outsiderCannotRemove = await fixture.outsiderB.client.from("competition_entries")
      .delete().eq("id", invitation.data!.id).select("id");
    expect(outsiderCannotRemove.error).toBeNull();
    expect(outsiderCannotRemove.data).toEqual([]);

    const removed = await fixture.adminA.client.from("competition_entries")
      .delete().eq("id", invitation.data!.id).select("id");
    expect(removed.error).toBeNull();
    expect(removed.data).toEqual([{ id: invitation.data!.id }]);

    const hiddenAfterRemoval = await fixture.outsiderB.client.from("competitions")
      .select("id").eq("id", competitionId);
    expect(hiddenAfterRemoval.data).toEqual([]);
  });
});
