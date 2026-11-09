import { describe, expect, it } from "vitest";
import { dropRowsBehindGap } from "./chatWindowGap";

const r = (id: string, t: number) => ({ id, created_at: new Date(t * 1000).toISOString() });

describe("dropRowsBehindGap", () => {
  it("drops saved rows older than a full new page with no overlap", () => {
    const prev = [r("a", 1), r("b", 2), r("temp-1", 3)];
    expect(dropRowsBehindGap(prev, [r("x", 50), r("y", 51)], true).map((m) => m.id)).toEqual(["temp-1"]);
  });
  it("keeps rows when the windows overlap", () => {
    const prev = [r("a", 1), r("x", 50)];
    expect(dropRowsBehindGap(prev, [r("x", 50), r("y", 51)], true)).toHaveLength(2);
  });
  it("keeps rows when the new page reaches the start of the chat", () => {
    const prev = [r("a", 1)];
    expect(dropRowsBehindGap(prev, [r("x", 50)], false)).toHaveLength(1);
  });
});
