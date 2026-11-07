import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextUpCarousel } from './NextUpCarousel';

const state = vi.hoisted(() => ({ reads: [] as string[], icp: false, ready: false, userId: 'account-1', savedStatus: 'going', save: vi.fn(), toast: vi.fn(), scopes: [] as unknown[] }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: state.userId } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock('@/hooks/useCanStartGame', () => ({ useCanStartGame: () => ({ canStart: false }) }));
vi.mock('@/hooks/useEventMembership', () => ({ useEventMembership: () => ({ data: state.ready ? true : undefined, isFetched: state.ready }) }));
vi.mock('@/live/authBackendMode', () => ({ resolveAuthBackend: () => state.icp ? 'icp' : 'supabase' }));
vi.mock('@/live/featureRouter', () => ({ withFeatureBackend: (_: string, handlers: { icp: (ctx: object) => unknown; supabase: () => unknown }, scope: unknown) => { state.scopes.push(scope); return state.icp ? handlers.icp({ identity: { getPrincipal: () => ({ toText: () => 'account-1' }) } }) : handlers.supabase(); } }));
vi.mock('@/live/features/vault', () => ({ resolveLivePiiTextBatch: async () => new Map() }));
vi.mock('@/live/features/events', () => ({ setLiveEventRsvp: (...args: unknown[]) => state.save(...args), adminUpsertLiveRsvp: vi.fn(),
  getMyLiveChildRsvps: async () => [],
  listLiveMyRsvps: async () => [{ event_id: 'icp-event', account_id: 'account-1', child_id: [], state: state.savedStatus }],
  listLiveDuties: async () => [{ event_id: 'icp-event', account_id: 'account-1', duty: 'Referee', completed: true }],
  getLiveEventRosterDetailed: async () => ({ rsvps: [] }),
}));
vi.mock('@/live/features/homeFeed', () => ({ fetchLiveHomeChildren: vi.fn() }));
// The card statically imports the events module as well as lazily reading it;
// stub its batch transport too so either module evaluation stays offline.
vi.mock('@/live/features/batching', () => ({ batched: async () => [
  { event_id: 'icp-event', account_id: 'account-1', duty: 'Referee', completed: true },
] }));
vi.mock('@/live/features/miniLeagues', () => ({ listLivePlayers: vi.fn() }));
vi.mock('@/lib/resolveEventChildScope', () => ({ resolveRsvpChildren: () => state.ready ? Promise.resolve([]) : new Promise(() => {}) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: (table: string) => {
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'is', 'not', 'in', 'limit', 'maybeSingle']) {
    query[method] = (...args: unknown[]) => { state.reads.push(`${table}:${method}:${String(args[0])}`); return query; };
  }
  query.then = () => new Promise(() => {});
  return query;
} } }));

const event = (id: string, clubId: string) => ({
  id, club_id: clubId, title: `Event ${id}`, type: 'social',
  event_date: new Date(Date.now() + 86400000).toISOString(),
  address: null, location_name: null, suburb: null, team_id: null,
  is_cancelled: false, opponent: null, teams: null,
  clubs: { name: clubId, sport: null },
});
function Location() { return <output data-testid="location">{useLocation().pathname}</output>; }

