import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const DEV = "ecsdwrarzfexssxtrymj";
const PROD = "yabcfiuntwqjwvschnji";

describe("backend targets", () => {
  it("Codemagic (prod-only) never defaults to the DEV backend", () => {
    const cm = read("codemagic.yaml");
    expect(cm).not.toContain(`IGNITE_LIVE_SUPABASE_URL:-https://${DEV}`);
    expect(cm).toContain(`IGNITE_LIVE_SUPABASE_URL:-https://${PROD}.supabase.co`);
    expect(cm).toContain("Refusing PROD build against DEV backend");
  });

  it("test canister workflow (main) defaults to DEV", () => {
    expect(read(".github/workflows/deploy-frontend-canister.yml")).toContain(`https://${DEV}.supabase.co`);
  });

  it("DEV ref is labelled DEV", () => {
    expect(read("frontend/src/lib/env.ts")).toMatch(new RegExp(`"${DEV}", // Ignite Club HQ DEV`));
  });
});
