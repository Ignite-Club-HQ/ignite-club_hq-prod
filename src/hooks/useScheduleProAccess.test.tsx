import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  useClubProAccess: vi.fn(),
  useUserHasAnyClubPro: vi.fn(),
  from: vi.fn(),
  queryOptions: [] as any[],
}));

vi.mock("@tanstack/react-query", () => ({ useQuery: mocks.useQuery }));
vi.mock("@/hooks/useClubProAccess", () => ({ useClubProAccess: mocks.useClubProAccess }));
vi.mock("@/hooks/useUserHasAnyClubPro", () => ({ useUserHasAnyClubPro: mocks.useUserHasAnyClubPro }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));

import { useScheduleProAccess } from "./useScheduleProAccess";

describe("useScheduleProAccess scope resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryOptions.length = 0;
    mocks.useQuery.mockImplementation((options: any) => {
      mocks.queryOptions.push(options);
      return { data: undefined, isLoading: !!options.enabled };
    });
    mocks.useClubProAccess.mockImplementation((clubId: string | null) => ({
      hasPro: clubId === "pro-club",
      isLoading: false,
    }));
    mocks.useUserHasAnyClubPro.mockReturnValue({ hasAnyClubPro: false, isLoading: false });
  });

  it("uses the exact club entitlement when the target supplies a club", () => {
    const { result } = renderHook(() => useScheduleProAccess({ club_id: "pro-club" } as any));

    expect(result.current).toEqual({ hasAccess: true, isLoading: false });
    expect(mocks.useClubProAccess).toHaveBeenCalledWith("pro-club");
    expect(mocks.queryOptions[0].enabled).toBe(false);
  });

  it("denies an explicit non-Pro club even if the user has Pro elsewhere", () => {
    mocks.useUserHasAnyClubPro.mockReturnValue({ hasAnyClubPro: true, isLoading: false });
    const { result } = renderHook(() => useScheduleProAccess({ club_id: "free-club" } as any));

    expect(result.current).toEqual({ hasAccess: false, isLoading: false });
    expect(mocks.useClubProAccess).toHaveBeenCalledWith("free-club");
  });

  it("uses any-club entitlement for a genuinely clubless direct message", () => {
    mocks.useUserHasAnyClubPro.mockReturnValue({ hasAnyClubPro: true, isLoading: false });
    const { result } = renderHook(() => useScheduleProAccess({} as any));

    expect(result.current).toEqual({ hasAccess: true, isLoading: false });
    expect(mocks.useClubProAccess).toHaveBeenCalledWith(null);
  });

  it("propagates any-club loading for a genuinely clubless target", () => {
    mocks.useUserHasAnyClubPro.mockReturnValue({ hasAnyClubPro: false, isLoading: true });
    const { result } = renderHook(() => useScheduleProAccess(null));

    expect(result.current).toEqual({ hasAccess: false, isLoading: true });
  });

  it("resolves a team-only target to its owning club", () => {
    mocks.useQuery.mockImplementation((options: any) => {
      mocks.queryOptions.push(options);
      return { data: "pro-club", isLoading: false };
    });
    const { result } = renderHook(() => useScheduleProAccess({ team_id: "team-1" } as any));

    expect(result.current).toEqual({ hasAccess: true, isLoading: false });
    expect(mocks.useClubProAccess).toHaveBeenCalledWith("pro-club");
    expect(mocks.queryOptions[0].queryKey).toEqual(["team-club-id", "team-1"]);
    expect(mocks.queryOptions[0].enabled).toBe(true);
  });

  it("must not borrow another club's entitlement while a team club lookup is loading", () => {
    mocks.useUserHasAnyClubPro.mockReturnValue({ hasAnyClubPro: true, isLoading: false });
    mocks.useQuery.mockImplementation((options: any) => {
      mocks.queryOptions.push(options);
      return { data: undefined, isLoading: true };
    });
    const { result } = renderHook(() => useScheduleProAccess({ team_id: "free-team" } as any));

    expect(result.current).toEqual({ hasAccess: false, isLoading: true });
  });

  it("must remain scoped when a team resolves to no club", () => {
    mocks.useUserHasAnyClubPro.mockReturnValue({ hasAnyClubPro: true, isLoading: false });
    mocks.useQuery.mockImplementation((options: any) => {
      mocks.queryOptions.push(options);
      return { data: null, isLoading: false };
    });
    const { result } = renderHook(() => useScheduleProAccess({ team_id: "orphan-team" } as any));

    expect(result.current).toEqual({ hasAccess: false, isLoading: false });
  });

  it("does not perform team resolution when a target already supplies both IDs", () => {
    renderHook(() => useScheduleProAccess({ team_id: "team-1", club_id: "pro-club" } as any));

    expect(mocks.queryOptions[0].enabled).toBe(false);
    expect(mocks.useClubProAccess).toHaveBeenCalledWith("pro-club");
  });

  it("scopes the team lookup to the exact team and returns only its club_id", async () => {
    const chain: any = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: { club_id: "club-42" }, error: null });
    mocks.from.mockReturnValue(chain);
    renderHook(() => useScheduleProAccess({ team_id: "team-42" } as any));

    const value = await mocks.queryOptions[0].queryFn();
    expect(value).toBe("club-42");
    expect(mocks.from).toHaveBeenCalledWith("teams");
    expect(chain.select).toHaveBeenCalledWith("club_id");
    expect(chain.eq).toHaveBeenCalledWith("id", "team-42");
  });
});
