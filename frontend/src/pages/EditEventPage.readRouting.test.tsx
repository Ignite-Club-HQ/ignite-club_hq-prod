import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ queries: new Map<string, () => Promise<unknown>>(), from: vi.fn(), subscription: vi.fn(), duties: vi.fn(), grants: vi.fn(), profiles: vi.fn(), events: vi.fn() }));
const event = { id: 'evt-1', club_id: 'club-1', team_id: 'team-1', type: 'training', title: 'Training', event_date: '2026-11-08T09:00:00Z', teams: { name: 'U12' }, clubs: { name: 'Club' } };
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: any) => { mocks.queries.set(JSON.stringify(options.queryKey), options.queryFn); return { data: options.queryKey[0] === 'event-edit' ? event : undefined, isLoading: false }; },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'principal-1' } }) }));
vi.mock('@/live/authBackendMode', () => ({ resolveAuthBackend: () => 'icp' }));
vi.mock('@/live/featureRouter', () => ({ mergeLists: (p: any[]) => p.flat(), withFeatureBackend: (_f: string, providers: any) => providers.icp({ identity: {}, target: {} }) }));
vi.mock('@/live/features/club', () => ({ getLiveClubProfile: vi.fn(), listLiveTeams: vi.fn(), getLiveClubSubscription: (...a: any[]) => mocks.subscription(...a) }));
vi.mock('@/live/features/events', () => ({ listLiveDuties: (...a: any[]) => mocks.duties(...a), listLiveEvents: (...a: any[]) => mocks.events(...a) }));
vi.mock('@/live/features/membership', () => ({ getLiveMyRoleGrants: vi.fn(), listLiveRoleGrants: (...a: any[]) => mocks.grants(...a), listLiveTeamRoleGrants: (...a: any[]) => mocks.grants(...a) }));
vi.mock('@/live/relationshipProfileRead', () => ({ readRelationshipProfiles: (...a: any[]) => mocks.profiles(...a) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: (...a: any[]) => mocks.from(...a) } }));
vi.mock('@/lib/eventEditTrace', () => ({ recordEventEditStage: vi.fn() }));
import EditEventPage from './EditEventPage';

beforeEach(() => {
  cleanup(); mocks.queries.clear(); vi.clearAllMocks();
  mocks.from.mockImplementation(() => { throw new Error('ICP edit attempted Supabase'); });
  mocks.subscription.mockResolvedValue({ is_pro: true });
  mocks.duties.mockResolvedValue([{ event_id: 'evt-1', account_id: 'principal-1', duty: 'Referee', completed: false }]);
  mocks.grants.mockResolvedValue([{ account_id: 'principal:principal-1', team: ['team-1'] }]);
  mocks.profiles.mockResolvedValue([{ id: 'principal-1', display_name: 'Member', avatar_url: null }]);
  mocks.events.mockResolvedValue([{ id: 'evt-1', address: ['Oval'], location: [], starts_at_ms: 1n }]);
  render(<MemoryRouter initialEntries={['/events/evt-1/edit']}><Routes><Route path='/events/:id/edit' element={<EditEventPage />} /></Routes></MemoryRouter>);
});

describe('ICP edit supporting reads never reach Supabase', () => {
  it.each(['club-subscription-edit', 'event-duties', 'event-members-for-duty', 'saved-locations'])('routes %s through authenticated ICP', async key => {
    const entry = [...mocks.queries].find(([k]) => JSON.parse(k)[0] === key || (key === 'event-duties' && JSON.parse(k).includes('duties')));
    expect(entry).toBeDefined();
    if (!entry) return;
    await entry[1]();
    expect(mocks.from).not.toHaveBeenCalled();
  });
});