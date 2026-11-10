import { beforeEach, describe, expect, it, vi } from 'vitest';
const reads = vi.hoisted(() => ({ grants: vi.fn(), team: vi.fn(), club: vi.fn(), mine: vi.fn() }));
vi.mock('@/live/features/membership', () => ({ getLiveMyRoleGrants: reads.grants }));
vi.mock('@/live/features/club', () => ({ getLiveTeam: reads.team, getLiveClubProfile: reads.club, getLiveTeamSubscription: vi.fn() }));
vi.mock('@/live/features/miniLeagues', () => ({ listMyLiveMiniLeagues: reads.mine, listLiveMiniLeaguesByClub: vi.fn(), getLiveMiniLeague: vi.fn() }));
import { fetchIcpCarouselItems } from './icpCarouselItems';
import { getCachedCarouselWithTs, setCachedCarousel } from '@/lib/myTeamsCarouselCache';

beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  reads.grants.mockResolvedValue([{ team: ['team-a'], club: ['club-a'], role: 'coach' }]);
  reads.team.mockResolvedValue([{ id: 'team-a', club_id: 'club-a', name: 'A', logo_url: [], deleted_at_ms: [] }]);
  reads.club.mockResolvedValue([{ name: 'Club A', logo_url: [], sport: [] }]);
  reads.mine.mockResolvedValue([]);
});

describe('current carousel latency audit (observed barriers, not acceptance)', () => {
  it('withholds the completed team while independent league discovery remains pending', async () => {
    let release: ((rows: never[]) => void) | undefined;
    reads.mine.mockImplementation(() => new Promise<never[]>(resolve => { release = resolve; }));
    let settled = false;
    const result = fetchIcpCarouselItems({} as never, null, { includeTrial: false }).then(rows => { settled = true; return rows; });
    await vi.waitFor(() => expect(reads.team).toHaveBeenCalledTimes(1));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(settled).toBe(false);
    release?.([]);
    expect((await result).map(row => row.id)).toEqual(['team-a']);
  });
  it('withholds the completed team while club display metadata remains pending', async () => {
    let release: ((rows: object[]) => void) | undefined;
    reads.club.mockImplementation(() => new Promise<object[]>(resolve => { release = resolve; }));
    let settled = false;
    const result = fetchIcpCarouselItems({} as never, null, { includeTrial: false }).then(rows => { settled = true; return rows; });
    await vi.waitFor(() => expect(reads.team).toHaveBeenCalledTimes(1));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(settled).toBe(false);
    release?.([{ name: 'Club A', logo_url: [], sport: [] }]);
    expect((await result).map(row => row.id)).toEqual(['team-a']);
  });
  it('discards saved cards after 24 hours even though they can be placeholders', () => {
    vi.useFakeTimers();
    try {
      setCachedCarousel('audit-user', null, { items: [{ id: 'team-a' }] });
      expect(getCachedCarouselWithTs('audit-user', null)).not.toBeNull();
      vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
      expect(getCachedCarouselWithTs('audit-user', null)).toBeNull();
    } finally { vi.useRealTimers(); }
  });
});