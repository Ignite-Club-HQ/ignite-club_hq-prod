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
    mocks.club.mockResolvedValue([{ name: "Club A", logo_url: [], sport: "football" }]);
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
    mocks.club.mockImplementation(async () => { await waiting; return [{ name: "Club A", logo_url: [], sport: "football" }]; });
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
});
