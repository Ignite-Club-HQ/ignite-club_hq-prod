import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
const state = vi.hoisted(() => ({ dev: true, principal: 'paul-test', enable: vi.fn(), copy: vi.fn() }));
vi.mock('@/live/icpPushMode', () => ({ usesDevIcpPush: () => state.dev }));
vi.mock('@/live/internetIdentityAuth', () => ({ getCurrentInternetIdentity: async () => ({ getPrincipal: () => ({ toText: () => state.principal }) }) }));
vi.mock('@/live/icpBrowserPush', () => ({ enableDevBrowserPushProbe: state.enable }));
import { IcpBrowserPushTestCard } from './IcpBrowserPushTestCard';
describe('manual TEST browser alert controls', () => {
  beforeEach(() => {
    state.dev = true; state.principal = 'paul-test'; vi.clearAllMocks();
    state.enable.mockResolvedValue({ status: 'registered', token: 'manual-test-address' });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: state.copy.mockResolvedValue(undefined) } });
  });
  it('enables with the signed-in identity and copies only the manual address', async () => {
    render(<IcpBrowserPushTestCard userId="principal:paul-test" />);
    fireEvent.click(screen.getByRole('button', { name: 'Enable test alerts' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Copy test address' }));
    await waitFor(() => expect(state.copy).toHaveBeenCalledWith('manual-test-address'));
    const config = state.enable.mock.calls[0]?.[0];
    expect(config.apiKey.length).toBeGreaterThan(0);
    expect(config.projectId.length).toBeGreaterThan(0);
    expect(config.appId).toMatch(/^1:\d+:web:/);
    expect(config.vapidKey.length).toBeGreaterThan(0);
  });
  it('never acquires an address for a different account', async () => {
    render(<IcpBrowserPushTestCard userId="principal:other-member" />);
    fireEvent.click(screen.getByRole('button', { name: 'Enable test alerts' }));
    await screen.findByRole('status');
    expect(state.enable).not.toHaveBeenCalled();
  });
  it('discards the address when the signed-in account changes', async () => {
    const view = render(<IcpBrowserPushTestCard userId="principal:paul-test" />);
    fireEvent.click(screen.getByRole('button', { name: 'Enable test alerts' }));
    await screen.findByRole('button', { name: 'Copy test address' });
    view.rerender(<IcpBrowserPushTestCard userId="principal:other-member" />);
    expect(screen.queryByRole('button', { name: 'Copy test address' })).toBeNull();
  });
  it('has no controls in Supabase or production mode', () => {
    state.dev = false;
    render(<IcpBrowserPushTestCard userId="principal:paul-test" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});