import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { CanisterUsageCard } from './CanisterUsageCard';
import dev from '../../../../deploy/opencloud/dev.json';

const { query, createAgent } = vi.hoisted(() => ({ query: vi.fn(), createAgent: vi.fn(async () => ({})) }));
vi.mock('@/live/adminCanisterTracking', () => ({
  getAdminCanisterTracking: () => ({
    target: { host: dev.apiHost }, cacheKey: 'opencloud-dev-32',
    groups: dev.groups.map(g => ({ canisters: Object.entries(g.canisterIds).map(([key, canisterId]) => ({ key, canisterId })) })),
  }),
}));
vi.mock('@icp-sdk/core/agent', () => ({
  AnonymousIdentity: class {}, HttpAgent: { create: createAgent },
  Actor: { createActor: (_idl: unknown, options: { canisterId: string }) => ({ usage_stats: () => query(options.canisterId) }) },
}));
afterEach(() => vi.clearAllMocks());
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><CanisterUsageCard /></QueryClientProvider>);
}
it('counts both OpenCloud groups on the engine host, without double-counting shared services', async () => {
  query.mockImplementation(async (id: string) => {
    const second = Object.values(dev.groups[1].canisterIds).includes(id);
    const n = second ? 7n : 3n;
    return { clubs: n, teams: n, accounts: n, news_posts: n, conversations: n, messages: n,
      scheduled_messages: n, events: n, rsvps: n, children: n };
  });
  show();
  await waitFor(() => expect(screen.getAllByText('10')).toHaveLength(10));
  expect(createAgent).toHaveBeenCalledWith(expect.objectContaining({ host: dev.apiHost }));
  expect(query).toHaveBeenCalledTimes(6);
  for (const group of dev.groups) for (const key of ['club_domain', 'events_domain', 'messaging_domain'] as const) {
    expect(query).toHaveBeenCalledWith(group.canisterIds[key]);
  }
});
it('an unavailable group never becomes a confirmed partial total', async () => {
  query.mockImplementation(async (id: string) => {
    if (id === dev.groups[1].canisterIds.club_domain) throw new Error('Unavailable');
    return { clubs: 3n, teams: 3n, accounts: 3n, news_posts: 3n };
  });
  show();
  await waitFor(() => expect(query).toHaveBeenCalledTimes(6));
  await waitFor(() => expect(screen.getAllByText('—')).toHaveLength(4));
});