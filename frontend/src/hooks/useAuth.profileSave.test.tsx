import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import type { IcpIdentityProfile } from '@/live/identityProfileCache';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), confirmed: vi.fn(), resume: vi.fn() }));
vi.mock('@/live/internetIdentityAuth', () => ({
  warmInternetIdentityAuthClient: async () => undefined,
  isInternetIdentitySignInReady: () => true,
  getCurrentInternetIdentityConfirmed: mocks.confirmed,
  resumeInternetIdentitySession: mocks.resume,
  clearExpiredInternetIdentitySession: () => false,
}));
vi.mock('@/live/identityProfile', () => ({ fetchIcpIdentityProfile: mocks.fetch }));
vi.mock('@/live/icpAgent', () => ({ clearLiveAgentCache: vi.fn() }));
vi.mock('@/live/groupDispatch', () => ({ clearGroupDispatchCache: vi.fn(), wipeGroupOwnerCache: vi.fn() }));
vi.mock('@/live/piiVetKeys', () => ({ clearPiiVetKeyCache: vi.fn(async () => undefined) }));
vi.mock('@/lib/icpQueryCachePersist', () => ({ clearPersistedIcpQueryCache: vi.fn(async () => undefined) }));
vi.mock('@/live/features/events', () => ({ clearListedLiveEvents: vi.fn() }));
vi.mock('@/live/features/messaging', () => ({ clearWarmLiveLatestPages: vi.fn() }));
import { IcpAuthProvider, useAuth } from './useAuth';

beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks();
  localStorage.setItem('ignite_icp_internet_identity_session', JSON.stringify({ provider: 'internet-identity', principal: 'account-a' }));
  mocks.confirmed.mockResolvedValue({});
  mocks.resume.mockResolvedValue({ provider: 'internet-identity', principal: 'account-a' });
});

it('adopts an acknowledged save without a second fetch and rejects an older missing-profile reply', async () => {
  let resolveOld: ((profile: IcpIdentityProfile) => void) | undefined;
  mocks.fetch.mockImplementation(() => new Promise<IcpIdentityProfile>(resolve => { resolveOld = resolve; }));
  let refresh: ReturnType<typeof useAuth>['refreshProfile'] | undefined;
  function Page() { const auth = useAuth(); refresh = auth.refreshProfile; return <div>{auth.profile?.display_name ?? 'Missing'}</div>; }
  render(<QueryClientProvider client={new QueryClient()}><IcpAuthProvider><Page /></IcpAuthProvider></QueryClientProvider>);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  const saved = { accountId: 'account-a', displayName: 'Test Parent', avatarRef: null, roles: [], profileMissing: false };
  await act(async () => { await refresh?.(saved); });
  expect(screen.getByText('Test Parent')).toBeTruthy();
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  await act(async () => { resolveOld?.({ ...saved, displayName: null, profileMissing: true }); });
  expect(screen.getByText('Test Parent')).toBeTruthy();
  await expect(refresh?.({ ...saved, accountId: 'other-account' })).rejects.toThrow('signed-in account');
  expect(screen.getByText('Test Parent')).toBeTruthy();
});
it('does not display Test2 before adopting a different real Internet Identity', async () => {
  const old = {
    accountId: 'test2-principal', displayName: 'Test2', avatarRef: null,
    roles: [], profileMissing: false,
  };
  localStorage.setItem('ignite_icp_internet_identity_session',
    JSON.stringify({ provider: 'internet-identity', principal: 'test2-principal' }));
  localStorage.setItem('ignite_icp_identity_profile:test2-principal', JSON.stringify(old));
  mocks.resume.mockResolvedValue({ provider: 'internet-identity', principal: 'fresh-principal' });
  mocks.fetch.mockResolvedValue({ ...old, accountId: 'fresh-principal', displayName: 'Fresh Parent' });

  function Page() {
    const auth = useAuth();
    return <div>{auth.user?.id ?? 'Not authenticated'} / {auth.profile?.display_name ?? 'No profile'}</div>;
  }
  render(<QueryClientProvider client={new QueryClient()}><IcpAuthProvider><Page /></IcpAuthProvider></QueryClientProvider>);

  // Browser storage is only a resume hint: never expose Test2 as signed in.
  expect(screen.getByText('Not authenticated / No profile')).toBeTruthy();
  await waitFor(() => expect(screen.getByText('fresh-principal / Fresh Parent')).toBeTruthy());
  expect(localStorage.getItem('ignite_icp_identity_profile:test2-principal')).toBeNull();
  expect(JSON.parse(localStorage.getItem('ignite_icp_internet_identity_session') ?? '{}').principal)
    .toBe('fresh-principal');
});
