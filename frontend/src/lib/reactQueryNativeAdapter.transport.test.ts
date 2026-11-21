import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onlineManager, QueryClient } from "@tanstack/react-query";

const mode = vi.hoisted(() => ({ icp: false, host: "https://engine.example.invalid", resume: undefined as undefined | ((s: { isActive: boolean }) => void) }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => "android" } }));
vi.mock("@capacitor/network", () => ({ Network: { getStatus: async () => ({ connected: true }), addListener: async () => ({ remove() {} }) } }));
vi.mock("@capacitor/app", () => ({ App: { addListener: async (event: string, callback: (s: { isActive: boolean }) => void) => {
  if (event === "appStateChange") mode.resume = callback;
  return { remove() {} };
} } }));
vi.mock("@/live/strictIcpTransport", () => ({ strictIcpActive: () => mode.icp }));
vi.mock("@/live/targetRegistry", () => ({ getActiveIcpTarget: () => ({ host: mode.host }) }));
vi.mock("@/lib/supabaseEndpoint", () => ({ supabaseOrigin: () => "https://email.example.invalid" }));
vi.mock("@/lib/supabaseAuthRetry", () => ({ abortAllInFlightRestGets: vi.fn() }));
import { setupReactQueryNativeAdapter } from "./reactQueryNativeAdapter";

const settle = async () => { await vi.advanceTimersByTimeAsync(1); };
describe("native recovery uses the active sign-in backend", () => {
  let client: QueryClient;
  let network: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    mode.icp = false; mode.host = "https://engine.example.invalid"; mode.resume = undefined;
    network = vi.fn().mockResolvedValue(new Response("reachable"));
    vi.stubGlobal("fetch", network);
    onlineManager.setOnline(true);
    client = new QueryClient();
  });
  afterEach(() => { client.clear(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); onlineManager.setOnline(true); });

  async function resume() {
    mode.resume?.({ isActive: false });
    mode.resume?.({ isActive: true });
    await settle();
  }

  it("never asks email authentication about an ICP connection", async () => {
    mode.icp = true;
    setupReactQueryNativeAdapter(client);
    await settle();
    expect(mode.resume).toBeTypeOf("function");
    await resume();
    expect(network).toHaveBeenCalledTimes(1);
    expect(network.mock.calls[0][0]).toBe("https://engine.example.invalid/api/v2/status");
  });

  it("keeps the existing email health probe for Supabase sessions", async () => {
    setupReactQueryNativeAdapter(client);
    await settle();
    await resume();
    expect(network).toHaveBeenCalledTimes(1);
    expect(network.mock.calls[0][0]).toBe("https://email.example.invalid/auth/v1/health");
  });

  it("resolves a switched backend and engine host afresh on each resume", async () => {
    setupReactQueryNativeAdapter(client);
    await settle();
    await resume();
    mode.icp = true; mode.host = "https://second-engine.example.invalid";
    await resume();
    expect(network.mock.calls.map(call => call[0])).toEqual([
      "https://email.example.invalid/auth/v1/health",
      "https://second-engine.example.invalid/api/v2/status",
    ]);
  });
});