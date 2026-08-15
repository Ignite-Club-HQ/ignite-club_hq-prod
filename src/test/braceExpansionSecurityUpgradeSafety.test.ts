/**
 * Security acceptance: brace-expansion is installed in three incompatible
 * majors across the tree. Each installed copy must satisfy the patched
 * version for ITS OWN major (not a single universal threshold), and any
 * unexpected major fails the test.
 *
 * Also keeps coverage that glob / ESLint / ExcelJS consumers still work.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));

function cmp(a: string, b: string) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

const MIN_BY_MAJOR: Record<string, string> = {
  "1": "1.1.18",
  "2": "2.1.4",
  "5": "5.0.9",
};

const copies = Object.entries(lock.packages as Record<string, { version?: string }>)
  .filter(([path]) => path.endsWith("node_modules/brace-expansion"))
  .map(([path, meta]) => ({ path, version: meta.version ?? "0.0.0" }));

describe("brace-expansion security upgrade safety", () => {
  it("finds installed brace-expansion copies", () => {
    expect(copies.length).toBeGreaterThan(0);
  });

  it("validates each copy against the minimum for its own major", () => {
    for (const copy of copies) {
      const major = copy.version.split(".")[0];
      const min = MIN_BY_MAJOR[major];
      expect(min, `unexpected brace-expansion major at ${copy.path}@${copy.version}`).toBeDefined();
      expect(cmp(copy.version, min!), `${copy.path}@${copy.version}`).toBeGreaterThanOrEqual(0);
    }
  });

  it("preserves the separate 1.x / 2.x / 5.x overrides", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.overrides["brace-expansion@1.x"]).toBe("1.1.18");
    expect(pkg.overrides["brace-expansion@2.x"]).toBe("2.1.4");
    expect(pkg.overrides["brace-expansion@5.x"]).toBe("5.0.9");
  });

  it("keeps brace expansion behaviour working for glob-style consumers", async () => {
    const mod = (await import("brace-expansion")) as unknown as {
      default?: (pattern: string) => string[];
      expand?: (pattern: string) => string[];
    };
    const expand = mod.default ?? mod.expand;
    expect(expand?.("a{b,c}d")).toEqual(["abd", "acd"]);
    const { minimatch } = await import("minimatch");
    expect(minimatch("src/a.ts", "src/*.{ts,tsx}")).toBe(true);
  });

  it("keeps ExcelJS usable (transitive brace-expansion consumer)", async () => {
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.addRow(["a", 1]);
    const buf = await wb.xlsx.writeBuffer();
    expect(buf.byteLength).toBeGreaterThan(0);
  });
});
