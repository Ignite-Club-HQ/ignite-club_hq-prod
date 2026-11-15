import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  children: vi.fn(), names: vi.fn(), teams: vi.fn(), grants: vi.fn(),
  prewarm: vi.fn(),
  memberCanisters: ['group-2-club'] as string[],
  everyCanisters: ['group-2-club'] as string[],
  routed: vi.fn(),
  blockCompleteInventory: false,
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'parent-a' } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/icpClubTeamLookup', () => ({ icpCtx: async () => ({ identity: { getPrincipal: () => ({ toText: () => 'parent-a' }) } }) }));
vi.mock('@/live/features/club', () => ({
  listMyLiveOwnChildren: state.children,
  listLiveTeams: state.teams,
  listMyLiveGroupRoleGrants: state.grants,
}));
vi.mock('@/live/piiVetKeys', () => ({ prewarmPiiVerificationKey: state.prewarm }));
// Exercise the real Children-page group callback with one signed-in Group 2
// context, rather than accidentally falling through an unconfigured test
// registry and reporting a child-list error.
vi.mock('@/live/featureRouter', () => ({
  withFeatureBackend: vi.fn(async (_feature: string, providers: { icp: (ctx: unknown) => Promise<unknown> }, scope?: { everyGroup?: boolean; memberGroups?: boolean; merge?: (parts: unknown[]) => unknown }) => {
    state.routed(scope);
    // Model the slow, complete cross-group inventory while a narrower
    // membership-verified preview may already be readable.
    if (scope?.everyGroup && state.blockCompleteInventory) {
      return new Promise(() => {});
    }
    const ids = scope?.memberGroups ? state.memberCanisters : state.everyCanisters;
    const results = await Promise.all(ids.map(id => providers.icp({
      identity: { getPrincipal: () => ({ toText: () => 'parent-a' }) },
      target: {
        alias: 'mainnet', host: 'https://icp-api.io',
        networkKind: 'public_mainnet',
        canisterIds: { club_domain: id, pii_access_control: 'pii-for-' + id },
      },
    })));
    return scope?.everyGroup || scope?.memberGroups ? scope.merge!(results) : results[0];
  }),
}));
vi.mock('@/live/features/membership', () => ({ getLiveMyRoleGrants: state.grants }));
vi.mock('@/live/features/vault', () => ({ resolveLivePiiTextBatch: state.names }));
import IcpChildrenPage from './IcpChildrenPage';
let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  state.children.mockResolvedValue([{ id: 'child-a', teams: [], parent: [{ toText: () => 'parent-a' }] }]);
  state.names.mockReturnValue(new Promise(() => {}));
  state.grants.mockResolvedValue([]);
  state.memberCanisters = ['group-2-club'];
  state.everyCanisters = ['group-2-club'];
  state.blockCompleteInventory = false;
});
afterEach(() => { cleanup(); client.clear(); });
const open = () => render(<QueryClientProvider client={client}><MemoryRouter><IcpChildrenPage /></MemoryRouter></QueryClientProvider>);
it('reveals authorized child controls without waiting for name decryption or global team discovery', async () => {
  open();
  expect(await screen.findByRole('button', { name: 'Remove child' })).toBeInTheDocument();
  expect(screen.getByLabelText('Retrieving child name')).toBeInTheDocument();
  // The team query may begin, but it must never block a verified child card.
  expect(state.teams).not.toHaveBeenCalled();
  expect(client.getQueryData(['icp-own-children-all-groups', 'parent-a'])).toHaveLength(1);
  expect(client.getQueryData(['icp-own-children-all-groups', 'parent-b'])).toBeUndefined();
});
it('failed child reads show retry rather than falsely reporting no children', async () => {
  state.children.mockRejectedValue(new Error('Denied'));
  open();
  expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  expect(screen.queryByText('No children added yet.')).not.toBeInTheDocument();
});
it('shows a retryable private-name state instead of labelling the child as Child', async () => {
  // The group-2 ciphertext can already be readable, while the signed-in
  // vetKey derivation is slow/unavailable on a cold browser session.
  state.names.mockResolvedValue(new Map());
  state.children.mockResolvedValue([{ id: 'child-a', teams: [], parent: [{ toText: () => 'other-parent' }] }]);
  open();
  expect(await screen.findByText('Name unavailable')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Retry child names' })).toBeInTheDocument();
  expect(screen.queryByText('No children added yet.')).not.toBeInTheDocument();
  expect(screen.getByText("You're a guardian")).toBeInTheDocument();
});

it('renders the locally decrypted child name once it becomes available', async () => {
  state.names.mockResolvedValue(new Map([['child-a', 'Ted']]));
  open();
  expect(await screen.findByText('Ted')).toBeInTheDocument();
  expect(screen.queryByText('Name unavailable')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Retry child names' })).not.toBeInTheDocument();
});

it('prefers the verified member-group route for names and prewarms the public key', async () => {
  state.names.mockResolvedValue(new Map([['child-a', 'Ted']]));
  open();
  expect(await screen.findByText('Ted')).toBeInTheDocument();
  expect(state.prewarm).toHaveBeenCalled();
  const memberRoutes = state.routed.mock.calls.filter(([scope]) => scope?.memberGroups);
  expect(memberRoutes).toHaveLength(1);
  expect(state.names).toHaveBeenCalledTimes(1);
});

it('falls back to verified all-group name reads when an orphan child is not in a member group', async () => {
  state.memberCanisters = []; // No current club membership, but the child still exists.
  state.names.mockResolvedValue(new Map([['child-a', 'Ted']]));
  open();
  expect(await screen.findByText('Ted')).toBeInTheDocument();
  expect(state.routed.mock.calls.some(([scope]) => scope?.memberGroups)).toBe(true);
  expect(state.names).toHaveBeenCalledTimes(1); // No other-group PII reads.
});

it('does not request private names from an unrelated group', async () => {
  state.everyCanisters = ['group-1-club', 'group-2-club'];
  state.memberCanisters = ['group-2-club'];
  state.children.mockImplementation(async (ctx: { target: { canisterIds: { club_domain: string } } }) =>
    ctx.target.canisterIds.club_domain === 'group-2-club'
      ? [{ id: 'child-a', teams: [], parent: [{ toText: () => 'parent-a' }] }]
      : []);
  state.names.mockResolvedValue(new Map([['child-a', 'Ted']]));
  open();
  expect(await screen.findByText('Ted')).toBeInTheDocument();
  expect(state.names).toHaveBeenCalledTimes(1);
  expect(state.names.mock.calls[0][0].target.canisterIds.club_domain).toBe('group-2-club');
});

it('shows a verified member-group child early but blocks writes until full discovery finishes', async () => {
  state.blockCompleteInventory = true;
  state.names.mockResolvedValue(new Map([['child-a', 'Ted']]));
  open();
  expect(await screen.findByText('Ted')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Remove child' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Guardians' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Add child' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Add to team' })).toBeDisabled();
  expect(screen.getByText(/Checking the remaining ICP groups/)).toBeInTheDocument();
  expect(screen.queryByText('No children added yet.')).not.toBeInTheDocument();
  expect(state.children).toHaveBeenCalledTimes(1); // concurrent previews are coalesced
});

it('does not falsely show No children when the fast member-group preview is empty', async () => {
  state.blockCompleteInventory = true;
  state.children.mockResolvedValue([]);
  open();
  expect(await screen.findByText('Loading children...')).toBeInTheDocument();
  expect(screen.queryByText('No children added yet.')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add child' })).toBeDisabled();
});

it('allows child controls only after the complete cross-group inventory is verified', async () => {
  state.names.mockResolvedValue(new Map([['child-a', 'Ted']]));
  open();
  expect(await screen.findByText('Ted')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add child' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Remove child' })).toBeEnabled();
});
