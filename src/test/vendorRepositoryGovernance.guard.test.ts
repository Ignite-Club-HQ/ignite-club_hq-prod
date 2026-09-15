import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

const owners = read(".github/CODEOWNERS");
const template = read(".github/pull_request_template.md");

describe("vendor repository governance", () => {
  it("assigns ownership for production-sensitive paths", () => {
    for (const path of [
      "/.github/workflows/",
      "/supabase/migrations/",
      "/supabase/functions/",
      "/src/integrations/supabase/",
      "/src/features/membership/",
      "/src/features/messaging/",
      "/src/features/events/",
      "/src/features/competitions/",
      "/src/features/vault/",
      "/src/components/subscription/",
      "/android/",
      "/ios/",
    ]) {
      expect(owners, `${path} should have a CODEOWNER`).toMatch(
        new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+@`, "m"),
      );
    }
  });

  it("states clearly that ownership is advisory unless a ruleset enforces it", () => {
    expect(owners).toContain("only if a branch ruleset separately enables");
  });

  it("requires PR authors to disclose the principal release risks", () => {
    for (const requirement of [
      "Authentication, roles, RLS, or tenant isolation",
      "Free/Pro entitlement impact",
      "Payments/IAP impact",
      "Migration files",
      "Changed Edge Functions",
      "Complete isolated baseline",
      "Known-good rollback commit",
    ]) {
      expect(template).toContain(requirement);
    }
  });
});
