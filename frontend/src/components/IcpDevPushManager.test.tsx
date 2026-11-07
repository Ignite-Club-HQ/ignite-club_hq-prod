import { render, waitFor, cleanup } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ initialize: vi.fn().mockResolvedValue({ success: false }), install: vi.fn().mockResolvedValue(undefined), subscribe: vi.fn(() => vi.fn()),
  resume: vi.fn().mockResolvedValue({ remove: vi.fn() }), user: { id: 'principal:account-a' }, navigate: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useOptionalAuth: () => ({ user: state.user }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => state.navigate }));
vi.mock('@/live/icpNativePush', () => ({ initializeDevIcpNativePush: state.initialize }));
vi.mock('@/live/icpPushTap', () => ({ installDevIcpPushTaps: state.install, subscribeDevIcpPushTaps: state.subscribe }));
vi.mock('@capacitor/app', () => ({ App: { addListener: state.resume } }));
import { IcpDevPushManager } from './IcpDevPushManager';

describe('separate ICP manager', () => {
  beforeEach(() => vi.clearAllMocks()); afterEach(cleanup);
  it('starts registration in the background without requesting permission during login', async () => {
    render(<IcpDevPushManager />);
    await waitFor(() => expect(state.initialize).toHaveBeenCalledWith('principal:account-a', false));
    expect(state.subscribe).toHaveBeenCalledWith('account-a', state.navigate);
  });
  it('does not call existing email token registration, health checks or notification synchronization', async () => {
    render(<IcpDevPushManager />);
    await waitFor(() => expect(state.resume).toHaveBeenCalledWith('resume', expect.any(Function)));
    // A failing ICP registration leaves the mounted provider running; there is no fallback provider callback.
    state.initialize.mockResolvedValueOnce({ success: false });
    state.resume.mock.calls[0][1]();
    expect(state.initialize).toHaveBeenCalledTimes(2);
  });
});