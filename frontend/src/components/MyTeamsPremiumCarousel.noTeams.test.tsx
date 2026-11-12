import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MyTeamsPremiumCarousel } from './MyTeamsPremiumCarousel';

const state = vi.hoisted(() => ({ leagueError: false, saved: null as null | { data: { items: object[] }; timestamp: number }, ready: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'account-1' }, initialized: true }) }));
vi.mock('@/hooks/useClubTheme', () => ({ useClubTheme: () => ({ activeClubFilter: null }) }));
vi.mock('@/hooks/useCarouselResumeRecovery', () => ({ useCarouselResumeRecovery: vi.fn() }));
vi.mock('@/hooks/useUnreadMessageCounts', () => ({ useUnreadMessageCounts: () => ({ data: {}, isFetched: true }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/live/authBackendMode', () => ({ resolveAuthBackend: () => 'icp' }));
vi.mock('@/lib/myTeamsCarouselCache', () => ({ getCachedCarouselWithTs: () => state.saved, setCachedCarousel: vi.fn() }));
vi.mock('@/lib/perfStages', () => ({ markStage: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQuery: (options: { queryKey: string[] }) => {
  const k = options.queryKey[0];
  if (k === 'my-teams-premium-v2') return { data: [], isLoading: false, isFetching: false, isError: false, isSuccess: true };
  if (k === 'my-leagues-premium-v2') return state.leagueError
    ? { data: undefined, isFetching: false, isError: true, isSuccess: false }
    : { data: undefined, isFetching: true, isError: false, isSuccess: false };
  return { data: k === 'team-competitions-premium-v3' ? [] : {}, isFetched: true, isSuccess: true };
} }));
afterEach(() => { cleanup(); state.ready.mockClear(); state.saved = null; state.leagueError = false; });

it('confirmed no teams settles immediately even while league discovery is pending', () => {
  render(<MyTeamsPremiumCarousel onReadyChange={state.ready} />);
  expect(state.ready).toHaveBeenLastCalledWith(true);
});

it('a member with no teams is not left on loading cards when a read fails', () => {
  state.leagueError = true;
  render(<MyTeamsPremiumCarousel onReadyChange={state.ready} />);
  expect(state.ready).toHaveBeenLastCalledWith(true);
});

it('a saved empty list shows straight away while the refresh is still running', () => {
  state.saved = { data: { items: [] }, timestamp: Date.now() };
  render(<MyTeamsPremiumCarousel onReadyChange={state.ready} />);
  expect(state.ready).toHaveBeenLastCalledWith(true);
});
