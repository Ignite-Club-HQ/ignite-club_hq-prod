import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import {
  isVaultDriveEnabled,
  resolveVaultDriveTitles,
} from "./vaultDriveService";

type IgniteSupabaseClient = SupabaseClient<Database>;

describe("Vault Google Drive feature boundary", () => {
  it("allows exactly the three established clubs", () => {
    expect(isVaultDriveEnabled("966bdaec-ebf1-46da-b2b3-cc53bf05c422")).toBe(true);
    expect(isVaultDriveEnabled("493ee2e3-c834-487d-93be-d1c8a0dbc4a8")).toBe(true);
    expect(isVaultDriveEnabled("36231b76-5313-478e-b8d5-23ac4f5e8b10")).toBe(true);
  });

  it("fails closed for absent and non-allowlisted clubs", () => {
    expect(isVaultDriveEnabled(undefined)).toBe(false);
    expect(isVaultDriveEnabled(null)).toBe(false);
    expect(isVaultDriveEnabled("another-club")).toBe(false);
  });

  it("invokes title resolution with only the exact club ID", async () => {
    const summary = { scanned: 4, updated: 3, unresolved: 1, errors: 0, hasOAuth: true };
    const invoke = vi.fn().mockResolvedValue({ data: { summary }, error: null });
    const client = { functions: { invoke } } as unknown as IgniteSupabaseClient;

    await expect(resolveVaultDriveTitles("club-a", client)).resolves.toBe(summary);
    expect(invoke).toHaveBeenCalledWith("resolve-drive-titles", { body: { clubId: "club-a" } });
  });

  it("preserves an absent summary for the existing no-change UI path", async () => {
    const client = {
      functions: { invoke: vi.fn().mockResolvedValue({ data: {}, error: null }) },
    } as unknown as IgniteSupabaseClient;
    await expect(resolveVaultDriveTitles("club-a", client)).resolves.toBeUndefined();
  });

  it("propagates Edge Function failures", async () => {
    const denied = { message: "permission denied" };
    const client = {
      functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: denied }) },
    } as unknown as IgniteSupabaseClient;
    await expect(resolveVaultDriveTitles("club-a", client)).rejects.toBe(denied);
  });
});
