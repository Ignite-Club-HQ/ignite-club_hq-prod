/**
 * Regression contracts for newly-created events reaching Home > Next Up.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const createEventPage = read("src/pages/CreateEventPage.tsx");
const homePage = read("src/pages/HomePage.tsx");

function successfulCreateWindow(): string {
  const start = createEventPage.indexOf('supabase.rpc("create_event_with_duties"');
  expect(start, "CreateEventPage must retain its transactional creation RPC").toBeGreaterThanOrEqual(0);
  const end = createEventPage.indexOf("} catch (error: any)", start);
  expect(end, "Could not locate the successful event-creation block").toBeGreaterThan(start);
  return createEventPage.slice(start, end);
}

describe("Home Next Up freshness after event creation", () => {
  it("invalidates the exact consolidated Home query before leaving a successful create", () => {
    const success = successfulCreateWindow();
    expect(success).toContain("await queryClient.invalidateQueries");
    expect(success).toMatch(
      /queryKey:\s*\[\s*["']user-memberships-and-events["']\s*,\s*user(?:!?)\.id\s*\]/,
    );
    expect(success).not.toContain("invalidateQueries()");

    const invalidateAt = success.indexOf("queryClient.invalidateQueries");
    const navigateAt = success.indexOf("navigate(");
    expect(invalidateAt, "Home invalidation must occur on the successful path").toBeGreaterThanOrEqual(0);
    expect(navigateAt, "Successful creation must still navigate to the event").toBeGreaterThan(invalidateAt);
  });

  it("gives each club and team an independent candidate window before merging", () => {
    expect(homePage).toContain('const scopedEventsQuery = (column: "club_id" | "team_id", value: string)');
    expect(homePage).toContain('.eq(column, value)');
    expect(homePage).toMatch(/clubIdsFromRolesArr\.map\(\(clubId\)\s*=>[\s\S]*?scopedEventsQuery\("club_id", clubId\)/);
    expect(homePage).toMatch(/teamIds\.map\(\(teamId\)\s*=>[\s\S]*?scopedEventsQuery\("team_id", teamId\)/);
    expect(homePage).toContain("const mergedEventsById = new Map");
    expect(homePage).toContain("mergedEventsById.set(row.id, row)");
    expect(homePage).not.toMatch(/\.or\(eventScopeOr\.join/);
  });

  it("keeps the Home query refresh-on-mount/focus/reconnect safety net", () => {
    expect(homePage).toContain('refetchOnMount: "always"');
    expect(homePage).toContain('refetchOnWindowFocus: "always"');
    expect(homePage).toContain('refetchOnReconnect: "always"');
  });
});
