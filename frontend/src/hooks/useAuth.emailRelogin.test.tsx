import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ client: undefined as any, callback: undefined as any }));
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
function Page() {
  auth = useAuth();
  return <output>{!auth.user ? 'signed-out' : auth.profileLoading || !auth.profileResolved ? 'pending' : auth.profile?.display_name ?? 'setup'}</output>;
}

it('signing back in as the same email member after sign-out finishes loading the profile', async () => {
  localStorage.setItem('ignite_cached_profile', JSON.stringify({ userId: member.id, timestamp: Date.now(), profile: { id: member.id, display_name: 'Paul' } }));
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
}, 15000);
