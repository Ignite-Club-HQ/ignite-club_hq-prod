import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import {
  assertSyntheticLocalMarker,
  createSecurityFixture,
  createSyntheticUser,
  service,
  type SecurityFixture,
  type SyntheticUser,
} from "./fixtures";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function subscribe(channel: RealtimeChannel) {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Realtime subscription timed out")), 5_000);
    channel.subscribe((status, error) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timer);
        resolve();
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timer);
        reject(error ?? new Error(`Realtime subscription failed: ${status}`));
      }
    });
  });
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}

async function expectEvent(promise: Promise<unknown>, waitMs = 5_000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Expected Realtime event was not delivered within ${waitMs}ms`)),
      waitMs,
    );
  });
  try {
    await expect(Promise.race([promise, timeout])).resolves.toBeUndefined();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function expectEventWithColdStartRetry(
  promise: Promise<unknown>,
  mutate: (attempt: number) => Promise<void>,
) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await mutate(attempt);
    try {
      await expectEvent(promise);
      return;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
}

async function expectNoEvent(promise: Promise<unknown>, waitMs = 500) {
  const sentinel = Symbol("no-event");
  const result = await Promise.race([
    promise,
    new Promise<typeof sentinel>((resolve) => setTimeout(() => resolve(sentinel), waitMs)),
  ]);
  expect(result).toBe(sentinel);
}

function eventChannel(client: SupabaseClient, eventId: string, onEvent: () => void) {
  return client.channel(`guardian-journey-${crypto.randomUUID()}`).on(
    "postgres_changes",
    { event: "UPDATE", schema: "public", table: "events", filter: `id=eq.${eventId}` },
    onEvent,
  );
}

describe("local journey: guardian invitation, access and removal", () => {
  let fixture: SecurityFixture;
  let invitee: SyntheticUser;
  let secondGuardian: SyntheticUser;
  const channels: Array<{ client: SupabaseClient; channel: RealtimeChannel }> = [];

  beforeAll(async () => {
    await assertSyntheticLocalMarker();
    fixture = await createSecurityFixture();
    invitee = await createSyntheticUser("guardian-invitee");
    secondGuardian = await createSyntheticUser("second-guardian");
  });

  afterAll(async () => {
    await Promise.all(channels.map(({ client, channel }) => client.removeChannel(channel)));
    await fixture?.cleanup();
    if (invitee?.id) await service.auth.admin.deleteUser(invitee.id);
    if (secondGuardian?.id) await service.auth.admin.deleteUser(secondGuardian.id);
  });

  it("grants exact access atomically, then removes database and Realtime access", async () => {
    const events = await service.from("events").insert([
      {
        club_id: fixture.clubA,
        team_id: fixture.teamA,
        created_by: fixture.adminA.id,
        title: "Synthetic Invited Team Event",
        type: "training",
        event_date: "2099-02-01T10:00:00.000Z",
      },
      {
        club_id: fixture.clubB,
        team_id: fixture.teamB,
        created_by: fixture.outsiderB.id,
        title: "Synthetic Other Club Event",
        type: "training",
        event_date: "2099-02-02T10:00:00.000Z",
      },
    ]).select("id, club_id");
    expect(events.error).toBeNull();
    const eventA = events.data!.find((row) => row.club_id === fixture.clubA)!.id;
    const eventB = events.data!.find((row) => row.club_id === fixture.clubB)!.id;

    const beforeAcceptance = await invitee.client.from("events").select("id").eq("id", eventA);
    expect(beforeAcceptance.error).toBeNull();
    expect(beforeAcceptance.data).toEqual([]);

    const invitation = await service.from("pending_invites").insert({
      role: "parent",
      invited_by_user_id: fixture.adminA.id,
      invited_user_id: invitee.id,
      club_id: fixture.clubA,
      team_id: fixture.teamA,
      invite_token: crypto.randomUUID(),
      metadata: { guardian_child_id: fixture.childA },
    }).select("id").single();
    expect(invitation.error).toBeNull();

    const accepted = await invitee.client.rpc("accept_guardian_invite", {
      _invite_id: invitation.data!.id,
      _child_id: fixture.childA,
    });
    expect(accepted.error).toBeNull();

    const [acceptedInvite, roles, guardians, visibleEvent, crossClubEvent] = await Promise.all([
      service.from("pending_invites").select("status, accepted_at").eq("id", invitation.data!.id).single(),
      service.from("user_roles").select("id, role, club_id, team_id")
        .eq("user_id", invitee.id).eq("role", "parent").eq("team_id", fixture.teamA),
      service.from("child_guardians").select("id")
        .eq("child_id", fixture.childA).eq("guardian_id", invitee.id),
      invitee.client.from("events").select("id").eq("id", eventA),
      invitee.client.from("events").select("id").eq("id", eventB),
    ]);
    expect(acceptedInvite.data?.status).toBe("accepted");
    expect(acceptedInvite.data?.accepted_at).toBeTruthy();
    expect(roles.data).toEqual([expect.objectContaining({
      role: "parent", club_id: fixture.clubA, team_id: fixture.teamA,
    })]);
    expect(guardians.data).toHaveLength(1);
    expect(visibleEvent.data).toEqual([{ id: eventA }]);
    expect(crossClubEvent.data).toEqual([]);

    const repeatedAcceptance = await invitee.client.rpc("accept_guardian_invite", {
      _invite_id: invitation.data!.id,
      _child_id: fixture.childA,
    });
    expect(repeatedAcceptance.error).not.toBeNull();
    const rolesAfterRetry = await service.from("user_roles").select("id")
      .eq("user_id", invitee.id).eq("role", "parent").eq("team_id", fixture.teamA);
    expect(rolesAfterRetry.data).toHaveLength(1);

    const secondInvitation = await service.from("pending_invites").insert({
      role: "parent",
      invited_by_user_id: fixture.adminA.id,
      invited_user_id: secondGuardian.id,
      club_id: fixture.clubA,
      team_id: fixture.teamA,
      invite_token: crypto.randomUUID(),
      metadata: { guardian_child_id: fixture.childA },
    }).select("id").single();
    expect(secondInvitation.error).toBeNull();
    const secondAccepted = await secondGuardian.client.rpc("accept_guardian_invite", {
      _invite_id: secondInvitation.data!.id,
      _child_id: fixture.childA,
    });
    expect(secondAccepted.error).toBeNull();

    const removed = await fixture.adminA.client.rpc("remove_team_member", {
      _team_id: fixture.teamA,
      _user_id: invitee.id,
    });
    expect(removed.error).toBeNull();
    expect(removed.data).toEqual(expect.objectContaining({ roles_removed: 1, exclusion_added: true }));

    const [noLongerVisible, deniedWrite, secondStillVisible, assignmentAfterFirstRemoval] = await Promise.all([
      invitee.client.from("events").select("id").eq("id", eventA),
      invitee.client.from("rsvps").insert({ event_id: eventA, user_id: invitee.id, status: "going" }),
      secondGuardian.client.from("events").select("id").eq("id", eventA),
      service.from("child_team_assignments").select("id")
        .eq("child_id", fixture.childA).eq("team_id", fixture.teamA),
    ]);
    expect(noLongerVisible.error).toBeNull();
    expect(noLongerVisible.data).toEqual([]);
    expect(deniedWrite.error).not.toBeNull();
    expect(secondStillVisible.data).toEqual([{ id: eventA }]);
    expect(assignmentAfterFirstRemoval.data).toHaveLength(1);

    const refreshed = await invitee.client.auth.refreshSession();
    expect(refreshed.error).toBeNull();
    const controlReceived = deferred<void>();
    const removedMemberReceived = deferred<void>();
    const controlChannel = eventChannel(fixture.adminA.client, eventA, () => controlReceived.resolve());
    const removedMemberChannel = eventChannel(invitee.client, eventA, () => removedMemberReceived.resolve());
    channels.push(
      { client: fixture.adminA.client, channel: controlChannel },
      { client: invitee.client, channel: removedMemberChannel },
    );
    await Promise.all([subscribe(controlChannel), subscribe(removedMemberChannel)]);

    await expectEventWithColdStartRetry(controlReceived.promise, async (attempt) => {
      const update = await service.from("events")
        .update({ description: `after guardian removal ${attempt}` }).eq("id", eventA);
      expect(update.error).toBeNull();
    });
    await expectNoEvent(removedMemberReceived.promise);

    const secondRemoval = await fixture.adminA.client.rpc("remove_team_member", {
      _team_id: fixture.teamA,
      _user_id: secondGuardian.id,
    });
    expect(secondRemoval.error).toBeNull();
    expect(secondRemoval.data).toEqual(expect.objectContaining({ roles_removed: 1, exclusion_added: true }));

    const [secondNoLongerVisible, assignmentAfterBothRemovals, guardianLinksRemain] = await Promise.all([
      secondGuardian.client.from("events").select("id").eq("id", eventA),
      service.from("child_team_assignments").select("id")
        .eq("child_id", fixture.childA).eq("team_id", fixture.teamA),
      service.from("child_guardians").select("guardian_id")
        .eq("child_id", fixture.childA).in("guardian_id", [invitee.id, secondGuardian.id]),
    ]);
    expect(secondNoLongerVisible.data).toEqual([]);
    expect(assignmentAfterBothRemovals.data).toHaveLength(1);
    expect(guardianLinksRemain.data).toHaveLength(2);

    const repeatedRemoval = await fixture.adminA.client.rpc("remove_team_member", {
      _team_id: fixture.teamA,
      _user_id: invitee.id,
    });
    expect(repeatedRemoval.error).toBeNull();
    expect(repeatedRemoval.data).toEqual(expect.objectContaining({ roles_removed: 0, exclusion_added: false }));
  });
});
