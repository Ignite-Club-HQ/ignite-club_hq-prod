import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  platform: 'android',
  backdrop: vi.fn().mockResolvedValue(undefined),
  show: vi.fn().mockResolvedValue(undefined),
  overlay: vi.fn().mockResolvedValue(undefined),
  color: vi.fn().mockResolvedValue(undefined),
  style: vi.fn().mockResolvedValue(undefined),
  systemStyle: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native.platform !== 'web', getPlatform: () => native.platform },
  registerPlugin: () => ({ setBackgroundColor: native.backdrop }),
  SystemBars: { setStyle: native.systemStyle },
  SystemBarsStyle: { Dark: 'DARK', Light: 'LIGHT' },
  SystemBarType: { StatusBar: 'StatusBar' },
}));
vi.mock('@capacitor/status-bar', () => ({
  StatusBar: { show: native.show, setOverlaysWebView: native.overlay, setBackgroundColor: native.color, setStyle: native.style },
  Style: { Dark: 'DARK', Light: 'LIGHT' },
}));

describe('Android transparent system-bar backdrop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    native.platform = 'android';
  });

  afterEach(() => { document.documentElement.className = ''; });

  it('paints the native light backdrop and applies readable dark icons', async () => {
    const { applyStatusBar } = await import('./statusBarControl');
    applyStatusBar('light', true);
    await vi.waitFor(() => expect(native.systemStyle).toHaveBeenCalledWith({ bar: 'StatusBar', style: 'LIGHT' }));
    expect(native.backdrop).toHaveBeenCalledWith({ color: '#f5f7f6' });
    expect(native.backdrop.mock.invocationCallOrder.at(-1)).toBeGreaterThan(native.systemStyle.mock.invocationCallOrder.at(-1) ?? 0);
  });

  it('restores the dark backdrop and light icons after a viewer', async () => {
    const { applyStatusBar, applyStatusBarForViewer } = await import('./statusBarControl');
    applyStatusBarForViewer();
    applyStatusBar('dark', true);
    await vi.waitFor(() => expect(native.backdrop).toHaveBeenLastCalledWith({ color: '#0f1512' }));
    await vi.waitFor(() => expect(native.systemStyle).toHaveBeenCalledTimes(2));
    expect(native.backdrop).toHaveBeenNthCalledWith(1, { color: '#000000' });
    expect(native.systemStyle).toHaveBeenLastCalledWith({ bar: 'StatusBar', style: 'DARK' });
    expect(native.backdrop.mock.invocationCallOrder.at(-1)).toBeGreaterThan(native.systemStyle.mock.invocationCallOrder.at(-1) ?? 0);
  });

  it('does not reconfigure native bars for repeated dark navigation requests', async () => {
    const { applyStatusBar } = await import('./statusBarControl');
    for (let i = 0; i < 10; i++) applyStatusBar('dark');
    await vi.waitFor(() => expect(native.systemStyle).toHaveBeenCalledTimes(1));
    expect(native.show).toHaveBeenCalledTimes(1);
  });

  it('reads the current DOM theme at execution instead of painting stale queued themes', async () => {
    const { applyStatusBar } = await import('./statusBarControl');
    document.documentElement.className = 'light';
    applyStatusBar();
    document.documentElement.className = 'dark';
    applyStatusBar();
    await vi.waitFor(() => expect(native.systemStyle).toHaveBeenCalled());
    expect(native.systemStyle).toHaveBeenCalledTimes(1);
    expect(native.systemStyle).toHaveBeenCalledWith({ bar: 'StatusBar', style: 'DARK' });
  });

  it('retains forced recovery when native bars reset on app resume', async () => {
    document.documentElement.className = 'dark';
    const { applyStatusBar, refreshStatusBar } = await import('./statusBarControl');
    applyStatusBar();
    await vi.waitFor(() => expect(native.systemStyle).toHaveBeenCalledTimes(1));
    refreshStatusBar();
    await vi.waitFor(() => expect(native.systemStyle).toHaveBeenCalledTimes(2));
    expect(native.backdrop).toHaveBeenLastCalledWith({ color: '#0f1512' });
  });

  it('preserves the iOS icon path without Android backdrop or overlay calls', async () => {
    native.platform = 'ios';
    const { applyStatusBar } = await import('./statusBarControl');
    applyStatusBar('dark');
    await vi.waitFor(() => expect(native.style).toHaveBeenCalledWith({ style: 'DARK' }));
    expect(native.systemStyle).not.toHaveBeenCalled();
    expect(native.backdrop).not.toHaveBeenCalled();
    expect(native.overlay).not.toHaveBeenCalled();
  });

  it('does not call native plugins in a browser', async () => {
    native.platform = 'web';
    const { applyStatusBar, applyStatusBarForViewer, refreshStatusBar } = await import('./statusBarControl');
    applyStatusBar('dark');
    applyStatusBarForViewer();
    refreshStatusBar();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(native.show).not.toHaveBeenCalled();
    expect(native.systemStyle).not.toHaveBeenCalled();
  });
});