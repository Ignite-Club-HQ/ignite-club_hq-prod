import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const workflow = readFileSync(
  resolve(process.cwd(), ".github/workflows/promote-to-prod.yml"),
  "utf8",
);

const prJobStart = workflow.indexOf("  validate-prod-pr:");
const promoteJobStart = workflow.indexOf("  promote:");
const prJob = workflow.slice(prJobStart, promoteJobStart);
const promoteJob = workflow.slice(promoteJobStart);

describe("production promotion workflow event isolation", () => {
  it("has a dedicated pull-request job and a separately gated production job", () => {
    expect(prJobStart).toBeGreaterThan(-1);
    expect(promoteJobStart).toBeGreaterThan(prJobStart);
    expect(prJob).toContain("if: github.event_name == 'pull_request'");
    expect(promoteJob).toContain(
      "if: github.event_name != 'pull_request' && github.ref_name == 'prod'",
    );
  });

  it("keeps the pull-request job repository-only", () => {
    expect(prJob).toContain("persist-credentials: false");
    expect(prJob).toContain("scripts/destructive-migration-guard.mjs");
    expect(prJob).toContain("git diff --name-status");

    expect(prJob).not.toMatch(/secrets\./);
    expect(prJob).not.toMatch(/supabase\/setup-cli/);
    expect(prJob).not.toMatch(/supabase\s+(?:link|db|migration|functions)/);
    expect(prJob).not.toMatch(/psql|postgresql:\/\//);
  });

  it("retains production operations only inside the event-gated job", () => {
    expect(promoteJob).toContain("secrets.SUPABASE_ACCESS_TOKEN");
    expect(promoteJob).toContain("supabase link --project-ref");
    expect(promoteJob).toContain("supabase db push --linked");
    expect(promoteJob).toContain("supabase functions deploy");
  });
});
