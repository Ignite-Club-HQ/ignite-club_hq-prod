import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
import { shouldSkipChatMountInvalidate } from './chatMountInvalidate';

describe('chat mount freshness', () => {
  it('joins the active first-page read instead of cancelling and starting it again', async () => {
    const client = new QueryClient();
    let finish: (value: string[]) => void = () => {};
    const fetch = client.fetchQuery({ queryKey: ['team-messages', 'never-opened'], queryFn: () => new Promise<string[]>(resolve => { finish = resolve; }) });
    expect(shouldSkipChatMountInvalidate(client, ['team-messages', 'never-opened'], 'team')).toBe(true);
    finish(['message']); await fetch; client.clear();
  });
  it('still requires a fresh read when no fetch is active', () => {
    const client = new QueryClient();
    expect(shouldSkipChatMountInvalidate(client, ['team-messages', 'new'], 'team')).toBe(false);
    client.clear();
  });
});