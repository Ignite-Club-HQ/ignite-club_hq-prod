import { describe, it, expect } from "vitest";
import { parseReviewScore, prepareScoreRecords } from "./scoreReviewInput";
describe("manual score review", () => {
  it("preserves zero separately from missing", () => { expect(parseReviewScore("0")).toBe(0); expect(parseReviewScore("")).toBeNull(); });
  it("rejects fractional and negative scores", () => { expect(() => parseReviewScore("1.5")).toThrow(); expect(() => parseReviewScore("-1")).toThrow(); });
  it("requires at least two copies", () => { expect(() => prepareScoreRecords([])).toThrow(); });
});