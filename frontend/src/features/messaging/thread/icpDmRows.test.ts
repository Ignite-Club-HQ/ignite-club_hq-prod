import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ profiles: vi.fn(), reactions: vi.fn() }));
vi.mock('@/lib/profileCache', () => ({ fetchProfilesWithCache: mocks.profiles }));
vi.mock('@/live/features/messaging', () => ({ listLiveReactions: mocks.reactions }));
import { mapIcpDmRows } from './icpDmRows';
const rows = [{ id: 'm1', body: 'Hello', sender: { toText: () => 'person' }, sequence: 1n, created_at_ms: 1n, attachment: [], reply_to_id: [] }];
describe('cold direct-message text', () => {
  it('publishes text immediately and starts independent enrichment together', async () => {
    let finish: (value: Map<string, unknown>) => void = () => {};
    mocks.profiles.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    mocks.reactions.mockResolvedValue([]);
    const ready = vi.fn();
    const pending = mapIcpDmRows({}, 'dm', rows, false, ready);
    expect(ready).toHaveBeenCalledWith([expect.objectContaining({ id: 'm1', text: 'Hello', author: null })]);
    expect(mocks.reactions).toHaveBeenCalledWith({}, 'dm');
    finish(new Map([['person', { display_name: 'Person' }]]));
    expect((await pending)[0].author.display_name).toBe('Person');
  });
  it('does not resolve private names or publish a cancelled read', async () => {
    mocks.profiles.mockClear(); mocks.reactions.mockResolvedValue([]);
    expect((await mapIcpDmRows({}, 'dm', rows, true))[0].author).toBeNull();
    expect(mocks.profiles).not.toHaveBeenCalled();
    const controller = new AbortController(); controller.abort(); const ready = vi.fn();
    await expect(mapIcpDmRows({}, 'dm', rows, true, ready, controller.signal)).rejects.toThrow();
    expect(ready).not.toHaveBeenCalled();
  });
});