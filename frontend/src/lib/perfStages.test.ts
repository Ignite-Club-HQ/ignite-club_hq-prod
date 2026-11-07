import { beforeEach, describe, expect, it } from "vitest";
import { getStages, markStage, resetStagesForTests, restartSignInStages, startupSamples } from "./perfStages";
describe("startup stage marks", () => {
  beforeEach(() => resetStagesForTests());
  it("keeps the first time of each stage", () => {
    markStage("home_first_paint"); const first = getStages().home_first_paint;
    markStage("home_first_paint");
    expect(getStages().home_first_paint).toBe(first);
  });
  it("a new sign-in tap clears all milestones to avoid mixing attempts", () => {
    markStage("sign_in_click"); markStage("identity_complete"); markStage("home_first_paint");
    restartSignInStages();
    expect(Object.keys(getStages())).toEqual([]);
  });
  it("measures actual II-to-home duration, not time since navigation", () => {
    const samples = startupSamples({ identity_complete: 10000, account_ready: 10400, profile_resolved: 10600, home_first_paint: 11200 }, "android");
    expect(samples.find(s => s.surface === "startup_delta:identity_complete:account_ready")?.duration_ms).toBe(400);
    expect(samples.find(s => s.surface === "startup_delta:identity_complete:home_first_paint")?.duration_ms).toBe(1200);
  });
  it("reports available intervals without waiting for a carousel", () => {
    expect(startupSamples({ sign_in_click: 200, identity_complete: 900 }, "web").find(s => s.surface === "startup_delta:sign_in_click:identity_complete")?.duration_ms).toBe(700);
  });
});
