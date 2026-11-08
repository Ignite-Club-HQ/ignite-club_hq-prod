import { beforeEach, describe, expect, it } from "vitest";
import { clearEventEditDraft, EVENT_EDIT_DRAFT_MAX_AGE_MS, eventEditDraftKey, loadEventEditDraft, saveEventEditDraft } from "./eventEditDraft";
import { eventEditSample } from "@/lib/eventEditTrace";

beforeEach(() => sessionStorage.clear());

describe("unsaved edit-event drafts", () => {
  it("come back for the same account and event after a sign-in round trip", () => {
    saveEventEditDraft("acc-a", "ev-1", { title: "Grand final" });
    expect(loadEventEditDraft("acc-a", "ev-1")).toEqual({ title: "Grand final" });
  });

  it("are never offered to a different account or event", () => {
    saveEventEditDraft("acc-a", "ev-1", { title: "Grand final" });
    expect(loadEventEditDraft("acc-b", "ev-1")).toBeNull();
    expect(loadEventEditDraft("acc-a", "ev-2")).toBeNull();
  });

  it("use the ignite_ prefix so sign-out sweeps them", () => {
    expect(eventEditDraftKey("acc-a", "ev-1").startsWith("ignite_")).toBe(true);
  });

  it("expire after 12 hours and are cleared after saving", () => {
    saveEventEditDraft("acc-a", "ev-1", { title: "x" }, 0);
    expect(loadEventEditDraft("acc-a", "ev-1", EVENT_EDIT_DRAFT_MAX_AGE_MS + 1)).toBeNull();
    saveEventEditDraft("acc-a", "ev-1", { title: "x" });
    clearEventEditDraft("acc-a", "ev-1");
    expect(loadEventEditDraft("acc-a", "ev-1")).toBeNull();
  });
});

describe("event edit timing samples", () => {
  it("report each stage under its own surface with no event details", () => {
    expect(eventEditSample("main_update", "game", 812.4, "android")).toEqual({
      surface: "event_edit:main_update", source: "game", duration_ms: 812, cache_hit: false, platform: "android",
    });
    expect(eventEditSample("save_start", "ordinary", -1, "web")).toBeNull();
  });
});
