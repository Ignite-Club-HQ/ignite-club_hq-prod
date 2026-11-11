import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';

const m = vi.hoisted(() => {
  // App launched on a phone that already holds this member's saved profile.
  localStorage.setItem('ignite_cached_profile', JSON.stringify({ userId: 'email-member', cachedAt: Date.now(), profile: { id: 'email-member', display_name: 'Paul' } }));
  return ({ client: undefined as any, callback: undefined as any });
});
vi.mock('@/lib/prefetchData', () => ({ prefetchUserData: async () => undefined }));
vi.mock('@/lib/nativePush', () => ({ isNativePlatform: () => false, unregisterNativePush: vi.fn() }));
vi.mock('@/integrations/supabase/client', async () => {
  const { createMockSupabaseClient } = await import('@/test/mockSupabaseClient');
  m.client = createMockSupabaseClient();
  m.client.auth.onAuthStateChange.mockImplementation((cb: unknown) => { m.callback = cb; return { data: { subscription: { unsubscribe() {} } } }; });
  return { supabase: m.client };
});
import { AuthProvider, useAuth } from './useAuth';

const member = { id: 'email-member', created_at: '2025-01-01T00:00:00Z', app_metadata: { provider: 'email' } };
const session = { user: member, access_token: 'fixture-only' };
let auth: ReturnType<typeof useAuth>;
const seen: string[] = [];
function Page() {
  auth = useAuth();
  const state = !auth.user ? 'signed-out' : auth.profileLoading || !auth.profileResolved ? 'pending' : auth.profileError ? 'retry' : auth.profile?.display_name ?? 'setup';
  seen.push(state);
  return <output>{state}</output>;
}

it('signing back in as the same email member after sign-out finishes loading the profile', async () => {
  m.client.auth.getSession.mockResolvedValue({ data: { session }, error: null });
  const { createMockQueryBuilder } = await import('@/test/mockSupabaseClient');
  m.client.from.mockImplementation((table: string) => {
    const b = createMockQueryBuilder();
    if (table === 'profiles') b.maybeSingle.mockResolvedValue({ data: { id: member.id, display_name: 'Paul' }, error: null });
    return b;
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><AuthProvider><Page /></AuthProvider></QueryClientProvider>);
  await act(async () => { m.callback('INITIAL_SESSION', session); });
  await waitFor(() => expect(screen.getByText('Paul')).toBeInTheDocument(), { timeout: 6000 });
  await act(async () => { await auth.signOut(); });
  await waitFor(() => expect(screen.getByText('signed-out')).toBeInTheDocument());
  await act(async () => { m.callback('SIGNED_IN', session); });
  await waitFor(() => expect(screen.getByText('Paul')).toBeInTheDocument(), { timeout: 6000 });
  // Create Profile must never be offered to a member who already has one.
  expect(seen).not.toContain('setup');
}, 15000);

it('an existing member whose profile read comes back empty is offered retry, never Create Profile', async () => {
  seen.length = 0;
  const { createMockQueryBuilder } = await import('@/test/mockSupabaseClient');
  m.client.from.mockImplementation(() => createMockQueryBuilder());
  m.client.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><AuthProvider><Page /></AuthProvider></QueryClientProvider>);
  await act(async () => { m.callback('SIGNED_IN', { user: { ...member, id: 'other-member' }, access_token: 'fixture-only' }); });
  await waitFor(() => expect(screen.getByText('retry')).toBeInTheDocument(), { timeout: 12000 });
  expect(seen).not.toContain('setup');
}, 20000);
