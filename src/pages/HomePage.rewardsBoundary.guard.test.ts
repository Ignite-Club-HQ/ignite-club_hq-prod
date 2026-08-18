import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/pages/HomePage.tsx"), "utf8");

function queryBlock(key: string, endMarker: string): string {
  const start = source.indexOf(`queryKey: ["${key}"`);
  const end = source.indexOf(endMarker, start);
  expect(start, `${key} query must remain present`).toBeGreaterThanOrEqual(0);
  expect(end, `${key} query boundary must remain discoverable`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("Home rewards data boundaries", () => {
  it("preserves pending-redemption identity and freshness policy", () => {
    const query = queryBlock("pending-redemptions-home", "const latestPendingRedemption");
    expect(query).toContain("fetchPendingHomeRedemptions(supabase, user!.id)");
    expect(query).toContain("enabled: !!user");
    expect(query).toContain("staleTime: 5 * 60 * 1000");
    expect(query).toContain("placeholderData: (prev) => prev");
    expect(query).not.toContain('.from("reward_redemptions")');
  });

  it("preserves selected-club scoping for available rewards", () => {
    const query = queryBlock("home-available-rewards", "// Fetch the next reward info");
    expect(query).toContain("fetchAvailableHomeRewards(supabase, selectedRewardClubId!)");
    expect(query).toContain("enabled: !!selectedRewardClubId");
    expect(query).toContain("staleTime: 5 * 60 * 1000");
    expect(query).not.toContain('.from("club_rewards")');
  });

  it("preserves the eligible-club key and enablement for the next reward", () => {
    const query = queryBlock("next-reward-info", "const minRewardThreshold");
    expect(query).toContain("fetchNextHomeRewardInfo(supabase, rewardClubs, !!isAppAdmin)");
    expect(query).toContain("rewardClubs.map((c: any) => c.id)");
    expect(query).toContain("enabled: rewardClubs.length > 0");
    expect(query).toContain("placeholderData: (prev) => prev");
    expect(query).not.toContain('.from("club_rewards")');
  });

  it("preserves guardian-aware child query identity and freshness", () => {
    const query = queryBlock("user-children-home", "// ---- Per-club reward balances");
    expect(query).toContain("fetchHomeUserChildren(supabase, user!.id)");
    expect(query).toContain("enabled: !!user");
    expect(query).toContain("staleTime: 5 * 60 * 1000");
    expect(query).not.toContain('.from("children")');
    expect(query).not.toContain('.from("child_guardians")');
  });
});
