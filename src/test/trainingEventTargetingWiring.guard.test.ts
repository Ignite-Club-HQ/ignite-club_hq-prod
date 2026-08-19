import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (file: string) => readFileSync(resolve(process.cwd(), "src/pages", file), "utf8");
const createPage = source("CreateEventPage.tsx");
const editPage = source("EditEventPage.tsx");

describe("training event targeting page wiring", () => {
  it.each([
    ["create", createPage],
    ["edit", editPage],
  ])("%s uses the shared targeting policy before persistence", (_name, page) => {
    expect(page).toContain("resolveEventTeamTargeting({");
    expect(page).toContain("if (!teamTargeting.valid)");
    expect(page).toContain("target_team_ids: teamTargeting.targetTeamIds");
    expect(page).toContain("teamTargeting.rsvpGrouping");
  });

  it.each([
    ["create", createPage],
    ["edit", editPage],
  ])("%s exposes club-wide controls for training through the shared scope policy", (_name, page) => {
    expect(page).toContain("supportsClubWideEventScope(type)");
    expect(page).toContain("<TargetTeamsPicker");
  });

  it("clears selected target teams when the create form changes club", () => {
    expect(createPage).toMatch(/setClubId\(v\);[\s\S]{0,180}setTargetTeamIds\(null\);/);
  });

  it("clears selected target teams when the edit form changes club", () => {
    expect(editPage).toMatch(/value !== selectedClubId[\s\S]{0,140}setTargetTeamIds\(null\);/);
  });
});
