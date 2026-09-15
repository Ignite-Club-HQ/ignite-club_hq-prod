import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ExcelJS from "exceljs";
import { Linter } from "eslint";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const minimatch = require("minimatch") as (
  value: string,
  pattern: string,
  options?: Record<string, unknown>,
) => boolean;

const root = resolve(import.meta.dirname, "../..");
const packageLock = JSON.parse(
  readFileSync(resolve(root, "package-lock.json"), "utf8"),
);
const packageJson = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
);

const minimumByMajor: Record<string, string> = {
  "1": "1.1.18",
  "2": "2.1.4",
  "5": "5.0.9",
};

function versionTuple(version: string): [number, number, number] {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new Error(`Unsupported semantic version: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function atLeast(actual: string, minimum: string): boolean {
  const left = versionTuple(actual);
  const right = versionTuple(minimum);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] > right[index]) return true;
    if (left[index] < right[index]) return false;
  }
  return true;
}

function resolutions(packageName: string): Array<{ path: string; version: string }> {
  return Object.entries<Record<string, any>>(packageLock.packages ?? {})
    .filter(([lockPath, metadata]) =>
      (lockPath === `node_modules/${packageName}`
        || lockPath.endsWith(`/node_modules/${packageName}`))
      && typeof metadata?.version === "string"
    )
    .map(([lockPath, metadata]) => ({
      path: lockPath,
      version: metadata.version,
    }));
}

describe("brace-expansion consumer compatibility", () => {
  it("preserves the TypeScript and TSX include globs used by the test toolchain", () => {
    const pattern = "src/**/*.{test,spec}.{ts,tsx}";

    expect(minimatch("src/hooks/useAuth.test.tsx", pattern)).toBe(true);
    expect(minimatch("src/lib/permissions.spec.ts", pattern)).toBe(true);
    expect(minimatch("src/pages/AuthPage.tsx", pattern)).toBe(false);
    expect(minimatch("tests/useAuth.test.tsx", pattern)).toBe(false);
  });

  it("preserves ordinary brace ranges and exclusion behaviour", () => {
    expect(minimatch("fixture-03.json", "fixture-{01..05}.json")).toBe(true);
    expect(minimatch("fixture-09.json", "fixture-{01..05}.json")).toBe(false);
    expect(
      minimatch("src/hooks/useAuth.tsx", "{src,tests}/**/*.{ts,tsx}"),
    ).toBe(true);
    expect(
      minimatch("node_modules/pkg/index.ts", "{src,tests}/**/*.{ts,tsx}"),
    ).toBe(false);
  });

  it("keeps ESLint's programmatic lint engine functional", () => {
    const linter = new Linter();
    const messages = linter.verify(
      "const unused = true;\nconst used = 1;\nconsole.log(used);",
      [
        {
          languageOptions: { ecmaVersion: 2022 },
          rules: { "no-unused-vars": "error" },
        },
      ],
    );

    expect(messages).toEqual([
      expect.objectContaining({
        ruleId: "no-unused-vars",
        severity: 2,
        message: expect.stringContaining("unused"),
      }),
    ]);
  });

  it("round-trips a multi-sheet ExcelJS archive without losing workbook data", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Ignite Club HQ";
    const events = workbook.addWorksheet("Events");
    events.addRow(["event_id", "title", "starts_at"]);
    events.addRow([
      "event-synthetic-1",
      "Synthetic Game Day",
      new Date("2027-06-12T09:30:00.000Z"),
    ]);
    const attendance = workbook.addWorksheet("Attendance");
    attendance.addRow(["member_id", "status"]);
    attendance.addRow(["member-synthetic-1", "attending"]);
    attendance.getCell("C1").value = "attending_count";
    attendance.getCell("C2").value = { formula: 'COUNTIF(B:B,"attending")', result: 1 };

    const output = await workbook.xlsx.writeBuffer();
    expect(output.byteLength).toBeGreaterThan(1_000);

    const imported = new ExcelJS.Workbook();
    await imported.xlsx.load(output);
    expect(imported.worksheets.map(({ name }) => name)).toEqual([
      "Events",
      "Attendance",
    ]);
    expect(imported.getWorksheet("Events")?.getCell("B2").value).toBe(
      "Synthetic Game Day",
    );
    expect(imported.getWorksheet("Attendance")?.getCell("C2").value).toMatchObject({
      formula: 'COUNTIF(B:B,"attending")',
      result: 1,
    });
  });
});

describe("brace-expansion security acceptance gate", () => {
  it("resolves every brace-expansion copy to the patched range", () => {
    const installed = resolutions("brace-expansion");
    expect(installed.length).toBeGreaterThan(0);
    const vulnerable = installed.filter(({ version }) => {
      const minimum = minimumByMajor[versionTuple(version)[0]];
      return minimum === undefined || !atLeast(version, minimum);
    });

    expect(
      vulnerable,
      `Vulnerable brace-expansion resolutions remain:\n${vulnerable
        .map(({ path, version }) => `${path}: ${version}`)
        .join("\n")}`,
    ).toEqual([]);
  });

  it("keeps separate patched overrides for every supported consumer major", () => {
    expect(packageJson.overrides?.["brace-expansion@1.x"]).toBe("1.1.18");
    expect(packageJson.overrides?.["brace-expansion@2.x"]).toBe("2.1.4");
    expect(packageJson.overrides?.["brace-expansion@5.x"]).toBe("5.0.9");
  });

  it("does not downgrade the major consumers to satisfy npm audit", () => {
    expect(
      atLeast(packageLock.packages?.["node_modules/eslint"]?.version, "9.32.0"),
    ).toBe(true);
    expect(
      atLeast(packageLock.packages?.["node_modules/exceljs"]?.version, "4.4.0"),
    ).toBe(true);
  });
});
