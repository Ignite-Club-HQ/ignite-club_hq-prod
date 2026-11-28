import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ allowance: vi.fn(), usage: vi.fn() }));
vi.mock('./domains', () => ({ connectLiveClubDomain: async () => ({ actor: { get_media_allowance: mocks.allowance } }) }));
vi.mock('./blobStoreUpload', () => ({ getLiveClubMediaUsage: mocks.usage }));
import { assertPhotoAllowance, checkLivePhotoUpload, photoScopeForPath, readLivePhotoAllowance } from './mediaPhotoAllowance';
import type { FeatureBackendContext } from './featureRouter';
const ctx = { target: { alias: 'owning-group' }, identity: {} } as FeatureBackendContext;
const media = (gallery: number, chat: number) => Object.fromEntries([
  ['gallery_photo', gallery], ['chat_photo', chat],
].map(([category, count]) => [category, { category: String(category), count: Number(count), bytes: 0, countLimit: 10, bytesLimit: null }]));
beforeEach(() => { vi.resetAllMocks(); mocks.allowance.mockResolvedValue({ Ok: { premium: false } }); mocks.usage.mockResolvedValue(media(9, 9)); });
describe('email-equivalent photo admission', () => {
  it.each(['gallery_photo', 'chat_photo'] as const)('allows the tenth %s and refuses the eleventh', category => {
    expect(() => assertPhotoAllowance(false, media(9, 9), category)).not.toThrow();
    expect(() => assertPhotoAllowance(false, media(10, 10), category)).toThrow('10 free');
  });
  it('refuses a two-photo album with only one remaining', () => {
    expect(() => assertPhotoAllowance(false, media(9, 0), 'gallery_photo', 2)).toThrow('10 free');
    expect(() => assertPhotoAllowance(false, media(8, 0), 'gallery_photo', 2)).not.toThrow();
  });
  it('keeps gallery and chat counts separate', () => {
    expect(() => assertPhotoAllowance(false, media(10, 0), 'chat_photo')).not.toThrow();
    expect(() => assertPhotoAllowance(false, media(0, 10), 'gallery_photo')).not.toThrow();
  });
  it('only exempts an authoritative Pro or active trial allowance', async () => {
    mocks.usage.mockResolvedValue(media(20, 20));
    await expect(checkLivePhotoUpload(ctx, 'clubs/c/chat/photo.jpg')).rejects.toThrow('10 free');
    mocks.allowance.mockResolvedValue({ Ok: { premium: true } });
    await expect(checkLivePhotoUpload(ctx, 'clubs/c/chat/photo.jpg')).resolves.toBeUndefined();
    expect(mocks.allowance).toHaveBeenCalledWith('c', []);
  });
  it('uses the exact owning-group target and team entitlement', async () => {
    await checkLivePhotoUpload(ctx, 'clubs/c/teams/t/chat/photo.jpg');
    expect(mocks.allowance).toHaveBeenCalledWith('c', ['t']);
    expect(mocks.usage).toHaveBeenCalledWith(ctx.target, ctx.identity, 'c');
  });
  it('stops uploads when subscription or media evidence is unavailable', async () => {
    mocks.allowance.mockResolvedValue({ Err: 'Club not found' });
    await expect(checkLivePhotoUpload(ctx, 'clubs/c/photo.jpg')).rejects.toThrow("couldn't check");
    mocks.allowance.mockResolvedValue({ Ok: { premium: false } });
    mocks.usage.mockRejectedValue(new Error('store offline'));
    await expect(readLivePhotoAllowance(ctx, 'c')).rejects.toThrow("couldn't check");
  });
  it('does not treat missing counters as unused quota', () => {
    expect(() => assertPhotoAllowance(false, {}, 'gallery_photo')).toThrow("couldn't check");
  });
  it.each(['clubs/c/logos/logo.jpg', 'clubs/c/sponsors/photo.jpg', 'clubs/c/vault/file.pdf', 'clubs/c/chat/files/file.pdf', 'avatars/account/photo.jpg'])('leaves branding, documents and personal media %s unchanged', async path => {
    expect(photoScopeForPath(path)).toBeNull();
    await checkLivePhotoUpload(ctx, path);
    expect(mocks.allowance).not.toHaveBeenCalled();
  });
});