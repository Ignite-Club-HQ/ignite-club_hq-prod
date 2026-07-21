import { beforeEach, describe, expect, it, vi } from "vitest";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));

import {
  getQueuedRsvpCount,
  getQueuedRsvps,
  getQueuedRsvpsForEvent,
  queueRsvp,
  syncQueuedRsvps,
} from "./rsvpQueue";

function updateResult(error: unknown = null) {
  const chain = {
    update: vi.fn(),
    eq: vi.fn(),
  };
  chain.update.mockReturnValue(chain);
  chain.eq.mockResolvedValue({ error });
  return chain;
}

function insertResult(error: unknown = null) {
  return { insert: vi.fn().mockResolvedValue({ error }) };
}

describe("offline RSVP queue", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("keeps only the latest pending response for the same attendee and event", () => {
    queueRsvp({ eventId: "event-1", userId: "user-1", status: "maybe" });
    queueRsvp({ eventId: "event-1", userId: "user-1", status: "going", notes: "Running late" });

    expect(getQueuedRsvps()).toEqual([
      expect.objectContaining({
        eventId: "event-1",
        userId: "user-1",
        status: "going",
        notes: "Running late",
        retryCount: 0,
      }),
    ]);
    expect(getQueuedRsvpCount()).toBe(1);
  });

  it("does not merge separate child, player, self, event, or user responses", () => {
    queueRsvp({ eventId: "event-1", userId: "parent-1", status: "going" });
    queueRsvp({ eventId: "event-1", userId: "parent-1", childId: "child-1", status: "going" });
    queueRsvp({ eventId: "event-1", userId: "parent-1", miniLeaguePlayerId: "player-1", status: "maybe" });
    queueRsvp({ eventId: "event-2", userId: "parent-1", status: "not_going" });
    queueRsvp({ eventId: "event-1", userId: "user-2", status: "going" });

    expect(getQueuedRsvpCount()).toBe(5);
    expect(getQueuedRsvpsForEvent("event-1")).toHaveLength(4);
  });

  it("updates an existing RSVP and removes it from the queue after success", async () => {
    const query = updateResult();
    from.mockReturnValueOnce(query);
    queueRsvp({
      eventId: "event-1",
      userId: "user-1",
      existingRsvpId: "rsvp-1",
      status: "not_going",
      notes: "Injured",
    });

    await expect(syncQueuedRsvps()).resolves.toEqual({ synced: 1, failed: 0 });
    expect(from).toHaveBeenCalledWith("rsvps");
    expect(query.update).toHaveBeenCalledWith({ status: "not_going", notes: "Injured", source: "user" });
    expect(query.eq).toHaveBeenCalledWith("id", "rsvp-1");
    expect(getQueuedRsvpCount()).toBe(0);
  });

  it("inserts when the cached existing RSVP no longer exists", async () => {
    const update = updateResult({ code: "PGRST116" });
    const insert = insertResult();
    from.mockReturnValueOnce(update).mockReturnValueOnce(insert);
    queueRsvp({ eventId: "event-1", userId: "parent-1", childId: "child-1", existingRsvpId: "missing", status: "going" });

    await expect(syncQueuedRsvps()).resolves.toEqual({ synced: 1, failed: 0 });
    expect(insert.insert).toHaveBeenCalledWith({
      event_id: "event-1",
      user_id: "parent-1",
      child_id: "child-1",
      mini_league_player_id: null,
      status: "going",
      notes: null,
      source: "user",
    });
  });

  it("retains transient failures for two retries, then drops and reports the third failure", async () => {
    queueRsvp({ eventId: "event-1", userId: "user-1", status: "going" });
    from.mockImplementation(() => insertResult({ message: "offline" }));

    await expect(syncQueuedRsvps()).resolves.toEqual({ synced: 0, failed: 0 });
    expect(getQueuedRsvps()[0].retryCount).toBe(1);
    await expect(syncQueuedRsvps()).resolves.toEqual({ synced: 0, failed: 0 });
    expect(getQueuedRsvps()[0].retryCount).toBe(2);
    await expect(syncQueuedRsvps()).resolves.toEqual({ synced: 0, failed: 1 });
    expect(getQueuedRsvpCount()).toBe(0);
  });

  it("syncs successful entries while retaining a failed entry", async () => {
    queueRsvp({ eventId: "event-1", userId: "user-1", status: "going" });
    queueRsvp({ eventId: "event-2", userId: "user-2", status: "maybe" });
    from
      .mockReturnValueOnce(insertResult())
      .mockReturnValueOnce(insertResult({ message: "offline" }));

    await expect(syncQueuedRsvps()).resolves.toEqual({ synced: 1, failed: 0 });
    expect(getQueuedRsvps()).toEqual([
      expect.objectContaining({ eventId: "event-2", userId: "user-2", retryCount: 1 }),
    ]);
  });

  it("treats malformed persisted data as an empty queue", () => {
    localStorage.setItem("ignite_rsvp_queue", "not-json");
    expect(getQueuedRsvps()).toEqual([]);
  });

  it("treats valid JSON with an invalid non-array shape as an empty queue", () => {
    localStorage.setItem("ignite_rsvp_queue", JSON.stringify({ eventId: "event-1" }));

    expect(getQueuedRsvps()).toEqual([]);
    expect(getQueuedRsvpCount()).toBe(0);
  });

  it("does not issue mutations when the queue is empty", async () => {
    await expect(syncQueuedRsvps()).resolves.toEqual({ synced: 0, failed: 0 });
    expect(from).not.toHaveBeenCalled();
  });

  it("counts an update-then-insert failure as one retry rather than two", async () => {
    from
      .mockReturnValueOnce(updateResult({ code: "PGRST116" }))
      .mockReturnValueOnce(insertResult({ message: "still offline" }));
    queueRsvp({
      eventId: "event-1",
      userId: "user-1",
      existingRsvpId: "deleted-rsvp",
      status: "going",
    });

    await expect(syncQueuedRsvps()).resolves.toEqual({ synced: 0, failed: 0 });
    expect(getQueuedRsvps()).toEqual([
      expect.objectContaining({ retryCount: 1 }),
    ]);
  });

  it("preserves a new RSVP queued while an earlier background sync is in flight", async () => {
    let release!: (value: { error: null }) => void;
    const pendingInsert = {
      insert: vi.fn(
        () => new Promise<{ error: null }>((resolve) => { release = resolve; }),
      ),
    };
    from.mockReturnValueOnce(pendingInsert);
    queueRsvp({ eventId: "event-1", userId: "user-1", status: "going" });

    const syncing = syncQueuedRsvps();
    await vi.waitFor(() => expect(pendingInsert.insert).toHaveBeenCalledOnce());
    queueRsvp({ eventId: "event-2", userId: "user-2", status: "maybe" });
    release({ error: null });
    await syncing;

    expect(getQueuedRsvps()).toEqual([
      expect.objectContaining({ eventId: "event-2", userId: "user-2" }),
    ]);
  });
});
