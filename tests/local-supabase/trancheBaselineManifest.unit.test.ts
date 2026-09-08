import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { trancheTestManifest } from "../../scripts/tranche-test-manifest.mjs";

const trancheIds = ["00", "01", "02", "03", "04", "05", "06", "07", "08", "09a", "09b"];

describe("tranche baseline manifest", () => {
  it("defines every promotion tranche exactly once", () => {
    expect(Object.keys(trancheTestManifest)).toEqual(trancheIds);
    expect(new Set(Object.values(trancheTestManifest).map(({ name }) => name)).size).toBe(trancheIds.length);
  });

  it.each(trancheIds)("gives tranche %s at least one valid Vitest selector", (tranche) => {
    const entry = trancheTestManifest[tranche as keyof typeof trancheTestManifest];
    expect(entry.vitest.length).toBeGreaterThan(0);
    for (const pattern of entry.vitest) expect(() => new RegExp(pattern)).not.toThrow();
  });

  it("keeps browser journeys with their owning application tranches", () => {
    expect(trancheTestManifest["01"].playwright).toContain("e2e-baseline/auth-safety.spec.ts");
    expect(trancheTestManifest["02"].playwright).toContain("e2e-baseline/committee-invite-mobile-signup.spec.ts");
    expect(trancheTestManifest["03"].playwright).toContain("e2e-baseline/club-wide-game-rsvp.spec.ts");
    expect(trancheTestManifest["05"].playwright).toContain("e2e-baseline/messaging-cross-surface-contracts.spec.ts");
    expect(trancheTestManifest["06"].playwright).toContain("e2e-baseline/vault-upload-safety.spec.ts");
    expect(trancheTestManifest["07"].playwright).toContain("e2e-baseline/messaging-navigation-and-layout.spec.ts");
  });

  it("keeps the PitchBoard matrix inside tranche 07", () => {
    const patterns = trancheTestManifest["07"].vitest.map((pattern) => new RegExp(pattern));
    expect(patterns.some((pattern) => pattern.test("src/components/pitch/AutoSubPlanDialog.matrix.test.ts"))).toBe(true);
  });

  it("keeps the matrix in the complete one-click baseline", () => {
    const runner = readFileSync(new URL("../../scripts/run-complete-baseline.mjs", import.meta.url), "utf8");
    expect(runner).toContain('"AutoSub matrix"');
    expect(runner).toContain('"vitest.matrix.config.ts"');
  });

  it.each(["02", "03", "04", "05", "06", "07", "09b"])(
    "records local integration ownership for backend tranche %s",
    (tranche) => {
      const entry = trancheTestManifest[tranche as keyof typeof trancheTestManifest];
      expect(entry.local?.length).toBeGreaterThan(0);
      for (const pattern of entry.local ?? []) expect(() => new RegExp(pattern)).not.toThrow();
    },
  );
});
