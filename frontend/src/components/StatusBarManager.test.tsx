import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const route = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('react-router-dom', () => ({ useLocation: () => route }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
}));
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }) } }));
vi.mock('@capacitor/keyboard', () => ({ Keyboard: { addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }) } }));
vi.mock('@/lib/statusBarControl', () => ({ applyStatusBar: vi.fn(), refreshStatusBar: vi.fn() }));

import { StatusBarManager } from './StatusBarManager';
import { applyStatusBar, refreshStatusBar } from '@/lib/statusBarControl';

beforeEach(() => {
  vi.clearAllMocks();
  route.pathname = '/';
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('style');
  document.documentElement.className = '';
});

describe('Android header inset ownership', () => {
  it('does not force an extra 24px gap when Android reserves the top inset', async () => {
    document.documentElement.style.setProperty('--safe-area-inset-top', '0px');
    render(<StatusBarManager />);
    await waitFor(() => expect(document.documentElement.style.getPropertyValue('--safe-area-top')).toBe('0px'));
  });

  it('keeps the reported top inset when Android passes it to the WebView', async () => {
    document.documentElement.style.setProperty('--safe-area-inset-top', '28px');
    render(<StatusBarManager />);
    await waitFor(() => expect(document.documentElement.style.getPropertyValue('--safe-area-top')).toBe('28px'));
  });

  it('does not force native repaint on ordinary navigation', async () => {
    document.documentElement.className = 'dark';
    const view = render(<StatusBarManager />);
    route.pathname = '/settings';
    view.rerender(<StatusBarManager />);
    expect(refreshStatusBar).not.toHaveBeenCalled();
    expect(applyStatusBar).toHaveBeenCalled();
  });

  it('ignores unrelated root class changes but applies a real theme change', async () => {
    document.documentElement.className = 'dark';
    render(<StatusBarManager />);
    vi.mocked(applyStatusBar).mockClear();
    document.documentElement.classList.add('rm');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(applyStatusBar).not.toHaveBeenCalled();
    document.documentElement.classList.remove('dark');
    await waitFor(() => expect(applyStatusBar).toHaveBeenCalledTimes(1));
  });
});