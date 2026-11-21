import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ icp: false, path: "/auth", session: vi.fn(), rpc: vi.fn(), authChange: vi.fn() }));
vi.mock("@/live/strictIcpTransport", () => ({ strictIcpActive: () => m.icp }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "account-1" } }) }));
vi.mock("react-router-dom", () => ({ useLocation: () => ({ pathname: m.path }) }));
vi.mock("@/live/loadBackendRouting", () => ({ isFeatureRoutedToIcp: () => false }));
vi.mock("@/live/internetIdentityAuth", () => ({ getCurrentInternetIdentity: vi.fn() }));
vi.mock("@/live/targetRegistry", () => ({ getActiveIcpTarget: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getSession: m.session, onAuthStateChange: m.authChange }, rpc: m.rpc,
} }));
import { useActivityTracking } from "./useActivityTracking";
const session = { user: { id: "account-1" }, access_token: "synthetic-not-a-credential" };
const settle = async () => { for (let n = 0; n < 10; n++) await Promise.resolve(); };

describe("activity tracking never checks email authentication in strict ICP mode", () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.clearAllMocks(); m.icp = false; m.path = "/auth";
    m.session.mockResolvedValue({ data: { session } });
    m.rpc.mockResolvedValue({ data: "activity-1", error: null });
    m.authChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ok")));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("does not read email sessions on auth, profile, children, settings or Home", async () => {
    m.icp = true;
    const hook = renderHook(() => useActivityTracking());
    for (const path of ["/auth", "/profile", "/children", "/settings", "/"]) {
      m.path = path;
      hook.rerender();
      await act(async () => { vi.advanceTimersByTime(1_000); await settle(); });
    }
    expect(m.session).not.toHaveBeenCalled();
    expect(m.rpc).not.toHaveBeenCalled();
    expect(m.authChange).not.toHaveBeenCalled();
  });

  it("preserves email activity but stops duration/unload callbacks after an ICP switch", async () => {
    const hook = renderHook(() => useActivityTracking());
    await act(async () => { vi.advanceTimersByTime(600); await settle(); });
    expect(m.rpc).toHaveBeenCalledWith("track_user_activity_start", expect.objectContaining({ _page_path: "/auth" }));
    m.icp = true;
    m.session.mockClear(); m.rpc.mockClear();
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      window.dispatchEvent(new Event("beforeunload"));
      await settle();
    });
    hook.rerender();
    expect(m.session).not.toHaveBeenCalled();
    expect(m.rpc).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});