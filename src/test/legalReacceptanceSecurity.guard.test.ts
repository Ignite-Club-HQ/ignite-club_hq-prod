import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(__dirname, "../../supabase/migrations/20260731061058_515faabc-bfd9-4feb-805b-b57fcbb19c0c.sql"),
  "utf8",
);
const settingsPage = readFileSync(join(__dirname, "../pages/AppSettingsPage.tsx"), "utf8");
const app = readFileSync(join(__dirname, "../App.tsx"), "utf8");

describe("legal reacceptance security contracts", () => {
  it("seeds the global switch explicitly off", () => {
    expect(migration).toMatch(/'legal_reacceptance'[\s\S]*'required',\s*false/);
    expect(migration).toMatch(/ON CONFLICT \(key\) DO NOTHING/);
  });

  it("allows activation only through an authenticated app-admin RPC", () => {
    expect(migration).toMatch(/auth\.uid\(\)/);
    expect(migration).toMatch(/has_role\(_uid,\s*'app_admin'::app_role/);
    expect(migration).toMatch(/RAISE EXCEPTION 'Only app admins can change legal re-acceptance'/);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.set_legal_reacceptance[\s\S]*FROM PUBLIC, anon/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.set_legal_reacceptance[\s\S]*TO authenticated/);
  });

  it("requires the exact confirmation phrase and a non-empty version", () => {
    expect(migration).toContain("REQUIRE ALL USERS TO REACCEPT");
    expect(migration).toMatch(/_confirmation IS DISTINCT FROM/);
    expect(migration).toMatch(/_version IS NULL OR length\(btrim\(_version\)\) = 0/);
  });

  it("creates a fresh effective timestamp for every separate activation", () => {
    expect(migration).toMatch(/'effective_at',\s*now\(\)/);
    expect(migration).toMatch(/'activated_at',\s*now\(\)/);
    expect(migration).toMatch(/legal_reacceptance_enabled/);
  });

  it("records acceptance only against the authenticated user's profile", () => {
    expect(migration).toMatch(/IF _uid IS NULL[\s\S]*RAISE EXCEPTION 'Not authenticated'/);
    expect(migration).toMatch(/UPDATE public\.profiles[\s\S]*terms_accepted_at = now\(\)[\s\S]*privacy_accepted_at = now\(\)[\s\S]*WHERE id = _uid/);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.accept_current_legal_terms\(\) FROM PUBLIC, anon/);
  });

  it("keeps the admin control behind the App Settings app-admin gate", () => {
    expect(settingsPage).toMatch(/\.eq\("role",\s*"app_admin"\)/);
    expect(settingsPage).toMatch(/if \(!isAppAdmin\)[\s\S]*Access denied\. App admin role required/);
    expect(settingsPage.indexOf("if (!isAppAdmin)")).toBeLessThan(
      settingsPage.indexOf("<LegalReacceptanceAdminCard />"),
    );
  });

  it("mounts the blocking gate globally inside authenticated application infrastructure", () => {
    expect(app).toContain("<LegalReacceptanceGate />");
    expect(app.indexOf("<LegalReacceptanceGate />")).toBeGreaterThan(app.indexOf("<AuthProvider"));
  });
});
