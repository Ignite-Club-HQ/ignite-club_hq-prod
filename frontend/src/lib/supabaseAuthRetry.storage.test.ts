import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { supabaseUrl: "https://storage-test.supabase.co" } }));
vi.mock("@/lib/clientPerfLog", () => ({ maybeLogSlowFetch: vi.fn() }));
vi.mock("@/lib/refreshSessionOnce", () => ({ refreshSessionOnce: vi.fn() }));

const originalFetch = window.fetch;
beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); });
afterEach(() => { window.fetch = originalFetch; vi.useRealTimers(); });

describe("storage listing recovery", () => {
  it("tracks POST listings as reads and aborts them at the read deadline", async () => {
    const network = vi.fn((_input, init: RequestInit | undefined) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }));
    window.fetch = network;
    const retry = await import("./supabaseAuthRetry");
    retry.installSupabaseAuthRetry();
    const request = window.fetch("https://storage-test.supabase.co/storage/v1/object/list/photos", { method: "POST" });
    const outcome = request.catch(error => error.name);
    const count = retry.getInFlightRestGetCount();
    await vi.advanceTimersByTimeAsync(25_000);
    // Clean up even when the old implementation failed to register the read.
    if (count === 0) return expect(count).toBe(1);
    expect(await outcome).toBe("AbortError");
    expect(retry.getInFlightRestGetCount()).toBe(0);
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("does not classify file writes as reads or replay them during recovery", async () => {
    const network = vi.fn().mockResolvedValue(new Response("ok"));
    window.fetch = network;
    const retry = await import("./supabaseAuthRetry");
    retry.installSupabaseAuthRetry();
    await window.fetch("https://storage-test.supabase.co/storage/v1/object/competition-vault/clubs/a/file.pdf", { method: "POST" });
    expect(retry.getInFlightRestGetCount()).toBe(0);
    expect(network.mock.calls[0][1]?.signal).toBeUndefined();
    expect(network).toHaveBeenCalledTimes(1);
  });
});