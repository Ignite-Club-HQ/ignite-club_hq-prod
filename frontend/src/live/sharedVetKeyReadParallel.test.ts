import { describe, expect, it, vi } from 'vitest';
import { readSharedVetKeyMaterialsConcurrently } from './sharedVetKeyReadParallel';

describe('shared ICP vetKey cold unlock', () => {
  it('starts public verification and encrypted vetKey reads together, not serially', async () => {
    let resolvePublic!: (key: string) => void;
    let resolveEncrypted!: (key: string) => void;
    const publicRead = vi.fn(() => new Promise<string>(resolve => { resolvePublic = resolve; }));
    const encryptedRead = vi.fn(() => new Promise<string>(resolve => { resolveEncrypted = resolve; }));
    const pending = readSharedVetKeyMaterialsConcurrently(publicRead, encryptedRead);
    // Both are underway even though neither remote read has completed.
    expect(publicRead).toHaveBeenCalledTimes(1);
    expect(encryptedRead).toHaveBeenCalledTimes(1);
    resolveEncrypted('encrypted transport-bound vetKey');
    resolvePublic('public verification key');
    await expect(pending).resolves.toEqual([
      'public verification key', 'encrypted transport-bound vetKey',
    ]);
  });

  it('fails closed on a canister refusal without retrying a key read', async () => {
    const readPublic = vi.fn(async () => 'verification');
    const readEncrypted = vi.fn(async (): Promise<string> => { throw new Error('Not authorised'); });
    await expect(readSharedVetKeyMaterialsConcurrently(readPublic, readEncrypted))
      .rejects.toThrow('Not authorised');
    expect(readPublic).toHaveBeenCalledTimes(1);
    expect(readEncrypted).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the public verification key is unavailable', async () => {
    const readPublic = vi.fn(async (): Promise<string> => { throw new Error('Public key unavailable'); });
    const readEncrypted = vi.fn(async () => 'encrypted key');
    await expect(readSharedVetKeyMaterialsConcurrently(readPublic, readEncrypted))
      .rejects.toThrow('Public key unavailable');
    expect(readPublic).toHaveBeenCalledTimes(1);
    expect(readEncrypted).toHaveBeenCalledTimes(1);
  });
});
