import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/pages/HomePage.tsx"),
  "utf8",
);

function homeRsvpQueryBlock(): string {
  const start = source.indexOf('queryKey: ["user-rsvps-home"');
  const end = source.indexOf("const getUserRsvpStatus", start);
  expect(start, "Home RSVP query key must remain present").toBeGreaterThanOrEqual(0);
  expect(end, "Home RSVP query block must remain discoverable").toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("Home RSVP data boundary", () => {
  it("delegates data access to the feature repository", () => {
    const block = homeRsvpQueryBlock();
    expect(block).toContain("fetchHomeUserRsvps(supabase, user!.id, eventIds)");
    expect(block).not.toContain('.from("rsvps")');
  });

  it("preserves identity/event scoping and the existing freshness policy", () => {
    const block = homeRsvpQueryBlock();
    expect(block).toContain('queryKey: ["user-rsvps-home", user?.id, eventIds]');
    expect(block).toContain("enabled: !!user && eventIds.length > 0");
    expect(block).toContain("staleTime: 2 * 60 * 1000");
    expect(block).toContain("placeholderData: (prev) => prev");
  });
});
