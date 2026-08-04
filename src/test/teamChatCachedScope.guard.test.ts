import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guard: cached team messages must never be laundered into the open thread.
 *
 * `getCachedTeamMessages()` used to stamp the active `teamId` onto every cached
 * row, so a cached row that already carried another team's immutable `team_id`
 * became indistinguishable from a legitimate row and passed `belongsToTeam()`.
 */
describe("team chat cached-message scope guard", () => {
  const page = readFileSync(
    join(__dirname, "..", "pages", "TeamChatPage.tsx"),
    "utf8",
  );

  it("never rewrites a cached row's team_id with the active team", () => {
    expect(page).not.toMatch(/^\s*team_id: teamId,\s*$/m);
  });

  it("rejects cached rows whose existing team_id conflicts, keeps legacy rows", () => {
    expect(page).toMatch(/getCachedMessages\("team", teamId\)\s*\n\s*\.filter\(/);
    expect(page).toMatch(/typeof cachedTeamId !== "string" \|\| cachedTeamId === teamId/);
    expect(page).toMatch(/team_id\?: unknown \}\)\.team_id as string \| undefined\) \?\? teamId/);
  });

  it("persists an immutable team_id on cached team messages", () => {
    const stamped = page.match(/team_id: m\.team_id \?\? teamId/g) ?? [];
    expect(stamped.length).toBeGreaterThanOrEqual(2);
  });
});
