import { describe, expect, it } from "vitest";
import { completeValues } from "./inboxPreviewSources";
describe("inbox refresh completeness", () => {
  it("rejects when one club read failed beside a successful one", () => {
    expect(() => completeValues({ values: ["club-ok"], failed: 1 })).toThrow(/incomplete/);
  });
  it("returns rows when every read succeeded", () => {
    expect(completeValues({ values: ["a", "b"], failed: 0 })).toEqual(["a", "b"]);
  });
});
