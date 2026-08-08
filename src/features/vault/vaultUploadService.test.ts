import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import {
  buildVaultUploadPath,
  createVaultExternalLink,
  getVaultUploadScope,
} from "./vaultUploadService";

type IgniteSupabaseClient = SupabaseClient<Database>;

describe("Vault upload scope and storage paths", () => {
  it("builds exact club, team, and mini-league scope fields", () => {
    expect(getVaultUploadScope({ type: "club", clubId: "club-a", clubName: "Club A" }))
      .toEqual({ club_id: "club-a" });
    expect(getVaultUploadScope({
      type: "team", clubId: "club-a", clubName: "Club A", teamId: "team-a", teamName: "Team A",
    })).toEqual({ club_id: "club-a", team_id: "team-a" });
    expect(getVaultUploadScope({
      type: "mini-league", clubId: "club-a", clubName: "Club A",
      miniLeagueId: "league-a", miniLeagueName: "League A",
    })).toEqual({ club_id: "club-a", mini_league_id: "league-a" });
    expect(getVaultUploadScope({ type: "root" })).toEqual({});
  });

  it("builds the characterized team storage path", () => {
    expect(buildVaultUploadPath({
      view: {
        type: "team", clubId: "club-a", clubName: "Club A", teamId: "team-a", teamName: "Team A",
      },
      userId: "user-a",
      fileName: "report.pdf",
      timestamp: 123,
      randomValue: 0.123456789,
    })).toBe("clubs/club-a/teams/team-a/user-a/123-xjylrx.pdf");
  });

  it("builds club, mini-league, and unassigned paths without cross-scope IDs", () => {
    const stable = { userId: "user-a", fileName: "photo.jpg", timestamp: 123, randomValue: 0.5 };
    expect(buildVaultUploadPath({
      ...stable, view: { type: "club", clubId: "club-a", clubName: "Club A" },
    })).toBe("clubs/club-a/user-a/123-.jpg");
    expect(buildVaultUploadPath({
      ...stable,
      view: {
        type: "mini-league", clubId: "club-a", clubName: "Club A",
        miniLeagueId: "league-a", miniLeagueName: "League A",
      },
    })).toBe("clubs/club-a/mini-leagues/league-a/user-a/123-.jpg");
    expect(buildVaultUploadPath({ ...stable, view: { type: "root" } }))
      .toBe("unassigned/user-a/123-.jpg");
  });
});

function insertClient(error: unknown = null) {
  const inserts: unknown[] = [];
  const query = {
    insert: (payload: unknown) => {
      inserts.push(payload);
      return Promise.resolve({ data: null, error });
    },
  };
  return { client: { from: () => query } as unknown as IgniteSupabaseClient, inserts };
}

describe("Vault external-link creation", () => {
  it("creates a zero-byte team-scoped external link with exact ownership and folder", async () => {
    const fake = insertClient();
    await createVaultExternalLink({
      url: "https://example.com/document",
      name: "Shared document",
      userId: "user-a",
      folderId: "folder-a",
      view: {
        type: "team", clubId: "club-a", clubName: "Club A", teamId: "team-a", teamName: "Team A",
      },
    }, fake.client);
    expect(fake.inserts).toEqual([{
      file_url: "https://example.com/document",
      uploaded_by: "user-a",
      name: "Shared document",
      folder_id: "folder-a",
      is_external_link: true,
      file_size: 0,
      club_id: "club-a",
      team_id: "team-a",
    }]);
  });

  it("applies mini-league scope without inventing a team ID", async () => {
    const fake = insertClient();
    await createVaultExternalLink({
      url: "https://example.com/fixture",
      name: "Fixture",
      userId: "user-a",
      folderId: null,
      view: {
        type: "mini-league", clubId: "club-a", clubName: "Club A",
        miniLeagueId: "league-a", miniLeagueName: "League A",
      },
    }, fake.client);
    expect(fake.inserts[0]).toMatchObject({ club_id: "club-a", mini_league_id: "league-a" });
    expect(fake.inserts[0]).not.toHaveProperty("team_id");
  });

  it("propagates insertion failures", async () => {
    const denied = { message: "permission denied", code: "42501" };
    const fake = insertClient(denied);
    await expect(createVaultExternalLink({
      url: "https://example.com",
      name: "Denied",
      userId: "user-a",
      folderId: null,
      view: { type: "root" },
    }, fake.client)).rejects.toBe(denied);
  });
});
