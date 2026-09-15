import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(__dirname, "HomePage.tsx"), "utf8");

describe("HomePage account-recovery invalidation", () => {
  it("delegates recovery completion to the bounded feature policy", () => {
    expect(source).toContain(
      '@/features/home/accountRecoveryCompletion',
    );
    expect(source).toContain(
      "onRecovered={() => completeHomeAccountRecovery(queryClient)}",
    );
  });

  it("never globally invalidates every active query", () => {
    expect(source).not.toMatch(/queryClient\.invalidateQueries\(\s*\)/);
  });
});
