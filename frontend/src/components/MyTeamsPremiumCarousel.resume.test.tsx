import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  club: 'club-a' as string | null,
  items: vi.fn(), trial: vi.fn(), save: vi.fn(),
  readOptions: [] as unknown[],
  saved: null as null | { data: { items: typeof teams }; timestamp: number },
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'paul' }, initialized: true }) }));
vi.mock('@/hooks/useClubTheme', () => ({ useClubTheme: () => ({ activeClubFilter: m.club }) }));
vi.mock('@/hooks/useCarouselResumeRecovery', () => ({ useCarouselResumeRecovery: vi.fn() }));
vi.mock('@/hooks/useUnreadMessageCounts', () => ({ useUnreadMessageCounts: () => ({ data: {}, isFetched: true }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/live/authBackendMode', () => ({ resolveAuthBackend: () => 'icp' }));
vi.mock('@/lib/perfStages', () => ({ markStage: vi.fn() }));
vi.mock('@/lib/myTeamsCarouselCache', () => ({ getCachedCarouselWithTs: () => m.saved, setCachedCarousel: m.save }));
vi.mock('@/components/home/icpCarouselItems', () => ({ fetchIcpCarouselItems: m.items }));
vi.mock('@/live/featureRouter', () => ({
  mergeLists: vi.fn(),
  withFeatureBackend: (_feature: string, handlers: { icp: (ctx: object) => unknown }) => handlers.icp({}),
}));
vi.mock('@/live/membershipRouting', () => ({
  readMembershipInScope: (ctx: object, _scope: object, read: (ctx: object) => unknown) => read(ctx),
}));
vi.mock('@/live/features/club', () => ({ getLiveTeamSubscription: m.trial }));
vi.mock('@/live/contentRouting', () => ({
  readContentInScope: (ctx: object, _area: string, _scope: object, read: (ctx: object) => unknown) => read(ctx),
}));
vi.mock('@/live/features/events', () => ({ listLiveEvents: vi.fn().mockResolvedValue([]) }));
vi.mock('@/live/features/competitions', () => ({
  listLiveEntriesByTeam: vi.fn().mockResolvedValue([]), listLiveCompetitions: vi.fn().mockResolvedValue([]),
}));
import { MyTeamsPremiumCarousel } from './MyTeamsPremiumCarousel';

const teams = [
  { id: 'team-a', club_id: 'club-a', name: 'Team A', club_name: 'Club A', type: 'team', canManage: false },
  { id: 'team-b', club_id: 'club-b', name: 'Team B', club_name: 'Club B', type: 'team', canManage: false },
];
const clients: QueryClient[] = [];
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return { client, ...render(<QueryClientProvider client={client}><MyTeamsPremiumCarousel /></QueryClientProvider>) };
}
beforeEach(() => {
  vi.clearAllMocks(); m.club = 'club-a'; m.saved = null;
  m.items.mockImplementation((_ctx, _filter, options) => Promise.resolve(options?.inventory === 'leagues' ? [] : teams));
  m.trial.mockResolvedValue(null);
});
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); });

describe('mounted carousel resume data path', () => {
  it('shows complete saved cards immediately while both inventories are suspended', () => {
    m.saved = { data: { items: teams }, timestamp: Date.now() - 2 * 86400000 };
    m.items.mockImplementation(() => new Promise(() => {}));
    mount();
    expect(screen.getByRole('button', { name: 'Team A — Club A' })).toBeInTheDocument();
  });
  it('removes saved team cards after a successful empty authorized read', async () => {
    m.saved = { data: { items: teams }, timestamp: Date.now() - 2 * 86400000 };
    m.items.mockResolvedValue([]);
    mount();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Team A — Club A' })).not.toBeInTheDocument());
    await waitFor(() => expect(m.save).toHaveBeenCalledWith('paul', null, expect.objectContaining({ items: [] })));
  });
  it('waits for complete first-login details and only enriches the selected club', async () => {
    let release: ((value: null) => void) | undefined;
    m.trial.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const { client } = mount();
    await waitFor(() => expect(m.trial).toHaveBeenCalledTimes(1), { timeout: 2500 });
    expect(screen.queryByRole('button', { name: 'Team A — Club A' })).not.toBeInTheDocument();
    await act(async () => { release?.(null); });
    await screen.findByRole('button', { name: 'Team A — Club A' });
    expect(screen.queryByRole('button', { name: 'Team B — Club B' })).not.toBeInTheDocument();
    expect(m.items).toHaveBeenCalledWith({}, null, { includeTrial: false, inventory: 'teams' });
    expect(m.items).toHaveBeenCalledWith({}, null, { includeTrial: false, inventory: 'leagues' });
    await waitFor(() => expect(m.trial).toHaveBeenCalledTimes(1), { timeout: 2500 });
    expect(m.trial).toHaveBeenCalledWith({}, 'team-a');
    expect(client.getQueryData(['my-teams-premium-v2', 'paul'])).toEqual(teams);
    expect(client.getQueryState(['team-trials-premium', 'paul', ['team-a']])?.fetchStatus).toBe('idle');
    expect(screen.getByRole('button', { name: 'Team A — Club A' })).toBeInTheDocument();
  });
  it('saves the complete inventory under the all-club key after a themed read settles', async () => {
    const { client } = mount();
    await screen.findByRole('button', { name: 'Team A — Club A' });
    await waitFor(() => expect(m.save).toHaveBeenCalledWith('paul', null, expect.objectContaining({ items: teams.map(team => expect.objectContaining(team)) })));
    expect(m.save).toHaveBeenCalledWith('paul', 'club-a', expect.objectContaining({ items: [expect.objectContaining(teams[0])] }));
    m.save.mockClear();
    let finish: ((rows: typeof teams) => void) | undefined;
    m.items.mockImplementationOnce(() => new Promise<typeof teams>(done => { finish = done; }));
    await act(async () => { void client.refetchQueries({ queryKey: ['my-teams-premium-v2', 'paul'] }); });
    expect(screen.getByRole('button', { name: 'Team A — Club A' })).toBeInTheDocument();
    expect(m.save).not.toHaveBeenCalled();
    await act(async () => { finish?.(teams); });
    await waitFor(() => expect(m.save).toHaveBeenCalledWith('paul', null, expect.objectContaining({ items: teams.map(team => expect.objectContaining(team)) })));
  });
});