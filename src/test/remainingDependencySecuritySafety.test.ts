import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transformSync } from "@babel/core";
import ExcelJS from "exceljs";
import { parseDocument, stringify } from "yaml";
import { v4 as uuidV4, v5 as uuidV5 } from "uuid";
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

function expectMinimumResolution(packageName: string, minimumVersion: string) {
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
}

describe("remaining dependency security compatibility", () => {
  it("parses aliases and serializes the nested YAML used by build configuration", () => {
    const source = [
      "defaults: &defaults",
      "  enabled: true",
      "  include:",
      "    - src/**/*.{ts,tsx}",
      "build:",
      "  <<: *defaults",
      "  mode: production",
    ].join("\n");

    const document = parseDocument(source, { merge: true });
    expect(document.errors).toEqual([]);
    expect(document.toJS()).toEqual({
      defaults: {
        enabled: true,
        include: ["src/**/*.{ts,tsx}"],
      },
      build: {
        enabled: true,
        include: ["src/**/*.{ts,tsx}"],
        mode: "production",
      },
    });
    expect(parseDocument(stringify(document.toJS())).toJS()).toEqual(
      document.toJS(),
    );
  });

  it("transforms modern application syntax and produces a valid source map", () => {
    const result = transformSync(
      "const label = club?.name ?? 'Unknown club'; export { label };",
      {
        ast: true,
        filename: "src/security-upgrade-fixture.ts",
        sourceMaps: true,
      },
    );

    expect(result?.code).toContain("club?.name");
    expect(result?.code).toContain("export");
    expect(result?.ast?.type).toBe("File");
    expect(result?.map?.sources).toEqual(["security-upgrade-fixture.ts"]);
  });

  it("preserves UUID string and bounded-buffer behaviour", () => {
    expect(uuidV4()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    const output = new Uint8Array(20).fill(0xaa);
    uuidV5("ignite-club-hq", uuidV5.URL, output, 2);
    expect([...output.slice(0, 2)]).toEqual([0xaa, 0xaa]);
    expect([...output.slice(18)]).toEqual([0xaa, 0xaa]);
    expect([...output.slice(2, 18)]).not.toContain(0xaa);
  });

  it("keeps ExcelJS workbook creation working with its resolved UUID dependency", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Members");
    sheet.addRow(["member_id", "name"]);
    sheet.addRow([uuidV4(), "Synthetic Member"]);

    const output = await workbook.xlsx.writeBuffer();
    const imported = new ExcelJS.Workbook();
    await imported.xlsx.load(output);

    expect(imported.getWorksheet("Members")?.getCell("B2").value).toBe(
      "Synthetic Member",
    );
  });
});

describe("resolved dependency security versions", () => {
  it("resolves every yaml copy to 2.8.3 or newer", () => {
    expectMinimumResolution("yaml", "2.8.3");
  });

  it("resolves every uuid copy to 11.1.1 or newer", () => {
    expectMinimumResolution("uuid", "11.1.1");
  });

  it("does not downgrade ExcelJS to satisfy npm audit", () => {
    expect(
      atLeast(packageLock.packages?.["node_modules/exceljs"]?.version, "4.4.0"),
    ).toBe(true);
  });
});

const describeBabelUpgradeCandidate =
  process.env.REMAINING_SECURITY_UPGRADE_CANDIDATE === "true"
    ? describe
    : describe.skip;

describeBabelUpgradeCandidate("Babel security acceptance gate", () => {
  it("resolves every @babel/core copy to a patched release", () => {
    expectMinimumResolution("@babel/core", "7.29.6");
  });
});
