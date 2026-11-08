import { describe, expect, it } from 'vitest';
import { browserTestSigningSeed } from '../../../supabase/functions/icp-dev-push-test/signing';

describe('isolated TEST signing configuration', () => {
  it('accepts an opaque alphanumeric key rather than requiring an old hex seed', async () => {
    const seed = await browserTestSigningSeed('fixture-only-nonsecret-opaque-key');
    expect(seed).toBeInstanceOf(Uint8Array);
    expect(seed.byteLength).toBe(32);
  });
  it('refuses missing configuration', async () => {
    await expect(browserTestSigningSeed('')).rejects.toThrow('TEST signing configuration unavailable');
  });
});