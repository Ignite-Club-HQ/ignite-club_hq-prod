import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { completeEventCreate, completeEventEdit } from "@/features/events/eventMutationCompletion";

describe("successful event mutation completion", () => {
  it("refreshes create-derived caches before navigating to the new event", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const navigate = vi.fn();
    await completeEventCreate({ queryClient: { invalidateQueries }, navigate, userId: "user-1" }, "event-1");
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["user-memberships-and-events", "user-1"],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["events"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["upcoming-events"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["team-next-event"] });
    expect(invalidateQueries.mock.invocationCallOrder[0]).toBeLessThan(navigate.mock.invocationCallOrder[0]);
    expect(navigate).toHaveBeenCalledWith("/events/event-1");
  });

  it("still navigates after a committed create when cache invalidation fails", async () => {
    const error = new Error("cache unavailable");
    const warn = vi.fn();
    const navigate = vi.fn();
    await completeEventCreate({
      queryClient: { invalidateQueries: vi.fn().mockRejectedValue(error) },
      navigate,
      userId: "user-1",
      warn,
    }, "event-1");
    expect(warn).toHaveBeenCalledWith("Next Up invalidation failed after event creation:", error);
    expect(navigate).toHaveBeenCalledWith("/events/event-1");
  });

  it("refreshes exact event and PitchBoard caches after edit", () => {
    const invalidateQueries = vi.fn();
    const navigate = vi.fn();
    completeEventEdit({ queryClient: { invalidateQueries }, navigate, userId: "user-1" }, "event-1");
    for (const queryKey of [
      ["pitch-linked-event", "event-1"],
      ["team-members-for-pitch"],
      ["pitch-board-going-rsvps", "event-1"],
      ["event", "event-1"],
      ["events"],
      ["upcoming-events"],
      ["team-next-event"],
      ["user-memberships-and-events", "user-1"],
    ]) expect(invalidateQueries).toHaveBeenCalledWith({ queryKey });
    expect(navigate).toHaveBeenCalledWith("/events/event-1");
  });

  it("supports an absent user while still refreshing shared edit caches", () => {
    const invalidateQueries = vi.fn();
    completeEventEdit({ queryClient: { invalidateQueries }, navigate: vi.fn() }, "event-1");
    expect(invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: ["user-memberships-and-events", undefined],
    });
  });
});

describe("event page completion ordering", () => {
  const createSource = readFileSync(resolve(process.cwd(), "src/pages/CreateEventPage.tsx"), "utf8");
  const editSource = readFileSync(resolve(process.cwd(), "src/pages/EditEventPage.tsx"), "utf8");

  it("completes create only after the atomic transaction returns an id", () => {
    expect(createSource.indexOf("await createEventTransaction(supabase, {"))
      .toBeLessThan(createSource.indexOf("await completeEventCreate({"));
    const createCatch = createSource.slice(
      createSource.indexOf("} catch (error: any) {", createSource.indexOf("await completeEventCreate({")),
      createSource.indexOf("} finally {", createSource.indexOf("await completeEventCreate({")),
    );
    expect(createCatch).not.toContain("completeEventCreate");
  });

  it("completes edit only after event and duty writes succeed", () => {
    const completionAt = editSource.indexOf("completeEventEdit({");
    expect(editSource.indexOf("updateEventTransaction(supabase, {")).toBeLessThan(completionAt);
    expect(editSource.indexOf("syncEventDuties(supabase")).toBeLessThan(completionAt);
    const editCatch = editSource.slice(
      editSource.indexOf("} catch (error: any) {", completionAt),
      editSource.indexOf("} finally {", completionAt),
    );
    expect(editCatch).not.toContain("completeEventEdit");
  });
});
