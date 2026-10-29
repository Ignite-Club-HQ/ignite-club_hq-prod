import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Static contract/security guards for the 2026-10-29 DEV compatibility migrations.
const dir = join(process.cwd(), "supabase/migrations");
const part1 = readFileSync(join(dir, "20261029030811_95cf86e6-11f0-45cc-8494-4c29eb100288.sql"), "utf8");
const part2 = readFileSync(join(dir, "20261029031008_fa1a98bb-1f6c-4ed5-a1af-c698dde997aa.sql"), "utf8");
const part3 = readFileSync(join(dir, "20261029031121_0f6c559d-4fdd-4254-a29e-e39122cf1b3d.sql"), "utf8");

describe("DEV compatibility migrations", () => {
  it("never invents club countries or upgrades subscriptions", () => {
    expect(part1).not.toMatch(/UPDATE\s+public\.clubs/i);
    expect(part1).toMatch(/pricing_version text NOT NULL DEFAULT 'legacy'/);
    expect(part1).not.toMatch(/UPDATE\s+public\.club_subscriptions/i);
  });

  it("does not restore score columns on competition_matches", () => {
    for (const sql of [part1, part2, part3]) {
      expect(sql).not.toMatch(/ALTER TABLE public\.competition_matches\s+ADD/i);
    }
  });

  it("keeps the hybrid RPC signatures", () => {
    expect(part1).toContain("read_game_history(p_team_id uuid DEFAULT NULL, p_club_id uuid DEFAULT NULL, p_limit integer DEFAULT 100)");
    expect(part1).toContain("save_game_history(p_result jsonb, p_only_if_missing boolean DEFAULT false)");
    expect(part1).toContain("read_history_player_stats(p_team_id uuid, p_event_id uuid DEFAULT NULL, p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL)");
    expect(part1).toContain("save_competition_match_result(p_match_id uuid, p_home_score integer, p_away_score integer, p_status text)");
    expect(part2).toContain("create_competition_role_email_invite(_competition_id uuid, _role text, _token text, _email text, _verification_code_hash text)");
    expect(part2).toContain("accept_competition_role_email_invite(p_token text, p_verification_code_hash text)");
  });

  it("history and result RPCs are signed-in only", () => {
    expect(part1).toMatch(/REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated/);
    const grantLine = part1.slice(part1.lastIndexOf("GRANT EXECUTE"));
    expect(grantLine).toMatch(/TO authenticated;\s*$/);
    expect(grantLine).not.toMatch(/anon/);
  });

  it("hidden competition scores never reach game_results via save_game_history", () => {
    expect(part1).toMatch(/IF public\.match_scores_hidden\(e\.competition_match_id\) THEN RETURN; END IF;/);
  });

  it("email invites require a verified, matching email and lock after 5 attempts", () => {
    expect(part2).toMatch(/email_confirmed_at IS NULL THEN\s+RETURN QUERY SELECT 'email_unverified'/);
    expect(part2).toMatch(/v_account_email <> lower\(btrim\(v_invite\.invited_email\)\)/);
    expect(part2).toMatch(/attempts \+ 1 >= 5 THEN 'locked'/);
    expect(part2).toMatch(/interval '48 hours'/);
    expect(part2).toMatch(/WHEN v_invite\.role = 'committee_member' THEN 'committee'/);
  });

  it("competition vault blocks direct client writes", () => {
    expect(part2).toMatch(/competition_vault_writes_service_only ON storage\.objects AS RESTRICTIVE FOR INSERT TO anon, authenticated/);
    expect(part2).toMatch(/competition_vault_updates_service_only ON storage\.objects AS RESTRICTIVE FOR UPDATE/);
  });

  it("new settings tables give signed-out visitors no access and nobody TRUNCATE", () => {
    expect(part3).toMatch(/REVOKE ALL ON public\.club_invite_message_defaults, public\.welcome_email_settings, public\.canister_memory_reports FROM PUBLIC, anon, authenticated/);
    expect(part3).not.toMatch(/TRUNCATE/);
    expect(part3).not.toMatch(/TO anon/);
  });
});
