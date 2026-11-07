import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ authenticated: false, listener: undefined as (() => void) | undefined,
  unsubscribe: vi.fn(), signIn: vi.fn(), targetHost: "https://icp-api.io", constructions: 0 }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock("./targetRegistry", () => ({ getActiveIcpTarget: () => ({ alias: "dev", host: state.targetHost, canisterIds: {} }) }));
const identity = { getPrincipal: () => ({ isAnonymous: () => false, toText: () => "caller" }) };
vi.mock("@icp-sdk/auth/client", () => ({ AuthClient: class {
  constructor() { state.constructions++; }
  isAuthenticated() { return state.authenticated; }
  async getIdentity() { return identity; }
  signIn() { return state.signIn(); }
  subscribe(listener: () => void) { state.listener = listener; return state.unsubscribe; }
  dispose() {}
} }));
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); localStorage.clear(); state.authenticated = false;
  state.listener = undefined; state.targetHost = "https://icp-api.io"; state.constructions = 0; });
it("SDK completion immediately resolves without a recovery timer", async () => {
  const mod = await import("./internetIdentityAuth");
  mod.setInternetIdentityAccountProvisionerForTests(async () => {});
  await mod.warmInternetIdentityAuthClient();
  state.signIn.mockResolvedValue(identity);
  await expect(mod.signInWithInternetIdentity()).resolves.toEqual({ principal: "caller", provider: "internet-identity" });
  expect(state.unsubscribe).toHaveBeenCalledOnce();
});
it("a validated stored-session notification wakes recovery immediately and cleans listeners", async () => {
  const mod = await import("./internetIdentityAuth");
  mod.setInternetIdentityAccountProvisionerForTests(async () => {});
  await mod.warmInternetIdentityAuthClient();
  state.signIn.mockImplementation(() => new Promise(() => {}));
  const pending = mod.signInWithInternetIdentity();
  await vi.waitFor(() => expect(state.listener).toBeTypeOf("function"));
  state.authenticated = true; state.listener?.();
  await expect(pending).resolves.toEqual({ principal: "caller", provider: "internet-identity" });
  expect(state.unsubscribe).toHaveBeenCalledOnce();
});
it("rejects invalid sessions without registration", async () => {
  const mod = await import("./internetIdentityAuth");
  const provision = vi.fn(); mod.setInternetIdentityAccountProvisionerForTests(provision);
  await mod.warmInternetIdentityAuthClient();
  state.signIn.mockRejectedValue(Error("Invalid session"));
  await expect(mod.signInWithInternetIdentity()).rejects.toThrow("Invalid session");
  expect(provision).not.toHaveBeenCalled(); expect(state.unsubscribe).toHaveBeenCalledOnce();
});
it("rebuilds the auth client when the target changes under the same alias", async () => {
  const mod = await import("./internetIdentityAuth");
  await mod.warmInternetIdentityAuthClient();
  state.targetHost = "https://different.icp-api.io";
  await mod.warmInternetIdentityAuthClient();
  expect(state.constructions).toBe(2); expect(mod.isInternetIdentitySignInReady()).toBe(true);
});