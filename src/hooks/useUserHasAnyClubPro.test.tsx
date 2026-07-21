import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  auth: { user: { id: "user-1" } as null | { id: string } },
  from: vi.fn(),
  queryOptions: undefined as any,
  results: new Map<string, any[]>(),
  queries: [] as Array<{ table: string; chain: any }>,
}));

vi.mock("@tanstack/react-query", () => ({ useQuery: mocks.useQuery }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));

import { useUserHasAnyClubPro } from "./useUserHasAnyClubPro";

function queueResult(table: string, ...results: any[]) {
  mocks.results.set(table, results.map(result => ({ data: null, error: null, ...result })));
}

function tableQuery(table: string) {
  const result = mocks.results.get(table)?.shift() ?? { data: [], error: null };
  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  Object.defineProperty(chain, "then", {
    value: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
  });
  mocks.queries.push({ table, chain });
  return chain;
}

function captureHook(queryState: { data?: boolean; isLoading?: boolean } = {}) {
  mocks.useQuery.mockImplementation((options: any) => {
    mocks.queryOptions = options;
    return { data: queryState.data, isLoading: queryState.isLoading ?? false };
  });
  return renderHook(() => useUserHasAnyClubPro());
}

describe("useUserHasAnyClubPro membership and entitlement resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.results.clear();
    mocks.queries.length = 0;
    mocks.queryOptions = undefined;
    mocks.auth.user = { id: "user-1" };
    mocks.from.mockImplementation(tableQuery);
  });

  it("does not enable a query for a signed-out visitor", () => {
    mocks.auth.user = null;
    const { result } = captureHook();

    expect(mocks.queryOptions.enabled).toBe(false);
    expect(mocks.queryOptions.queryKey).toEqual(["user-has-any-club-pro", undefined]);
    expect(result.current).toEqual({ hasAnyClubPro: false, isLoading: false });
  });

  it("scopes membership discovery to the current user", async () => {
    queueResult("user_roles", { data: [] });
    captureHook();

    await expect(mocks.queryOptions.queryFn()).resolves.toBe(false);
    const roles = mocks.queries.find(q => q.table === "user_roles")!.chain;
    expect(roles.select).toHaveBeenCalledWith("club_id, team_id");
    expect(roles.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("returns false without querying subscriptions when the user has no memberships", async () => {
    queueResult("user_roles", { data: [] });
    captureHook();

    await expect(mocks.queryOptions.queryFn()).resolves.toBe(false);
    expect(mocks.from).not.toHaveBeenCalledWith("club_subscriptions");
  });

  it("derives clubs from team memberships and deduplicates them with direct roles", async () => {
    queueResult("user_roles", { data: [
      { club_id: "club-1", team_id: null },
      { club_id: "club-1", team_id: null },
      { club_id: null, team_id: "team-1" },
      { club_id: null, team_id: "team-2" },
    ] });
    queueResult("teams", { data: [{ club_id: "club-1" }, { club_id: "club-2" }] });
    queueResult("club_subscriptions", { data: [] });
    captureHook();

    await expect(mocks.queryOptions.queryFn()).resolves.toBe(false);
    const teams = mocks.queries.find(q => q.table === "teams")!.chain;
    expect(teams.in).toHaveBeenCalledWith("id", ["team-1", "team-2"]);
    const subs = mocks.queries.find(q => q.table === "club_subscriptions")!.chain;
    expect(subs.in).toHaveBeenCalledWith("club_id", ["club-1", "club-2"]);
  });

  it.each([
    { is_pro: true },
    { is_pro_football: true },
    { admin_pro_override: true },
    { admin_pro_football_override: true },
  ])("grants each active entitlement form: %o", async entitlement => {
    queueResult("user_roles", { data: [{ club_id: "club-1", team_id: null }] });
    queueResult("club_subscriptions", { data: [{ ...entitlement, expires_at: null }] });
    captureHook();

    await expect(mocks.queryOptions.queryFn()).resolves.toBe(true);
  });

  it("ignores an expired Pro club but grants another active club", async () => {
    queueResult("user_roles", { data: [
      { club_id: "expired-club", team_id: null },
      { club_id: "active-club", team_id: null },
    ] });
    queueResult("club_subscriptions", { data: [
      { is_pro: true, expires_at: "2020-01-01T00:00:00Z" },
      { admin_pro_override: true, expires_at: "2099-01-01T00:00:00Z" },
    ] });
    captureHook();

    await expect(mocks.queryOptions.queryFn()).resolves.toBe(true);
  });

  it("denies when every entitlement is expired", async () => {
    queueResult("user_roles", { data: [{ club_id: "club-1", team_id: null }] });
    queueResult("club_subscriptions", { data: [{ is_pro_football: true, expires_at: "2020-01-01T00:00:00Z" }] });
    captureHook();

    await expect(mocks.queryOptions.queryFn()).resolves.toBe(false);
  });

  it("must propagate a membership lookup failure instead of caching the user as Free", async () => {
    queueResult("user_roles", { data: null, error: { message: "roles lookup denied" } });
    captureHook();

    await expect(mocks.queryOptions.queryFn()).rejects.toMatchObject({ message: "roles lookup denied" });
    expect(mocks.from).not.toHaveBeenCalledWith("club_subscriptions");
  });

  it("must propagate a team ownership lookup failure instead of using incomplete membership", async () => {
    queueResult("user_roles", { data: [{ club_id: null, team_id: "team-1" }] });
    queueResult("teams", { data: null, error: { message: "team lookup denied" } });
    captureHook();

    await expect(mocks.queryOptions.queryFn()).rejects.toMatchObject({ message: "team lookup denied" });
    expect(mocks.from).not.toHaveBeenCalledWith("club_subscriptions");
  });

  it("must propagate a subscription lookup failure instead of caching a false entitlement", async () => {
    queueResult("user_roles", { data: [{ club_id: "club-1", team_id: null }] });
    queueResult("club_subscriptions", { data: null, error: { message: "subscription lookup unavailable" } });
    captureHook();

    await expect(mocks.queryOptions.queryFn()).rejects.toMatchObject({ message: "subscription lookup unavailable" });
  });

  it("returns the current React Query loading state without granting access", () => {
    const { result } = captureHook({ data: undefined, isLoading: true });
    expect(result.current).toEqual({ hasAnyClubPro: false, isLoading: true });
  });
});
