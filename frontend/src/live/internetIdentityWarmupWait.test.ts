import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Cold-start behaviour: a screen asking for the identity before the auth
 * client exists must WAIT for the shared warm-up (bounded), not answer
 * "signed out" instantly — instant nulls forced callers into fail-and-retry
 * loops that stacked ~13s of dead time onto cold chat opens.
 */

const state = vi.hoisted(() => ({
  constructDelayMs: 80,
  constructFails: false,
  constructed: 0,
}));

vi.mock("@/lib/perfStages", () => ({ markStage: vi.fn(), restartSignInStages: vi.fn() }));
vi.mock("./privateProfileSession", () => ({
  observePrivateProfilePrincipal: vi.fn(),
  retirePrivateProfileSession: vi.fn(),
  capturePrivateProfileSession: () => () => {},
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
    constructor() {
      state.constructed += 1;
      if (state.constructFails) return Promise.reject(new Error("chunk load failed"));
      return new Promise((resolve) => setTimeout(() => resolve(this), state.constructDelayMs));
    }
    isAuthenticated() { return true; }
    async getIdentity() { return fakeIdentity; }
    async signIn() { return fakeIdentity; }
    async signOut() {}
    dispose() {}
  },
}));

async function freshModule() {
  vi.resetModules();
  return import("./internetIdentityAuth");
}

const STORED_SESSION = JSON.stringify({ provider: "internet-identity", principal: "test-principal-aaaa" });

describe("getCurrentInternetIdentity cold-start wait", () => {
  beforeEach(() => {
    state.constructDelayMs = 80;
    state.constructFails = false;
    state.constructed = 0;
    localStorage.clear();
  });

  it("waits for the in-flight warm-up and returns the identity instead of an instant null", async () => {
    localStorage.setItem("ignite_icp_internet_identity_session", STORED_SESSION);
    const mod = await freshModule();
    const started = Date.now();
    const identity = await mod.getCurrentInternetIdentity();
    const elapsed = Date.now() - started;
    expect(identity).toBe(fakeIdentity);
    // It waited for the client construction rather than answering null at t=0.
    expect(elapsed).toBeGreaterThanOrEqual(state.constructDelayMs - 20);
    expect(state.constructed).toBe(1);
  });

  it("shares one warm-up across concurrent callers", async () => {
    localStorage.setItem("ignite_icp_internet_identity_session", STORED_SESSION);
    const mod = await freshModule();
    const [a, b] = await Promise.all([
      mod.getCurrentInternetIdentity(),
      mod.getCurrentInternetIdentity(),
    ]);
    expect(a).toBe(fakeIdentity);
    expect(b).toBe(fakeIdentity);
    expect(state.constructed).toBe(1);
  });

  it("shares construction between warm-up and silent resume", async () => {
    const mod = await freshModule();
    mod.setInternetIdentityAccountProvisionerForTests(async () => {});
    await Promise.all([mod.warmInternetIdentityAuthClient(), mod.resumeInternetIdentitySession()]);
    expect(state.constructed).toBe(1);
  });

  it("answers null (bounded) when the warm-up fails", async () => {
    localStorage.setItem("ignite_icp_internet_identity_session", STORED_SESSION);
    state.constructFails = true;
    const mod = await freshModule();
    const started = Date.now();
    const identity = await mod.getCurrentInternetIdentity();
    expect(identity).toBeNull();
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("answers null immediately when no sign-in is stored (nothing to wait for)", async () => {
    const mod = await freshModule();
    const started = Date.now();
    const identity = await mod.getCurrentInternetIdentity();
    expect(identity).toBeNull();
    expect(Date.now() - started).toBeLessThan(state.constructDelayMs);
    expect(state.constructed).toBe(0);
  });
});
