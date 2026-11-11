import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ client: undefined as any, callback: undefined as any }));
vi.mock('@/lib/prefetchData', () => ({ prefetchUserData: vi.fn() }));
vi.mock('@/lib/nativePush', () => ({ isNativePlatform: () => false, unregisterNativePush: vi.fn() }));
vi.mock('@/integrations/supabase/client', async () => {
  const { createMockSupabaseClient } = await import('@/test/mockSupabaseClient');
  m.client = createMockSupabaseClient();
  m.client.auth.onAuthStateChange.mockImplementation((callback: unknown) => {
    m.callback = callback;
    return { data: { subscription: { unsubscribe() {} } } };
  });
  return { supabase: m.client };
});
import { AuthProvider, useAuth } from './useAuth';

const member = { id: 'email-member', created_at: '2025-01-01T00:00:00Z', app_metadata: { provider: 'email' } };
const session = { user: member, access_token: 'fixture-only' };
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); m.callback = undefined; });
function Page() {
  const auth = useAuth();
  return <output>{auth.profileLoading || !auth.profileResolved ? 'pending' : auth.profileError ? 'retry' : auth.profile?.display_name ?? 'setup'}</output>;
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><AuthProvider><Page /></AuthProvider></QueryClientProvider>);
}

it('does not classify an established email account with a missing profile read as a new signup', async () => {
  m.client.auth.getSession.mockResolvedValue({ data: { session }, error: null });
  const view = mount();
  await waitFor(() => expect(screen.getByText('retry')).toBeInTheDocument(), { timeout: 8000 });
  expect(screen.queryByText('setup')).toBeNull();
  view.unmount();
});

it('keeps the profile pending when initial session completion overlaps an active profile read', async () => {
  let resolveSession: ((value: unknown) => void) | undefined;
  let resolveProfile: ((value: unknown) => void) | undefined;
  m.client.auth.getSession.mockImplementationOnce(() => new Promise(resolve => { resolveSession = resolve; }));
  const { createMockQueryBuilder } = await import('@/test/mockSupabaseClient');
  m.client.from.mockImplementation((table: string) => {
    const builder = createMockQueryBuilder();
    if (table === 'profiles') builder.maybeSingle.mockImplementation(() => new Promise(resolve => { resolveProfile = resolve; }));
    return builder;
  });
  const view = mount();
  await act(async () => { m.callback('INITIAL_SESSION', session); });
  await waitFor(() => expect(resolveProfile).toBeTypeOf('function'));
  await act(async () => { resolveSession?.({ data: { session }, error: null }); });
  expect(screen.getByText('pending')).toBeInTheDocument();
  await act(async () => { resolveProfile?.({ data: { id: member.id, display_name: 'Existing Member' }, error: null }); });
  expect(screen.getByText('Existing Member')).toBeInTheDocument();
  view.unmount();
});