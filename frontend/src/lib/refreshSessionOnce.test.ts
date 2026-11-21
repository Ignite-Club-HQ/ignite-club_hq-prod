import { describe, it, expect, vi, beforeEach } from "vitest";

const mode = vi.hoisted(() => ({ icp: false, sessionCalls: 0 }));
vi.mock("@/live/strictIcpTransport", () => ({ strictIcpActive: () => mode.icp }));

const state = {
  refreshCalls: 0,
  session: { access_token: "new", user: { id: "u1" } } as any,
  refreshImpl: null as null | (() => Promise<any>),
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      refreshSession: async () => {
        state.refreshCalls += 1;
        if (state.refreshImpl) return state.refreshImpl();
        await new Promise((r) => setTimeout(r, 20));
        return { data: { session: state.session }, error: null };
      },
      getSession: async () => { mode.sessionCalls++; return { data: { session: state.session }, error: null }; },
    },
  },
}));

import { refreshSessionOnce, __resetRefreshSessionOnce, isStaleRefreshTokenError } from "./refreshSessionOnce";

describe("refreshSessionOnce", () => {
  beforeEach(() => {
    mode.icp = false; mode.sessionCalls = 0;
    state.refreshCalls = 0;
    state.refreshImpl = null;
    state.session = { access_token: "new", user: { id: "u1" } };
    __resetRefreshSessionOnce();
  });

  it("never refreshes or reads an email session in ICP mode", async () => {
    mode.icp = true;
    expect((await refreshSessionOnce(10)).session).toBeNull();
    expect(state.refreshCalls).toBe(0);
    expect(mode.sessionCalls).toBe(0);
  });

  it("does not perform email recovery after an in-flight refresh fails during an ICP switch", async () => {
    state.refreshImpl = async () => { mode.icp = true; throw new Error("old refresh failed"); };
    const result = await refreshSessionOnce();
    expect(result.session).toBeNull();
    expect(mode.sessionCalls).toBe(0);
    expect(state.refreshCalls).toBe(1);
  });

  it("fires exactly one refresh for concurrent callers and shares the result", async () => {
    const [a, b, c] = await Promise.all([
      refreshSessionOnce(),
      refreshSessionOnce(),
      refreshSessionOnce(),
    ]);
    expect(state.refreshCalls).toBe(1);
    expect(a.session?.access_token).toBe("new");
    expect(b.session?.access_token).toBe("new");
    expect(c.session?.access_token).toBe("new");
    expect([a.shared, b.shared, c.shared].filter(Boolean).length).toBe(2);
    expect(a.error).toBeNull();
  });

  it("treats a rotated-refresh-token failure as benign when a session exists", async () => {
    state.refreshImpl = async () => ({
      data: { session: null },
      error: { message: "Invalid Refresh Token: Already Used", code: "refresh_token_already_used" },
    });
    const res = await refreshSessionOnce();
    expect(res.error).toBeNull();
    expect(res.benign).toBe(true);
    expect(res.session?.access_token).toBe("new");
  });

  it("surfaces a genuine rejection when no session remains", async () => {
    state.session = null;
    state.refreshImpl = async () => ({
      data: { session: null },
      error: { message: "invalid grant", code: "invalid_grant" },
    });
    const res = await refreshSessionOnce();
    expect(res.session).toBeNull();
    expect(res.error).toBeTruthy();
    expect(res.benign).toBe(false);
  });

  it("allows a new refresh after the previous one settles", async () => {
    await refreshSessionOnce();
    await refreshSessionOnce();
    expect(state.refreshCalls).toBe(2);
  });

  it("classifies stale refresh token errors", () => {
    expect(isStaleRefreshTokenError({ code: "refresh_token_not_found" })).toBe(true);
    expect(isStaleRefreshTokenError({ message: "Refresh Token Not Found" })).toBe(true);
    expect(isStaleRefreshTokenError({ message: "boom" })).toBe(false);
  });
});
