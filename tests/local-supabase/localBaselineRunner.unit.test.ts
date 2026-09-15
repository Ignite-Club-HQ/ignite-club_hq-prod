import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertOnlyAllowedLocalNames,
  baselineBranchMode,
  expectedMigrationVersions,
  findUnreviewedMirroredMigrations,
  hasExplicitLocalSessionApproval,
  migrationLedgersMatch,
  parseLocalGatewayKeys,
  validateCurrentLocalParity,
  worktreeUpdateMode,
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

  it("flags only newer production migrations that touch mirrored contracts", () => {
    expect(findUnreviewedMirroredMigrations([
      { name: "20260722043149_current.sql", sql: "create function can_view_competition()" },
      { name: "20260723000000_unrelated.sql", sql: "alter table public.sponsors add column url text" },
      { name: "20260724000000_membership.sql", sql: "create function remove_team_member()" },
    ], "20260722043149_current.sql")).toEqual(["20260724000000_membership.sql"]);
  });

  it("requires the critical mirrored behaviours in the synthetic SQL", () => {
    const complete = `
      create table public.team_member_exclusions (team_id uuid);
      create function public.remove_team_member(_team_id uuid) returns void;
      create function public.can_publish_club_wide_photo(_user_id uuid, _club_id uuid) returns boolean;
      create policy competitions_select on public.competitions for select
        using (created_by = (select auth.uid()));
      create policy "Scoped role-checked photo uploads" on public.photos for insert
        with check (uploader_id = (select auth.uid()));
    `;
    expect(validateCurrentLocalParity(complete)).toEqual([]);
    expect(validateCurrentLocalParity("select 1")).toEqual([
      "direct competition creator visibility",
      "scoped team-member removal RPC",
      "guardian-derived membership exclusions",
      "role-scoped club-wide photo publishing",
      "single scoped photo upload policy",
    ]);
  });

  it("confirms the checked-in production and synthetic contracts are currently aligned", () => {
    const productionDirectory = resolve(process.cwd(), "supabase/migrations");
    const localDirectory = resolve(process.cwd(), "local-supabase-workspace/supabase/migrations");
    const production = readdirSync(productionDirectory)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => ({ name, sql: readFileSync(resolve(productionDirectory, name), "utf8") }));
    const localSql = readdirSync(localDirectory)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => readFileSync(resolve(localDirectory, name), "utf8"))
      .join("\n");
    expect(findUnreviewedMirroredMigrations(production)).toEqual([]);
    expect(validateCurrentLocalParity(localSql)).toEqual([]);
  });

  it("accepts exactly one deliberate local-session approval flag", () => {
    expect(hasExplicitLocalSessionApproval(["--approved-local-session"])).toBe(true);
    expect(hasExplicitLocalSessionApproval([])).toBe(false);
    expect(hasExplicitLocalSessionApproval(["--approve"])).toBe(false);
    expect(hasExplicitLocalSessionApproval([
      "--approved-local-session", "--approved-local-session",
    ])).toBe(false);
  });

  it("keeps the one-click npm and GitHub Actions entry points on exactly one approval", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    const baselineScript = packageJson.scripts?.["test:baseline"] ?? "";
    expect(baselineScript.match(/--approved-local-session/g)).toHaveLength(1);
    expect(packageJson.scripts?.baseline).toBe("npm run test:baseline");

    const compatibilityEntryPoint = readFileSync(
      resolve(process.cwd(), "scripts/run-baseline.sh"),
      "utf8",
    );
    expect(compatibilityEntryPoint).toContain(
      "exec node scripts/run-complete-baseline.mjs --approved-local-session",
    );
    expect(compatibilityEntryPoint).not.toContain("BASELINE_DB_URL");
    expect(compatibilityEntryPoint).not.toContain("SKIP:");

    const workflow = readFileSync(
      resolve(process.cwd(), ".github/workflows/codespaces-review-baseline.yml"),
      "utf8",
    );
    expect(workflow).toContain("run: npm run test:baseline");
    expect(workflow).not.toContain("npm run test:baseline -- --approved-local-session");
  });

  it("keeps the strict feature boundary in the complete baseline", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    expect(packageJson.scripts?.["typecheck:strict-policies"])
      .toBe("tsc -p tsconfig.strict-features.json --noEmit");
    expect(packageJson.scripts?.["typecheck:strict-workflows"])
      .toBe("tsc -p tsconfig.strict-workflows.json --noEmit");
    expect(packageJson.scripts?.["typecheck:strict-features"])
      .toBe("npm run typecheck:strict-policies && npm run typecheck:strict-workflows");

    const baselineRunner = readFileSync(
      resolve(process.cwd(), "scripts/run-complete-baseline.mjs"),
      "utf8",
    );
    expect(baselineRunner).toContain(
      'runStage("Strict feature boundary", "npm", ["run", "typecheck:strict-features"]',
    );
  });

  it("selects a free loopback port for Playwright instead of reusing an unrelated server", () => {
    const baselineRunner = readFileSync(
      resolve(process.cwd(), "scripts/run-complete-baseline.mjs"),
      "utf8",
    );
    expect(baselineRunner).toContain("reserveAvailableLoopbackPort");
    expect(baselineRunner).toContain('PLAYWRIGHT_BASELINE_PORT: String(playwrightPort)');

    const playwrightConfig = readFileSync(
      resolve(process.cwd(), "playwright.baseline.config.ts"),
      "utf8",
    );
    expect(playwrightConfig).toContain('reuseExistingServer: false');
    expect(playwrightConfig).toContain('--strictPort');
  });

  it("tests dirty worktrees in place without attempting an automatic branch update", () => {
    expect(worktreeUpdateMode(0, "")).toBe("update");
    expect(worktreeUpdateMode(0, " M src/example.test.ts\n")).toBe("test-current");
    expect(worktreeUpdateMode(128, "")).toBe("error");
  });

  it("makes the one-click command safe on review and tranche branches", () => {
    expect(baselineBranchMode("codespaces-review")).toBe("update-test-branch");
    expect(baselineBranchMode("promotion/09b-telemetry-recipient-reconciliation"))
      .toBe("test-current");
    expect(baselineBranchMode("feature/example")).toBe("test-current");
    expect(baselineBranchMode("main")).toBe("protected");
    expect(baselineBranchMode("master")).toBe("protected");
    expect(baselineBranchMode("")).toBe("error");
  });
});
