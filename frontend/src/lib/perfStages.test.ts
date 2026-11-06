import { beforeEach, describe, expect, it } from "vitest";
import { getStages, markStage, resetStagesForTests, restartSignInStages } from "./perfStages";
describe("startup stage marks", () => {
  beforeEach(() => resetStagesForTests());
  it("keeps the first time of each stage", () => {
    markStage("home_first_paint"); const first = getStages().home_first_paint;
    markStage("home_first_paint");
    expect(getStages().home_first_paint).toBe(first);
  });
  it("a new sign-in tap clears only sign-in stages", () => {
    markStage("sign_in_click"); markStage("identity_complete"); markStage("home_first_paint");
    restartSignInStages();
    expect(Object.keys(getStages())).toEqual(["home_first_paint"]);
  });
});
