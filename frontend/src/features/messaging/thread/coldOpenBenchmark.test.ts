import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ profiles: vi.fn(), reactions: vi.fn() }));
vi.mock('@/lib/profileCache', () => ({ fetchProfilesWithCache: mocks.profiles }));
vi.mock('@/live/features/messaging', () => ({ listLiveReactions: mocks.reactions }));
import { mapIcpDmRows } from './icpDmRows';

describe('deterministic uncached DM critical path benchmark (not real network)', () => {
  it('removes enrichment from first-text latency for 30 distinct never-cached threads', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    const before: number[] = []; const after: number[] = [];
    try {
      for (let i = 0; i < 30; i++) {
        mocks.profiles.mockImplementation(async () => { await wait(1200); return new Map(); });
        mocks.reactions.mockImplementation(async () => { await wait(800); return []; });
        const oldStart = Date.now();
        const old = (async () => { await wait(600); await mocks.profiles(); await mocks.reactions(); before.push(Date.now() - oldStart); })();
        await vi.advanceTimersByTimeAsync(2600); await old;
        const start = Date.now();
        const fresh = (async () => {
          await wait(600);
          return mapIcpDmRows({}, `never-cached-${i}`, [{ id: `m${i}`, body: 'text', sender: { toText: () => 'person' }, sequence: 1n, created_at_ms: 1n }], false,
            () => after.push(Date.now() - start));
        })();
        await vi.advanceTimersByTimeAsync(1800); await fresh;
      }
      expect(before).toEqual(Array(30).fill(2600));
      expect(after).toEqual(Array(30).fill(600));
      console.info('SIMULATED DM first text: 30 cold samples, median/P95 2600/2600ms before -> 600/600ms after; fixed 600ms page, 1200ms profiles, 800ms reactions. Not Android/network evidence.');
    } finally { vi.useRealTimers(); }
  });
});