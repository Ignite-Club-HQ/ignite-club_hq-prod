import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  grants: vi.fn(), team: vi.fn(), club: vi.fn(), subscription: vi.fn(), mine: vi.fn(), leagues: vi.fn(), league: vi.fn(),
}));
vi.mock("@/live/features/membership", () => ({ getLiveMyRoleGrants: mocks.grants }));
vi.mock("@/live/features/club", () => ({ getLiveTeam: mocks.team, getLiveClubProfile: mocks.club, getLiveTeamSubscription: mocks.subscription }));
vi.mock("@/live/features/miniLeagues", () => ({ listMyLiveMiniLeagues: mocks.mine, listLiveMiniLeaguesByClub: mocks.leagues, getLiveMiniLeague: mocks.league }));
import { fetchIcpCarouselItems } from "./icpCarouselItems";

describe("ICP carousel parallel reads", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.grants.mockResolvedValue([{ team: ["team-a"], club: ["club-a"], role: "coach" }]);
    mocks.team.mockResolvedValue([{ id: "team-a", club_id: "club-a", name: "A", deleted_at_ms: [], logo_url: [] }]);
    mocks.club.mockResolvedValue([{ name: "Club A", logo_url: [], sport: ["football"] }]);
    mocks.subscription.mockResolvedValue(null);
    mocks.mine.mockResolvedValue([]);
  });
  it("starts league discovery while the team read is still pending", async () => {
    let release: (() => void) | undefined;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    mocks.team.mockImplementation(async () => { await waiting; return []; });
    const pending = fetchIcpCarouselItems({} as never, null);
    try { await vi.waitFor(() => expect(mocks.mine).toHaveBeenCalledTimes(1), { timeout: 150 }); }
    finally { release?.(); await pending; }
  });
  it("starts the trial read without waiting for the club logo and name", async () => {
    let release: (() => void) | undefined;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    mocks.club.mockImplementation(async () => { await waiting; return [{ name: "Club A", logo_url: [], sport: ["football"] }]; });
    const pending = fetchIcpCarouselItems({} as never, null);
    try { await vi.waitFor(() => expect(mocks.subscription).toHaveBeenCalledTimes(1), { timeout: 150 }); }
    finally { release?.(); await pending; }
  });
  it("shares one in-flight club read between teams from the same club", async () => {
    mocks.grants.mockResolvedValue(["team-a", "team-b"].map(team => ({ team: [team], club: ["club-a"], role: "coach" })));
    mocks.team.mockImplementation(async (_ctx, id) => [{ id, club_id: "club-a", name: id, deleted_at_ms: [], logo_url: [] }]);
    const items = await fetchIcpCarouselItems({} as never, null);
    expect(items.map(item => item.id)).toEqual(["team-a", "team-b"]);
    expect(mocks.club).toHaveBeenCalledTimes(1);
  });
  it("starts the trial read before the team row arrives", async () => {
    let release: (() => void) | undefined;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    mocks.team.mockImplementation(async () => { await waiting; return [{ id: "team-a", club_id: "club-a", name: "A", deleted_at_ms: [], logo_url: [] }]; });
    const pending = fetchIcpCarouselItems({} as never, null);
    try { await vi.waitFor(() => expect(mocks.subscription).toHaveBeenCalledTimes(1), { timeout: 150 }); }
    finally { release?.(); await pending; }
  });
  it("never shows a trial badge for a team the member cannot see", async () => {
    mocks.team.mockResolvedValue([]);
    mocks.subscription.mockResolvedValue({ is_pro: true, trial_ends_at_ms: [1] });
    expect(await fetchIcpCarouselItems({} as never, null)).toEqual([]);
  });
  it("returns core cards without starting optional trial reads", async () => {
    mocks.subscription.mockImplementation(() => new Promise(() => {}));
    const items = await fetchIcpCarouselItems({} as never, null, { includeTrial: false });
    expect(items.map(item => item.id)).toEqual(["team-a"]);
    expect(mocks.subscription).not.toHaveBeenCalled();
  });
  it("uses complete caller-authorized league rows without reading each league again", async () => {
    mocks.grants.mockResolvedValue([]);
    mocks.mine.mockResolvedValue([{ id: "league-a", name: "League A", club_id: "club-a", logo_url: [], status: "active" }]);
    const items = await fetchIcpCarouselItems({} as never, null);
    expect(items.map(item => item.id)).toEqual(["league-a"]);
    expect(mocks.league).not.toHaveBeenCalled();
  });
  it("starts independent player-league discovery before empty role discovery finishes", async () => {
    let release: (() => void) | undefined;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    mocks.grants.mockImplementation(async () => { await waiting; return []; });
    const pending = fetchIcpCarouselItems({} as never, null);
    try {
      await vi.waitFor(() => expect(mocks.mine).toHaveBeenCalledTimes(1), { timeout: 150 });
    } finally { release?.(); await pending; }
  });
  it("settles a confirmed empty inventory without requesting card details", async () => {
    mocks.grants.mockResolvedValue([]);
    expect(await fetchIcpCarouselItems({} as never, null)).toEqual([]);
    for (const read of [mocks.team, mocks.subscription, mocks.club, mocks.leagues, mocks.league]) {
      expect(read).not.toHaveBeenCalled();
    }
  });
  it("preserves a player's league even when there are no role grants or teams", async () => {
    mocks.grants.mockResolvedValue([]);
    mocks.mine.mockResolvedValue([{ id: "league-a" }]);
    mocks.league.mockResolvedValue([{ id: "league-a", club_id: "club-a", name: "League A", logo_url: [], status: "active" }]);
    expect((await fetchIcpCarouselItems({} as never, null)).map(item => item.id)).toEqual(["league-a"]);
    expect(mocks.team).not.toHaveBeenCalled();
  });
  it.each(["grants", "mine"] as const)("does not certify empty when %s discovery fails", async (read) => {
    mocks.grants.mockResolvedValue([]);
    mocks[read].mockRejectedValue(new Error("inventory unavailable"));
    await expect(fetchIcpCarouselItems({} as never, null)).rejects.toThrow("inventory unavailable");
  });
  it('finishes complete team cards independently of stalled league discovery', async () => {
    mocks.mine.mockImplementation(() => new Promise(() => {}));
    const items = await fetchIcpCarouselItems({} as never, null, { includeTrial: false, inventory: 'teams' });
    expect(items[0]).toMatchObject({ id: 'team-a', name: 'A', club_name: 'Club A', sport: 'football' });
    expect(mocks.mine).not.toHaveBeenCalled();
  });
  it('does not reread team details during independent league inventory', async () => {
    mocks.mine.mockResolvedValue([{ id: 'league-a', name: 'League A', club_id: 'club-a', logo_url: [], status: 'active' }]);
    expect((await fetchIcpCarouselItems({} as never, null, { includeTrial: false, inventory: 'leagues' })).map(item => item.id)).toEqual(['league-a']);
    expect(mocks.team).not.toHaveBeenCalled();
  });
  it('joins an outstanding read for the same account, target and inventory', async () => {
    let release: ((rows: object[]) => void) | undefined;
    mocks.team.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const ctx = { identity: { getPrincipal: () => ({ toText: () => 'account-a' }) }, target: { host: 'test' } } as never;
    const first = fetchIcpCarouselItems(ctx, null, { includeTrial: false, inventory: 'teams' });
    const second = fetchIcpCarouselItems(ctx, null, { includeTrial: false, inventory: 'teams' });
    expect(second).toBe(first);
    await vi.waitFor(() => expect(mocks.team).toHaveBeenCalledTimes(1));
    release?.([]);
    await first;
  });
});
