/**
 * Security acceptance: react-router-dom must stay >= 7.18.2 within major 7,
 * resolve react-router to the same safe version, and never be duplicated as a
 * separate direct dependency.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
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

describe("react-router security upgrade safety", () => {
  it("pins react-router-dom to 7.18.2 or newer within major 7", () => {
    const declared = (pkg.dependencies?.["react-router-dom"] ?? "").replace(/^[^\d]*/, "");
    expect(declared.startsWith("7.")).toBe(true);
    expect(cmp(declared, "7.18.2")).toBeGreaterThanOrEqual(0);
  });

  it("does not declare react-router as a separate direct dependency", () => {
    expect(pkg.dependencies?.["react-router"]).toBeUndefined();
    expect(pkg.devDependencies?.["react-router"]).toBeUndefined();
  });

  it("has no installed react-router copy below 7.18.2", () => {
    const copies = installed("react-router");
    expect(copies.length).toBeGreaterThan(0);
    for (const copy of copies) {
      expect(copy.version.startsWith("7."), `${copy.path}@${copy.version}`).toBe(true);
      expect(cmp(copy.version, "7.18.2"), `${copy.path}@${copy.version}`).toBeGreaterThanOrEqual(0);
    }
  });

  it("has no installed react-router-dom copy below 7.18.2", () => {
    for (const copy of installed("react-router-dom")) {
      expect(cmp(copy.version, "7.18.2"), `${copy.path}@${copy.version}`).toBeGreaterThanOrEqual(0);
    }
  });
});
