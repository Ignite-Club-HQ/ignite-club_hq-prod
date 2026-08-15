/**
 * Security acceptance: js-yaml 4.x must be >= 4.3.1 everywhere, and YAML
 * parsing / round-tripping must keep working after the upgrade.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { load, dump } from "js-yaml";

const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));

function cmp(a: string, b: string) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

function installed(name: string) {
  return Object.entries(lock.packages as Record<string, { version?: string }>)
    .filter(([path]) => path.endsWith(`node_modules/${name}`))
    .map(([path, meta]) => ({ path, version: meta.version ?? "0.0.0" }));
}

describe("high severity dependency upgrade safety", () => {
  it("has no js-yaml 4.x copy below 4.3.1", () => {
    const copies = installed("js-yaml");
    expect(copies.length).toBeGreaterThan(0);
    for (const copy of copies) {
      if (!copy.version.startsWith("4.")) continue;
      expect(cmp(copy.version, "4.3.1"), `${copy.path}@${copy.version}`).toBeGreaterThanOrEqual(0);
    }
  });

  it("still parses YAML documents", () => {
    const parsed = load("name: ignite\nteams:\n  - u12\n  - u14\n") as {
      name: string;
      teams: string[];
    };
    expect(parsed.name).toBe("ignite");
    expect(parsed.teams).toEqual(["u12", "u14"]);
  });

  it("still round-trips YAML", () => {
    const value = { club: "Bridgewater", nested: { enabled: true, count: 3 } };
    expect(load(dump(value))).toEqual(value);
  });
});
