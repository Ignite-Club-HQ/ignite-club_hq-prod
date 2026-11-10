import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ backend: "supabase", raw: "false", value: false as unknown, from: vi.fn(), read: vi.fn(), channel: vi.fn() }));
vi.mock("@/live/authBackendMode", () => ({ resolveAuthBackend: () => m.backend }));
vi.mock("@/live/targetRegistry", () => ({ getActiveIcpTarget: () => ({ host: "https://icp-api.io", canisterIds: { club_domain: "aaaaa-aa" } }) }));
vi.mock("@/live/appConfig", () => ({ readLiveAppConfig: m.read }));
vi.mock("@/live/features/appSettings", () => ({ decodeAppSettingBool: (raw: string | null, fallback: boolean) => raw == null ? fallback : JSON.parse(raw) === true }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: m.from, channel: m.channel, removeChannel: vi.fn() } }));
import { useChatVirtualizationEnabled } from "./useChatVirtualizationEnabled";
import { useChatBasicChunkSize } from "./useChatBasicChunkSize";
import { useChatRecapGloballyEnabled } from "./useChatRecapGloballyEnabled";
import { useFreeClubPollingEnabled } from "./useFreeClubPollingEnabled";

beforeEach(() => {
  vi.clearAllMocks(); m.backend = "supabase"; m.value = false; m.raw = "true";
  m.read.mockImplementation(async () => m.raw);
  const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: { value: m.value }, error: null }) };
  m.from.mockReturnValue(chain);
  const channel = { on: () => channel, subscribe: () => channel };
  m.channel.mockReturnValue(channel);
});

describe("shared settings never reuse email values in ICP", () => {
  it.each([
    ["virtualisation", useChatVirtualizationEnabled, false, true],
    ["recap", useChatRecapGloballyEnabled, false, true],
    ["free polling", useFreeClubPollingEnabled, false, true],
    ["message chunk", useChatBasicChunkSize, 25, 80],
  ] as const)("%s reads the new source after switching modes", async (_name, hook, emailValue, icpValue) => {
    m.value = emailValue; m.raw = JSON.stringify(icpValue);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result, rerender, unmount } = renderHook(() => hook(), { wrapper });
    await waitFor(() => expect(result.current).toBe(emailValue));
    m.backend = "icp"; m.from.mockClear(); m.channel.mockClear(); rerender();
    await waitFor(() => expect(m.read).toHaveBeenCalled());
    await waitFor(() => expect(result.current).toBe(icpValue));
    expect(m.from).not.toHaveBeenCalled(); expect(m.channel).not.toHaveBeenCalled();
    unmount(); client.clear();
  });
});