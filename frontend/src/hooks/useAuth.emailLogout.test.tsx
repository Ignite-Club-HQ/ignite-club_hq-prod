import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ signOut: vi.fn(), navigate: vi.fn(), unregister: vi.fn(), callback: undefined as ((event: string, session: unknown) => void) | undefined }));
vi.mock("@/lib/appNavigator", () => ({ navigateApp: m.navigate }));
vi.mock("@/lib/nativePush", () => ({ isNativePlatform: () => true, unregisterNativePush: m.unregister }));
vi.mock("@/lib/prefetchData", () => ({ prefetchUserData: vi.fn() }));
vi.mock("@/integrations/supabase/client", async () => {
  const { createMockSupabaseClient } = await import("@/test/mockSupabaseClient");
  const supabase = createMockSupabaseClient();
  supabase.auth.onAuthStateChange.mockImplementation(callback => { m.callback = callback; return { data: { subscription: { unsubscribe() {} } } }; });
  supabase.auth.signOut = m.signOut;
  return { supabase };
});
import { AuthProvider, useAuth } from "./useAuth";

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); m.unregister.mockResolvedValue(undefined); });

it("retires protected observers and cancels their reads before removing the email session", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const cancel = vi.spyOn(client, "cancelQueries");
  let logout: (() => Promise<void>) | undefined;
  let readSignal: AbortSignal | undefined;
  let completeLogout: (() => void) | undefined;
  function Page() {
    logout = useAuth().signOut;
    useQuery({ queryKey: ["events", "email-user"], queryFn: ({ signal }) => { readSignal = signal; return new Promise(() => {}); } });
    return <div>Protected email page</div>;
  }
  m.signOut.mockImplementation(() => new Promise<void>(resolve => { completeLogout = resolve; }));
  const { unmount } = render(<QueryClientProvider client={client}><AuthProvider><Page /></AuthProvider></QueryClientProvider>);
  await waitFor(() => expect(m.callback).toBeTypeOf("function"));
  await waitFor(() => expect(readSignal).toBeDefined());
  let pending: Promise<void> | undefined;
  act(() => { pending = logout?.(); });
  await waitFor(() => expect(m.signOut).toHaveBeenCalled());
  expect(screen.queryByText("Protected email page")).toBeNull();
  expect(readSignal?.aborted).toBe(true);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(m.navigate).toHaveBeenCalledWith("/auth", { replace: true });
  await act(async () => { completeLogout?.(); await pending; });
  unmount(); client.clear();
});