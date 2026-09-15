import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/pages/HomePage.tsx"), "utf8");

function block(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  expect(start, `${startMarker} must remain present`).toBeGreaterThanOrEqual(0);
  expect(end, `${endMarker} must follow ${startMarker}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("Home entitlement data boundaries", () => {
  it("delegates the aggregate Pro read while preserving its scoped cache policy", () => {
    const query = block(
      'queryKey: ["user-has-pro-access"',
      "const showProBadge",
    );
    expect(query).toContain("fetchHomeProAccess(");
    expect(query).toContain("userMemberships?.clubIds ?? []");
    expect(query).toContain("userMemberships?.teamIds ?? []");
    expect(query).toContain("enabled: !!user && !!userMemberships");
    expect(query).toContain("staleTime: 5 * 60 * 1000");
    expect(query).toContain("placeholderData: (prev) => prev");
    expect(query).not.toContain('.from("club_subscriptions")');
    expect(query).not.toContain('.from("team_subscriptions")');
  });

  it("delegates reward-club entitlement reads with active-club scope intact", () => {
    const query = block('queryKey: ["reward-clubs-home"', "const hasAnyRewardClubPro");
    expect(query).toContain("fetchHomeRewardClubs(");
    expect(query).toContain("userMemberships?.clubIds ?? []");
    expect(query).toContain("activeClubFilter");
    expect(query).toContain("enabled: !!user && !!userMemberships");
    expect(query).toContain("staleTime: 5 * 60 * 1000");
    expect(query).not.toContain('.from("club_subscriptions")');
  });
});
