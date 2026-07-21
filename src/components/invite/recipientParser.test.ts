import { describe, expect, it } from "vitest";
import { looksLikeMultiRecipient, parseRecipients } from "./recipientParser";

describe("invite recipient parsing", () => {
  it("parses name-only, bare-email and display-name formats", () => {
    expect(parseRecipients("Alex Smith")).toEqual([{ name: "Alex Smith", email: "" }]);
    expect(parseRecipients("alex@example.test")).toEqual([{ name: "alex", email: "alex@example.test" }]);
    expect(parseRecipients("Alex Smith <alex@example.test>")).toEqual([{ name: "Alex Smith", email: "alex@example.test" }]);
  });

  it("treats a single name-comma-email pair as one recipient", () => {
    expect(parseRecipients("Alex Smith, alex@example.test")).toEqual([{ name: "Alex Smith", email: "alex@example.test" }]);
  });

  it("splits pasted newline, tab and semicolon lists", () => {
    expect(parseRecipients("alex@example.test\nSam <sam@example.test>; Taylor\tpat@example.test")).toEqual([
      { name: "alex", email: "alex@example.test" }, { name: "Sam", email: "sam@example.test" },
      { name: "Taylor", email: "" }, { name: "pat", email: "pat@example.test" },
    ]);
  });

  it("deduplicates email and name recipients case-insensitively", () => {
    expect(parseRecipients("Alex@Example.test; alex@example.test; Taylor; TAYLOR")).toEqual([
      { name: "Alex", email: "Alex@Example.test" }, { name: "Taylor", email: "" },
    ]);
  });

  it.each([
    "Alex <alex@example.test extra>", "Alex <alex@example.test><evil@example.test>", "Alex <not-an-email>",
  ])("does not accept malformed angle-bracket email %j", (input) => {
    expect(parseRecipients(input)[0]?.email).toBe("");
  });

  it("detects genuine multi-recipient input without classifying a single pair as a list", () => {
    expect(looksLikeMultiRecipient("alex@example.test; sam@example.test")).toBe(true);
    expect(looksLikeMultiRecipient("Alex Smith, alex@example.test")).toBe(false);
    expect(looksLikeMultiRecipient("Alex Smith")).toBe(false);
  });

  it("returns an empty list for blank input", () => {
    expect(parseRecipients("  ")).toEqual([]);
    expect(looksLikeMultiRecipient("")).toBe(false);
  });
});
