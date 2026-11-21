import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Only a session that has really ended may send a member back to sign-in.
 * A momentary "can't act" (identity being re-minted, record moving under the
 * client) must read as "unknown" so open forms are not thrown away.
 */

const state = vi.hoisted(() => ({
  status: "signed-in" as string,
  getIdentityThrows: false,
}));

vi.mock("@/lib/perfStages", () => ({ markStage: vi.fn(), restartSignInStages: vi.fn() }));
vi.mock("./privateProfileSession", () => ({
  observePrivateProfilePrincipal: vi.fn(),
  retirePrivateProfileSession: vi.fn(),
}));
vi.mock("./targetRegistry", () => ({
  getActiveIcpTarget: () => ({ alias: "test-target", host: "https://icp0.io", canisterIds: {} }),
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));

const fakeIdentity = {
  getPrincipal: () => ({ isAnonymous: () => false, toText: () => "test-principal-aaaa" }),
};

vi.mock("@icp-sdk/auth/client", () => ({
  AuthClient: class {
    getStatus() { return { state: state.status }; }
    isAuthenticated() { return state.status === "signed-in"; }
    async getIdentity() {
      if (state.getIdentityThrows) throw new Error("SessionNotHeldError");
      return fakeIdentity;
    }
    async signIn() { return fakeIdentity; }
    async signOut() {}
    dispose() {}
  },
}));

const STORED = JSON.stringify({ provider: "internet-identity", principal: "test-principal-aaaa" });

async function fresh() {
  vi.resetModules();
  return import("./internetIdentityAuth");
}

describe("getInternetIdentitySessionHealth", () => {
  beforeEach(() => {
    state.status = "signed-in";
    state.getIdentityThrows = false;
    localStorage.clear();
    localStorage.setItem("ignite_icp_internet_identity_session", STORED);
  });

  it("is active for a valid session", async () => {
    const mod = await fresh();
    expect(await mod.getInternetIdentitySessionHealth()).toBe("active");
  });

  it("is ended when the delegation has expired", async () => {
    state.status = "expired";
    const mod = await fresh();
    expect(await mod.getInternetIdentitySessionHealth()).toBe("ended");
  });

  it("is ended when nothing is stored on this device", async () => {
    localStorage.clear();
    const mod = await fresh();
    expect(await mod.getInternetIdentitySessionHealth()).toBe("ended");
  });

  it("is unknown (not signed out) when the identity briefly cannot be read but the record is still signed in", async () => {
    state.getIdentityThrows = true;
    const mod = await fresh();
    expect(await mod.getInternetIdentitySessionHealth()).toBe("unknown");
  });

  it("is ended after an explicit sign-out", async () => {
    const mod = await fresh();
    await mod.warmInternetIdentityAuthClient();
    vi.doMock("./icpAgent", () => ({ clearLiveAgentCache: vi.fn() }));
    vi.doMock("./piiVetKeys", () => ({ clearPiiVetKeyCache: vi.fn() }));
    vi.doMock("./groupDispatch", () => ({ wipeGroupOwnerCache: vi.fn() }));
    await mod.signOutInternetIdentity();
    expect(await mod.getInternetIdentitySessionHealth()).toBe("ended");
  });
});

describe("revoked DEV delegation recovery policy", () => {
  const revoked = new Error("Identity revoked; surviving-account relink required");
  it.each([
    "https://proe7-kqaaa-aaaas-qg6gq-cai.icp.net",
    "https://proe7-kqaaa-aaaas-qg6gq-cai.icp0.io",
    "https://proe7-kqaaa-aaaas-qg6gq-cai.ic0.app",
    "https://ignite-club-launchpad.lovable.app",
  ])("recognizes the pinned DEV origin %s", async (origin) => {
    const auth = await fresh();
    expect(auth.shouldClearRevokedDevInternetIdentitySession(origin, revoked)).toBe(true);
  });

  it.each([
    "https://igniteclubhq.app",
    "https://igniteclubhq.com",
    "https://pjx2u-tiaaa-aaaac-qhj3a-cai.icp0.io",
    "https://example.com",
  ])("never runs the DEV recovery on %s", async (origin) => {
    const auth = await fresh();
    expect(auth.shouldClearRevokedDevInternetIdentitySession(origin, revoked)).toBe(false);
  });

  it("does not clear sessions for unrelated canister rejections", async () => {
    const auth = await fresh();
    const dev = "https://proe7-kqaaa-aaaas-qg6gq-cai.icp.net";
    for (const message of ["Account authority changed; retry", "Unlinked identity", "Account suspended", "Connection closed"]) {
      expect(auth.shouldClearRevokedDevInternetIdentitySession(dev, new Error(message))).toBe(false);
    }
  });
});
