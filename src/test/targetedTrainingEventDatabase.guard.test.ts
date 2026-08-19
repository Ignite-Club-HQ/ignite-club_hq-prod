import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260819040000_allow_targeted_training_events.sql",
);
const migration = readFileSync(migrationPath, "utf8");

describe("targeted training event database contract", () => {
  it("allows training alongside the existing game and social event types", () => {
    expect(migration).toMatch(
      /NEW\.type\s+NOT\s+IN\s*\(\s*'game'\s*,\s*'social'\s*,\s*'training'\s*\)/i,
    );
  });

  it("retains the two-distinct-team minimum", () => {
    expect(migration).toContain("IF arr_len < 2 THEN");
    expect(migration).toContain("IF distinct_len <> arr_len THEN");
  });

  it("retains the club-wide-only and same-club boundaries", () => {
    expect(migration).toContain("IF NEW.team_id IS NOT NULL THEN");
    expect(migration).toContain("t.club_id <> NEW.club_id");
    expect(migration).toContain("IF NEW.club_id IS NULL THEN");
  });

  it("remains fail-closed for empty target arrays", () => {
    expect(migration).toContain("IF arr_len = 0 THEN");
    expect(migration).toContain("USING ERRCODE = 'check_violation'");
  });
});
