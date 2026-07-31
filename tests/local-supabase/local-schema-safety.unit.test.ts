import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const baseline = readFileSync("local-supabase-workspace/supabase/migrations/20260721000000_local_test_baseline.sql", "utf8");
const config = readFileSync("local-supabase-workspace/supabase/config.toml", "utf8");
const migrationDirectory = "local-supabase-workspace/supabase/migrations";
const migrations = readdirSync(migrationDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(`${migrationDirectory}/${name}`, "utf8"));
const combined = `${migrations.join("\n")}\n${config}`;

describe("local baseline: static drift and remote-target safety", () => {
  it("contains no hosted Supabase URL, database URL or JWT", () => {
    expect(combined).not.toMatch(/https?:\/\/[^\s"']+\.supabase\.co/i);
    expect(combined).not.toMatch(/postgres(?:ql)?:\/\//i);
    expect(combined).not.toMatch(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/);
  });

  it("contains no hosted API keys, Riverside data or non-local project reference", () => {
    expect(combined).not.toMatch(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/);
    expect(combined).not.toMatch(/riverside/i);
    const projectIds = [...config.matchAll(/^project_id\s*=\s*"([^"]+)"/gm)].map((match) => match[1]);
    expect(projectIds).toEqual(["ignite-club-local-security-tests"]);
  });

  it("contains no remote migration or project-linking command", () => {
    expect(combined).not.toMatch(/--linked|db\s+(push|pull)|\bsupabase\s+link\b/i);
  });

  it("retains the synthetic environment marker and service-only grant", () => {
    expect(baseline).toContain("ignite-club-local-security-tests");
    expect(baseline).toMatch(/revoke all on function public\.is_local_security_test_environment\(\) from public, anon, authenticated/i);
    expect(baseline).toMatch(/grant execute on function public\.is_local_security_test_environment\(\) to service_role/i);
  });

  it("pins security-definer helper search paths", () => {
    const definitions = migrations.flatMap((migration) => migration.match(/security definer[^;]+/gi) ?? []);
    expect(definitions.length).toBeGreaterThan(5);
    for (const definition of definitions) {
      expect(definition).toMatch(/set search_path\s*(?:=|to\b)/i);
    }
  });

  it("keeps Studio and analytics disabled while Auth, Storage, Realtime and Edge are enabled", () => {
    expect(config).toMatch(/\[studio\][\s\S]*?enabled\s*=\s*false/);
    expect(config).toMatch(/\[analytics\][\s\S]*?enabled\s*=\s*false/);
    for (const section of ["auth", "storage", "realtime", "edge_runtime"]) {
      expect(config).toMatch(new RegExp(`\\[${section}\\][\\s\\S]*?enabled\\s*=\\s*true`));
    }
  });
});
