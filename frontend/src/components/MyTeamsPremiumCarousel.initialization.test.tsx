import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MyTeamsPremiumCarousel } from './MyTeamsPremiumCarousel';

const state = vi.hoisted(() => ({ loading: true, rows: [] as object[], marks: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'account-1' }, initialized: true }) }));
vi.mock('@/hooks/useClubTheme', () => ({ useClubTheme: () => ({ activeClubFilter: null }) }));
vi.mock('@/hooks/useCarouselResumeRecovery', () => ({ useCarouselResumeRecovery: vi.fn() }));
vi.mock('@/hooks/useUnreadMessageCounts', () => ({ useUnreadMessageCounts: () => ({ data: {} }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/live/authBackendMode', () => ({ resolveAuthBackend: () => 'icp' }));
vi.mock('@/lib/myTeamsCarouselCache', () => ({ getCachedCarouselWithTs: () => null, setCachedCarousel: vi.fn() }));
vi.mock('@/lib/perfStages', () => ({ markStage: state.marks }));
vi.mock('@tanstack/react-query', () => ({ useQuery: (options: { queryKey: string[] }) =>
  options.queryKey[0] === 'my-teams-premium-v2'
    ? { data: state.rows, isLoading: state.loading, isFetching: state.loading, isError: false }
    : { data: options.queryKey[0] === 'team-competitions-premium-v3' ? [] : {} }
}));

describe('carousel first-render initialization', () => {
  beforeEach(() => { state.loading = true; state.rows = []; state.marks.mockClear(); });
  afterEach(cleanup);

  it('does not crash or report a visible card during the initial pending read', () => {
    expect(() => render(<MyTeamsPremiumCarousel />)).not.toThrow();
    expect(state.marks).not.toHaveBeenCalledWith('first_team_card');
  });

  it('survives an empty settled read without reporting a visible card', () => {
    state.loading = false;
    expect(() => render(<MyTeamsPremiumCarousel />)).not.toThrow();
    expect(state.marks).not.toHaveBeenCalledWith('first_team_card');
  });

  it('reports the first card after a pending read resolves without changing hook order', () => {
    const view = render(<MyTeamsPremiumCarousel />);
    state.loading = false;
    state.rows = [{ id: 'team-1', name: 'Team One', type: 'team', club_id: 'club-1', club_name: 'Club One' }];
    expect(() => view.rerender(<MyTeamsPremiumCarousel />)).not.toThrow();
    expect(state.marks).toHaveBeenCalledWith('first_team_card');
  });
});