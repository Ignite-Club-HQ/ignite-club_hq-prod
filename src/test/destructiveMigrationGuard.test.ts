import { describe, expect, it } from "vitest";
import {
  ALLOW_MARKER,
  scanMigrationSql,
} from "../../scripts/destructive-migration-guard.mjs";

describe("destructive migration guard", () => {
  it.each([
    ["delete", "DELETE FROM public.events WHERE starts_at < now();"],
    ["update", "UPDATE profiles SET avatar_url = NULL;"],
    ["truncate", "TRUNCATE ONLY public.notifications;"],
    ["drop table", "DROP TABLE IF EXISTS public.rsvps;"],
    ["drop media column", "ALTER TABLE photos DROP COLUMN IF EXISTS image_url;"],
  ])("flags protected %s statements", (_label, sql) => {
    expect(scanMigrationSql(sql).findings).toHaveLength(1);
  });

  it("is case-insensitive and tolerates multiline SQL whitespace", () => {
    const result = scanMigrationSql(
      "delete\n  from\n  public.club_messages\nwhere created_at < now();",
    );
    expect(result.findings).toEqual([
      expect.objectContaining({ line: 1, statement: "delete from public.club_messages" }),
    ]);
  });

  it("does not block additive or non-protected migrations", () => {
    const sql = [
      "ALTER TABLE public.events ADD COLUMN livestream_url text;",
      "CREATE INDEX events_starts_at_idx ON public.events(starts_at);",
      "UPDATE public.synthetic_test_fixture SET enabled = false;",
    ].join("\n");
    expect(scanMigrationSql(sql)).toEqual({ allowed: false, findings: [] });
  });

  it("recognises the production workflow's explicit review marker", () => {
    const sql = [
      "-- promote-guard: allow",
      "DELETE FROM public.events WHERE id IS NULL;",
    ].join("\n");
    expect(ALLOW_MARKER.test(sql)).toBe(true);
    expect(scanMigrationSql(sql)).toEqual({ allowed: true, findings: [] });
  });

  it("does not accept similar-looking or incomplete allow markers", () => {
    const result = scanMigrationSql(
      "-- promote guard allow\nDELETE FROM public.events;",
    );
    expect(result.allowed).toBe(false);
    expect(result.findings).toHaveLength(1);
  });
});
