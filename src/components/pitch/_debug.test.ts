import { describe, it } from "vitest";
import { buildSubWindows } from "./planner/windows";

describe("debug", () => {
  it("compares window outputs", () => {
    const res = buildSubWindows({
      startAbs: 0, endAbs: 2400, halfDurationSeconds: 1200,
      targetIntervalSec: 420, intervalFloorSec: 240,
      noSubBeforeSec: 240, noSubAfterSec: 144,
      halftimeGuardSec: 90, halftimeGuardActive: true,
      forcedTimes: [240, 1056, 1440],
      extraTimes: [1800, 2064],
      forcedBufferSec: 180,
    });
    console.log("WINDOWS:", res);
  });
});
