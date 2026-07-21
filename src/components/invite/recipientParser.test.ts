import { describe, it, expect } from "vitest";
import { parseRecipients, looksLikeMultiRecipient } from "./recipientParser";

describe("recipientParser — supported formats", () => {
  it("parses a bare email", () => {
    expect(parseRecipients("alice@example.com")).toEqual([{ name: "alice", email: "alice@example.com" }]);
  });

  it("parses name-only", () => {
    expect(parseRecipients("Alice Smith")).toEqual([{ name: "Alice Smith", email: "" }]);
  });

  it("parses Name <email>", () => {
    expect(parseRecipients("Alice Smith <alice@example.com>")).toEqual([
      { name: "Alice Smith", email: "alice@example.com" },
    ]);
  });

  it("parses `Name, email` as one entry when it's the only recipient", () => {
    expect(parseRecipients("Alice Smith, alice@example.com")).toEqual([
      { name: "Alice Smith", email: "alice@example.com" },
    ]);
  });

  it("splits on newline / tab / semicolon", () => {
    expect(parseRecipients("a@x.io\nb@x.io\tc@x.io;d@x.io")).toEqual([
      { name: "a", email: "a@x.io" },
      { name: "b", email: "b@x.io" },
      { name: "c", email: "c@x.io" },
      { name: "d", email: "d@x.io" },
    ]);
  });

  it("splits on commas when multiple emails are present", () => {
    expect(parseRecipients("a@x.io, b@x.io")).toEqual([
      { name: "a", email: "a@x.io" },
      { name: "b", email: "b@x.io" },
    ]);
  });

  it("dedupes case-insensitively", () => {
    expect(parseRecipients("A@X.io\na@x.io")).toEqual([{ name: "A", email: "A@X.io" }]);
  });
});

describe("recipientParser — hardened rejections", () => {
  it("rejects `Alex <alex@example.test extra>` (extra tokens in bracket body)", () => {
    expect(parseRecipients("Alex <alex@example.test extra>")).toEqual([]);
  });

  it("rejects `Alex <alex@example.test><evil@example.test>` (multiple brackets)", () => {
    expect(parseRecipients("Alex <alex@example.test><evil@example.test>")).toEqual([]);
  });

  it("rejects unmatched opening bracket", () => {
    expect(parseRecipients("Alex <alex@example.test")).toEqual([]);
  });

  it("rejects unmatched closing bracket", () => {
    expect(parseRecipients("Alex alex@example.test>")).toEqual([]);
  });

  it("rejects nested brackets", () => {
    expect(parseRecipients("Alex <<alex@example.test>>")).toEqual([]);
  });

  it("rejects content after the closing bracket", () => {
    expect(parseRecipients("Alex <alex@example.test> hack@evil.test")).toEqual([]);
  });

  it("rejects a name-only entry that contains @-noise", () => {
    expect(parseRecipients("Alex @broken")).toEqual([]);
  });

  it("rejects an ambiguous un-splittable entry containing two emails", () => {
    // No list separators (comma/semicolon/newline/tab) → one entry with two
    // emails. Ambiguous — must be rejected so we never silently graft the
    // name onto an attacker-controlled second address.
    expect(parseRecipients("Alex alice@x.io evil@x.io")).toEqual([]);
  });
});

describe("looksLikeMultiRecipient", () => {
  it("returns true for newline-separated pairs", () => {
    expect(looksLikeMultiRecipient("a@x.io\nb@x.io")).toBe(true);
  });
  it("returns true for two bare emails", () => {
    expect(looksLikeMultiRecipient("a@x.io, b@x.io")).toBe(true);
  });
  it("returns false for a single Name <email>", () => {
    expect(looksLikeMultiRecipient("Alice <a@x.io>")).toBe(false);
  });
});