describe('Next Up pending secondary reads', () => {
  beforeEach(() => { state.reads = []; state.icp = false; state.ready = false; state.userId = 'account-1'; state.savedStatus = 'going'; state.save.mockReset(); state.toast.mockClear(); state.scopes = []; });
  afterEach(cleanup);

  it('opens a known event immediately and after a club switch without waiting for attendance reads', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (id: string, club: string) => <QueryClientProvider client={client}>
      <MemoryRouter><NextUpCarousel events={[event(id, club)]} isLoading={true} /><Location /></MemoryRouter>
    </QueryClientProvider>;
    const view = render(tree('a', 'club-a'));
    fireEvent.click(screen.getByRole('button', { name: /^Event a,/ }));
    expect(screen.getByTestId('location').textContent).toBe('/events/a');
    expect(screen.queryByRole('button', { name: /RSVP Going/ })).toBeNull();
    view.rerender(tree('b', 'club-b'));
    fireEvent.click(screen.getByRole('button', { name: /^Event b,/ }));
    expect(screen.getByTestId('location').textContent).toBe('/events/b');
    expect(client.getQueryState(['hero-rsvp', 'b', 'account-1'])?.status).toBe('pending');
    client.clear();
  });

  it('starts avatar and count reads concurrently while the count remains pending', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><NextUpCarousel events={[event('a', 'club-a')]} /></MemoryRouter></QueryClientProvider>);
    await waitFor(() => expect(state.reads).toContain('rsvps:limit:5'));
    expect(client.getQueryState(['rsvp-summary', 'a', 'social'])?.status).toBe('pending');
    client.clear();
  });

  it('mounted ICP cards resolve adult RSVP and completed duties without any Supabase reads', async () => {
    state.icp = true;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><NextUpCarousel events={[event('icp-event', 'club-a')]} /></MemoryRouter></QueryClientProvider>);
    await waitFor(() => expect(client.getQueryData(['hero-rsvp', 'icp-event', 'account-1'])).toEqual({ id: 'icp-event:account-1', status: 'going' }));
    await waitFor(() => { const q = client.getQueryState(['hero-my-duties', 'icp-event', 'account-1']); if (q?.error) throw q.error; expect(q?.data).toEqual([
      { id: 'icp-event:account-1:Referee', name: 'Referee', status: 'completed', start_time: null, end_time: null },
    ]); });
    expect(state.reads).toEqual([]);
    client.clear();
  });

  it('saves a prefixed ICP account with the exact signed-in principal and reads the answer back', async () => {
    state.icp = true; state.ready = true; state.userId = 'principal:account-1';
    state.save.mockImplementation(async (_ctx, _event, accountId, status) => {
      if (accountId !== 'account-1') throw new Error("Cannot set another member's RSVP");
      state.savedStatus = status;
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><NextUpCarousel events={[event('icp-event', 'club-a')]} /></MemoryRouter></QueryClientProvider>);
    const maybe = await screen.findByRole('button', { name: 'RSVP Maybe' });
    fireEvent.click(maybe);
    await waitFor(() => expect(client.getQueryData(['hero-rsvp', 'icp-event', 'principal:account-1'])).toEqual({ id: 'icp-event:account-1', status: 'maybe' }));
    expect(state.save).toHaveBeenCalledTimes(1);
    expect(state.scopes).toContainEqual(expect.objectContaining({ eventId: 'icp-event', attempts: 1, writeKey: expect.any(String) }));
    expect(state.toast).not.toHaveBeenCalled();
    expect(state.reads).toEqual([]);
    client.clear();
  });

  it('does not replay a refused ICP save or fall back to Supabase', async () => {
    state.icp = true; state.ready = true;
    state.save.mockRejectedValue(new Error('Event RSVP not allowed for this member'));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><NextUpCarousel events={[event('icp-event', 'club-a')]} /></MemoryRouter></QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'RSVP Maybe' }));
    await waitFor(() => expect(state.toast).toHaveBeenCalled());
    expect(state.save).toHaveBeenCalledTimes(1);
    expect(state.savedStatus).toBe('going');
    expect(state.reads).toEqual([]);
    client.clear();
  });

  it('refuses an account switch before sending an RSVP for another identity', async () => {
    state.icp = true; state.ready = true; state.userId = 'principal:other-account';
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><NextUpCarousel events={[event('icp-event', 'club-a')]} /></MemoryRouter></QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'RSVP Maybe' }));
    await waitFor(() => expect(state.toast).toHaveBeenCalled());
    expect(state.save).not.toHaveBeenCalled();
    expect(state.reads).toEqual([]);
    client.clear();
  });
});