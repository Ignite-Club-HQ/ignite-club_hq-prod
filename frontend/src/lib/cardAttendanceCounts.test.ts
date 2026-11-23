import { describe, it, expect } from "vitest";
import { countCardAttendance } from "./cardAttendanceCounts";

describe("countCardAttendance", () => {
  it("counts adult players on senior games", () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({ account_id: `a${i}`, child_id: null, state: "going" }));
    expect(countCardAttendance(rows, false).going).toBe(6);
  });
  it("does not count a parent who answered for their child", () => {
    const rows = [
      { account_id: "p", child_id: "c1", state: "going" },
      { account_id: "p", child_id: null, state: "going" },
    ];
    expect(countCardAttendance(rows, false).going).toBe(1);
    expect(countCardAttendance(rows, true).going).toBe(2);
  });
});
