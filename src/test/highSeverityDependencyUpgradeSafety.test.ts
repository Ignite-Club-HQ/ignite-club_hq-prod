import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ExcelJS from "exceljs";
import { parse as parseFlatted, stringify as stringifyFlatted } from "flatted";
import { dump as dumpYaml, load as loadYaml } from "js-yaml";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const packageLock = JSON.parse(
  readFileSync(resolve(root, "package-lock.json"), "utf8"),
);

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

describe("high-severity dependency compatibility", () => {
  it("round-trips the fixture workbook values used by Ignite imports and templates", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Fixtures");
    sheet.addRow([
      "title",
      "date",
      "time",
      "opponent",
      "address",
      "description",
      "reminder_hours",
    ]);
    sheet.addRow([
      "U10 – Round 1 vs Eagles",
      new Date("2027-03-06T00:00:00.000Z"),
      "10:00",
      "Eagles FC",
      "123 Sports Ground Rd",
      "Home game 🏆",
      24,
    ]);
    sheet.getCell("H1").value = "double_reminder";
    sheet.getCell("H2").value = { formula: "G2*2", result: 48 };

    const output = await workbook.xlsx.writeBuffer();
    expect(output.byteLength).toBeGreaterThan(1_000);

    const imported = new ExcelJS.Workbook();
    await imported.xlsx.load(output);
    const importedSheet = imported.getWorksheet("Fixtures");

    expect(importedSheet).toBeDefined();
    expect(importedSheet!.getCell("A2").value).toBe("U10 – Round 1 vs Eagles");
    expect(importedSheet!.getCell("F2").value).toBe("Home game 🏆");
    expect(importedSheet!.getCell("G2").value).toBe(24);
    expect(importedSheet!.getCell("H2").value).toMatchObject({
      formula: "G2*2",
      result: 48,
    });
    expect(importedSheet!.getCell("B2").value).toBeInstanceOf(Date);
  });

  it("keeps ExcelJS on the expected tmp and uuid dependency boundary", () => {
    const excelEntry = packageLock.packages?.["node_modules/exceljs"];
    expect(excelEntry?.version).toBe("4.4.0");
    expect(excelEntry?.dependencies).toMatchObject({
      tmp: "^0.2.0",
      uuid: "^8.3.0",
    });
  });

  it("round-trips circular ESLint-style cache data with flatted", () => {
    const shared = { file: "src/hooks/useAuth.tsx", status: "clean" };
    const cache: Record<string, unknown> = {
      version: 1,
      entries: [shared, shared],
    };
    cache.self = cache;

    const decoded = parseFlatted(stringifyFlatted(cache)) as typeof cache;
    expect(decoded.self).toBe(decoded);
    expect((decoded.entries as unknown[])[0]).toBe((decoded.entries as unknown[])[1]);
    expect((decoded.entries as Array<typeof shared>)[0]).toEqual(shared);
  });

  it("parses and serializes ESLint-style YAML merges without changing values", () => {
    const source = [
      "defaults: &defaults",
      "  severity: warning",
      "  enabled: true",
      "rules:",
      "  no-unsafe-input:",
      "    <<: *defaults",
      "    paths:",
      "      - src",
      "      - supabase/functions",
    ].join("\n");

    const parsed = loadYaml(source) as any;
    expect(parsed.rules["no-unsafe-input"]).toEqual({
      severity: "warning",
      enabled: true,
      paths: ["src", "supabase/functions"],
    });
    expect(loadYaml(dumpYaml(parsed))).toEqual(parsed);
  });
});

describe("high-severity dependency acceptance gate", () => {
  const minimumVersions: Record<string, string> = {
    flatted: "3.4.3",
    "js-yaml": "4.3.1",
    tmp: "0.2.7",
  };

  for (const [packageName, minimumVersion] of Object.entries(minimumVersions)) {
    it(`resolves every ${packageName} copy to ${minimumVersion} or newer`, () => {
      const installed = resolutions(packageName);
      expect(installed.length).toBeGreaterThan(0);
      const vulnerable = installed.filter(
        ({ version }) => !atLeast(version, minimumVersion),
      );
      expect(
        vulnerable,
        `Vulnerable ${packageName} resolutions remain:\n${vulnerable
          .map(({ path, version }) => `${path}: ${version}`)
          .join("\n")}`,
      ).toEqual([]);
    });
  }

  it("does not downgrade ExcelJS while fixing its transitive tmp dependency", () => {
    expect(
      atLeast(packageLock.packages?.["node_modules/exceljs"]?.version, "4.4.0"),
    ).toBe(true);
  });
});
