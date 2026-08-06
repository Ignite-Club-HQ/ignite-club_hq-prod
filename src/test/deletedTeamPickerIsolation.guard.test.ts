import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

function queryWindow(file: string, queryKey: string, length = 2_400) {
  const start = file.indexOf(queryKey);
  expect(start, `Missing query key ${queryKey}`).toBeGreaterThanOrEqual(0);
  return file.slice(start, start + length);
}

function expectActiveTeamsOnly(query: string) {
  expect(query).toContain('.from("teams")');
  expect(query).toContain('.is("deleted_at", null)');
}

describe("soft-deleted team isolation across destination pickers", () => {
  it("excludes deleted teams from both Event creation team sources", () => {
    const page = source("src/pages/CreateEventPage.tsx");
    expectActiveTeamsOnly(queryWindow(page, '"club-teams-for-event"'));
    expectActiveTeamsOnly(queryWindow(page, '"all-club-teams-for-target"'));
  });

  it("excludes deleted teams from Gallery upload choices for admins and members", () => {
    const sheet = source("src/components/UploadPhotoSheet.tsx");
    const query = queryWindow(sheet, '"user-teams-upload-sheet"', 3_800);
    expect(query.match(/\.is\("deleted_at", null\)/g)).toHaveLength(2);
  });

  it("excludes deleted teams from the Gallery browsing filter", () => {
    const media = source("src/pages/MediaPage.tsx");
    expectActiveTeamsOnly(queryWindow(media, '"media-filter-teams"'));
  });

  it("excludes deleted teams from Vault choices for admins and members", () => {
    const vault = source("src/pages/VaultPage.tsx");
    const query = queryWindow(vault, '"vault-club-teams"', 3_400);
    expect(query.match(/\.is\("deleted_at", null\)/g)).toHaveLength(2);
  });

  it("revalidates an Event team immediately before writing, closing stale-selection races", () => {
    const page = source("src/pages/CreateEventPage.tsx");
    expect(page).toContain('.select("id, deleted_at")');
    expect(page).toContain('if (teamCheckError || !teamRow || (teamRow as any).deleted_at)');
    expect(page).toContain('title: "Team no longer available"');
  });
});
