import { beforeEach, describe, expect, it, vi } from 'vitest';
const actor = vi.hoisted(() => ({ set_app_config: vi.fn(), get_app_config: vi.fn() }));
vi.mock('../domains', () => ({ connectLiveClubDomain: vi.fn(async () => ({ actor })) }));
import { setLiveAppSetting } from './appSettings';
import type { FeatureBackendContext } from '../featureRouter';
const ctx = {} as FeatureBackendContext;
beforeEach(() => { vi.clearAllMocks(); actor.set_app_config.mockResolvedValue({ Ok: null }); });
describe('ICP shared settings save confirmation', () => {
  it('confirms the same setting on the same actor after one save', async () => {
    actor.get_app_config.mockResolvedValue(['false']);
    await setLiveAppSetting(ctx, 'chat_recap_enabled', false);
    expect(actor.set_app_config).toHaveBeenCalledExactlyOnceWith('chat_recap_enabled', 'false');
    expect(actor.get_app_config).toHaveBeenCalledExactlyOnceWith('chat_recap_enabled');
  });
  it('does not report success when readback is missing or different', async () => {
    actor.get_app_config.mockResolvedValue(['true']);
    await expect(setLiveAppSetting(ctx, 'chat_recap_enabled', false)).rejects.toThrow('could not confirm');
    expect(actor.set_app_config).toHaveBeenCalledTimes(1);
  });
  it('never repeats a write when confirmation fails', async () => {
    actor.get_app_config.mockRejectedValue(new Error('offline'));
    await expect(setLiveAppSetting(ctx, 'welcome_dm_message', 'Welcome')).rejects.toThrow('could not confirm');
    expect(actor.set_app_config).toHaveBeenCalledTimes(1);
  });
  it('server refusal never starts confirmation or another write', async () => {
    actor.set_app_config.mockResolvedValue({ Err: 'Only governor or app admin can set app config' });
    await expect(setLiveAppSetting(ctx, 'club_creation_locked', true)).rejects.toThrow();
    expect(actor.get_app_config).not.toHaveBeenCalled();
    expect(actor.set_app_config).toHaveBeenCalledTimes(1);
  });
});