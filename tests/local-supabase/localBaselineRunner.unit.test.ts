import { describe, expect, it } from "vitest";
import {
  assertOnlyAllowedLocalNames,
  expectedMigrationVersions,
  migrationLedgersMatch,
  parseLocalGatewayKeys,
} from "../../scripts/local-baseline-safety.mjs";

describe("complete baseline local lifecycle safety", () => {
  it("extracts and sorts only valid migration versions", () => {
    expect(expectedMigrationVersions([
      "20260721004000_owner.sql",
      "README.md",
      "20260721000000_baseline.sql",
      "bad.sql",
    ])).toEqual(["20260721000000", "20260721004000"]);
  });

  it("requires an exact, non-empty migration ledger match", () => {
    expect(migrationLedgersMatch(["1", "2"], ["1", "2"])).toBe(true);
    expect(migrationLedgersMatch(["1", "2"], ["1"])).toBe(false);
    expect(migrationLedgersMatch(["1"], ["2"])).toBe(false);
    expect(migrationLedgersMatch([], [])).toBe(false);
  });

  it("extracts only modern local publishable and secret keys", () => {
    expect(parseLocalGatewayKeys(`
      apikey == 'sb_secret_${"s".repeat(24)}'
      apikey == 'sb_publishable_${"p".repeat(24)}'
    `)).toEqual({
      publishableKey: `sb_publishable_${"p".repeat(24)}`,
      secretKey: `sb_secret_${"s".repeat(24)}`,
    });
    expect(() => parseLocalGatewayKeys("hosted-looking-but-not-a-local-key"))
      .toThrow(/generated local API keys/);
  });

  it("refuses lifecycle targets outside the explicit local allowlist", () => {
    expect(() => assertOnlyAllowedLocalNames(["safe-local"], ["safe-local"])).not.toThrow();
    expect(() => assertOnlyAllowedLocalNames(["safe-local", "unexpected"], ["safe-local"]))
      .toThrow(/unexpected/);
  });
});
