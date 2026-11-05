import { describe, expect, it, vi, beforeEach } from "vitest";

const actor = {
  list_team_class_schedules: vi.fn(),
  set_team_class_schedule: vi.fn(),
};
vi.mock("../domains", () => ({ connectLiveClubDomain: vi.fn(async () => ({ actor })) }));

import { listLiveTeamClassSchedules, setLiveTeamClassSchedule } from "./club";

const ctx = { target: {}, identity: {} } as any;

describe("team class schedules", () => {
  beforeEach(() => { actor.list_team_class_schedules.mockReset(); actor.set_team_class_schedule.mockReset(); });

  it("reads a schedule by team id", async () => {
    actor.list_team_class_schedules.mockResolvedValue({ Ok: [
      { team_id: "t1", day: "Monday", time: ["16:30"], duration_minutes: [45n], capacity: [] },
    ] });
    const m = await listLiveTeamClassSchedules(ctx, "c1");
    expect(m.get("t1")).toEqual({ day: "Monday", time: "16:30", durationMinutes: 45, capacity: null });
  });

  it("clears the schedule when no day is chosen", async () => {
    actor.set_team_class_schedule.mockResolvedValue({ Ok: null });
    await setLiveTeamClassSchedule(ctx, "t1", { day: null, time: "16:30", durationMinutes: 45, capacity: 10 });
    expect(actor.set_team_class_schedule).toHaveBeenCalledWith("t1", []);
  });
});
