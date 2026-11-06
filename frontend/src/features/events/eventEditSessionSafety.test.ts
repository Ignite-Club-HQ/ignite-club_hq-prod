import { beforeEach, describe, expect, it, vi } from "vitest";
import { IcpSessionRequiredError } from "@/live/icpSessionErrors";

/**
 * Edit-event saves with a valid and an expired Internet Identity session, for
 * ordinary, game (duty team + duties), recurring-series and
 * recurring-conversion edits. An expired session must fail before any
 * canister write; a valid one writes each thing exactly once.
 */

const m = vi.hoisted(() => ({
  sessionValid: true,
  calls: [] as string[],
}));

vi.mock("@/live/featureRouter", async () => {
  const { IcpSessionRequiredError: E } = await import("@/live/icpSessionErrors");
  return {
    withFeatureBackend: async (_f: string, providers: { icp: (ctx: unknown) => unknown }) => {
      // Mirrors featureRouter: the identity is checked before any call is sent.
      if (!m.sessionValid) throw new E();
      return providers.icp({ identity: {}, target: { alias: "test" } });
    },
  };
});
vi.mock("@/live/features/events", () => ({
  createLiveOpenDuty: vi.fn(async () => { m.calls.push("open_duty"); }),
  createLiveRecurringEventSeries: vi.fn(async () => { m.calls.push("create_series"); return { events: [1, 2, 3] }; }),
  getLiveEventsSnapshot: vi.fn(async () => ({
    events: [{ id: "e1", series_id: ["s1"], starts_at_ms: 2_000_000_000_000n, deleted: false }],
    series: [{ id: "s1", title: "T", description: "", event_type: "training", location: [] }],
  })),
  setLiveEventDuty: vi.fn(async () => { m.calls.push("set_duty"); }),
  updateLiveEvent: vi.fn(async () => { m.calls.push("update_event"); }),
  updateLiveEventSeries: vi.fn(async () => { m.calls.push("update_series"); }),
  setLiveEventDutyTeam: vi.fn(async () => { m.calls.push("duty_team"); }),
  setLiveEventAutoReminder: vi.fn(async () => { m.calls.push("reminder"); }),
}));

import { convertEventToRecurringSeries, syncEventDuties, updateEventTransaction } from "./editEventWorkflow";
import { classifyEventSaveFailure, uncertainSaveBlocksResubmit } from "./eventSaveOutcome";

const base = {
  eventId: "e1",
  selectedEventDate: "2033-05-18T03:33:20.000Z",
  selectedStartTime: "2033-05-18T03:33:20.000Z",
  selectedEndTime: "2033-05-18T04:33:20.000Z",
};

beforeEach(() => {
  m.sessionValid = true;
  m.calls = [];
});

describe("edit event — valid session", () => {
  it("ordinary edit writes the event once, then the reminder, after confirming the main write", async () => {
    const order: string[] = [];
    await updateEventTransaction({}, {
      ...base, updateSeries: false, updates: { title: "New", type: "training", reminder_hours_before: 24 },
      onMainCommitted: () => order.push(`committed after ${m.calls.join(",")}`),
    });
    expect(m.calls).toEqual(["update_event", "reminder"]);
    expect(order).toEqual(["committed after update_event"]);
  });

  it("game edit writes event, duty team and each duty exactly once", async () => {
    await updateEventTransaction({}, { ...base, updateSeries: false, updates: { title: "Final", type: "game", duty_team_id: "t2" } });
    await syncEventDuties({}, "e1", [], [{ name: "BBQ", assignedTo: "acc-1" }, { name: "Gate", assignedTo: null }]);
    expect(m.calls).toEqual(["update_event", "duty_team", "set_duty", "open_duty"]);
  });

  it("recurring series edit updates the series once", async () => {
    await updateEventTransaction({}, { ...base, updateSeries: true, updates: { title: "Weekly" } });
    expect(m.calls).toEqual(["update_series"]);
  });

  it("recurring conversion creates the series exactly once", async () => {
    const n = await convertEventToRecurringSeries({}, {
      eventId: "e1", updates: { club_id: "c1", title: "Train" }, selectedDate: new Date(base.selectedEventDate),
      selectedStartTime: base.selectedStartTime, selectedEndTime: base.selectedEndTime,
      occurrenceDates: [], recurrenceEndDate: "2033-07-01", frequency: "weekly",
    });
    expect(n).toBe(3);
    expect(m.calls).toEqual(["create_series"]);
  });
});

describe("edit event — expired session", () => {
  beforeEach(() => { m.sessionValid = false; });

  it.each([
    ["ordinary", () => updateEventTransaction({}, { ...base, updateSeries: false, updates: { title: "x" } })],
    ["game", () => updateEventTransaction({}, { ...base, updateSeries: false, updates: { type: "game", duty_team_id: "t2" } })],
    ["recurring series", () => updateEventTransaction({}, { ...base, updateSeries: true, updates: { title: "x" } })],
    ["recurring conversion", () => convertEventToRecurringSeries({}, {
      eventId: "e1", updates: { club_id: "c1" }, selectedDate: new Date(base.selectedEventDate),
      selectedStartTime: null, selectedEndTime: null, occurrenceDates: [], recurrenceEndDate: "2033-07-01", frequency: "weekly",
    })],
  ])("%s edit sends nothing and reports a sign-in-needed failure", async (_label, run) => {
    const error = await run().then(() => null, (e) => e);
    expect(error).toBeInstanceOf(IcpSessionRequiredError);
    expect(classifyEventSaveFailure(error)).toBe("session_before_send");
    expect(m.calls).toEqual([]);
  });
});

describe("uncertain outcomes are never auto-retried", () => {
  it("a dropped connection is uncertain, a refusal is not", () => {
    expect(classifyEventSaveFailure(new Error("Request timed out after 300000 msec"))).toBe("uncertain");
    expect(classifyEventSaveFailure(new TypeError("Failed to fetch"))).toBe("uncertain");
    expect(classifyEventSaveFailure(new Error("Not authorised to edit this event"))).toBe("rejected");
  });

  it("blocks re-submitting an uncertain recurring conversion only", () => {
    expect(uncertainSaveBlocksResubmit("uncertain", "main_update", true)).toBe(true);
    expect(uncertainSaveBlocksResubmit("uncertain", "main_update", false)).toBe(false);
    expect(uncertainSaveBlocksResubmit("rejected", "main_update", true)).toBe(false);
  });
});
