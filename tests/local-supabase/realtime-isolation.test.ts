import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { assertSyntheticLocalMarker, createSecurityFixture, service, type SecurityFixture } from "./fixtures";

const realtimeEnabled = process.env.LOCAL_SUPABASE_REALTIME_ENABLED === "true";
const realtimeDescribe = realtimeEnabled ? describe : describe.skip;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function subscribe(channel: RealtimeChannel) {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Realtime subscription timed out")), 5_000);
    channel.subscribe((status, error) => {
      if (status === "SUBSCRIBED") { clearTimeout(timer); resolve(); }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timer);
        const detail = error instanceof Error ? ` (${error.message})` : error ? ` (${String(error)})` : "";
        reject(new Error(`Realtime subscription failed: ${status}${detail}`));
      }
    });
  });
  // A freshly provisioned local Realtime tenant can report SUBSCRIBED just
  // before its Postgres replication listener is ready to deliver the first
  // change. Allow that listener to settle; authorization is still exercised
  // by every subsequent database mutation and delivery assertion.
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}

async function expectEvent(promise: Promise<unknown>, waitMs = 5_000) {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Expected Realtime event was not delivered within ${waitMs}ms`)), waitMs);
  });
  await expect(Promise.race([promise, timeout])).resolves.toBeUndefined();
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

async function expectNoEvent(promise: Promise<unknown>, waitMs = 350) {
  const sentinel = Symbol("no-event");
  const outcome = await Promise.race([
    promise,
    new Promise<typeof sentinel>((resolve) => setTimeout(() => resolve(sentinel), waitMs)),
  ]);
  expect(outcome).toBe(sentinel);
}

function eventUpdateChannel(client: SupabaseClient, name: string, eventId: string, onEvent: () => void) {
  return client.channel(name).on(
    "postgres_changes",
    { event: "UPDATE", schema: "public", table: "events", filter: `id=eq.${eventId}` },
    onEvent,
  );
}

realtimeDescribe("local Realtime RLS and lifecycle isolation", () => {
  let fixture: SecurityFixture;
  let eventA: string;
  let teamMessageA: string;
  const channels: Array<{ client: SupabaseClient; channel: RealtimeChannel }> = [];

  beforeAll(async () => {
    await assertSyntheticLocalMarker();
    fixture = await createSecurityFixture();
    const event = await service.from("events").insert({
      club_id: fixture.clubA,
      team_id: fixture.teamA,
      created_by: fixture.adminA.id,
      title: "Synthetic Realtime Event",
      type: "training",
      event_date: "2099-01-01T10:00:00.000Z",
    }).select("id").single();
    if (event.error) throw event.error;
    eventA = event.data.id;
    const message = await service.from("team_messages").insert({
      team_id: fixture.teamA,
      author_id: fixture.adminA.id,
      text: "Synthetic mounted realtime message",
    }).select("id").single();
    if (message.error) throw message.error;
    teamMessageA = message.data.id;
  });

  afterAll(async () => {
    await Promise.all(channels.map(({ client, channel }) => client.removeChannel(channel)));
    await fixture?.cleanup();
  });

  function track(client: SupabaseClient, channel: RealtimeChannel) {
    channels.push({ client, channel });
    return channel;
  }

  it("delivers an event change to an authorized member", async () => {
    const received = deferred<void>();
    const channel = track(fixture.memberA.client, eventUpdateChannel(
      fixture.memberA.client, `authorized-${crypto.randomUUID()}`, eventA, () => received.resolve(),
    ));
    await subscribe(channel);
    await expectEventWithColdStartRetry(received.promise, async (attempt) => {
      const updated = await service.from("events")
        .update({ description: `authorized delivery ${attempt}` }).eq("id", eventA);
      expect(updated.error).toBeNull();
    });
  });

  it("does not deliver another club's change to an unauthorized subscriber", async () => {
    const authorized = deferred<void>();
    const unauthorized = deferred<any>();
    const allowedChannel = track(fixture.adminA.client, eventUpdateChannel(
      fixture.adminA.client, `positive-control-${crypto.randomUUID()}`, eventA, () => authorized.resolve(),
    ));
    const deniedChannel = track(fixture.outsiderB.client, eventUpdateChannel(
      fixture.outsiderB.client, `cross-club-denied-${crypto.randomUUID()}`, eventA, () => unauthorized.resolve(),
    ));
    await Promise.all([subscribe(allowedChannel), subscribe(deniedChannel)]);
    const updated = await service.from("events").update({ description: "cross-club isolation" }).eq("id", eventA);
    expect(updated.error).toBeNull();
    await expectEvent(authorized.promise);
    await expectNoEvent(unauthorized.promise);
  });

  it("honours the exact row filter", async () => {
    const received = deferred<void>();
    const channel = track(fixture.memberA.client, eventUpdateChannel(
      fixture.memberA.client, `exact-filter-${crypto.randomUUID()}`, crypto.randomUUID(), () => received.resolve(),
    ));
    await subscribe(channel);
    await service.from("events").update({ description: "different row" }).eq("id", eventA);
    await expectNoEvent(received.promise);
  });

  it.each(["UPDATE", "DELETE"] as const)("delivers a scoped team-message %s to an authorised chat only", async (event) => {
    const authorized = deferred<void>();
    const unauthorized = deferred<any>();
    const filter = { event, schema: "public", table: "team_messages", filter: `team_id=eq.${fixture.teamA}` } as const;
    const allowedChannel = track(fixture.memberA.client, fixture.memberA.client
      .channel(`message-${event.toLowerCase()}-${crypto.randomUUID()}`)
      .on("postgres_changes", filter, () => authorized.resolve()));
    const deniedChannel = track(fixture.outsiderB.client, fixture.outsiderB.client
      .channel(`message-denied-${event.toLowerCase()}-${crypto.randomUUID()}`)
      .on("postgres_changes", filter, payload => unauthorized.resolve(payload)));
    await Promise.all([subscribe(allowedChannel), subscribe(deniedChannel)]);

    if (event === "UPDATE") {
      expect((await service.from("team_messages").update({ text: "Realtime update" }).eq("id", teamMessageA)).error).toBeNull();
    } else {
      expect((await service.from("team_messages").delete().eq("id", teamMessageA)).error).toBeNull();
    }
    await expectEvent(authorized.promise);

    if (event === "DELETE") {
      // Supabase cannot apply row-level authorization after a row is gone.
      // DELETE broadcasts may therefore reach a filtered subscriber, but RLS
      // must redact the old record to its primary key only.
      const payload = await Promise.race([
        unauthorized.promise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Expected redacted DELETE event")), 5_000)),
      ]);
      expect(Object.keys(payload.old).sort()).toEqual(["id"]);
      const replacement = await service.from("team_messages").insert({
        team_id: fixture.teamA, author_id: fixture.adminA.id, text: "Synthetic replacement",
      }).select("id").single();
      expect(replacement.error).toBeNull();
      teamMessageA = replacement.data!.id;
    } else {
      await expectNoEvent(unauthorized.promise);
    }
  });

  it("delivers reaction add/change/remove only to a member with access to the parent message", async () => {
    const parent = await fixture.memberA.client.from("team_messages").insert({
      team_id: fixture.teamA,
      author_id: fixture.memberA.id,
      text: "Synthetic reaction parent",
    }).select("id").single();
    expect(parent.error).toBeNull();
    const events: string[] = [];
    const unauthorized = deferred<void>();
    const allowedChannel = track(fixture.memberA.client, fixture.memberA.client
      .channel(`reaction-lifecycle-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, payload => {
        events.push(payload.eventType);
      }));
    const deniedChannel = track(fixture.outsiderB.client, fixture.outsiderB.client
      .channel(`reaction-denied-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, payload => unauthorized.resolve(payload)));
    await Promise.all([subscribe(allowedChannel), subscribe(deniedChannel)]);

    const inserted = await fixture.memberA.client.from("message_reactions").insert({
      user_id: fixture.memberA.id,
      team_message_id: parent.data!.id,
      reaction_type: "heart",
    }).select("id").single();
    expect(inserted.error).toBeNull();
    await expect.poll(() => events, { timeout: 5_000 }).toEqual(["INSERT"]);
    expect((await fixture.memberA.client.from("message_reactions").update({ reaction_type: "clap" }).eq("id", inserted.data!.id)).error).toBeNull();
    await expect.poll(() => events, { timeout: 5_000 }).toEqual(["INSERT", "UPDATE"]);
    expect((await fixture.memberA.client.from("message_reactions").delete().eq("id", inserted.data!.id)).error).toBeNull();

    await expect.poll(() => events, { timeout: 5_000 }).toEqual(["INSERT", "UPDATE", "DELETE"]);
    const redacted = await Promise.race([
      unauthorized.promise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Expected redacted reaction DELETE event")), 5_000)),
    ]);
    expect(redacted.eventType).toBe("DELETE");
    expect(Object.keys(redacted.old).sort()).toEqual(["id"]);
  });

  it("removes database row access immediately when membership is revoked", async () => {
    const removed = await service.from("user_roles").delete().eq("user_id", fixture.memberA.id).eq("club_id", fixture.clubA);
    expect(removed.error).toBeNull();
    const noLongerVisible = await fixture.memberA.client.from("events").select("id").eq("id", eventA);
    expect(noLongerVisible.error).toBeNull();
    expect(noLongerVisible.data).toEqual([]);
  });

  it("denies a refreshed new subscription created after access is revoked", async () => {
    const refreshed = await fixture.memberA.client.auth.refreshSession();
    expect(refreshed.error).toBeNull();
    const authorized = deferred<void>();
    const denied = deferred<void>();
    const controlChannel = track(fixture.adminA.client, eventUpdateChannel(
      fixture.adminA.client, `post-revoke-control-${crypto.randomUUID()}`, eventA, () => authorized.resolve(),
    ));
    const deniedChannel = track(fixture.memberA.client, eventUpdateChannel(
      fixture.memberA.client, `post-revoke-member-${crypto.randomUUID()}`, eventA, () => denied.resolve(),
    ));
    await Promise.all([subscribe(controlChannel), subscribe(deniedChannel)]);
    await service.from("events").update({ description: "new channel after revocation" }).eq("id", eventA);
    await expectEvent(authorized.promise);
    await expectNoEvent(denied.promise);
  });

  it("prevents post-revocation delivery when the client explicitly tears down the scoped channel", async () => {
    const restored = await service.from("user_roles").insert({
      user_id: fixture.memberA.id,
      role: "player",
      club_id: fixture.clubA,
      team_id: fixture.teamA,
    });
    expect(restored.error).toBeNull();
    const received = deferred<void>();
    const memberChannel = eventUpdateChannel(
      fixture.memberA.client, `explicit-revoke-teardown-${crypto.randomUUID()}`, eventA, () => received.resolve(),
    );
    await subscribe(memberChannel);
    const removed = await service.from("user_roles").delete()
      .eq("user_id", fixture.memberA.id).eq("club_id", fixture.clubA);
    expect(removed.error).toBeNull();
    expect(await fixture.memberA.client.removeChannel(memberChannel)).toBe("ok");
    await new Promise((resolve) => setTimeout(resolve, 250));
    await service.from("events").update({ description: "after explicit revoke teardown" }).eq("id", eventA);
    await expectNoEvent(received.promise);
  });

  it("delivers nothing after explicit channel removal", async () => {
    const received = deferred<void>();
    let removalConfirmed = false;
    const channel = eventUpdateChannel(
      fixture.adminA.client,
      `removed-${crypto.randomUUID()}`,
      eventA,
      () => { if (removalConfirmed) received.resolve(); },
    );
    await subscribe(channel);
    expect(await fixture.adminA.client.removeChannel(channel)).toBe("ok");
    removalConfirmed = true;
    // removeChannel resolves before the local websocket server has always
    // finished detaching the binding; enforce a short, fixed upper allowance.
    await new Promise((resolve) => setTimeout(resolve, 250));
    await service.from("events").update({ description: "after unsubscribe" }).eq("id", eventA);
    await expectNoEvent(received.promise);
  });
});
