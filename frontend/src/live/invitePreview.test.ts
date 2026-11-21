import { beforeEach, describe, expect, it, vi } from "vitest";

// Independent unit coverage for the public invite dispatcher; JoinTeamPage's
// component tests mock this module and cannot cover provider selection.
const state = vi.hoisted(() => ({ backend: "supabase" as "supabase" | "icp" }));
vi.mock("./authBackendMode", () => ({ resolveAuthBackend: () => state.backend }));
vi.mock("./targetRegistry", () => ({ getActiveIcpTarget: () => ({ canisterIds: { club_domain: "g1" } }) }));
vi.mock("./publicGroupReads", () => ({
  readFreshPublicTargets: async () => [
    { canisterIds: { club_domain: "g1" } },
    { canisterIds: { club_domain: "g2" } },
  ],
}));
vi.mock("@icp-sdk/core/agent", () => ({
  AnonymousIdentity: class {
    getPrincipal() { return { isAnonymous: () => true }; }
  },
}));
vi.mock("./featureRouter", () => ({
  withFeatureBackend: async (_feature: string, providers: any) => providers.supabase(),
}));

import { readInvitePreview } from "./invitePreview";

beforeEach(() => { state.backend = "supabase"; });

describe("signed-out team invitation preview backend isolation", () => {
  it("resolves ICP pending invitations anonymously on an email-default device", async () => {
    const supabase = vi.fn();
    const icp = vi.fn(async (ctx: any) => ctx.target.canisterIds.club_domain === "g2" ? { id: "pinv-member", club_id: "club" } : null);
    expect(await readInvitePreview("pinv-member", { supabase, icp })).toEqual({ id: "pinv-member", club_id: "club" });
    expect(supabase).not.toHaveBeenCalled();
  });
  it("uses anonymous ICP lookup for an explicit on-chain invite despite email default", async () => {
    const supabase = vi.fn(async () => ({ source: "email" }));
    const icp = vi.fn(async (ctx: any) => ctx.target.canisterIds.club_domain === "g2"
      ? { source: "icp", role: "parent" }
      : null);
    const result = await readInvitePreview("tok-0123456789abcdef0123456789abcdef", { supabase, icp } as any, { forceIcp: true });
    expect(result).toEqual({ source: "icp", role: "parent" });
    expect(supabase).not.toHaveBeenCalled();
    expect(icp).toHaveBeenCalledTimes(2);
  });

  it("preserves the existing email invite lookup when ICP was not explicitly selected", async () => {
    const supabase = vi.fn(async () => ({ source: "email" }));
    const icp = vi.fn(async () => null);
    const result = await readInvitePreview("email-invite-token", { supabase, icp } as any);
    expect(result).toEqual({ source: "email" });
    expect(supabase).toHaveBeenCalledTimes(1);
    expect(icp).not.toHaveBeenCalled();
  });

  it("fails closed if two ICP groups claim the same invitation", async () => {
    const supabase = vi.fn(async () => null);
    const icp = vi.fn(async () => ({ source: "icp" }));
    await expect(readInvitePreview("tok-0123456789abcdef0123456789abcdef",
      { supabase, icp } as any, { forceIcp: true }))
      .rejects.toThrow("Invitation has multiple owners");
    expect(supabase).not.toHaveBeenCalled();
  });
});
