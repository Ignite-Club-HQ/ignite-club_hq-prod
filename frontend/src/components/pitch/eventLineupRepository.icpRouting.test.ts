import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), email: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mocks.email } }));
vi.mock('@/live/featureRouter', () => ({ withFeatureBackend: async (_: unknown, providers: { icp: (ctx: unknown) => unknown }) => providers.icp({}) }));
vi.mock('@/live/features/events', () => ({ getLiveLineupSnapshot: mocks.read, saveLiveLineupSnapshot: mocks.write }));
import { fetchEventLineup, saveEventLineup, buildEventLineupSnapshot } from './eventLineupRepository';
beforeEach(() => vi.clearAllMocks());
describe('ICP lineup single transport', () => {
  it.each([[], [{ players: [] }]])('returns true absence without email fallback', async raw => {
    mocks.read.mockResolvedValueOnce(raw);
    expect(await fetchEventLineup('event-a', 'team-club-a-1-1795340400000')).toBeNull();
    expect(mocks.email).not.toHaveBeenCalled();
  });
  it('propagates denied reads without querying email storage', async () => {
    mocks.read.mockRejectedValueOnce(new Error('Forbidden'));
    await expect(fetchEventLineup('event-a', 'team-a')).rejects.toThrow('Forbidden');
    expect(mocks.email).not.toHaveBeenCalled();
  });
  it('acknowledges saves and preserves rejected outcomes without fallback', async () => {
    const snapshot = buildEventLineupSnapshot({ players: [{ id: 'p', name: '', position: { x: 10, y: 20 }, minutesPlayed: 0 }], teamSize: '7', selectedFormation: 2 });
    mocks.write.mockResolvedValueOnce({ revision: 1n });
    expect(await saveEventLineup({ eventId: 'event-a', teamId: 'team-a', snapshot })).toBe(true);
    mocks.write.mockRejectedValueOnce(new Error('Forbidden'));
    await expect(saveEventLineup({ eventId: 'event-a', teamId: 'team-a', snapshot })).rejects.toThrow('Forbidden');
    expect(mocks.email).not.toHaveBeenCalled();
  });
});