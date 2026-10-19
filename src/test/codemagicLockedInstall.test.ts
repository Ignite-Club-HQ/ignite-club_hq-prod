import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const config = load(readFileSync("codemagic.yaml", "utf8")) as {
  workflows: Record<string, { scripts: Array<{ name: string; script: string }> }>;
};

describe("Codemagic reproducible dependency installation", () => {
  for (const id of [
    "android-debug-workflow",
    "ios-debug-workflow",
    "android-workflow",
    "ios-workflow",
  ]) {
    it(`${id} uses the committed lockfile without regenerating it`, () => {
      const step = config.workflows[id]?.scripts.find(
        (entry) => entry.name === "Install dependencies",
      );
      expect(step?.script).toBe("npm ci --no-audit --no-fund");
    });
  }
});